import { describe, expect, it, vi } from "vitest";
import { ARMY_UNITS, BUILDINGS } from "./content";
import { TOWER_UPGRADES } from "./duel";
import { GameSimulation } from "./simulation";
import type { BuildingState, DifficultyId, DuelCastleState, EnemyUnitKind, GridPoint, RaiderState } from "./types";

function createDuel(difficulty: DifficultyId = "standard"): GameSimulation {
  const simulation = new GameSimulation();
  expect(simulation.selectMission("siege")).toBe(true);
  expect(simulation.selectDifficulty(difficulty)).toBe(true);
  simulation.start();
  return simulation;
}

function createConfrontation(mission: "river" | "ruins" | "siege", difficulty: DifficultyId = "standard"): GameSimulation {
  const simulation = new GameSimulation();
  expect(simulation.selectMission(mission)).toBe(true);
  expect(simulation.selectDifficulty(difficulty)).toBe(true);
  simulation.start();
  return simulation;
}

function advance(simulation: GameSimulation, seconds: number): void {
  for (let remaining = seconds; remaining > 0.000001;) {
    const step = Math.min(0.05, remaining);
    simulation.tick(step);
    remaining -= step;
  }
}

function addEnemy(simulation: GameSimulation, kind: EnemyUnitKind, x: number, z: number): RaiderState {
  const state: RaiderState = {
    id: 900_000 + simulation.snapshot.raiders.length,
    kind,
    stance: "guard",
    homeX: x,
    homeZ: z,
    x,
    z,
    hp: kind === "catapult" ? 340 : kind === "batteringRam" ? 520 : 180,
    maxHp: kind === "catapult" ? 340 : kind === "batteringRam" ? 520 : 180,
    speed: 0,
    damage: 0,
    cooldown: 999,
    elite: kind === "catapult" || kind === "batteringRam",
    heading: 0,
    attacking: false,
    attackPulse: 0,
  };
  (simulation.snapshot.raiders as RaiderState[]).push(state);
  return state;
}

