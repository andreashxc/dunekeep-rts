import { describe, expect, it } from "vitest";
import {
  ARMY_UNITS, BASE_STORAGE_CAPACITY, DIFFICULTIES, DIFFICULTY_LIST,
  GRANARY_GRAIN_BONUS, GRANARY_STORAGE_BONUS, MARKET_STORAGE_BONUS,
  MISSIONS, MISSION_LIST, RESOURCE_KEYS, STOCKPILE_KEYS, TRADE_RATES,
} from "./content";
import { GameSimulation } from "./simulation";
import type { ArmyUnitKind, BuildingKind, DifficultyId, MissionId, RationPolicy, TaxPolicy } from "./types";

const missionIds = MISSION_LIST.map((mission) => mission.id);

function advance(simulation: GameSimulation, seconds: number): void {
  let remaining = seconds;
  while (remaining > 0.000001) {
    const step = Math.min(0.05, remaining);
    simulation.tick(step);
    remaining -= step;
  }
}

function create(mission: MissionId = "oasis", difficulty: DifficultyId = "standard"): GameSimulation {
  const simulation = new GameSimulation();
  simulation.selectMission(mission);
  simulation.selectDifficulty(difficulty);
  simulation.start();
  return simulation;
}

function building(simulation: GameSimulation, kind: BuildingKind) {
  return simulation.snapshot.buildings.find((item) => item.kind === kind)!;
}

function production(simulation: GameSimulation, id: number) {
  return simulation.snapshot.economy.production.find((item) => item.buildingId === id)!;
}

function frozenState(simulation: GameSimulation) {
  const snapshot = simulation.snapshot;
  return JSON.parse(JSON.stringify({
    elapsed: snapshot.elapsed, raidClock: snapshot.raidClock, resources: snapshot.resources,
    population: snapshot.population, hope: snapshot.hope, buildings: snapshot.buildings,
    army: snapshot.army, raiders: snapshot.raiders, chronicle: snapshot.chronicle,
  }));
}

