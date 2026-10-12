import { describe, expect, it } from "vitest";
import { BUILDINGS } from "./content";
import { GameSimulation } from "./simulation";
import type { BuildingKind, Resources } from "./types";

const plots = [[7, 11], [5, 11], [7, 13], [9, 11], [5, 9], [9, 13]] as const;

/** Identical six tiles, six production workers, water/storage support and funding
 * period. Materials are earned normally; all setup uses player commands. */
function productionEstate(kind: "dates" | "bread") {
  const sim = new GameSimulation();
  sim.start();
  const initialFarm = sim.snapshot.buildings.find(b => b.kind === "farm")!;
  sim.setBuildingEnabled(initialFarm.id, false);
  expect(sim.place("lumber", 3, 14)).toBe(true);
  sim.beginPreparation();
  for (let step = 0; step < 1220; step++) sim.tick(.05);
  expect(sim.place("well", 7, 10)).toBe(true);
  expect(sim.place("granary", 7, 12)).toBe(true);
  const kinds: BuildingKind[] = kind === "dates"
    ? Array(6).fill("farm") : ["mill", "wheatFarm", "wheatFarm", "bakery", "bakery", "bakery"];
  const ids: number[] = [];
  const construction: Partial<Resources> = {};
  for (let index = 0; index < plots.length; index++) {
    const [gx, gz] = plots[index];
    expect(sim.place(kinds[index], gx, gz), `${kind}: ${kinds[index]} at ${gx},${gz}`).toBe(true);
    ids.push(sim.snapshot.buildings.find(b => b.gx === gx && b.gz === gz)!.id);
    for (const [resource, amount] of Object.entries(BUILDINGS[kinds[index]].cost)) {
      const key = resource as keyof Resources;
      construction[key] = (construction[key] ?? 0) + amount;
    }
  }
  const report = () => {
    const rows = sim.snapshot.economy.production.filter(row => ids.includes(row.buildingId));
    return {
      kind, tiles: ids.length,
      workers: rows.reduce((sum,row) => sum + row.workersAssigned, 0),
      foodPerTick: rows.reduce((sum,row) => sum + (row.outputs.food ?? 0), 0),
      grainProduced: rows.reduce((sum,row) => sum + (row.outputs.grain ?? 0), 0),
      grainConsumed: rows.reduce((sum,row) => sum + (row.inputs.grain ?? 0), 0),
      woodConsumed: rows.reduce((sum,row) => sum + (row.inputs.wood ?? 0), 0),
      construction,
    };
  };
  return { sim, report };
}

describe("equal-area staffed food economy", () => {
  it("makes a developed bread chain at least 10% more productive while charging its extra materials", () => {
    const dates = productionEstate("dates").report();
    const bread = productionEstate("bread").report();
    console.info("food-chain-comparison", JSON.stringify({dates, bread, advantagePercent: (bread.foodPerTick / dates.foodPerTick - 1) * 100}));
    expect(dates.tiles).toBe(6);
    expect(bread.tiles).toBe(dates.tiles);
    expect(dates.workers).toBe(6);
    expect(bread.workers).toBe(dates.workers);
    expect(bread.foodPerTick).toBeGreaterThanOrEqual(dates.foodPerTick * 1.1);
    expect(bread.woodConsumed).toBeGreaterThan(0);
    expect(bread.grainProduced).toBeGreaterThanOrEqual(bread.grainConsumed);
    expect(bread.construction.wood).toBeGreaterThan(dates.construction.wood!);
    expect(bread.construction.stone).toBeGreaterThan(dates.construction.stone!);
  });


  it.each(["dates", "bread"] as const)("delivers the projected %s food through the actual economy tick", kind => {
    const { sim } = productionEstate(kind);
    const before = sim.snapshot;
    const expectedNet = before.economy.foodNetPerTick;
    // The shared funding period ends at 61s, away from growth/events. Two
    // seconds contain exactly one economy tick with no storage saturation.
    for (let step = 0; step < 40; step++) sim.tick(.05);
    expect(sim.snapshot.resources.food - before.resources.food).toBeCloseTo(expectedNet, 2);
  });

  it("requires an active staffed mill and resumes when the support is restored", () => {
    const estate = productionEstate("bread");
    const mill = estate.sim.snapshot.buildings.find(b => b.kind === "mill")!;
    const operating = estate.report().foodPerTick;
    expect(operating).toBeGreaterThan(0);
    expect(estate.sim.setBuildingEnabled(mill.id, false)).toBe(true);
    expect(estate.report().foodPerTick).toBe(0);
    expect(estate.sim.snapshot.economy.production.filter(row => row.kind === "bakery").every(row => row.status === "missing-support")).toBe(true);
    expect(estate.sim.setBuildingEnabled(mill.id, true)).toBe(true);
    expect(estate.report().foodPerTick).toBe(operating);
  });
});
