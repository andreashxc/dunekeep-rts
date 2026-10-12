import { describe, expect, it } from "vitest";
import { GameSimulation } from "./simulation";
import { terrainAt, terrainFor, terrainPassable } from "./terrain";

function river() {
  const sim = new GameSimulation();
  sim.selectMission("river");
  sim.start();
  return sim;
}

describe("terrain rules through player commands", () => {
  it("rejects water, crossings and rocks without spending resources", () => {
    const sim = river();
    const before = sim.snapshot.resources;
    expect(sim.canPlace("wall", 12, 13)).toMatchObject({ valid: false, reason: expect.stringContaining("Вода") });
    expect(sim.place("wall", 12, 13)).toBe(false);
    expect(sim.canPlace("wall", 12, 8)).toMatchObject({ valid: false, reason: expect.stringContaining("переправу") });
    expect(sim.snapshot.resources).toEqual(before);
    const canyon = new GameSimulation();
    canyon.selectMission("canyon"); canyon.start();
    expect(canyon.canPlace("house", 1, 8)).toMatchObject({ valid: false, reason: expect.stringContaining("Скалы") });
  });

  it("routes a recruited squad over a crossing instead of through the river", () => {
    const sim = river();
    const barracks = sim.snapshot.buildings.find(b => b.kind === "barracks")!;
    for (let index = 0; index < 5; index++) expect(sim.enqueueUnit("spearman", barracks.id)).toBe(true);
    sim.beginPreparation();
    for (let step = 0; step < 520; step++) sim.tick(.05);
    expect(sim.snapshot.army).toHaveLength(5);
    const soldierIds = sim.snapshot.army.map(unit => unit.id);
    sim.selectArmyUnits(soldierIds);
    expect(sim.issueArmyOrder("move", { x: 15, z: 13 })).toBe(true);
    let reachedFarBank = false;
    let crossedBridge = false;
    const terrain = terrainFor("river", 2);
    for (let step = 0; step < 1600; step++) {
      sim.tick(.05);
      // The rival tower covers the far bank; casualties are valid. Every live
      // member must stay on land and at least one must actually cross.
      for (const unit of sim.snapshot.army.filter(unit => soldierIds.includes(unit.id))) {
        const tile = terrainAt(terrain, unit.x, unit.z);
        expect(terrainPassable(tile), `blocked tile at ${unit.x},${unit.z}`).toBe(true);
        if (tile === "crossing") crossedBridge = true;
        if (unit.x >= 14.5) reachedFarBank = true;
      }
      if (reachedFarBank) break;
    }
    expect(crossedBridge).toBe(true);
    expect(reachedFarBank).toBe(true);
  });

  it("round-trips new terrain and preserves the flat rules of legacy saves", () => {
    const sim = new GameSimulation();
    sim.selectMission("canyon"); sim.start();
    const modern = sim.exportSave()!;
    expect(modern.state.mapRulesVersion).toBe(2);
    const restored = new GameSimulation();
    expect(restored.restoreSave(modern)).toBe(true);
    expect(restored.canPlace("wall", 1, 8).valid).toBe(false);
    // Removing this optional field models an actual pre-terrain save, not a
    // campaign shortcut. No resources, units, positions, or outcomes are changed.
    const legacy = structuredClone(modern);
    delete legacy.state.mapRulesVersion;
    const oldGame = new GameSimulation();
    expect(oldGame.restoreSave(legacy)).toBe(true);
    expect(oldGame.snapshot.mapRulesVersion).toBe(1);
    expect(oldGame.canPlace("wall", 1, 8).valid).toBe(true);
    expect(oldGame.place("wall", 1, 8)).toBe(true);
    const savedAgain = oldGame.exportSave()!;
    expect(savedAgain.state.mapRulesVersion).toBe(1);
    const oldReloaded = new GameSimulation();
    expect(oldReloaded.restoreSave(savedAgain)).toBe(true);
    expect(oldReloaded.snapshot.buildings.some(b => b.kind === "wall" && b.gx === 1 && b.gz === 8)).toBe(true);
  });
});
