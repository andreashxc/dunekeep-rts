import { describe, expect, it } from "vitest";
import { MISSIONS } from "./content";
import { TOWER_UPGRADES } from "./duel";
import { GameSimulation } from "./simulation";
import { terrainAt, terrainBuildable, terrainFor } from "./terrain";
import type { DifficultyId } from "./types";

function recruitPair(difficulty: DifficultyId) {
  const sim = new GameSimulation();
  sim.selectMission("river"); sim.selectDifficulty(difficulty); sim.start();
  const barracks = sim.snapshot.buildings.find(building => building.kind === "barracks")!;
  expect(sim.enqueueUnit("spearman", barracks.id)).toBe(true);
  expect(sim.enqueueUnit("spearman", barracks.id)).toBe(true);
  sim.beginPreparation();
  for (let tick = 0; tick < 210; tick++) sim.tick(.05);
  expect(sim.snapshot.army).toHaveLength(2);
  return sim;
}

describe("river's alternative crossing", () => {
  it("places the initial tower legally, protects the north, and leaves the outer southern approach clear", () => {
    const config = MISSIONS.river.duel!;
    const tower = config.enemyStartingBuildings.find(building => building.kind === "tower")!;
    expect(config.enemyStartingBuildings.filter(building => building.gx === tower.gx && building.gz === tower.gz)).toHaveLength(1);
    expect(tower.gx).toBeGreaterThanOrEqual(config.enemyBuildArea.minGx);
    expect(tower.gx).toBeLessThanOrEqual(config.enemyBuildArea.maxGx);
    expect(terrainBuildable(terrainAt(terrainFor("river"), tower.gx, tower.gz))).toBe(true);
    const range = TOWER_UPGRADES.light.range;
    for (const [x, z] of [[11, 18], [12, 18], [13, 18], [14, 18], [9, 12]]) {
      expect(Math.hypot(x - tower.gx, z - tower.gz)).toBeGreaterThan(range);
    }
    expect(Math.hypot(13 - tower.gx, 8 - tower.gz)).toBeLessThan(range);
  });

  it.each(["relaxed", "standard"] as const)("lets two normally recruited soldiers cross south with full health on %s", difficulty => {
    const sim = recruitPair(difficulty);
    const ids = sim.snapshot.army.map(unit => unit.id);
    // Coarse whole-cell clicks, not fractional coordinates or direct control.
    // First stay behind the riverbank, then use the outer lane of the bridge.
    for (const [x, z] of [[7, 20], [11, 20], [11, 18], [14, 18], [14, 21]]) {
      sim.selectArmyUnits(ids);
      expect(sim.issueArmyOrder("move", { x, z })).toBe(true);
      let arrived = false;
      for (let tick = 0; tick < 800; tick++) {
        sim.tick(.05);
        const soldiers = sim.snapshot.army.filter(unit => ids.includes(unit.id));
        expect(soldiers).toHaveLength(2);
        for (const unit of soldiers) expect(unit.hp).toBe(unit.maxHp);
        if (soldiers.every(unit => unit.order?.status === "holding" || Math.hypot(unit.x - x, unit.z - z) < .65)) {
          arrived = true; break;
        }
      }
      expect(arrived, `route must reach ${x},${z}`).toBe(true);
    }
    for (const unit of sim.snapshot.army.filter(unit => ids.includes(unit.id))) {
      expect(unit.x).toBeGreaterThan(13.5);
      expect(unit.z).toBeGreaterThan(20);
    }
    expect(sim.snapshot.raidClock).toBeLessThan(45);
  });

  it("still makes an unsupported direct northern advance take real damage", () => {
    const sim = recruitPair("standard");
    sim.selectArmyUnits(sim.snapshot.army.map(unit => unit.id));
    sim.issueArmyOrder("move", { x: 14, z: 8 });
    let damageTaken = false;
    for (let tick = 0; tick < 600; tick++) {
      sim.tick(.05);
      if (sim.snapshot.army.length < 2 || sim.snapshot.army.some(unit => unit.hp < unit.maxHp)) {
        damageTaken = true; break;
      }
    }
    expect(damageTaken).toBe(true);
  });
});
