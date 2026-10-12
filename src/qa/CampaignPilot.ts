import { MISSIONS } from "../game/content";
import type { GameSimulation } from "../game/simulation";
import type { BuildingKind, GameSnapshot, GridPoint, MissionId } from "../game/types";

type ActionKind = "build" | "repair" | "upgrade" | "trade" | "recruit" | "order";
export interface CampaignPilotDiagnostics {
  policy: "fortified";
  missionId: MissionId | null;
  state: "waiting" | "running" | "paused" | "unsupported" | "completed" | "mission-changed";
  decisions: number;
  actions: number;
  actionCounts: Record<ActionKind, number>;
  lastAction: string | null;
  lastDecisionAt: number | null;
}

/** Opt-in local QA player. The caller owns activation and the real game loop.
 * This class only submits ordinary player commands: it never starts a mission,
 * advances time, changes speed, writes snapshots, or injects resources. */
export class CampaignPilot {
  private report: CampaignPilotDiagnostics = {
    policy: "fortified", missionId: null, state: "waiting", decisions: 0, actions: 0,
    actionCounts: { build: 0, repair: 0, upgrade: 0, trade: 0, recruit: 0, order: 0 },
    lastAction: null, lastDecisionAt: null,
  };
  private targetId: number | null = null;
  private actionsThisDecision = 0;
  private cells = new Map<string, GridPoint[]>();

  constructor(private readonly sim: GameSimulation) {}

  diagnostics(): CampaignPilotDiagnostics {
    return { ...this.report, actionCounts: { ...this.report.actionCounts } };
  }

  update(): void {
    const s = this.sim.snapshot;
    if (!s.duel) { this.report.state = "unsupported"; return; }
    if (this.report.missionId && (this.report.missionId !== s.missionId
      || s.raidClock < (this.report.lastDecisionAt ?? 0))) {
      this.report.state = "mission-changed"; return;
    }
    if (!this.sim.isRunning) {
      this.report.state = s.missionCompleted ? "completed" : s.status === "paused" || s.preparationStarted && s.timePaused ? "paused" : "waiting";
      return;
    }
    this.report.state = "running";
    if (this.report.lastDecisionAt !== null && s.raidClock - this.report.lastDecisionAt < 1 - 1e-8) return;
    this.report.missionId = s.missionId;
    this.report.lastDecisionAt = s.raidClock;
    this.report.decisions++;
    this.actionsThisDecision = 0;
    this.decide(s);
  }

  private act(kind: ActionKind, label: string, command: () => boolean): boolean {
    if (this.actionsThisDecision >= 4 || !command()) return false;
    this.actionsThisDecision++;
    this.report.actions++;
    this.report.actionCounts[kind]++;
    this.report.lastAction = label;
    return true;
  }

  private place(kind: BuildingKind, anchor: GridPoint, s: GameSnapshot): boolean {
    if (!this.sim.canAfford(kind)) return false;
    const key = `${s.gridSize}:${anchor.gx}:${anchor.gz}`;
    let candidates = this.cells.get(key);
    if (!candidates) {
      candidates = [];
      for (let gx = 0; gx < s.gridSize; gx++) for (let gz = 0; gz < s.gridSize; gz++) candidates.push({ gx, gz });
      candidates.sort((a,b) => Math.hypot(a.gx-anchor.gx,a.gz-anchor.gz)-Math.hypot(b.gx-anchor.gx,b.gz-anchor.gz));
      this.cells.set(key, candidates);
    }
    const cell = candidates.find(p => Math.hypot(p.gx-s.keep.gx,p.gz-s.keep.gz) >= 2.5
      && p.gz !== s.keep.gz
      && !s.buildings.some(b => Math.abs(b.gx-p.gx)+Math.abs(b.gz-p.gz) <= 1)
      && this.sim.canPlace(kind,p.gx,p.gz).valid);
    return Boolean(cell && this.act("build", `${kind} at ${cell.gx},${cell.gz}`, () => this.sim.place(kind,cell.gx,cell.gz)));
  }