describe("six handcrafted scenarios", () => {
  it.each(missionIds)("loads %s with resources, terrain and its own objective rules", (id) => {
    const simulation = new GameSimulation();
    expect(simulation.selectMission(id)).toBe(true);
    const mission = MISSIONS[id]; const snapshot = simulation.snapshot;
    expect(snapshot.status).toBe("title");
    expect(snapshot.missionName).toBe(mission.name);
    expect(snapshot.mapTheme).toBe(mission.theme);
    expect(snapshot.resources).toEqual(mission.startingResources);
    expect(snapshot.waveCount).toBe(mission.waves.length);
    expect(snapshot.resourceZones).toEqual(mission.resourceZones);
    expect(snapshot.rallyPoint.gx).toBeGreaterThanOrEqual(0);
    expect(snapshot.rallyPoint.gx).toBeLessThan(snapshot.gridSize);
    expect(snapshot.rallyPoint.gz).toBeGreaterThanOrEqual(0);
    expect(snapshot.rallyPoint.gz).toBeLessThan(snapshot.gridSize);
    expect(Math.hypot(snapshot.rallyPoint.gx - mission.keep.gx, snapshot.rallyPoint.gz - mission.keep.gz)).toBeGreaterThan(0.74);
    for (const structure of snapshot.buildings) {
      const clearance = structure.kind === "keep" ? 0.74
        : structure.kind === "tower" ? 0.62
          : structure.kind === "wall" ? 0.52
            : structure.kind === "gate" ? 0
              : 0.56;
      expect(Math.hypot(snapshot.rallyPoint.gx - structure.gx, snapshot.rallyPoint.gz - structure.gz)).toBeGreaterThanOrEqual(clearance);
    }
    expect(snapshot.civilians).toBe(mission.startingPopulation);
    expect(snapshot.populationCap).toBe(mission.startingPopulationCap);
    if (mission.duel) {
      expect(mission.waves).toHaveLength(0);
      expect(snapshot.duel).not.toBeNull();
    } else {
      expect(mission.waves.length).toBeGreaterThanOrEqual(id === "oasis" ? 1 : 3);
      expect(mission.waves.at(-1)!.at).toBeLessThanOrEqual(650);
    }
    expect(mission.strategyHint.length).toBeGreaterThan(60);
    expect(mission.events.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < mission.waves.length; index += 1) expect(mission.waves[index].at).toBeGreaterThan(mission.waves[index - 1].at);
    const occupied = snapshot.buildings.map((item) => `${item.gx},${item.gz}`);
    expect(new Set(occupied).size).toBe(occupied.length);
    expect(new Set(mission.events.map((event) => event.id)).size).toBe(mission.events.length);
    for (const key of STOCKPILE_KEYS) expect(snapshot.resources[key]).toBeLessThanOrEqual(snapshot.economy.storageCapacity[key]);
  });

  it("separates three defence stages from three increasingly fast castle confrontations", () => {
    expect(missionIds).toEqual(["oasis", "canyon", "salt", "river", "ruins", "siege"]);
    expect(new Set(MISSION_LIST.map((mission) => mission.theme)).size).toBe(6);
    expect(MISSION_LIST.slice(0, 3).every((mission) => !mission.duel)).toBe(true);
    expect(MISSION_LIST.slice(3).every((mission) => mission.goalKind === "duel" && mission.duel)).toBe(true);
    expect(MISSIONS.oasis).toMatchObject({ goalKind: "tutorial", waves: [expect.any(Object)] });
    expect(MISSIONS.oasis.waves).toHaveLength(1);
    expect(MISSION_LIST.slice(3).map((mission) => mission.duel!.objective.kind))
      .toEqual(["hold-crossing", "break-fortress", "destroy-keep"]);
    expect(MISSION_LIST.slice(3).map((mission) => mission.duel!.aiPace))
      .toEqual([...MISSION_LIST.slice(3).map((mission) => mission.duel!.aiPace)].sort((a, b) => a - b));
  });

  it.each(missionIds)("uses the actual resource zones on %s", (id) => {
    const simulation = create(id);
    const { lumber, quarry, iron, fertile } = MISSIONS[id].resourceZones;
    expect(simulation.getPlacementEfficiency("lumber", lumber.gx + 1, lumber.gz)).toBe(1.4);
    expect(simulation.getPlacementEfficiency("quarry", quarry.gx - 1, quarry.gz)).toBe(1.4);
    expect(simulation.getPlacementEfficiency("ironMine", iron.gx + 1, iron.gz)).toBe(1.4);
    for (const node of [lumber, quarry, iron]) expect(simulation.canPlace("house", node.gx, node.gz).valid).toBe(false);
    expect(simulation.getPlacementEfficiency("wheatFarm", fertile.gx, fertile.gz))
      .toBeGreaterThan(simulation.getPlacementEfficiency("wheatFarm", simulation.snapshot.gridSize - 1 - fertile.gx, simulation.snapshot.gridSize - 1 - fertile.gz));
  });

  it("rejects scenario or difficulty changes while running or paused", () => {
    const simulation = create("canyon");
    expect(simulation.selectMission("salt")).toBe(false);
    expect(simulation.selectDifficulty("veteran")).toBe(false);
    simulation.togglePause();
    expect(simulation.selectMission("river")).toBe(false);
    expect(simulation.snapshot.missionId).toBe("canyon");
  });

  it("can explicitly leave a paused scenario for the campaign while preserving difficulty", () => {
    const simulation = create("canyon", "veteran");
    simulation.beginPreparation(); advance(simulation, 3); simulation.togglePause();
    simulation.returnToCampaign();
    expect(simulation.snapshot.status).toBe("title");
    expect(simulation.snapshot.elapsed).toBe(0);
    expect(simulation.snapshot.difficultyId).toBe("veteran");
    expect(simulation.selectMission("river")).toBe(true);
  });

  it("teaches the first stage in four concrete steps before its single small attack", () => {
    const simulation = create("oasis");
    expect(simulation.snapshot).toMatchObject({ goalKind: "tutorial", goalProgress: 0, goalTarget: 4, waveCount: 1 });
    expect(simulation.place("farm", 6, 10)).toBe(true);
    expect(simulation.snapshot.goalProgress).toBe(1);
    expect(simulation.place("tower", 5, 8)).toBe(true);
    expect(simulation.snapshot.goalProgress).toBe(2);
    expect(simulation.place("barracks", 5, 5)).toBe(true);
    const barracks = building(simulation, "barracks");
    expect(simulation.trainUnit("spearman", barracks.id)).toBe(true);
    expect(simulation.snapshot.goalProgress).toBe(2);
    expect(simulation.trainUnit("spearman", barracks.id)).toBe(true);
    expect(simulation.snapshot.goalProgress).toBe(3);
    simulation.beginPreparation();
    simulation.debugSpawnWave();
    for (const raider of simulation.snapshot.raiders) raider.hp = 0;
    (simulation as unknown as { raidClock: number }).raidClock = 10_000;
    simulation.tick(0.05);
    expect(simulation.snapshot).toMatchObject({ status: "victory", goalProgress: 4, wave: 1 });
  });
});

