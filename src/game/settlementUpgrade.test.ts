import { describe, expect, it } from "vitest";
import { ARMY_UNITS, BUILDINGS } from "./content";
import { GameSimulation } from "./simulation";
import type { RaiderState } from "./types";

function settlement() {
  const simulation = new GameSimulation();
  simulation.selectMission("siege"); simulation.start();
  const barracks = simulation.snapshot.buildings.find(b => b.kind === "barracks")!;
  return { simulation, barracks };
}
function advance(simulation: GameSimulation, seconds: number) {
  for (let i = 0; i < Math.round(seconds / 0.05); i++) simulation.tick(0.05);
}
function reload(simulation: GameSimulation) {
  const loaded = new GameSimulation();
  expect(loaded.restoreSave(JSON.parse(JSON.stringify(simulation.exportSave())))).toBe(true);
  return loaded;
}

describe("independent settlement upgrade validation", () => {
  it("reserves once, survives save/reload and refunds cancellation once", () => {
    const { simulation, barracks } = settlement();
    const initial = { ...simulation.snapshot.resources };
    expect(simulation.enqueueUnit("spearman", barracks.id)).toBe(true);
    const reserved = { ...simulation.snapshot.resources };
    expect(reserved.food).toBe(initial.food - ARMY_UNITS.spearman.cost.food!);
    expect(reserved.gold).toBe(initial.gold - ARMY_UNITS.spearman.cost.gold!);
    const loaded = reload(simulation);
    expect(loaded.snapshot.resources).toEqual(reserved);
    expect(loaded.cancelTraining(barracks.id, 0)).toBe(true);
    expect(loaded.snapshot.resources).toEqual(initial);
    expect(loaded.cancelTraining(barracks.id, 0)).toBe(false);
    expect(loaded.snapshot.resources).toEqual(initial);
  });

  it("refunds uncompleted training when its building is deliberately demolished", () => {
    const { simulation, barracks } = settlement();
    const gold = simulation.snapshot.resources.gold;
    expect(simulation.enqueueUnit("spearman", barracks.id)).toBe(true);
    expect(simulation.enqueueUnit("spearman", barracks.id)).toBe(true);
    expect(simulation.demolish(barracks.id)).toBe(true);
    expect(simulation.snapshot.resources.gold).toBe(gold + Math.floor((BUILDINGS.barracks.cost.gold ?? 0) * 0.4));
    expect(simulation.cancelTraining(barracks.id, 0)).toBe(false);
    simulation.beginPreparation(); advance(simulation, 12);
    expect(simulation.snapshot.army).toHaveLength(0);
  });

  it("accepts at most five queued units, including during pause, and freezes their clocks", () => {
    const { simulation, barracks } = settlement();
    simulation.togglePause();
    for (let i = 0; i < 5; i++) expect(simulation.enqueueUnit("spearman", barracks.id)).toBe(true);
    const reserved = { ...simulation.snapshot.resources };
    expect(simulation.enqueueUnit("spearman", barracks.id)).toBe(false);
    advance(simulation, 10);
    expect(simulation.snapshot.resources).toEqual(reserved);
    expect(barracks.trainingQueue).toHaveLength(5);
    expect(barracks.trainingQueue![0].remaining).toBe(5);
    expect(simulation.snapshot.armyCount).toBe(0);
  });

  it("completes a reloaded order without charging its price again", () => {
    const queued = settlement();
    const control = settlement();
    expect(queued.simulation.enqueueUnit("spearman", queued.barracks.id)).toBe(true);
    const loaded = reload(queued.simulation);
    loaded.beginPreparation(); control.simulation.beginPreparation();
    advance(loaded, 5.1); advance(control.simulation, 5.1);
    expect(loaded.snapshot.armyCount).toBe(1);
    expect(loaded.snapshot.buildings.find(b => b.id === queued.barracks.id)!.trainingQueue).toHaveLength(0);
    expect(loaded.snapshot.resources.gold).toBeCloseTo(control.simulation.snapshot.resources.gold - ARMY_UNITS.spearman.cost.gold!);
    expect(loaded.snapshot.resources.food).toBeCloseTo(control.simulation.snapshot.resources.food - ARMY_UNITS.spearman.cost.food!);
  });

  it("repairs progressively, freezes on pause and suspends work while an enemy is close", () => {
    const { simulation } = settlement();
    const save = simulation.exportSave()!;
    save.state.buildings.find(b => b.kind === "keep")!.hp -= 300;
    const damaged = new GameSimulation(); expect(damaged.restoreSave(save)).toBe(true);
    const keep = damaged.snapshot.buildings.find(b => b.kind === "keep")!;
    const hp = keep.hp;
    expect(damaged.repair(keep.id)).toBe(true);
    expect(keep.hp).toBe(hp);
    const afterCharge = { ...damaged.snapshot.resources };
    expect(damaged.repair(keep.id)).toBe(false);
    expect(damaged.snapshot.resources).toEqual(afterCharge);
    damaged.beginPreparation(); advance(damaged, 0.5);
    expect(keep.hp).toBeGreaterThan(hp); expect(keep.hp).toBeLessThan(keep.maxHp);
    damaged.togglePause(); const pausedHp = keep.hp; advance(damaged, 2);
    expect(keep.hp).toBe(pausedHp);
    damaged.togglePause();
    const enemy: RaiderState = { id: 900000, kind: "raider", stance: "guard", homeX: keep.gx + 3, homeZ: keep.gz, x: keep.gx + 3, z: keep.gz, hp: 1000, maxHp: 1000, speed: 0, damage: 0, cooldown: 999, elite: false, heading: 0, attacking: false, attackPulse: 0 };
    (damaged.snapshot.raiders as RaiderState[]).push(enemy);
    advance(damaged, 0.5);
    expect(keep.hp).toBe(pausedHp);
  });

  it("keeps Hold Position units at their anchor when an enemy is outside weapon range", () => {
    const { simulation, barracks } = settlement();
    expect(simulation.trainUnit("spearman", barracks.id)).toBe(true);
    const unit = simulation.snapshot.army[0];
    simulation.selectArmyUnits([unit.id]);
    expect(simulation.holdSelectedArmy()).toBe(true);
    const origin = {x: unit.x, z: unit.z};
    const enemy: RaiderState = { id: 900001, kind: "raider", stance: "guard", homeX: unit.x, homeZ: unit.z + 3, x: unit.x, z: unit.z + 3, hp: 1000, maxHp: 1000, speed: 0, damage: 0, cooldown: 999, elite: false, heading: 0, attacking: false, attackPulse: 0 };
    (simulation.snapshot.raiders as RaiderState[]).push(enemy);
    simulation.beginPreparation(); advance(simulation, 1);
    expect(Math.hypot(unit.x - origin.x, unit.z - origin.z)).toBeLessThan(0.1);
  });

  it("stops an enclosed farm and restores access through a gate", () => {
    const simulation = new GameSimulation(); simulation.start();
    let point: { gx: number; gz: number } | undefined;
    const offsets = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
    for (let gz = 2; gz < 16 && !point; gz++) for (let gx = 2; gx < 16 && !point; gx++) {
      if (simulation.canPlace("farm", gx, gz).valid && offsets.every(([dx,dz]) => simulation.canPlace("wall", gx + dx, gz + dz).valid)) point = {gx,gz};
    }
    expect(point).toBeDefined();
    expect(simulation.place("farm", point!.gx, point!.gz)).toBe(true);
    const farm = simulation.snapshot.buildings.find(b => b.kind === "farm" && b.gx === point!.gx && b.gz === point!.gz)!;
    const production = () => simulation.snapshot.economy.production.find(p => p.buildingId === farm.id)!;
    expect(production().status).not.toBe("no-access");
    for (const [dx,dz] of offsets) expect(simulation.place("wall", point!.gx + dx, point!.gz + dz)).toBe(true);
    expect(production().status).toBe("no-access");
    expect(Object.values(production().outputs).every(amount => amount === 0)).toBe(true);
    const opening = simulation.snapshot.buildings.find(b => b.gx === point!.gx && b.gz === point!.gz + 1)!;
    expect(simulation.demolish(opening.id)).toBe(true);
    expect(simulation.place("gate", opening.gx, opening.gz)).toBe(true);
    expect(production().status).not.toBe("no-access");
  });

  it("builds a line for exactly its preview price and rejects blocked lines without partial work", () => {
    const simulation = new GameSimulation(); simulation.start();
    let plan: ReturnType<GameSimulation["previewWallLine"]> | undefined;
    let start = {gx:0,gz:0}; let end = start;
    for (let gz = 1; gz < 16 && !plan; gz++) for (let gx = 1; gx < 14 && !plan; gx++) {
      const candidate = simulation.previewWallLine({gx,gz},{gx:gx+2,gz});
      if (candidate.valid) { plan = candidate; start = {gx,gz}; end = {gx:gx+2,gz}; }
    }
    expect(plan).toBeDefined();
    // A valid three-cell line must be rejected atomically if only two cells are affordable.
    const poorSave = simulation.exportSave()!;
    poorSave.state.resources.stone = 2 * BUILDINGS.wall.cost.stone!;
    const poor = new GameSimulation(); expect(poor.restoreSave(poorSave)).toBe(true);
    const poorCount = poor.snapshot.buildings.length;
    const poorResources = { ...poor.snapshot.resources };
    expect(poor.placeWallLine(start, end)).toBe(false);
    expect(poor.snapshot.buildings).toHaveLength(poorCount);
    expect(poor.snapshot.resources).toEqual(poorResources);
    const initial = simulation.snapshot.resources.stone;
    expect(simulation.placeWallLine(start,end)).toBe(true);
    expect(simulation.snapshot.resources.stone).toBe(initial - 3 * BUILDINGS.wall.cost.stone!);
    const before = simulation.snapshot.buildings.length;
    const resources = { ...simulation.snapshot.resources };
    expect(simulation.placeWallLine({gx:start.gx - 1,gz:start.gz},end)).toBe(false);
    expect(simulation.snapshot.buildings).toHaveLength(before);
    expect(simulation.snapshot.resources).toEqual(resources);
  });
});
