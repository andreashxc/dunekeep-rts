import { describe, expect, it, vi } from "vitest";
import { ARMY_UNITS } from "./content";
import { GameSimulation } from "./simulation";
import type { ArmyUnitKind, ArmyUnitState, BuildingKind, BuildingState, ProjectileEvent, SimulationEvents } from "./types";

function advance(simulation: GameSimulation, seconds: number): void {
  let remaining = seconds;
  while (remaining > 0.000001) {
    const step = Math.min(0.05, remaining);
    simulation.tick(step);
    remaining -= step;
  }
}

function advanceUntil(simulation: GameSimulation, predicate: () => boolean, timeout = 30): void {
  for (let elapsed = 0; elapsed < timeout && !predicate(); elapsed += 0.05) simulation.tick(0.05);
  expect(predicate()).toBe(true);
}

function create(events: SimulationEvents = {}): GameSimulation {
  const simulation = new GameSimulation(events);
  simulation.selectMission("siege");
  simulation.start();
  return simulation;
}

function placeAndGet(simulation: GameSimulation, kind: BuildingKind, gx: number, gz: number) {
  expect(simulation.place(kind, gx, gz)).toBe(true);
  return simulation.snapshot.buildings.find((item) => item.kind === kind && item.gx === gx && item.gz === gz)!;
}

function connectedTowerAndWall(simulation: GameSimulation): { tower: BuildingState; eastWall: BuildingState } {
  const tower = placeAndGet(simulation, "tower", 8, 6);
  const eastWall = placeAndGet(simulation, "wall", 9, 6);
  return { tower, eastWall };
}

function train(simulation: GameSimulation, kind: ArmyUnitKind, schoolPoint = { gx: 2, gz: 2 }): ArmyUnitState {
  const definition = ARMY_UNITS[kind];
  let school = simulation.snapshot.buildings.find((item) => item.kind === definition.trainedAt);
  if (!school) school = placeAndGet(simulation, definition.trainedAt, schoolPoint.gx, schoolPoint.gz);
  expect(simulation.trainUnit(kind, school.id)).toBe(true);
  return simulation.snapshot.army.at(-1)!;
}

function station(simulation: GameSimulation, unit: ArmyUnitState, fortificationId: number): void {
  simulation.selectArmyUnits([unit.id]);
  expect(simulation.issueArmyGarrisonOrder(fortificationId)).toBe(true);
  expect(simulation.beginPreparation()).toBe(true);
  advanceUntil(simulation, () => unit.garrison?.status === "stationed");
}