describe("difficulty rules", () => {
  it.each(DIFFICULTY_LIST)("applies $id supplies, timings, count, health and damage", (difficulty) => {
    const simulation = create("oasis", difficulty.id);
    expect(simulation.snapshot.difficultyId).toBe(difficulty.id);
    for (const key of RESOURCE_KEYS) expect(simulation.snapshot.resources[key]).toBe(Math.floor(MISSIONS.oasis.startingResources[key] * difficulty.startingResourceMultiplier));
    simulation.beginPreparation();
    expect(simulation.snapshot.nextWaveIn).toBeCloseTo(MISSIONS.oasis.waves[0].at * difficulty.waveTimeMultiplier);
    simulation.debugSpawnWave();
    const wave = MISSIONS.oasis.waves[0];
    expect(simulation.snapshot.enemiesAlive).toBe(Math.max(1, Math.round(wave.count * difficulty.enemyCountMultiplier)));
    expect(simulation.snapshot.raiders[0].maxHp).toBe(Math.round(91 * (wave.hpScale ?? 1) * difficulty.enemyHpMultiplier));
    expect(simulation.snapshot.raiders[0].damage).toBe(Math.round(14.6 * difficulty.enemyDamageMultiplier));
    simulation.restart();
    expect(simulation.snapshot.difficultyId).toBe(difficulty.id);
    expect(simulation.snapshot.preparationStarted).toBe(false);
  });
  it("orders real pressure from relaxed to veteran", () => {
    expect(DIFFICULTIES.relaxed.waveTimeMultiplier).toBeGreaterThan(1);
    expect(DIFFICULTIES.veteran.waveTimeMultiplier).toBeLessThan(1);
    expect(DIFFICULTIES.veteran.enemyDamageMultiplier).toBeGreaterThan(1);
  });
});

describe("the entire world freezes on preparation and pause", () => {
  it.each(missionIds)("never grants free time or resources during %s initial planning", (id) => {
    const simulation = create(id);
    expect(simulation.place("wall", 1, 1)).toBe(true);
    const before = frozenState(simulation);
    advance(simulation, 120);
    expect(simulation.snapshot.preparationStarted).toBe(false);
    expect(simulation.snapshot.timePaused).toBe(true);
    expect(simulation.snapshot.nextWaveIn).toBeNull();
    expect(frozenState(simulation)).toEqual(before);
    expect(simulation.beginPreparation()).toBe(true);
    expect(simulation.beginPreparation()).toBe(false);
    advance(simulation, 2.1);
    expect(simulation.snapshot.elapsed).toBeGreaterThan(2);
    expect(simulation.snapshot.timePaused).toBe(false);
  });

  it.each(["planning", "manual"] as const)("freezes positions, HP, cooldowns and economy during %s pause", (mode) => {
    const simulation = create();
    simulation.place("barracks", 5, 5);
    expect(simulation.trainUnit("spearman", building(simulation, "barracks").id)).toBe(true);
    simulation.beginPreparation(); simulation.setRallyPoint(12, 12); simulation.debugSpawnWave();
    advance(simulation, 1);
    if (mode === "planning") simulation.setPlanningPaused(true); else simulation.togglePause();
    const before = frozenState(simulation);
    expect(simulation.snapshot.timePaused).toBe(true);
    advance(simulation, 6);
    expect(frozenState(simulation)).toEqual(before);
    if (mode === "planning") simulation.setPlanningPaused(false); else simulation.togglePause();
    advance(simulation, 1);
    expect(simulation.snapshot.elapsed).toBeGreaterThan(before.elapsed);
    expect(simulation.snapshot.army[0].x).not.toBe(before.army[0].x);
  });

  it("holds an army trained from finite starting supplies still until ready", () => {
    const simulation = create();
    simulation.place("barracks", 5, 5); simulation.trainUnit("spearman", building(simulation, "barracks").id);
    simulation.setRallyPoint(12, 12);
    const before = frozenState(simulation); advance(simulation, 10);
    expect(frozenState(simulation)).toEqual(before);
  });

  it("keeps manual pause after leaving construction and rejects destructive paused HUD actions", () => {
    const simulation = create(); simulation.beginPreparation();
    simulation.setPlanningPaused(true); simulation.togglePause(); simulation.setPlanningPaused(false);
    const house = building(simulation, "house"); const before = frozenState(simulation);
    expect(simulation.demolish(house.id)).toBe(false);
    expect(simulation.repair(house.id)).toBe(false);
    advance(simulation, 2); expect(frozenState(simulation)).toEqual(before);
    expect(simulation.snapshot.timePaused).toBe(true);
  });

  it("ignores invalid and negative deltas", () => {
    const simulation = create(); simulation.beginPreparation(); const before = frozenState(simulation);
    for (const delta of [NaN, Infinity, -1, 0]) simulation.tick(delta);
    expect(frozenState(simulation)).toEqual(before);
  });

  it("stops damage and cooldowns in an active fight, not only on an empty map", () => {
    const simulation = create(); simulation.place("barracks", 7, 7);
    for (let index = 0; index < 3; index += 1) simulation.trainUnit("spearman", building(simulation, "barracks").id);
    simulation.beginPreparation(); simulation.debugSpawnWave(); simulation.debugSpawnWave();
    let combatSeen = false;
    for (let step = 0; step < 800; step += 1) {
      simulation.tick(0.05);
      combatSeen = simulation.snapshot.raiders.some((unit) => unit.hp < unit.maxHp) || simulation.snapshot.army.some((unit) => unit.hp < unit.maxHp);
      if (combatSeen) break;
    }
    expect(combatSeen).toBe(true);
    simulation.setPlanningPaused(true); const before = frozenState(simulation);
    advance(simulation, 5); expect(frozenState(simulation)).toEqual(before);
    simulation.setPlanningPaused(false); advance(simulation, 1);
    expect(frozenState(simulation)).not.toEqual(before);
  });
});

