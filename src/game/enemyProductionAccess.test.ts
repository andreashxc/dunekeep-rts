import { describe, expect, it } from "vitest";
import { BUILDINGS } from "./content";
import { GameSimulation } from "./simulation";
import type { BuildingKind, BuildingState } from "./types";

/** Isolated topology fixtures loaded through validated saves. These unit tests
 * deliberately arrange buildings; the campaign tests still use only player
 * construction and recruitment, without save edits. */
function economyFixture(options: { gate?: "enemy" | "player"; version?: 1 | 2; removableWall?: boolean } = {}) {
  const source = new GameSimulation();
  source.selectMission("siege"); source.start();
  const save = source.exportSave()!;
  save.state.mapRulesVersion = options.version ?? 2;
  save.state.nextId = 1000;
  const enemy = save.state.duel!;
  const building = (id: number, kind: BuildingKind, gx: number, gz: number): BuildingState => ({
    id, kind, gx, gz, hp: BUILDINGS[kind].maxHp, maxHp: BUILDINGS[kind].maxHp,
    cooldown: 0, efficiency: 1, enabled: true, priority: "normal",
  });
  enemy.buildings = [building(100, "keep", 24, 15), building(101, "ironMine", 25, 10),
    building(102, "wall", 24, 10), building(103, "wall", 25, 9), building(104, "wall", 25, 11)];
  const exit = building(105, options.gate ? "gate" : "wall", 26, 10);
  if (options.gate === "player" || options.removableWall) save.state.buildings.push(exit);
  else enemy.buildings.push(exit);
  enemy.resources = { wood: 0, stone: 0, food: 100, gold: 0, grain: 20, iron: 0, weapons: 0 };
  enemy.population = 8;
  enemy.buildCooldown = 600; enemy.trainCooldown = 600; enemy.assaultCooldown = 600;
  const sim = new GameSimulation();
  expect(sim.restoreSave(save)).toBe(true);
  expect(sim.beginPreparation()).toBe(true);
  return sim;
}

function economyTick(sim: GameSimulation) {
  for (let step = 0; step < 40; step++) sim.tick(.05);
  // Floating point accumulation can put the first tick just below two seconds.
  sim.tick(.001);
  return sim.snapshot.duel!.enemyResources.iron;
}

describe("symmetric production connectivity", () => {
  it("stops a rival mine enclosed by walls without consuming its raw materials", () => {
    const sim = economyFixture();
    expect(economyTick(sim)).toBe(0);
    expect(economyTick(sim)).toBe(0);
  });

  it("lets rival workers use their own gate but not the player's gate", () => {
    expect(economyTick(economyFixture({ gate: "enemy" }))).toBeGreaterThan(0);
    expect(economyTick(economyFixture({ gate: "player" }))).toBe(0);
  });

  it("invalidates a cached blocked route after a player demolishes the obstruction", () => {
    const sim = economyFixture({ removableWall: true });
    expect(economyTick(sim)).toBe(0);
    expect(sim.demolish(105)).toBe(true);
    expect(economyTick(sim)).toBeGreaterThan(0);
  });

  it("preserves pre-terrain save production rules", () => {
    expect(economyTick(economyFixture({ version: 1 }))).toBeGreaterThan(0);
  });

  it("invalidates storage-source access when the player disables and reenables a market", () => {
    const save = economyFixture().exportSave()!;
    const keep = save.state.buildings.find(building => building.kind === "keep")!;
    const make = (id: number, kind: BuildingKind, gx: number, gz: number): BuildingState => ({
      id, kind, gx, gz, hp: BUILDINGS[kind].maxHp, maxHp: BUILDINGS[kind].maxHp,
      cooldown: 0, efficiency: 1, enabled: true, priority: "normal",
    });
    save.state.buildings = [keep, make(200, "ironMine", 6, 7), make(201, "market", 5, 7)];
    save.state.civilianEntities = save.state.civilianEntities.map(civilian => ({ ...civilian, jobBuildingId: null }));
    // An enclosed five-by-five yard can reach its local storage but not keep.
    let nextId = 202;
    for (let x = 4; x <= 8; x++) for (let z = 5; z <= 9; z++) {
      if (x === 4 || x === 8 || z === 5 || z === 9) save.state.buildings.push(make(nextId++, "wall", x, z));
    }
    const sim = new GameSimulation();
    expect(sim.restoreSave(save)).toBe(true);
    const output = () => sim.snapshot.economy.production.find(row => row.buildingId === 200)!;
    expect(output().outputs.iron).toBeGreaterThan(0);
    expect(sim.setBuildingEnabled(201, false)).toBe(true);
    expect(output().status).toBe("no-access");
    expect(output().outputs.iron ?? 0).toBe(0);
    expect(sim.setBuildingEnabled(201, true)).toBe(true);
    expect(output().outputs.iron).toBeGreaterThan(0);
  });

  it("requires both a reachable and staffed mill before the rival bakery consumes grain", () => {
    const makeBakery = (millReachable: boolean, staffed: boolean) => {
      const base = economyFixture({ gate: "enemy" });
      const save = base.exportSave()!;
      const enemy = save.state.duel!;
      enemy.resources.wood = 10;
      const mine = enemy.buildings.find(building => building.id === 101)!;
      // The enclosed mill is within bakery support radius, so distance alone
      // cannot satisfy the chain. A reachable gate opens its service entrance.
      Object.assign(mine, { kind: "mill", hp: BUILDINGS.mill.maxHp, maxHp: BUILDINGS.mill.maxHp });
      if (!millReachable) {
        const gate = enemy.buildings.find(building => building.id === 105)!;
        Object.assign(gate, { kind: "wall", hp: BUILDINGS.wall.maxHp, maxHp: BUILDINGS.wall.maxHp });
      }
      enemy.buildings.push({ id: 106, kind: "bakery", gx: 23, gz: 12,
        hp: BUILDINGS.bakery.maxHp, maxHp: BUILDINGS.bakery.maxHp, cooldown: 0,
        efficiency: 1, enabled: true, priority: "normal" });
      // Allocate the only worker to the bakery first. The mill physically
      // exists but is unstaffed, which used to be sufficient for rival bread.
      if (!staffed) { mine.id = 107; enemy.population = 1; }
      const sim = new GameSimulation();
      expect(sim.restoreSave(save)).toBe(true);
      return sim;
    };
    for (const [reachable, staffed] of [[false, true], [true, false], [true, true]]) {
      const sim = makeBakery(reachable, staffed);
      const grain = sim.snapshot.duel!.enemyResources.grain;
      economyTick(sim);
      expect(sim.snapshot.duel!.enemyResources.grain).toBe(reachable && staffed ? grain - 2 : grain);
    }
  });
});