  private decide(s: GameSnapshot): void {
    const mission = MISSIONS[s.missionId];
    const keep = s.keep;
    const count = (kind: BuildingKind) => s.buildings.filter(b => b.kind === kind).length;
    const ensure = (kind: BuildingKind, number: number, anchor = keep) => count(kind) < number && this.place(kind,anchor,s);
    // Retain existing orders; add reinforcements only when a viable force exists.
    if (!s.missionCompleted && s.missionId !== "river" && s.armyCount >= 18
      && s.army.filter(u => u.kind === "catapult").length >= 5) {
      const targets = s.duel!.enemyBuildings.filter(b => b.hp > 0
        && (s.missionId !== "ruins" || ["wall","gate","tower","keep"].includes(b.kind)));
      const target = (s.missionId === "siege" ? targets.find(b => b.kind === "keep") : undefined)
        ?? targets.find(b => b.id === this.targetId)
        ?? [...targets].sort((a,b) => Math.hypot(a.gx-keep.gx,a.gz-keep.gz)-Math.hypot(b.gx-keep.gx,b.gz-keep.gz))[0];
      if (target) {
        const ready = s.army.filter(u => !u.order || u.order.targetBuildingId !== target.id);
        if (ready.length) this.act("order", `attack building ${target.id}`, () => {
          this.sim.selectArmyUnits(ready.map(u => u.id));
          return this.sim.issueArmyAttackBuildingOrder(target.id);
        });
        this.targetId = target.id;
      }
    }
    for (const b of s.buildings.filter(b => b.hp < b.maxHp * .8 && !b.repairRemaining)) {
      this.act("repair", `repair ${b.kind} ${b.id}`, () => this.sim.repair(b.id));
    }
    if (s.populationCap-s.population < 4 && s.populationCap < 64
      && ensure("house",count("house")+1,{gx:keep.gx-2,gz:keep.gz+3})) return;
    if (ensure("lumber",2,mission.resourceZones.lumber) || ensure("quarry",2,mission.resourceZones.quarry)) return;
    if ((s.economy.foodNetPerTick < 0 || s.resources.food < 90) && count("farm") < 7
      && this.place("farm",mission.resourceZones.fertile,s)) return;
    if (ensure("farm",2,mission.resourceZones.fertile)
      || ensure("well",1,mission.resourceZones.fertile) || ensure("granary",1,mission.resourceZones.fertile)) return;
    const plain = s.buildings.find(b => b.kind === "tower" && (b.towerUpgrade ?? "none") === "none");
    const upgrade = s.buildings.some(b => b.towerUpgrade === "heavy") ? "light" : "heavy";
    if (plain && this.act("upgrade", `${upgrade} tower ${plain.id}`, () => this.sim.upgradeTower(plain.id,upgrade))) return;
    if (count("tower") < 4 && this.place("tower",{gx:keep.gx+3,gz:keep.gz+(count("tower")-2)*3},s)) return;
    if (ensure("market",1) || ensure("ironMine",1,mission.resourceZones.iron) || ensure("blacksmith",1)) return;
    const market = s.buildings.find(b => b.kind === "market");
    if (market) {
      if (s.resources.gold > 200) for (const resource of ["wood","stone","food"] as const) {
        if (s.resources[resource] < 100) this.act("trade", `buy ${resource}`, () => this.sim.trade(market.id,resource,"buy"));
      }
      for (const resource of ["food","stone","wood","weapons"] as const) {
        if (s.resources[resource] > (resource === "weapons" ? 16 : 180)) this.act("trade", `sell ${resource}`, () => this.sim.trade(market.id,resource,"sell"));
      }
    }
    if (ensure("archery",1) || ensure("barracks",1) || (s.missionId !== "river" && ensure("siegeWorkshop",1))) return;
    const current = this.sim.snapshot;
    const queued = current.buildings.flatMap(b => b.trainingQueue ?? []);
    if (current.freeWorkers <= 2 || current.resources.food <= 45 || current.armyCount+queued.length >= 22) return;
    const units = [...current.army,...queued];
    const workshop = current.buildings.find(b => b.kind === "siegeWorkshop");
    if (s.missionId !== "river" && units.filter(u => u.kind === "catapult").length < 8 && workshop
      && this.act("recruit","queue catapult",() => this.sim.enqueueUnit("catapult",workshop.id))) return;
    const archery = current.buildings.find(b => b.kind === "archery");
    if (units.filter(u => u.kind === "archer").length < 8 && archery
      && this.act("recruit","queue archer",() => this.sim.enqueueUnit("archer",archery.id))) return;
    const barracks = current.buildings.find(b => b.kind === "barracks");
    const kind = current.resources.weapons > 10 ? "swordsman" : "spearman";
    if (barracks) this.act("recruit",`queue ${kind}`,() => this.sim.enqueueUnit(kind,barracks.id));
  }
}