describe("productive economy", () => {
  it.each(missionIds)("has a safe first default-policy minute on %s", (id) => {
    const simulation = create(id); const before = simulation.snapshot;
    expect(before.economy.taxPolicy).toBe("standard"); expect(before.economy.rationPolicy).toBe("normal");
    expect(before.economy.staffedRatio).toBe(1); expect(before.economy.popularityTrendPerTick).toBeGreaterThan(0);
    simulation.beginPreparation(); advance(simulation, 60);
    expect(simulation.snapshot.status).toBe("playing"); expect(simulation.snapshot.resources.food).toBeGreaterThan(20);
    expect(simulation.snapshot.hope).toBeGreaterThanOrEqual(45);
    for (const key of STOCKPILE_KEYS) expect(simulation.snapshot.resources[key]).toBeLessThanOrEqual(simulation.snapshot.economy.storageCapacity[key]);
  });

  it("makes taxes an immediate income/popularity trade-off", () => {
    const run = (policy: TaxPolicy) => {
      const simulation = create(); simulation.setTaxPolicy(policy); simulation.beginPreparation();
      const before = simulation.snapshot; advance(simulation, 2.05);
      return { gold: simulation.snapshot.resources.gold - before.resources.gold, hope: simulation.snapshot.hope - before.hope };
    };
    const none = run("none"), standard = run("standard"), high = run("high");
    expect(none.gold).toBe(0); expect(standard.gold).toBeCloseTo(MISSIONS.oasis.startingPopulation * 0.12);
    expect(high.gold).toBeGreaterThan(standard.gold); expect(none.hope).toBeGreaterThan(standard.hope);
    expect(standard.hope).toBeGreaterThan(high.hope);
  });

  it("makes rations a food/popularity trade-off", () => {
    const run = (policy: RationPolicy) => {
      const simulation = create(); simulation.setRationPolicy(policy); simulation.beginPreparation();
      const before = simulation.snapshot; advance(simulation, 2.05);
      return { food: simulation.snapshot.resources.food - before.resources.food, hope: simulation.snapshot.hope - before.hope };
    };
    const half = run("half"), normal = run("normal"), double = run("double");
    expect(half.food).toBeGreaterThan(normal.food); expect(normal.food).toBeGreaterThan(double.food);
    expect(double.hope).toBeGreaterThan(normal.hope); expect(normal.hope).toBeGreaterThan(half.hope);
  });

  it("uses ration policy to change migration speed", () => {
    const slow = create(); slow.setRationPolicy("half"); slow.beginPreparation();
    const fast = create(); fast.setRationPolicy("double"); fast.beginPreparation();
    // Migration is committed on the first two-second economy tick after its interval.
    advance(slow, 16.1); advance(fast, 16.1);
    expect(slow.snapshot.civilians).toBe(MISSIONS.oasis.startingPopulation);
    expect(fast.snapshot.civilians).toBe(MISSIONS.oasis.startingPopulation + 1);
  });

  it("resets policies, production switches, events and preparation on restart", () => {
    const simulation = create("river", "veteran");
    simulation.setTaxPolicy("high"); simulation.setRationPolicy("half");
    simulation.setBuildingEnabled(building(simulation, "farm").id, false);
    simulation.beginPreparation(); advance(simulation, 70);
    expect(simulation.snapshot.chronicle.length).toBeGreaterThan(0);
    simulation.restart();
    expect(simulation.snapshot.economy.taxPolicy).toBe("standard"); expect(simulation.snapshot.economy.rationPolicy).toBe("normal");
    expect(simulation.snapshot.buildings.every((item) => item.enabled)).toBe(true);
    expect(simulation.snapshot.chronicle).toEqual([]); expect(simulation.snapshot.activeEffects).toEqual([]);
    expect(simulation.snapshot.difficultyId).toBe("veteran"); expect(simulation.snapshot.elapsed).toBe(0);
    expect(simulation.snapshot.preparationStarted).toBe(false);
  });

  it("runs wheat -> staffed mill -> bakery using only starting supplies", () => {
    const simulation = create();
    expect(simulation.place("wheatFarm", 6, 10)).toBe(true); expect(simulation.place("mill", 5, 10)).toBe(true);
    expect(simulation.place("bakery", 4, 10)).toBe(true);
    const bakery = building(simulation, "bakery");
    expect(production(simulation, bakery.id)).toMatchObject({ status: "working", workersAssigned: 1, inputs: { grain: 2, wood: 0.5 }, outputs: { food: 14 } });
    const before = simulation.snapshot.resources; simulation.beginPreparation(); advance(simulation, 2.05);
    expect(simulation.snapshot.resources.grain).toBeGreaterThan(before.grain);
    expect(simulation.snapshot.resources.wood).toBeCloseTo(before.wood - 0.5);
    expect(simulation.snapshot.resources.food).toBeGreaterThan(before.food + 7);
  });

  it("does not consume inputs when grain or a mill is missing", () => {
    const simulation = create(); simulation.place("bakery", 5, 5); const bakery = building(simulation, "bakery");
    expect(production(simulation, bakery.id).status).toBe("missing-support");
    simulation.place("mill", 6, 5); expect(production(simulation, bakery.id).status).toBe("missing-input");
    const wood = simulation.snapshot.resources.wood; simulation.beginPreparation(); advance(simulation, 2.05);
    expect(simulation.snapshot.resources.wood).toBe(wood);
    expect(simulation.snapshot.economy.warnings.some((warning) => warning.includes("сырья"))).toBe(true);
  });

  it("requires an enabled, staffed mill inside four cells", () => {
    const simulation = create("river"); simulation.place("bakery", 4, 5); simulation.place("mill", 9, 5);
    const bakery = building(simulation, "bakery"); expect(production(simulation, bakery.id).status).toBe("missing-support");
    simulation.place("mill", 5, 5);
    const nearby = simulation.snapshot.buildings.find((item) => item.kind === "mill" && item.gx === 5)!;
    expect(production(simulation, bakery.id).status).toBe("working");
    simulation.setBuildingEnabled(nearby.id, false); expect(production(simulation, bakery.id).status).toBe("missing-support");
  });

  it("converts mined iron and wood into weapons without eating stored grain", () => {
    const simulation = create("ruins"); expect(simulation.canPlace("ironMine", 1, 1).valid).toBe(false);
    expect(simulation.place("blacksmith", 8, 12)).toBe(true); const smith = building(simulation, "blacksmith");
    expect(production(simulation, smith.id)).toMatchObject({ workersNeeded: 2, inputs: { iron: 2, wood: 1 }, outputs: { weapons: 1 } });
    const before = simulation.snapshot.resources; simulation.beginPreparation(); advance(simulation, 2.05);
    expect(simulation.snapshot.resources.weapons).toBe(1);
    expect(simulation.snapshot.resources.iron).toBeCloseTo(before.iron + 2.24 - 2);
    expect(simulation.snapshot.resources.wood).toBe(before.wood - 1); expect(simulation.snapshot.resources.grain).toBe(before.grain);
  });

  it("reports hunger even with a full grain store when no bakery is running", () => {
    const simulation = create("river"); simulation.setBuildingEnabled(building(simulation, "farm").id, false);
    simulation.setRationPolicy("double"); simulation.beginPreparation(); advance(simulation, 85);
    expect(simulation.snapshot.resources.food).toBe(0);
    expect(simulation.snapshot.resources.grain).toBeGreaterThan(0);
    expect(simulation.snapshot.economy.foodNetPerTick).toBeLessThan(0);
    expect(simulation.snapshot.economy.popularityFactors.food).toBe(-3);
    expect(simulation.snapshot.economy.warnings.some((warning) => warning.includes("Еда"))).toBe(true);
  });

  it("does not spend inputs to create discarded output when storage is full", () => {
    const simulation = create("ruins"); simulation.place("blacksmith", 8, 12);
    simulation.beginPreparation(); advance(simulation, 84);
    const smith = building(simulation, "blacksmith");
    expect(simulation.snapshot.resources.weapons).toBe(BASE_STORAGE_CAPACITY.weapons);
    expect(production(simulation, smith.id).status).toBe("storage-full");
    const before = simulation.snapshot.resources.wood; advance(simulation, 2.05);
    expect(simulation.snapshot.resources.wood).toBe(before);
  });

  it("makes wells and granaries improve farming and popularity", () => {
    const simulation = create(); const farm = building(simulation, "farm");
    const before = production(simulation, farm.id).outputs.food!;
    simulation.place("well", 9, 10); expect(production(simulation, farm.id).outputs.food).toBeGreaterThan(before);
    expect(simulation.snapshot.economy.popularityFactors.water).toBeGreaterThan(0);
    simulation.place("granary", 10, 9); expect(production(simulation, farm.id).outputs.food).toBeCloseTo(before * 1.45, 1);
    expect(simulation.snapshot.economy.storageCapacity.grain).toBe(BASE_STORAGE_CAPACITY.grain + GRANARY_GRAIN_BONUS);
  });

  it("allocates real workers by priority and frees them when production is disabled", () => {
    const simulation = create(); simulation.place("barracks", 5, 5); const barracks = building(simulation, "barracks");
    for (let index = 0; index < 4; index += 1) expect(simulation.trainUnit("spearman", barracks.id)).toBe(true);
    for (let index = 0; index < 4; index += 1) expect(simulation.place("lumber", index + 2, 2)).toBe(true);
    expect(simulation.place("farm", 6, 2)).toBe(true); const last = simulation.snapshot.buildings.at(-1)!;
    expect(production(simulation, last.id).status).toBe("unstaffed");
    expect(simulation.setBuildingPriority(last.id, "high")).toBe(true); expect(production(simulation, last.id).workersAssigned).toBe(1);
    const jobs = simulation.snapshot.jobs; simulation.setBuildingEnabled(last.id, false);
    expect(simulation.snapshot.jobs).toBe(jobs - 1); expect(production(simulation, last.id).status).toBe("disabled");
    expect(simulation.snapshot.economy.warnings.some((warning) => warning.includes("работников"))).toBe(true);
  });

  it("expands storage and shrinks it correctly on demolition", () => {
    const simulation = create(); simulation.place("granary", 10, 9); simulation.place("market", 4, 4);
    const capacity = simulation.snapshot.economy.storageCapacity;
    expect(capacity.food).toBe(BASE_STORAGE_CAPACITY.food + GRANARY_STORAGE_BONUS);
    expect(capacity.grain).toBe(BASE_STORAGE_CAPACITY.grain + GRANARY_GRAIN_BONUS);
    for (const key of ["wood", "stone", "iron", "weapons"] as const) expect(capacity[key]).toBe(BASE_STORAGE_CAPACITY[key] + MARKET_STORAGE_BONUS[key]);
    expect(simulation.demolish(building(simulation, "granary").id)).toBe(true);
    expect(simulation.snapshot.economy.storageCapacity.food).toBe(BASE_STORAGE_CAPACITY.food);
  });

  it("clamps actual food overflow after demolishing a full granary", () => {
    const simulation = create("river"); simulation.place("granary", 6, 6); simulation.place("mill", 6, 5); simulation.place("bakery", 5, 5);
    simulation.beginPreparation(); advance(simulation, 65);
    expect(simulation.snapshot.resources.food).toBeGreaterThan(BASE_STORAGE_CAPACITY.food);
    expect(simulation.demolish(building(simulation, "granary").id)).toBe(true);
    expect(simulation.snapshot.resources.food).toBe(BASE_STORAGE_CAPACITY.food);
  });

  it.each(STOCKPILE_KEYS)("trades %s only through a staffed market with no arbitrage", (resource) => {
    const simulation = create("salt"); const market = building(simulation, "market"); const rate = TRADE_RATES[resource];
    const before = simulation.snapshot.resources;
    expect(simulation.trade(market.id, resource, "buy")).toBe(true);
    expect(simulation.snapshot.resources[resource]).toBe(before[resource] + rate.lot);
    expect(simulation.snapshot.resources.gold).toBe(before.gold - rate.buy);
    expect(simulation.trade(market.id, resource, "sell")).toBe(true);
    expect(simulation.snapshot.resources[resource]).toBe(before[resource]);
    expect(simulation.snapshot.resources.gold).toBe(before.gold - rate.buy + rate.sell);
    expect(simulation.trade(building(simulation, "keep").id, resource, "buy")).toBe(false);
  });

  it("rejects purchases that would overflow storage", () => {
    const simulation = create("salt"); const market = building(simulation, "market");
    while (simulation.snapshot.resources.food + TRADE_RATES.food.lot <= simulation.snapshot.economy.storageCapacity.food) expect(simulation.trade(market.id, "food", "buy")).toBe(true);
    const before = simulation.snapshot.resources; expect(simulation.trade(market.id, "food", "buy")).toBe(false);
    expect(simulation.snapshot.resources).toEqual(before);
  });

  it("keeps population inside capacity when occupied houses are demolished", () => {
    const simulation = create("canyon"); simulation.place("house", 5, 5); simulation.beginPreparation(); advance(simulation, 60);
    for (const house of simulation.snapshot.buildings.filter((item) => item.kind === "house")) simulation.demolish(house.id);
    expect(simulation.snapshot.population).toBeLessThanOrEqual(simulation.snapshot.populationCap);
  });
});