describe("wall and tower army garrisons", () => {
  it("accepts archers and spearmen, rejects cavalry and heavy infantry, and reserves deterministic capacity", () => {
    const messages: string[] = [];
    const simulation = create({ onToast: (message) => messages.push(message) });
    const wall = placeAndGet(simulation, "wall", 3, 3);
    const archer = train(simulation, "archer");
    const spearman = train(simulation, "spearman");
    const knight = train(simulation, "knight", { gx: 2, gz: 4 });

    simulation.selectArmyUnits([archer.id, spearman.id]);
    expect(simulation.issueArmyGarrisonOrder(wall.id)).toBe(true);
    expect(archer.garrison).toMatchObject({ buildingId: wall.id, buildingKind: "wall", slot: 0, status: "approaching" });
    expect(spearman.garrison).toBeNull();

    const before = { x: knight.x, z: knight.z, order: knight.order, garrison: knight.garrison };
    simulation.selectArmyUnits([knight.id]);
    expect(simulation.issueArmyGarrisonOrder(wall.id)).toBe(false);
    expect({ x: knight.x, z: knight.z, order: knight.order, garrison: knight.garrison }).toEqual(before);
    expect(messages.at(-1)).toContain("Конница");
  });

  it("fills two tower slots and then continues over a connected wall network", () => {
    const simulation = create();
    const { tower, eastWall } = connectedTowerAndWall(simulation);
    const units = [train(simulation, "spearman"), train(simulation, "spearman"), train(simulation, "spearman")];
    simulation.selectArmyUnits(units.map((unit) => unit.id));
    expect(simulation.issueArmyGarrisonOrder(tower.id)).toBe(true);
    expect(units.map((unit) => [unit.garrison?.buildingId, unit.garrison?.slot])).toEqual([
      [tower.id, 0],
      [tower.id, 1],
      [eastWall.id, 0],
    ]);
    expect(new Set(units.map((unit) => `${unit.garrison?.buildingId}:${unit.garrison?.slot}`)).size).toBe(3);
  });

  it("keeps unreachable slots available for a later unit that can reach them", () => {
    const simulation = create();
    const tower = simulation.snapshot.buildings.find((item) => item.kind === "tower")!;
    const blocked = train(simulation, "spearman");
    const reachable = train(simulation, "spearman");
    const internals = simulation as unknown as {
      findGarrisonApproach: (unit: ArmyUnitState, building: BuildingState) => { x: number; z: number } | null;
    };
    vi.spyOn(internals, "findGarrisonApproach").mockImplementation((unit, building) => unit.id === reachable.id
      ? { x: building.gx, z: building.gz - 0.92 }
      : null);

    simulation.selectArmyUnits([blocked.id, reachable.id]);
    expect(simulation.issueArmyGarrisonOrder(tower.id)).toBe(true);
    expect(blocked.garrison).toBeNull();
    expect(reachable.garrison).toMatchObject({ buildingId: tower.id, slot: 0, status: "approaching" });
  });

  it("walks, mounts over simulation time, and freezes every phase while paused", () => {
    const simulation = create();
    const wall = placeAndGet(simulation, "wall", 3, 3);
    const unit = train(simulation, "spearman");
    simulation.selectArmyUnits([unit.id]);
    expect(simulation.issueArmyGarrisonOrder(wall.id)).toBe(true);
    const beforeStart = JSON.parse(JSON.stringify(unit));
    advance(simulation, 3);
    expect(JSON.parse(JSON.stringify(unit))).toEqual(beforeStart);

    expect(simulation.beginPreparation()).toBe(true);
    advanceUntil(simulation, () => unit.garrison?.status === "mounting");
    simulation.tick(0.1);
    expect(unit.garrison!.transition).toBeGreaterThan(0);
    expect(unit.garrison!.transition).toBeLessThan(1);
    simulation.togglePause();
    const frozen = JSON.parse(JSON.stringify(unit));
    advance(simulation, 2);
    expect(JSON.parse(JSON.stringify(unit))).toEqual(frozen);
    simulation.togglePause();
    advanceUntil(simulation, () => unit.garrison?.status === "stationed");
    expect(unit.garrison?.transition).toBe(1);
    expect(unit.x).toBeCloseTo(unit.garrison!.deckX);
    expect(unit.z).toBeCloseTo(unit.garrison!.deckZ);
  });

  it("dismounts before a ground order and preserves an occupied garrison across rally changes", () => {
    const simulation = create();
    const wall = placeAndGet(simulation, "wall", 3, 3);
    const unit = train(simulation, "spearman");
    station(simulation, unit, wall.id);

    expect(simulation.setRallyPoint(14, 14)).toBe(true);
    expect(unit.garrison?.status).toBe("stationed");
    simulation.selectArmyUnits([unit.id]);
    expect(simulation.issueArmyOrder("move", { x: 5, z: 5 })).toBe(true);
    expect(unit.garrison).toMatchObject({ status: "dismounting", queuedGroundOrder: { kind: "move", anchorX: 5, anchorZ: 5 } });
    advanceUntil(simulation, () => unit.garrison === null);
    expect(unit.order).toMatchObject({ kind: "move", anchorX: 5, anchorZ: 5 });
    advanceUntil(simulation, () => unit.order?.status === "holding");
    expect(Math.hypot(unit.x - unit.order!.destinationX, unit.z - unit.order!.destinationZ)).toBeLessThan(0.16);
  });

  it("lets direct control walk onto a touching wall and keeps the new deck position", () => {
    const simulation = create();
    const { tower, eastWall } = connectedTowerAndWall(simulation);
    const unit = train(simulation, "archer");
    station(simulation, unit, tower.id);
    expect(simulation.enterDirectControl(unit.id)).toBe(true);
    const deck = { x: unit.x, z: unit.z };
    expect(simulation.setDirectControlInput({ moveX: 1, moveZ: 0, heading: 0, sprint: true })).toBe(true);
    expect(simulation.snapshot.directControl).toMatchObject({ moveX: 1, moveZ: 0, sprint: false });
    advance(simulation, 1.4);
    expect(unit.x).toBeGreaterThan(deck.x);
    expect(unit.garrison?.status).toBe("stationed");
    expect(unit.garrison?.buildingId).toBe(eastWall.id);
    const reached = { x: unit.x, z: unit.z };
    expect(simulation.exitDirectControl()).toBe(true);
    simulation.tick(0.05);
    expect(unit.x).toBeCloseTo(reached.x);
    expect(unit.z).toBeCloseTo(reached.z);

    expect(simulation.enterDirectControl(unit.id)).toBe(true);
    expect(simulation.requestDirectControlDismount()).toBe(true);
    expect(unit.garrison?.status).toBe("dismounting");
    expect(simulation.requestDirectControlDismount()).toBe(false);
    advanceUntil(simulation, () => unit.garrison === null);
    expect(simulation.snapshot.directControl?.entityId).toBe(unit.id);
    simulation.setDirectControlInput({ moveX: 1, moveZ: 0, heading: 0, sprint: false });
    advance(simulation, 0.5);
    expect(unit.x).not.toBeCloseTo(deck.x);
  });

  it("changes wall and tower deck height continuously and cannot enter an occupied wall", () => {
    const smooth = create();
    const { tower, eastWall } = connectedTowerAndWall(smooth);
    const walker = train(smooth, "spearman");
    station(smooth, walker, eastWall.id);
    expect(smooth.enterDirectControl(walker.id)).toBe(true);
    smooth.setDirectControlInput({ moveX: -1, moveZ: 0, heading: 0, sprint: false });
    let previousHeight = walker.garrison!.deckY;
    let maximumStep = 0;
    for (let step = 0; step < 40 && walker.garrison?.buildingId !== tower.id; step += 1) {
      smooth.tick(0.05);
      maximumStep = Math.max(maximumStep, Math.abs(walker.garrison!.deckY - previousHeight));
      previousHeight = walker.garrison!.deckY;
    }
    expect(walker.garrison?.buildingId).toBe(tower.id);
    expect(walker.garrison!.deckY).toBeGreaterThan(1.14);
    expect(maximumStep).toBeLessThan(0.08);

    const blocked = create();
    const { tower: blockedTower, eastWall: blockedWall } = connectedTowerAndWall(blocked);
    const occupant = train(blocked, "spearman");
    station(blocked, occupant, blockedWall.id);
    const controlled = train(blocked, "archer");
    blocked.selectArmyUnits([controlled.id]);
    expect(blocked.issueArmyGarrisonOrder(blockedTower.id)).toBe(true);
    advanceUntil(blocked, () => controlled.garrison?.status === "stationed");
    expect(blocked.enterDirectControl(controlled.id)).toBe(true);
    blocked.setDirectControlInput({ moveX: 1, moveZ: 0, heading: 0, sprint: false });
    advance(blocked, 2);
    expect(controlled.garrison?.buildingId).toBe(blockedTower.id);
    expect(controlled.x).toBeLessThanOrEqual(blockedTower.gx + 0.5);
  });

  it("lets a directly controlled foot unit climb nearby and keeps control through pause and descent", () => {
    const simulation = create();
    const wall = placeAndGet(simulation, "wall", 3, 3);
    const unit = train(simulation, "archer");
    unit.x = wall.gx;
    unit.z = wall.gz - 0.56;
    expect(simulation.beginPreparation()).toBe(true);
    expect(simulation.enterDirectControl(unit.id)).toBe(true);
    expect(simulation.snapshot.directControl?.mountTarget).toEqual({ buildingId: wall.id, buildingKind: "wall" });
    expect(simulation.setDirectControlInput({ moveX: 0, moveZ: 1, heading: 0, sprint: true })).toBe(true);

    const approach = { x: unit.x, z: unit.z };
    expect(simulation.requestDirectControlMount()).toBe(true);
    expect(simulation.snapshot.directControl).toMatchObject({ entityId: unit.id, moveX: 0, moveZ: 0, sprint: false, mountTarget: null });
    expect(unit.garrison).toMatchObject({
      buildingId: wall.id,
      buildingKind: "wall",
      slot: 0,
      status: "mounting",
      transition: 0,
      approachX: approach.x,
      approachZ: approach.z,
    });
    expect(simulation.requestDirectControlMount()).toBe(false);
    expect(simulation.toggleDirectControlDance()).toBe(false);
    expect(simulation.requestDirectControlAttack()).toBe(false);
    simulation.tick(0.1);
    const frozenTransition = unit.garrison!.transition;
    simulation.togglePause();
    expect(simulation.requestDirectControlDismount()).toBe(false);
    expect(unit.garrison?.status).toBe("mounting");
    advance(simulation, 1);
    expect(unit.garrison!.transition).toBe(frozenTransition);
    simulation.togglePause();
    advanceUntil(simulation, () => unit.garrison?.status === "stationed");
    expect(simulation.snapshot.directControl?.entityId).toBe(unit.id);

    expect(simulation.requestDirectControlDismount()).toBe(true);
    advanceUntil(simulation, () => unit.garrison === null);
    expect(simulation.snapshot.directControl?.entityId).toBe(unit.id);
    expect(unit.x).toBeCloseTo(approach.x);
    expect(unit.z).toBeCloseTo(approach.z);
    expect(simulation.snapshot.directControl?.mountTarget).toEqual({ buildingId: wall.id, buildingKind: "wall" });
  });

  it("reverses a direct climb from its current transition without restarting control", () => {
    const simulation = create();
    const tower = placeAndGet(simulation, "tower", 3, 3);
    const unit = train(simulation, "spearman");
    unit.x = tower.gx;
    unit.z = tower.gz - 0.64;
    expect(simulation.beginPreparation()).toBe(true);
    expect(simulation.enterDirectControl(unit.id)).toBe(true);
    expect(simulation.snapshot.directControl?.mountTarget).toEqual({ buildingId: tower.id, buildingKind: "tower" });
    expect(simulation.requestDirectControlMount()).toBe(true);
    simulation.tick(0.18);
    const reached = unit.garrison!.transition;
    expect(reached).toBeGreaterThan(0);
    expect(reached).toBeLessThan(1);
    expect(simulation.requestDirectControlDismount()).toBe(true);
    expect(unit.garrison?.status).toBe("dismounting");
    expect(unit.garrison?.transition).toBe(reached);
    advanceUntil(simulation, () => unit.garrison === null);
    expect(simulation.snapshot.directControl?.entityId).toBe(unit.id);
    expect(simulation.snapshot.directControl?.mountTarget).toEqual({ buildingId: tower.id, buildingKind: "tower" });
  });

  it("finishes climbing after leaving the camera and evacuates safely if the host is destroyed", () => {
    const finished = create();
    const tower = placeAndGet(finished, "tower", 3, 3);
    const archer = train(finished, "archer");
    archer.x = tower.gx;
    archer.z = tower.gz - 0.56;
    expect(finished.beginPreparation()).toBe(true);
    expect(finished.enterDirectControl(archer.id)).toBe(true);
    expect(finished.requestDirectControlMount(tower.id)).toBe(true);
    finished.tick(0.1);
    expect(finished.exitDirectControl()).toBe(true);
    expect(finished.snapshot.directControl).toBeNull();
    advanceUntil(finished, () => archer.garrison?.status === "stationed");
    expect(archer.garrison).toMatchObject({ buildingId: tower.id, status: "stationed" });

    const destroyed = create();
    const wall = placeAndGet(destroyed, "wall", 3, 3);
    const spearman = train(destroyed, "spearman");
    spearman.x = wall.gx;
    spearman.z = wall.gz - 0.56;
    expect(destroyed.beginPreparation()).toBe(true);
    expect(destroyed.enterDirectControl(spearman.id)).toBe(true);
    expect(destroyed.requestDirectControlMount(wall.id)).toBe(true);
    destroyed.tick(0.1);
    const internals = destroyed as unknown as { destroyBuilding: (building: BuildingState) => void };
    internals.destroyBuilding(wall);
    expect(spearman.garrison).toBeNull();
    expect(Number.isFinite(spearman.x) && Number.isFinite(spearman.z)).toBe(true);
    expect(destroyed.snapshot.directControl?.entityId).toBe(spearman.id);
  });

  it("does not expose a direct climb across a connected occupied wall", () => {
    const simulation = create();
    const wall = placeAndGet(simulation, "wall", 3, 3);
    placeAndGet(simulation, "wall", 4, 3);
    const occupant = train(simulation, "spearman");
    const controlled = train(simulation, "archer");
    station(simulation, occupant, wall.id);
    controlled.x = wall.gx;
    controlled.z = wall.gz - 0.56;
    expect(simulation.enterDirectControl(controlled.id)).toBe(true);
    expect(simulation.snapshot.directControl?.mountTarget).toBeNull();
    const before = { x: controlled.x, z: controlled.z };
    expect(simulation.requestDirectControlMount()).toBe(false);
    expect(controlled.garrison).toBeNull();
    expect({ x: controlled.x, z: controlled.z }).toEqual(before);
  });

  it("rejects cavalry and heavy infantry without changing direct-control state", () => {
    for (const kind of ["knight", "swordsman"] as const) {
      const messages: string[] = [];
      const simulation = create({ onToast: (message) => messages.push(message) });
      const wall = placeAndGet(simulation, "wall", 3, 3);
      const unit = train(simulation, kind, kind === "knight" ? { gx: 2, gz: 4 } : { gx: 2, gz: 2 });
      unit.x = wall.gx;
      unit.z = wall.gz - 0.56;
      expect(simulation.beginPreparation()).toBe(true);
      expect(simulation.enterDirectControl(unit.id)).toBe(true);
      expect(simulation.snapshot.directControl?.mountTarget).toBeNull();
      expect(simulation.requestDirectControlMount()).toBe(false);
      expect(unit.garrison).toBeNull();
      expect(simulation.snapshot.directControl?.entityId).toBe(unit.id);
      expect(messages.at(-1)).toContain(kind === "knight" ? "Конница" : "лучника или копейщика");
    }
  });

  it("requires the controlled unit to stand beside an unblocked cardinal approach", () => {
    const simulation = create();
    const wall = placeAndGet(simulation, "wall", 5, 5);
    const unit = train(simulation, "spearman");
    unit.x = wall.gx - 0.5;
    unit.z = wall.gz - 0.5;
    expect(simulation.beginPreparation()).toBe(true);
    expect(simulation.enterDirectControl(unit.id)).toBe(true);
    expect(simulation.snapshot.directControl?.mountTarget).toBeNull();
    const before = { x: unit.x, z: unit.z };
    expect(simulation.requestDirectControlMount()).toBe(false);
    expect(unit.garrison).toBeNull();
    expect({ x: unit.x, z: unit.z }).toEqual(before);

    unit.x = wall.gx;
    unit.z = wall.gz - 0.56;
    expect(simulation.snapshot.directControl?.mountTarget).toEqual({ buildingId: wall.id, buildingKind: "wall" });
  });

  it("revalidates the fortification shown by the contextual action before climbing", () => {
    const simulation = create();
    const wall = placeAndGet(simulation, "wall", 5, 5);
    const otherWall = placeAndGet(simulation, "wall", 6, 5);
    const unit = train(simulation, "archer");
    unit.x = wall.gx;
    unit.z = wall.gz - 0.56;
    expect(simulation.beginPreparation()).toBe(true);
    expect(simulation.enterDirectControl(unit.id)).toBe(true);
    expect(simulation.snapshot.directControl?.mountTarget?.buildingId).toBe(wall.id);

    expect(simulation.requestDirectControlMount(otherWall.id)).toBe(false);
    expect(unit.garrison).toBeNull();
    expect(simulation.snapshot.directControl?.entityId).toBe(unit.id);
    expect(simulation.requestDirectControlMount(wall.id)).toBe(true);
  });

  it("rejects manual demolition while occupied and evacuates safely after combat destruction", () => {
    const simulation = create();
    const wall = placeAndGet(simulation, "wall", 3, 3);
    const unit = train(simulation, "spearman");
    station(simulation, unit, wall.id);
    expect(simulation.demolish(wall.id)).toBe(false);
    expect(simulation.snapshot.buildings.some((item) => item.id === wall.id)).toBe(true);

    simulation.debugSpawnWave();
    const raider = simulation.snapshot.raiders[0];
    for (const other of simulation.snapshot.raiders.slice(1)) {
      other.x = simulation.snapshot.gridSize - 1;
      other.z = simulation.snapshot.gridSize - 1;
      other.cooldown = 999;
    }
    unit.cooldown = 999;
    wall.hp = 1;
    raider.x = wall.gx;
    raider.z = wall.gz;
    raider.cooldown = 0;
    raider.stance = "assault";
    simulation.tick(0.05);
    expect(simulation.snapshot.buildings.some((item) => item.id === wall.id)).toBe(false);
    expect(unit.garrison).toBeNull();
    expect(Number.isFinite(unit.x) && Number.isFinite(unit.z)).toBe(true);
  });

  it("does not teleport a ground unit when its destination fortification is destroyed", () => {
    const simulation = create();
    const wall = placeAndGet(simulation, "wall", 3, 3);
    const unit = train(simulation, "spearman");
    simulation.selectArmyUnits([unit.id]);
    expect(simulation.issueArmyGarrisonOrder(wall.id)).toBe(true);
    expect(simulation.beginPreparation()).toBe(true);
    simulation.tick(0.2);
    expect(unit.garrison?.status).toBe("approaching");
    const before = { x: unit.x, z: unit.z };

    const internals = simulation as unknown as { destroyBuilding: (building: BuildingState) => void };
    internals.destroyBuilding(wall);
    expect(unit.garrison).toBeNull();
    expect(unit.order).toBeNull();
    expect(unit.x).toBeCloseTo(before.x);
    expect(unit.z).toBeCloseTo(before.z);
  });

  it("keeps mounting and dismounting units out of ground-level raider melee", () => {
    const simulation = create();
    const wall = placeAndGet(simulation, "wall", 3, 3);
    const unit = train(simulation, "spearman");
    simulation.selectArmyUnits([unit.id]);
    expect(simulation.issueArmyGarrisonOrder(wall.id)).toBe(true);
    expect(simulation.beginPreparation()).toBe(true);
    advanceUntil(simulation, () => unit.garrison?.status === "mounting");
    advance(simulation, 0.34);
    expect(unit.garrison?.status).toBe("mounting");
    simulation.debugSpawnWave();
    const raider = simulation.snapshot.raiders[0];
    for (const other of simulation.snapshot.raiders.slice(1)) {
      other.x = simulation.snapshot.gridSize - 1;
      other.z = simulation.snapshot.gridSize - 1;
      other.cooldown = 999;
    }
    raider.x = unit.x;
    raider.z = unit.z;
    raider.cooldown = 0;
    const mountingHp = unit.hp;
    simulation.tick(0.01);
    expect(unit.hp).toBe(mountingHp);

    advanceUntil(simulation, () => unit.garrison?.status === "stationed");
    simulation.selectArmyUnits([unit.id]);
    expect(simulation.issueArmyOrder("move", { x: 5, z: 5 })).toBe(true);
    unit.garrison!.transition = 0.95;
    unit.x = unit.garrison!.deckX;
    unit.z = unit.garrison!.deckZ;
    raider.x = unit.x;
    raider.z = unit.z;
    raider.cooldown = 0;
    const dismountingHp = unit.hp;
    simulation.tick(0.01);
    expect(unit.hp).toBe(dismountingHp);
  });

  it("fires elevated archer projectiles with the tower range bonus", () => {
    const projectiles: ProjectileEvent[] = [];
    const simulation = create({ onProjectile: (event) => projectiles.push(event) });
    const tower = simulation.snapshot.buildings.find((item) => item.kind === "tower")!;
    const unit = train(simulation, "archer");
    station(simulation, unit, tower.id);
    simulation.debugSpawnWave();
    const [target, ...others] = simulation.snapshot.raiders;
    for (const other of others) {
      other.x = simulation.snapshot.gridSize - 1;
      other.z = simulation.snapshot.gridSize - 1;
      other.cooldown = 999;
    }
    target.x = unit.x + ARMY_UNITS.archer.range + 0.8;
    target.z = unit.z;
    target.cooldown = 999;
    unit.cooldown = 0;
    const before = target.hp;
    simulation.tick(0.05);
    expect(before - target.hp).toBeGreaterThanOrEqual(ARMY_UNITS.archer.damage);
    const arrow = projectiles.find((event) => event.source === "archer");
    expect(arrow?.fromY).toBeCloseTo(2.06);
    expect(arrow?.toY).toBe(0.30);
  });

  it("keeps snapshots JSON-safe and clears garrisons on restart", () => {
    const simulation = create();
    const tower = simulation.snapshot.buildings.find((item) => item.kind === "tower")!;
    const unit = train(simulation, "archer");
    simulation.selectArmyUnits([unit.id]);
    expect(simulation.issueArmyGarrisonOrder(tower.id)).toBe(true);
    expect(() => JSON.parse(JSON.stringify(simulation.snapshot))).not.toThrow();
    simulation.restart();
    expect(simulation.snapshot.army).toHaveLength(0);
    expect(simulation.snapshot.directControl).toBeNull();
  });
});