describe("parallel castle duel", () => {
  it("gives stages four to six distinct maps, rivals, objectives and rising pressure", () => {
    const confrontations = (["river", "ruins", "siege"] as const).map((mission) => createConfrontation(mission));
    expect(confrontations.map((simulation) => simulation.snapshot.gridSize)).toEqual([26, 28, 30]);
    expect(new Set(confrontations.map((simulation) => simulation.snapshot.duel!.enemyName)).size).toBe(3);
    expect(confrontations.map((simulation) => simulation.snapshot.duel!.objectiveKind))
      .toEqual(["hold-crossing", "break-fortress", "destroy-keep"]);
    expect(confrontations.map((simulation) => simulation.snapshot.duel!.nextAssaultIn))
      .toEqual([...confrontations.map((simulation) => simulation.snapshot.duel!.nextAssaultIn)].sort((a, b) => b - a));
  });

  it("settles the river confrontation only after two defended marches and six surviving fighters", () => {
    const simulation = createConfrontation("river");
    const barracks = simulation.snapshot.buildings.find((building) => building.kind === "barracks")!;
    for (let index = 0; index < 6; index += 1) expect(simulation.trainUnit("spearman", barracks.id)).toBe(true);
    const state = (simulation as unknown as { duelCastle: DuelCastleState }).duelCastle;
    state.assaultsLaunched = 1;
    state.assaultsDefeated = 1;
    expect(simulation.beginPreparation()).toBe(true);
    simulation.tick(0.05);
    expect(simulation.snapshot.status).toBe("playing");
    state.assaultsLaunched = 2;
    state.assaultsDefeated = 2;
    simulation.tick(0.05);
    expect(simulation.snapshot).toMatchObject({ status: "victory", missionCompleted: true, goalProgress: 8 });
    expect(simulation.snapshot.duel).toMatchObject({ friendly: true, assaultsDefeated: 2 });
  });

  it("settles the garden confrontation after five fortifications and an eight-weapon reserve", () => {
    const simulation = createConfrontation("ruins");
    const state = (simulation as unknown as { duelCastle: DuelCastleState }).duelCastle;
    const player = simulation as unknown as { resources: { weapons: number } };
    state.fortificationsDestroyed = 5;
    player.resources.weapons = 7;
    expect(simulation.beginPreparation()).toBe(true);
    simulation.tick(0.05);
    expect(simulation.snapshot).toMatchObject({ status: "playing", goalProgress: 12, goalTarget: 13 });
    player.resources.weapons = 8;
    simulation.tick(0.05);
    expect(simulation.snapshot).toMatchObject({ status: "victory", missionCompleted: true, goalProgress: 13 });
    expect(simulation.snapshot.duel).toMatchObject({ friendly: true, fortificationsDestroyed: 5 });
  });

  it("loads a larger symmetric duel with no wave schedule and clear build territories", () => {
    const simulation = createDuel();
    const snapshot = simulation.snapshot;
    expect(snapshot.gridSize).toBe(30);
    expect(snapshot.waveCount).toBe(0);
    expect(snapshot.nextWaveIn).toBeNull();
    expect(snapshot.goalKind).toBe("duel");
    expect(snapshot.duel?.enemyBuildings.some((building) => building.kind === "keep")).toBe(true);
    expect(simulation.canPlace("house", 11, 2)).toMatchObject({ valid: false, reason: expect.stringContaining("нельзя строить") });
    expect(simulation.canPlace("house", 19, 2)).toMatchObject({ valid: false, reason: expect.stringContaining("соперника") });
    expect(simulation.canPlace("house", 10, 2).valid).toBe(true);
  });

  it("freezes both castles during planning and pause, then lets the rival spend and build", () => {
    const simulation = createDuel();
    const initial = JSON.parse(JSON.stringify(simulation.snapshot.duel));
    advance(simulation, 80);
    expect(simulation.snapshot.duel).toEqual(initial);

    simulation.beginPreparation();
    advance(simulation, 72);
    const active = simulation.snapshot.duel!;
    expect(active.enemyDevelopment).toBeGreaterThan(initial.enemyDevelopment);
    expect(active.enemyResources).not.toEqual(initial.enemyResources);
    const frozen = JSON.parse(JSON.stringify({ raidClock: simulation.snapshot.raidClock, duel: active, raiders: simulation.snapshot.raiders }));
    simulation.togglePause();
    advance(simulation, 45);
    expect(JSON.parse(JSON.stringify({ raidClock: simulation.snapshot.raidClock, duel: simulation.snapshot.duel, raiders: simulation.snapshot.raiders }))).toEqual(frozen);
  });

  it("makes standard and hard rivals develop quickly and launch their own attacks", () => {
    const relaxed = createDuel("relaxed");
    const standard = createDuel("standard");
    const hard = createDuel("veteran");
    const initialStandardDevelopment = standard.snapshot.duel!.enemyDevelopment;
    const initialHardDevelopment = hard.snapshot.duel!.enemyDevelopment;
    relaxed.beginPreparation();
    standard.beginPreparation();
    hard.beginPreparation();

    advance(relaxed, 110);
    advance(standard, 110);
    advance(hard, 75);

    expect(relaxed.snapshot.duel!.assaultsLaunched).toBe(0);
    expect(standard.snapshot.duel).toMatchObject({ assaultsLaunched: expect.any(Number) });
    expect(standard.snapshot.duel!.assaultsLaunched).toBeGreaterThanOrEqual(1);
    expect(standard.snapshot.duel!.enemyDevelopment).toBeGreaterThan(initialStandardDevelopment);
    expect(hard.snapshot.duel!.assaultsLaunched).toBeGreaterThanOrEqual(1);
    expect(hard.snapshot.duel!.enemyDevelopment).toBeGreaterThan(initialHardDevelopment);
  });

  it("heals personnel beside a working well only while the area is safe", () => {
    const simulation = createDuel();
    const barracks = simulation.snapshot.buildings.find((building) => building.kind === "barracks")!;
    expect(simulation.trainUnit("spearman", barracks.id)).toBe(true);
    const unit = simulation.snapshot.army.at(-1)!;
    const internals = simulation as unknown as { addBuilding: (kind: "well", gx: number, gz: number) => BuildingState };
    const well = internals.addBuilding("well", Math.round(unit.x), Math.round(unit.z));
    unit.x = well.gx;
    unit.z = well.gz;
    unit.hp = unit.maxHp * 0.5;
    const pausedHp = unit.hp;
    advance(simulation, 2);
    expect(unit.hp).toBe(pausedHp);

    simulation.beginPreparation();
    advance(simulation, 1);
    expect(unit.hp).toBeGreaterThan(pausedHp);
    const woundedHp = unit.maxHp * 0.45;
    unit.hp = woundedHp;
    const threat = addEnemy(simulation, "spearman", unit.x + 5.9, unit.z);
    advance(simulation, 1);
    expect(unit.hp).toBe(woundedHp);

    unit.x = well.gx + 4;
    unit.z = well.gz;
    threat.x = well.gx - 4;
    threat.z = well.gz;
    unit.hp = woundedHp;
    advance(simulation, 0.05);
    expect(unit.hp).toBe(woundedHp);

    threat.hp = 0;
    advance(simulation, 1);
    expect(unit.hp).toBeGreaterThan(woundedHp);
    unit.kind = "catapult";
    unit.hp = 100;
    unit.maxHp = ARMY_UNITS.catapult.maxHp;
    advance(simulation, 1);
    expect(unit.hp).toBe(100);
  });

  it("keeps an empty tower inert and filters light and heavy modules by target class", () => {
    const empty = createDuel();
    expect(empty.place("tower", 10, 3)).toBe(true);
    const unprotected = addEnemy(empty, "spearman", 10, 4);
    empty.beginPreparation();
    advance(empty, 1.2);
    expect(unprotected.hp).toBe(unprotected.maxHp);

    const light = createDuel();
    expect(light.place("tower", 10, 3)).toBe(true);
    const lightTower = light.snapshot.buildings.find((building) => building.gx === 10 && building.gz === 3)!;
    expect(light.upgradeTower(lightTower.id, "light")).toBe(true);
    const footman = addEnemy(light, "spearman", 10, 4);
    const ram = addEnemy(light, "batteringRam", 9.9, 4);
    light.beginPreparation();
    advance(light, 0.7);
    expect(footman.hp).toBe(footman.maxHp - TOWER_UPGRADES.light.damage);
    expect(ram.hp).toBe(ram.maxHp);

    const heavy = createDuel();
    expect(heavy.place("tower", 10, 3)).toBe(true);
    const heavyTower = heavy.snapshot.buildings.find((building) => building.gx === 10 && building.gz === 3)!;
    expect(heavy.upgradeTower(heavyTower.id, "heavy")).toBe(true);
    const ignoredFootman = addEnemy(heavy, "spearman", 10, 4);
    const catapult = addEnemy(heavy, "catapult", 9.9, 4);
    heavy.beginPreparation();
    advance(heavy, 0.7);
    expect(ignoredFootman.hp).toBe(ignoredFootman.maxHp);
    expect(catapult.hp).toBe(catapult.maxHp - TOWER_UPGRADES.heavy.damage);
  });

  it("charges a permanent tower choice once and blocks work within five cells of an enemy", () => {
    const simulation = createDuel();
    expect(simulation.place("tower", 10, 3)).toBe(true);
    const tower = simulation.snapshot.buildings.find((building) => building.gx === 10 && building.gz === 3)!;
    const before = { ...simulation.snapshot.resources };
    expect(simulation.upgradeTower(tower.id, "light")).toBe(true);
    for (const [key, amount] of Object.entries(TOWER_UPGRADES.light.cost)) {
      expect(simulation.snapshot.resources[key as keyof typeof before]).toBe(before[key as keyof typeof before] - amount!);
    }
    const after = { ...simulation.snapshot.resources };
    expect(simulation.upgradeTower(tower.id, "heavy")).toBe(false);
    expect(simulation.snapshot.resources).toEqual(after);

    const threatened = createDuel();
    expect(threatened.place("tower", 10, 3)).toBe(true);
    const threatenedTower = threatened.snapshot.buildings.find((building) => building.gx === 10 && building.gz === 3)!;
    addEnemy(threatened, "spearman", 10, 8);
    expect(threatened.upgradeTower(threatenedTower.id, "light")).toBe(false);
    expect(threatened.snapshot.buildings.find((building) => building.id === threatenedTower.id)?.towerUpgrade).toBe("none");
  });

  it("turns the defeated castle into a persistent, non-hostile allied town", () => {
    const simulation = createDuel();
    const totalBefore = simulation.snapshot.population;
    const foodUseBefore = simulation.snapshot.economy.foodUsePerTick;
    expect(simulation.place("siegeWorkshop", 6, 20)).toBe(true);
    const workshop = simulation.snapshot.buildings.find((building) => building.kind === "siegeWorkshop")!;
    expect(simulation.trainUnit("catapult", workshop.id)).toBe(true);
    const catapult = simulation.snapshot.army.find((unit) => unit.kind === "catapult")!;
    expect(simulation.snapshot.civilians).toBe(totalBefore - (ARMY_UNITS.catapult.populationCost ?? 1));
    expect(simulation.snapshot.population).toBe(totalBefore);
    expect(simulation.snapshot.economy.foodUsePerTick).toBeCloseTo(foodUseBefore);
    expect(simulation.enterDirectControl(catapult.id)).toBe(false);

    const enemyKeep = simulation.snapshot.duel!.enemyBuildings.find((building) => building.kind === "keep")!;
    enemyKeep.hp = Math.min(100, enemyKeep.hp);
    (simulation as unknown as { duelCastle: DuelCastleState }).duelCastle.resources.wood = 0;
    catapult.cooldown = 0;
    simulation.selectArmyUnits([catapult.id]);
    expect(simulation.issueArmyAttackBuildingOrder(enemyKeep.id)).toBe(true);
    expect(catapult.order).toMatchObject({ targetBuildingId: enemyKeep.id });
    simulation.beginPreparation();
    advance(simulation, 12);
    expect(catapult.targetId).toBe(enemyKeep.id);
    expect(catapult.order).toMatchObject({ targetBuildingId: enemyKeep.id });
    advance(simulation, 38);
    expect(enemyKeep.hp).toBe(enemyKeep.maxHp);
    expect(simulation.snapshot.goalProgress).toBe(100);
    expect(simulation.snapshot.status).toBe("victory");
    expect(simulation.snapshot.duel?.friendly).toBe(true);
    expect(simulation.snapshot.raiders).toHaveLength(0);
    expect(catapult.order).toBeNull();
    expect(simulation.issueArmyAttackBuildingOrder(enemyKeep.id)).toBe(false);
    const enemyGate = simulation.snapshot.duel!.enemyBuildings.find((building) => building.kind === "gate")!;
    const internals = simulation as unknown as {
      armyObstructionDepth: (x: number, z: number) => number;
      findPath: (start: { x: number; z: number }, goal: { x: number; z: number }, perspective: "player" | "enemy") => Array<{ x: number; z: number }>;
    };
    expect(internals.armyObstructionDepth(enemyGate.gx, enemyGate.gz)).toBe(0);
    expect(internals.findPath({ x: 19, z: 15 }, { x: 21, z: 15 }, "player"))
      .toContainEqual({ x: enemyGate.gx, z: enemyGate.gz });
    expect(simulation.continueAfterVictory()).toBe(true);
    advance(simulation, 10);
    expect(simulation.snapshot).toMatchObject({ status: "playing", missionCompleted: true });
    const continuedSave = simulation.exportSave(777)!;
    continuedSave.state.duel!.buildings.find((building) => building.kind === "keep")!.hp = 0;
    const restored = new GameSimulation();
    expect(restored.restoreSave(continuedSave)).toBe(true);
    expect(restored.snapshot).toMatchObject({ status: "playing", missionCompleted: true });
    expect(restored.snapshot.duel).toMatchObject({ friendly: true, enemyKeepHp: BUILDINGS.keep.maxHp });
    expect(restored.snapshot.raiders).toHaveLength(0);
  });

  it("keeps each side's own gate passable while the opposing gate and walls remain solid", () => {
    const simulation = createDuel();
    const internals = simulation as unknown as {
      findPath: (start: { x: number; z: number }, goal: { x: number; z: number }, perspective: "player" | "enemy") => Array<{ x: number; z: number }>;
      armyObstructionDepth: (x: number, z: number) => number;
      enemyObstructionDepth: (x: number, z: number) => number;
    };
    const playerGate = simulation.snapshot.buildings.find((building) => building.kind === "gate")!;
    const enemyGate = simulation.snapshot.duel!.enemyBuildings.find((building) => building.kind === "gate")!;
    const throughOwnGate = internals.findPath({ x: 8, z: 15 }, { x: 10, z: 15 }, "player");
    expect(throughOwnGate).toContainEqual({ x: playerGate.gx, z: playerGate.gz });
    const aroundEnemyGate = internals.findPath({ x: 19, z: 15 }, { x: 21, z: 15 }, "player");
    expect(aroundEnemyGate).not.toContainEqual({ x: enemyGate.gx, z: enemyGate.gz });
    expect(aroundEnemyGate.length).toBeGreaterThan(2);
    const throughRivalOwnGate = internals.findPath({ x: 21, z: 15 }, { x: 19, z: 15 }, "enemy");
    expect(throughRivalOwnGate).toContainEqual({ x: enemyGate.gx, z: enemyGate.gz });
    expect(internals.armyObstructionDepth(playerGate.gx, playerGate.gz)).toBe(0);
    expect(internals.armyObstructionDepth(enemyGate.gx, enemyGate.gz)).toBeGreaterThan(0);
    expect(internals.enemyObstructionDepth(enemyGate.gx, enemyGate.gz)).toBe(0);
  });

  it("uses the same five-cell safety rule for rival building and repair decisions", () => {
    const simulation = createDuel();
    const barracks = simulation.snapshot.buildings.find((building) => building.kind === "barracks")!;
    expect(simulation.trainUnit("spearman", barracks.id)).toBe(true);
    const scout = simulation.snapshot.army.at(-1)!;
    scout.x = 24;
    scout.z = 15;
    const internals = simulation as unknown as {
      duelCastle: DuelCastleState;
      findEnemyBuildCell: (kind: "tower") => GridPoint | null;
      tryRepairEnemyBuilding: () => boolean;
    };
    const buildCell = internals.findEnemyBuildCell("tower");
    expect(buildCell).not.toBeNull();
    expect(Math.hypot(buildCell!.gx - scout.x, buildCell!.gz - scout.z)).toBeGreaterThan(5);

    const tower = internals.duelCastle.buildings.find((building) => building.kind === "tower")!;
    tower.hp = tower.maxHp * 0.5;
    scout.x = tower.gx + 5;
    scout.z = tower.gz;
    const blockedResources = { ...internals.duelCastle.resources };
    expect(internals.tryRepairEnemyBuilding()).toBe(false);
    expect(tower.hp).toBe(tower.maxHp * 0.5);
    expect(internals.duelCastle.resources).toEqual(blockedResources);
    scout.x = 1;
    scout.z = 1;
    expect(internals.tryRepairEnemyBuilding()).toBe(true);
    expect(tower.hp).toBe(tower.maxHp);
    expect(internals.duelCastle.resources.stone).toBeLessThan(blockedResources.stone);

    for (const building of internals.duelCastle.buildings) building.hp = building.maxHp;
    const keep = internals.duelCastle.buildings.find((building) => building.kind === "keep")!;
    const quarry = internals.duelCastle.buildings.find((building) => building.kind === "quarry")!;
    keep.hp = keep.maxHp * 0.5;
    quarry.hp = quarry.maxHp * 0.5;
    const safeBlocker = [
      { x: keep.gx + 5, z: keep.gz }, { x: keep.gx - 5, z: keep.gz },
      { x: keep.gx, z: keep.gz + 5 }, { x: keep.gx, z: keep.gz - 5 },
    ].find((point) => Math.hypot(point.x - quarry.gx, point.z - quarry.gz) > 5)!;
    scout.x = safeBlocker.x;
    scout.z = safeBlocker.z;
    internals.duelCastle.resources.wood = 999;
    internals.duelCastle.resources.stone = 999;
    expect(internals.tryRepairEnemyBuilding()).toBe(true);
    expect(keep.hp).toBe(keep.maxHp * 0.5);
    expect(quarry.hp).toBe(quarry.maxHp);
  });

  it("retargets siege engines to reachable defenses and caches an unreachable firing position", () => {
    const simulation = createDuel();
    const internals = simulation as unknown as {
      addBuilding: (kind: "wall", gx: number, gz: number) => BuildingState;
      playerBuildingTargetForSiege: (raider: RaiderState, kind: EnemyUnitKind) => BuildingState | undefined;
      getEnemySiegePath: (raider: RaiderState, target: BuildingState, range: number, minRange: number) => GridPoint[];
      findPath: (start: GridPoint, goal: GridPoint, perspective: "player" | "enemy") => GridPoint[];
    };
    for (let x = 10; x <= 13; x += 1) {
      for (let z = 0; z < simulation.snapshot.gridSize; z += 1) internals.addBuilding("wall", x, z);
    }
    const innerGate = simulation.snapshot.buildings.find((building) => building.kind === "gate")!;
    const ram = addEnemy(simulation, "batteringRam", 24, 15);
    ram.stance = "assault";
    const target = internals.playerBuildingTargetForSiege(ram, "batteringRam")!;
    expect(target.kind).toBe("wall");
    expect(target.gx).toBe(13);
    expect(target.id).toBe(ram.targetBuildingId);
    expect(target.id).not.toBe(innerGate.id);

    const catapult = addEnemy(simulation, "catapult", 24, 15);
    const enclosedKeep = simulation.snapshot.buildings.find((building) => building.kind === "keep")!;
    const findPath = vi.spyOn(internals, "findPath");
    expect(internals.getEnemySiegePath(catapult, enclosedKeep, ARMY_UNITS.catapult.range, ARMY_UNITS.catapult.minRange ?? 0)).toEqual([]);
    const callsAfterFirstSearch = findPath.mock.calls.length;
    expect(callsAfterFirstSearch).toBeGreaterThan(0);
    expect(internals.getEnemySiegePath(catapult, enclosedKeep, ARMY_UNITS.catapult.range, ARMY_UNITS.catapult.minRange ?? 0)).toEqual([]);
    expect(findPath).toHaveBeenCalledTimes(callsAfterFirstSearch);
  });

  it("never lets rival civilians and crews exceed housing after homes are lost", () => {
    const simulation = createDuel();
    const internals = simulation as unknown as { duelCastle: DuelCastleState };
    internals.duelCastle.buildings = internals.duelCastle.buildings.filter((building) => building.kind !== "house");
    internals.duelCastle.population = 10;
    addEnemy(simulation, "catapult", 24, 15);
    addEnemy(simulation, "batteringRam", 24, 16);
    simulation.beginPreparation();
    advance(simulation, 2.05);
    expect(simulation.snapshot.duel!.enemyPopulation).toBeLessThanOrEqual(simulation.snapshot.duel!.enemyPopulationCap);
    expect(simulation.snapshot.duel).toMatchObject({ enemyPopulation: 12, enemyPopulationCap: 12 });
  });

  it("ticks rival tower reload once and rejects duel saves without the rival castle", () => {
    const simulation = createDuel();
    const internals = simulation as unknown as { duelCastle: DuelCastleState };
    const tower = internals.duelCastle.buildings.find((building) => building.kind === "tower")!;
    tower.towerUpgrade = "light";
    tower.cooldown = 1;
    simulation.beginPreparation();
    simulation.tick(0.05);
    expect(tower.cooldown).toBeCloseTo(0.95);

    const invalid = simulation.exportSave(321)!;
    invalid.state.duel = null;
    expect(new GameSimulation().restoreSave(invalid)).toBe(false);
  });

  it("round-trips the rival economy, buildings, timers and tower modules", () => {
    const original = createDuel();
    expect(original.place("tower", 10, 3)).toBe(true);
    const tower = original.snapshot.buildings.find((building) => building.gx === 10 && building.gz === 3)!;
    expect(original.upgradeTower(tower.id, "heavy")).toBe(true);
    const internals = original as unknown as { duelCastle: DuelCastleState };
    for (const key of Object.keys(internals.duelCastle.resources) as Array<keyof typeof internals.duelCastle.resources>) {
      internals.duelCastle.resources[key] = 999;
    }
    original.beginPreparation();
    advance(original, 72);
    const enemyModule = original.snapshot.duel!.enemyBuildings.find((building) => building.kind === "tower" && building.towerUpgrade !== "none");
    expect(enemyModule?.towerUpgrade).toMatch(/light|heavy/);
    const save = original.exportSave(123_456)!;

    const restored = new GameSimulation();
    expect(restored.restoreSave(save)).toBe(true);
    expect(restored.snapshot).toMatchObject({ missionId: "siege", status: "playing", gridSize: 30 });
    expect(restored.snapshot.buildings.find((building) => building.id === tower.id)?.towerUpgrade).toBe("heavy");
    expect(restored.snapshot.duel).toEqual(original.snapshot.duel);
    expect(restored.snapshot.duel!.enemyBuildings.find((building) => building.id === enemyModule!.id)?.towerUpgrade).toBe(enemyModule!.towerUpgrade);
    expect(restored.exportSave(123_456)?.state.duel).toEqual(save.state.duel);
  });

  it("uses the declared keep health for percentage progress", () => {
    const simulation = createDuel();
    const keep = simulation.snapshot.duel!.enemyBuildings.find((building) => building.kind === "keep")!;
    keep.hp = BUILDINGS.keep.maxHp * 0.55;
    expect(simulation.snapshot.goalProgress).toBe(45);
  });
});