describe("safe building distance", () => {
  it("blocks construction at five cells from a living enemy and allows it beyond the boundary", () => {
    const simulation = create();
    simulation.debugSpawnWave();
    for (const raider of simulation.snapshot.raiders) { raider.x = 17; raider.z = 17; }
    const enemy = simulation.snapshot.raiders[0];
    enemy.x = 6;
    enemy.z = 1;
    expect(simulation.canPlace("wall", 1, 1)).toMatchObject({ valid: false, reason: expect.stringContaining("5 клеток") });
    enemy.x = 6.01;
    expect(simulation.canPlace("wall", 1, 1).valid).toBe(true);
  });

  it("blocks repair at five cells without spending materials", () => {
    const simulation = create();
    expect(simulation.place("wall", 1, 1)).toBe(true);
    const wall = simulation.snapshot.buildings.find((item) => item.kind === "wall" && item.gx === 1)!;
    wall.hp -= 100;
    simulation.debugSpawnWave();
    for (const raider of simulation.snapshot.raiders) { raider.x = 17; raider.z = 17; }
    const enemy = simulation.snapshot.raiders[0];
    enemy.x = 6;
    enemy.z = 1;
    const before = { ...simulation.snapshot.resources };
    expect(simulation.repair(wall.id)).toBe(false);
    expect(simulation.snapshot.resources).toEqual(before);
    expect(wall.hp).toBe(wall.maxHp - 100);
    enemy.x = 6.01;
    expect(simulation.repair(wall.id)).toBe(true);
    expect(wall.hp).toBeLessThan(wall.maxHp);
    expect(wall.repairRemaining).toBeGreaterThan(0);
  });
});

