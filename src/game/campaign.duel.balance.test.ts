import { describe, expect, it } from "vitest";
import { MISSIONS } from "./content";
import { GameSimulation } from "./simulation";
import type { BuildingKind, GridPoint } from "./types";

/** Only player commands and read-only snapshots. No state injection, debug waves,
 * direct-control damage tricks, save editing, or changes to mission tuning. */
function playDuel(id: "river" | "ruins" | "siege", policy: "fortified" | "mobile" = "fortified") {
  const sim = new GameSimulation();
  sim.selectMission(id); sim.selectDifficulty("standard"); sim.start(); sim.setTimeScale(2);
  const mission = MISSIONS[id];
  const keep = mission.keep;
  const towerLimit = policy === "mobile" ? 2 : 4;
  const catapultLimit = policy === "mobile" ? 6 : 8;
  const count = (kind: BuildingKind) => sim.snapshot.buildings.filter(b => b.kind === kind).length;
  function place(kind: BuildingKind, anchor: GridPoint): boolean {
    if (!sim.canAfford(kind)) return false;
    const cells: (GridPoint & { distance: number })[] = [];
    const size = sim.snapshot.gridSize;
    for (let gx = 0; gx < size; gx++) for (let gz = 0; gz < size; gz++) {
      cells.push({ gx, gz, distance: Math.hypot(gx - anchor.gx, gz - anchor.gz) });
    }
    cells.sort((a, b) => a.distance - b.distance);
    const occupied = sim.snapshot.buildings;
    const cell = cells.find(p => Math.hypot(p.gx-keep.gx,p.gz-keep.gz) >= 2.5
      && p.gz !== keep.gz && !occupied.some(b => Math.abs(b.gx-p.gx)+Math.abs(b.gz-p.gz) <= 1)
      && sim.canPlace(kind, p.gx, p.gz).valid);
    return cell ? sim.place(kind, cell.gx, cell.gz) : false;
  }
  const ensure = (kind: BuildingKind, n: number, anchor = keep) => count(kind) < n && place(kind, anchor);
  ensure("lumber", 1, mission.resourceZones.lumber);
  ensure("quarry", 1, mission.resourceZones.quarry);
  ensure("farm", 2, mission.resourceZones.fertile);
  sim.beginPreparation();
  const buildings = new Set(sim.snapshot.buildings.map(b => b.id));
  const army = new Set<number>();
  let peakCatapultsIncludingQueue = 0;
  let minimumFood = sim.snapshot.resources.food;
  let minimumKeepHp = sim.snapshot.buildings.find(b => b.kind === "keep")!.hp;
  const observe = () => {
    const s = sim.snapshot;
    peakCatapultsIncludingQueue = Math.max(peakCatapultsIncludingQueue, s.army.filter(u => u.kind === "catapult").length + s.buildings.flatMap(b => b.trainingQueue ?? []).filter(u => u.kind === "catapult").length);
    for (const b of s.buildings) buildings.add(b.id);
    for (const u of s.army) army.add(u.id);
    minimumFood = Math.min(minimumFood, s.resources.food);
    minimumKeepHp = Math.min(minimumKeepHp, s.buildings.find(b => b.kind === "keep")?.hp ?? 0);
  };
  let attacks = 0;
  let targetId: number | null = null;
  for (let decision = 0; decision < 1200 && sim.snapshot.status === "playing"; decision++) {
    for (let tick = 0; tick < 20 && sim.snapshot.status === "playing"; tick++) { observe(); sim.tick(0.05); }
    observe();
    let s = sim.snapshot;
    if (s.status !== "playing") break;
    // Reissue only to new reinforcements or a new target, not every frame.
    if (id !== "river" && s.army.filter(u => u.kind === "catapult").length >= 5 && s.armyCount >= 18) {
      const targets = s.duel!.enemyBuildings.filter(b => b.hp > 0 && (id !== "ruins" || ["wall", "gate", "tower", "keep"].includes(b.kind)));
      const target = (id === "siege" ? targets.find(b => b.kind === "keep") : undefined) ?? targets.find(b => b.id === targetId) ?? targets.sort((a,b) => Math.hypot(a.gx-keep.gx,a.gz-keep.gz)-Math.hypot(b.gx-keep.gx,b.gz-keep.gz))[0];
      if (target) {
        const ready = s.army.filter(u => !u.order || u.order.targetBuildingId !== target.id);
        if (ready.length) { sim.selectArmyUnits(ready.map(u => u.id)); sim.issueArmyAttackBuildingOrder(target.id); attacks++; }
        targetId = target.id;
      }
    }
    for (const b of s.buildings.filter(b => b.hp < b.maxHp * .8)) sim.repair(b.id);
    if (s.populationCap - s.population < 4 && s.populationCap < 64 && ensure("house", count("house") + 1, {gx: keep.gx-2,gz:keep.gz+3})) continue;
    if (ensure("lumber", 2, mission.resourceZones.lumber) || ensure("quarry", 2, mission.resourceZones.quarry)) continue;
    if ((s.economy.foodNetPerTick < 0 || s.resources.food < 90) && count("farm") < 7 && place("farm", mission.resourceZones.fertile)) continue;
    if (ensure("well", 1, mission.resourceZones.fertile) || ensure("granary", 1, mission.resourceZones.fertile)) continue;
    const plain = s.buildings.find(b => b.kind === "tower" && (b.towerUpgrade ?? "none") === "none");
    if (plain && sim.upgradeTower(plain.id, s.buildings.some(b => b.towerUpgrade === "heavy") ? "light" : "heavy")) continue;
    if (count("tower") < towerLimit && place("tower", {gx:keep.gx+3,gz:keep.gz+(count("tower")-2)*3})) continue;
    if (ensure("market",1) || ensure("ironMine",1,mission.resourceZones.iron) || ensure("blacksmith",1)) continue;
    const market = s.buildings.find(b => b.kind === "market");
    if (market && s.resources.gold > 200) {
      for (const resource of ["wood", "stone", "food"] as const) if (s.resources[resource] < 100) sim.trade(market.id, resource, "buy");
    }
    if (market) for (const resource of ["food", "stone", "wood", "weapons"] as const) {
      if (s.resources[resource] > (resource === "weapons" ? 16 : 180)) sim.trade(market.id, resource, "sell");
    }
    if (ensure("archery",1) || ensure("barracks",1) || (id !== "river" && ensure("siegeWorkshop",1))) continue;
    s = sim.snapshot;
    const queued = s.buildings.flatMap(b => b.trainingQueue ?? []);
    if (s.freeWorkers > 2 && s.resources.food > 45 && s.armyCount + queued.length < 22) {
      const catapults = s.army.filter(u => u.kind === "catapult").length + queued.filter(u => u.kind === "catapult").length;
      const archers = s.army.filter(u => u.kind === "archer").length + queued.filter(u => u.kind === "archer").length;
      const workshop = s.buildings.find(b => b.kind === "siegeWorkshop");
      if (id !== "river" && catapults < catapultLimit && workshop && sim.enqueueUnit("catapult",workshop.id)) continue;
      const archery = s.buildings.find(b => b.kind === "archery");
      if (archers < 8 && archery && sim.enqueueUnit("archer",archery.id)) continue;
      const barracks = s.buildings.find(b => b.kind === "barracks");
      if (barracks) sim.enqueueUnit(s.resources.weapons > 10 ? "swordsman" : "spearman",barracks.id);
    }
  }
  const s = sim.snapshot;
  return { id, policy, towers:count("tower"), status:s.status, seconds:Math.round(s.raidClock), goal:s.goalProgress,target:s.goalTarget,
    minimumFood:Math.round(minimumFood), minimumKeepHp:Math.round(minimumKeepHp),
    buildingsLost:buildings.size-s.buildings.length, unitsLost:army.size-s.army.length,
    army:s.armyCount, peakCatapultsIncludingQueue, attacks, resources:s.resources, duel:s.duel && {assaults:s.duel.assaultsDefeated},
    gridSize:s.gridSize, unitsSeen:army.size, buildingsSeen:buildings.size,
    survivingArmy:s.army.map(u => u.kind) };
}

describe("public-API complete standard duel campaign", () => {
  it.each((["river", "ruins", "siege"] as const).flatMap(id => (["fortified", "mobile"] as const).map(policy => ({id, policy}))))("completes $id with $policy player commands", ({id, policy}) => {
    const result = playDuel(id, policy);
    console.info("duel-campaign-balance", JSON.stringify(result));
    expect(result.status, JSON.stringify(result)).toBe("victory");
    expect(result.goal).toBeGreaterThanOrEqual(result.target);
    expect(result.gridSize).toBe(MISSIONS[id].gridSize);
    expect(result.minimumKeepHp).toBeGreaterThan(0);
    expect(result.towers).toBeLessThanOrEqual(policy === "mobile" ? 2 : 4);
    expect(result.peakCatapultsIncludingQueue).toBeLessThanOrEqual(policy === "mobile" ? 6 : 8);
    expect(result.unitsLost).toBeGreaterThanOrEqual(0);
    if (id === "river") expect(result.duel?.assaults).toBeGreaterThanOrEqual(2);
    else expect(result.attacks).toBeGreaterThan(0);
  }, 90000);
});