describe("army and fortifications", () => {
  it.each(["spearman", "archer", "swordsman", "knight"] as ArmyUnitKind[])("trains %s from civilians and actual paid resources", (kind) => {
    const simulation = create("ruins");
    if (kind === "swordsman" || kind === "knight") { simulation.place("blacksmith", 8, 12); simulation.beginPreparation(); advance(simulation, 8.05); }
    const definition = ARMY_UNITS[kind]; expect(simulation.place(definition.trainedAt, 5, 5)).toBe(true);
    const before = simulation.snapshot; expect(simulation.trainUnit(kind, building(simulation, definition.trainedAt).id)).toBe(true);
    expect(simulation.snapshot.armyCount).toBe(before.armyCount + 1); expect(simulation.snapshot.civilians).toBe(before.civilians - 1);
    expect(simulation.snapshot.population).toBe(before.population);
    for (const key of RESOURCE_KEYS) expect(simulation.snapshot.resources[key]).toBeCloseTo(before.resources[key] - (definition.cost[key] ?? 0));
  });

  it("rejects a mismatched military school and missing forged weapons", () => {
    const simulation = create(); simulation.place("barracks", 5, 5); const barracks = building(simulation, "barracks");
    expect(simulation.trainUnit("archer", barracks.id)).toBe(false); expect(simulation.trainUnit("swordsman", barracks.id)).toBe(false);
    expect(simulation.snapshot.armyCount).toBe(0);
  });

  it("routes allies through a gate rather than adjacent walls", () => {
    const simulation = create(); simulation.place("barracks", 5, 5);
    simulation.place("wall", 6, 4); simulation.place("gate", 6, 5); simulation.place("wall", 6, 6);
    simulation.trainUnit("spearman", building(simulation, "barracks").id);
    expect(simulation.setRallyPoint(7, 5)).toBe(true); expect(simulation.setRallyPoint(18, 5)).toBe(false);
    simulation.beginPreparation(); advance(simulation, 3);
    expect(simulation.snapshot.army[0].x).toBeGreaterThan(6.2); expect(Math.abs(simulation.snapshot.army[0].z - 5)).toBeLessThan(0.45);
  });

  it("keeps a plain tower inert without consuming a civilian job", () => {
    const simulation = create("salt");
    expect(simulation.place("tower", 15, 8)).toBe(true);
    const tower = building(simulation, "tower");
    expect(production(simulation, tower.id)).toMatchObject({ workersNeeded: 0, workersAssigned: 0 });
    const freeWorkers = simulation.snapshot.freeWorkers;
    simulation.beginPreparation();
    simulation.debugSpawnWave();
    advance(simulation, 1);
    expect(tower.cooldown).toBe(0);
    expect(simulation.snapshot.freeWorkers).toBe(freeWorkers);
  });
});

describe("finite, deterministic, pause-aware scripted events", () => {
  it.each(missionIds)("fires the first %s event only once at its scenario time", (id) => {
    const simulation = create(id); const first = MISSIONS[id].events[0];
    advance(simulation, first.at + 10); expect(simulation.snapshot.chronicle).toEqual([]);
    simulation.beginPreparation(); advance(simulation, first.at - 0.1); expect(simulation.snapshot.chronicle).toEqual([]);
    simulation.setPlanningPaused(true); advance(simulation, 3); expect(simulation.snapshot.chronicle).toEqual([]);
    simulation.setPlanningPaused(false); advance(simulation, 0.3);
    expect(simulation.snapshot.chronicle.map((event) => event.id)).toContain(first.id);
    advance(simulation, 0.5); expect(simulation.snapshot.chronicle.filter((event) => event.id === first.id)).toHaveLength(1);
    expect(simulation.snapshot.population).toBeLessThanOrEqual(simulation.snapshot.populationCap);
  });

  it("shows a seasonal modifier and restores ordinary yields when it expires", () => {
    const simulation = create("river"); const farm = building(simulation, "wheatFarm");
    for (const structure of simulation.snapshot.buildings) structure.hp = structure.maxHp = 1_000_000;
    const ordinary = production(simulation, farm.id).efficiency; simulation.beginPreparation(); advance(simulation, 65.1);
    expect(simulation.snapshot.activeEffects).toHaveLength(1); expect(production(simulation, farm.id).efficiency).toBeCloseTo(ordinary * 1.35, 1);
    advance(simulation, 100.1); expect(simulation.snapshot.activeEffects).toHaveLength(0);
    expect(production(simulation, farm.id).efficiency).toBeCloseTo(ordinary);
    expect(simulation.snapshot.chronicle.map((event) => event.id)).toContain("river-flood-end");
  });
});
