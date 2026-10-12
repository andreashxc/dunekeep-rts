import { describe, expect, it } from "vitest";
import { ARMY_UNITS, GRID_SIZE } from "./content";
import { GameSimulation } from "./simulation";
import type { ArmyUnitKind, ArmyUnitState, BuildingKind, RaiderState } from "./types";

function advance(simulation: GameSimulation, seconds: number): void {
  let remaining = seconds;
  while (remaining > 0.000001) {
    const step = Math.min(0.05, remaining);
    simulation.tick(step);
    remaining -= step;
  }
}

function create(mission: "oasis" | "siege" = "oasis"): GameSimulation {
  const simulation = new GameSimulation();
  simulation.selectMission(mission);
  simulation.start();
  return simulation;
}

function building(simulation: GameSimulation, kind: BuildingKind) {
  return simulation.snapshot.buildings.find((item) => item.kind === kind)!;
}

function trainAt(simulation: GameSimulation, kind: ArmyUnitKind, gx = 2, gz = 2): ArmyUnitState {
  const definition = ARMY_UNITS[kind];
  let school = simulation.snapshot.buildings.find((item) => item.kind === definition.trainedAt);
  if (!school) {
    expect(simulation.place(definition.trainedAt, gx, gz)).toBe(true);
    school = building(simulation, definition.trainedAt);
  }
  expect(simulation.trainUnit(kind, school.id)).toBe(true);
  return simulation.snapshot.army.at(-1)!;
}

function combatSetup(kind: ArmyUnitKind): {
  simulation: GameSimulation;
  unit: ArmyUnitState;
  target: RaiderState;
} {
  const simulation = create(kind === "swordsman" || kind === "knight" ? "siege" : "oasis");
  const unit = trainAt(simulation, kind, 1, 1);
  unit.x = 1.5;
  unit.z = 1.5;
  unit.cooldown = 0;
  expect(simulation.enterDirectControl(unit.id)).toBe(true);
  expect(simulation.beginPreparation()).toBe(true);
  simulation.debugSpawnWave();
  if (simulation.snapshot.raiders.length === 0) {
    (simulation.snapshot.raiders as RaiderState[]).push({
      id: 999_001, kind: "raider", stance: "guard", homeX: 2, homeZ: 2,
      x: 2, z: 2, hp: 300, maxHp: 300, speed: 0, damage: 0,
      cooldown: 999, elite: false, heading: 0, attacking: false, attackPulse: 0,
    });
  }
  const [target, ...others] = simulation.snapshot.raiders;
  for (const raider of others) {
    raider.x = GRID_SIZE - 1;
    raider.z = GRID_SIZE - 1;
    raider.cooldown = 999;
  }
  target.cooldown = 999;
  return { simulation, unit, target };
}

describe("strategy army commands", () => {
  it("selects valid unique ids and sends a compact deterministic formation", () => {
    const simulation = create();
    expect(simulation.place("barracks", 2, 2)).toBe(true);
    const barracks = building(simulation, "barracks");
    for (let index = 0; index < 4; index += 1) expect(simulation.trainUnit("spearman", barracks.id)).toBe(true);
    const ids = simulation.snapshot.army.map((unit) => unit.id);

    expect(simulation.selectArmyUnits([ids[2], ids[0], ids[2], 999_999, ids[1], ids[3]])).toEqual([ids[2], ids[0], ids[1], ids[3]]);
    expect(simulation.issueArmyOrder("move", { x: 12, z: 12 })).toBe(true);
    const orders = simulation.snapshot.army.map((unit) => unit.order!);
    expect(orders.every((order) => order.kind === "move" && order.status === "moving")).toBe(true);
    expect(orders.every((order) => order.anchorX === 12 && order.anchorZ === 12)).toBe(true);
    const destinations = orders.map((order) => `${order.destinationX.toFixed(3)},${order.destinationZ.toFixed(3)}`);
    expect(new Set(destinations).size).toBe(4);
    expect(orders.every((order) => Math.hypot(order.destinationX - 12, order.destinationZ - 12) < 0.8)).toBe(true);

    const before = simulation.snapshot.army.map((unit) => ({ id: unit.id, x: unit.x, z: unit.z }));
    advance(simulation, 20);
    expect(simulation.snapshot.army.map((unit) => ({ x: unit.x, z: unit.z })))
      .toEqual(before.map(({ x, z }) => ({ x, z })));

    simulation.beginPreparation();
    advance(simulation, 25);
    for (const unit of simulation.snapshot.army) {
      expect(unit.order?.status).toBe("holding");
      expect(Math.hypot(unit.x - unit.order!.destinationX, unit.z - unit.order!.destinationZ)).toBeLessThan(0.16);
    }
  });

  it("retasks only the currently selected unit and preserves the other orders", () => {
    const simulation = create();
    simulation.place("barracks", 2, 2);
    const barracks = building(simulation, "barracks");
    for (let index = 0; index < 3; index += 1) simulation.trainUnit("spearman", barracks.id);
    const ids = simulation.snapshot.army.map((unit) => unit.id);
    simulation.selectArmyUnits(ids);
    simulation.issueArmyOrder("move", { x: 12, z: 12 });
    simulation.selectArmyUnits([ids[1]]);
    simulation.issueArmyOrder("attack-move", { x: 4, z: 13 });
    expect(simulation.snapshot.army.find((unit) => unit.id === ids[1])?.order).toMatchObject({ kind: "attack-move", anchorX: 4, anchorZ: 13 });
    expect(simulation.snapshot.army.filter((unit) => unit.id !== ids[1]).every((unit) => unit.order?.anchorX === 12)).toBe(true);
  });

  it("distinguishes move from attack-move while retaining fallback rally behavior", () => {
    const run = (kind: "move" | "attack-move") => {
      const simulation = create();
      const unit = trainAt(simulation, "archer", 1, 1);
      unit.cooldown = 0;
      simulation.selectArmyUnits([unit.id]);
      simulation.issueArmyOrder(kind, { x: 10, z: 1.5 });
      simulation.beginPreparation();
      simulation.debugSpawnWave();
      const [target, ...others] = simulation.snapshot.raiders;
      target.x = 3;
      target.z = 1.45;
      target.cooldown = 999;
      for (const raider of others) { raider.x = 17; raider.z = 17; raider.cooldown = 999; }
      const beforeHp = target.hp;
      simulation.tick(0.05);
      return { damage: beforeHp - target.hp, pulse: unit.attackPulse };
    };
    expect(run("move")).toEqual({ damage: 0, pulse: 0 });
    expect(run("attack-move")).toEqual({ damage: ARMY_UNITS.archer.damage, pulse: 1 });

    const fallback = create();
    const unit = trainAt(fallback, "spearman", 2, 2);
    fallback.setRallyPoint(12, 12);
    fallback.beginPreparation();
    const before = Math.hypot(unit.x - 12, unit.z - 12);
    advance(fallback, 1);
    expect(Math.hypot(unit.x - 12, unit.z - 12)).toBeLessThan(before);
    expect(unit.order).toBeNull();
  });

  it.each(["planning", "manual"] as const)("does not execute an attack-move during %s pause", (mode) => {
    const simulation = create();
    const unit = trainAt(simulation, "archer", 1, 1);
    unit.cooldown = 0;
    simulation.selectArmyUnits([unit.id]);
    simulation.issueArmyOrder("attack-move", { x: 10, z: 1.5 });
    simulation.beginPreparation();
    simulation.debugSpawnWave();
    const [target, ...others] = simulation.snapshot.raiders;
    target.x = 3; target.z = 1.45; target.cooldown = 999;
    for (const raider of others) { raider.x = 17; raider.z = 17; raider.cooldown = 999; }
    if (mode === "planning") simulation.setPlanningPaused(true); else simulation.togglePause();
    const before = target.hp;
    advance(simulation, 3);
    expect(target.hp).toBe(before);
    expect(unit.attackPulse).toBe(0);
    if (mode === "planning") simulation.setPlanningPaused(false); else simulation.togglePause();
    simulation.tick(0.05);
    expect(target.hp).toBe(before - ARMY_UNITS.archer.damage);
    expect(unit.attackPulse).toBe(1);
  });
});

describe("direct unit control", () => {
  it("keeps the default rally formation outside the keep and leaves recruits controllable", () => {
    const simulation = create();
    const keep = building(simulation, "keep");
    const unit = trainAt(simulation, "spearman", 5, 7);
    expect(Math.hypot(
      simulation.snapshot.rallyPoint.gx - keep.gx,
      simulation.snapshot.rallyPoint.gz - keep.gz,
    )).toBeGreaterThan(0.74);

    simulation.beginPreparation();
    advance(simulation, 7);
    expect(Math.hypot(unit.x - keep.gx, unit.z - keep.gz)).toBeGreaterThan(0.74);
    expect(simulation.enterDirectControl(unit.id)).toBe(true);
    const before = { x: unit.x, z: unit.z };
    simulation.setDirectControlInput({ moveX: 1, moveZ: 0, heading: Math.PI / 2, sprint: false });
    advance(simulation, 0.6);
    expect(Math.hypot(unit.x - before.x, unit.z - before.z)).toBeGreaterThan(0.25);
  });

  it("lets direct control escape an occupied starting footprint without walking through it", () => {
    const simulation = create();
    const keep = building(simulation, "keep");
    const unit = trainAt(simulation, "spearman", 2, 2);
    unit.x = keep.gx + 0.3;
    unit.z = keep.gz;
    expect(simulation.enterDirectControl(unit.id)).toBe(true);
    simulation.setDirectControlInput({ moveX: 1, moveZ: 0, heading: Math.PI / 2, sprint: false });
    simulation.beginPreparation();
    advance(simulation, 0.8);
    expect(unit.x).toBeGreaterThan(keep.gx + 0.74);
    expect(unit.z).toBeCloseTo(keep.gz, 6);

    const escapedX = unit.x;
    simulation.setDirectControlInput({ moveX: -1, moveZ: 0, heading: -Math.PI / 2, sprint: false });
    advance(simulation, 0.8);
    expect(unit.x).toBeGreaterThan(keep.gx + 0.72);
    expect(unit.x).toBeLessThan(escapedX);
  });

  it("normalizes world input and makes sprint predictably faster than walking", () => {
    const run = (sprint: boolean) => {
      const simulation = create();
      const unit = trainAt(simulation, "spearman", 2, 2);
      expect(simulation.enterDirectControl(unit.id)).toBe(true);
      expect(simulation.setDirectControlInput({ moveX: 3, moveZ: 4, heading: Math.PI * 3, sprint })).toBe(true);
      expect(simulation.snapshot.directControl).toMatchObject({ moveX: 0.6, moveZ: 0.8, sprint });
      expect(simulation.snapshot.directControl!.heading).toBeCloseTo(Math.PI);
      simulation.beginPreparation();
      const before = { x: unit.x, z: unit.z };
      advance(simulation, 1);
      return { distance: Math.hypot(unit.x - before.x, unit.z - before.z), movement: unit.movement };
    };
    const walk = run(false);
    const sprint = run(true);
    expect(walk.movement).toBe("walk");
    expect(sprint.movement).toBe("sprint");
    expect(walk.distance).toBeCloseTo(ARMY_UNITS.spearman.speed, 4);
    expect(sprint.distance).toBeCloseTo(walk.distance * 2.2, 4);
  });

  it("makes mounted movement faster both normally and while sprinting", () => {
    const travel = (sprint: boolean) => {
      const simulation = create("siege");
      const unit = trainAt(simulation, "knight", 2, 2);
      unit.x = 3.5;
      unit.z = 3.5;
      expect(unit.speed).toBe(1.8);
      expect(simulation.enterDirectControl(unit.id)).toBe(true);
      expect(simulation.setDirectControlInput({ moveX: 1, moveZ: 0, heading: Math.PI / 2, sprint })).toBe(true);
      simulation.beginPreparation();
      const before = { x: unit.x, z: unit.z };
      advance(simulation, 0.5);
      return Math.hypot(unit.x - before.x, unit.z - before.z);
    };
    const walk = travel(false);
    const sprint = travel(true);
    expect(walk).toBeCloseTo(ARMY_UNITS.knight.speed * 0.5, 4);
    expect(walk).toBeGreaterThan(ARMY_UNITS.spearman.speed * 0.5);
    expect(sprint).toBeCloseTo(walk * 2.2, 4);
  });

  it("clamps the controlled unit to the map and blocks living buildings", () => {
    const simulation = create();
    const unit = trainAt(simulation, "spearman", 2, 2);
    expect(simulation.place("wall", 5, 2)).toBe(true);
    simulation.enterDirectControl(unit.id);
    simulation.setDirectControlInput({ moveX: 1, moveZ: 0, heading: Math.PI / 2, sprint: true });
    simulation.beginPreparation();
    advance(simulation, 5);
    expect(unit.x).toBeLessThan(4.8);
    expect(unit.z).toBeCloseTo(2.45);

    simulation.setDirectControlInput({ moveX: 0, moveZ: 1, heading: 0, sprint: true });
    advance(simulation, 3);
    simulation.setDirectControlInput({ moveX: -1, moveZ: 0, heading: -Math.PI / 2, sprint: true });
    advance(simulation, 20);
    expect(unit.x).toBeCloseTo(0.16, 5);
    simulation.setDirectControlInput({ moveX: 0, moveZ: 1, heading: 0, sprint: true });
    advance(simulation, 30);
    expect(unit.z).toBeCloseTo(GRID_SIZE - 1 - 0.16, 5);
  });

  it("treats a gate as a passable opening instead of a solid wall", () => {
    const simulation = create();
    const unit = trainAt(simulation, "spearman", 2, 2);
    expect(simulation.place("gate", 5, 2)).toBe(true);
    simulation.enterDirectControl(unit.id);
    simulation.setDirectControlInput({ moveX: 1, moveZ: 0, heading: Math.PI / 2, sprint: true });
    simulation.beginPreparation();
    advance(simulation, 3);
    expect(unit.x).toBeGreaterThan(5.3);
  });

  it.each(["planning", "manual"] as const)("freezes direct input and queued orders during %s pause", (mode) => {
    const simulation = create();
    simulation.place("barracks", 2, 2);
    const barracks = building(simulation, "barracks");
    simulation.trainUnit("spearman", barracks.id);
    simulation.trainUnit("spearman", barracks.id);
    const [ordered, controlled] = simulation.snapshot.army;
    simulation.selectArmyUnits([ordered.id]);
    simulation.issueArmyOrder("move", { x: 12, z: 12 });
    simulation.enterDirectControl(controlled.id);
    simulation.setDirectControlInput({ moveX: 1, moveZ: 0, heading: Math.PI / 2, sprint: true });
    simulation.beginPreparation();
    if (mode === "planning") simulation.setPlanningPaused(true); else simulation.togglePause();
    const before = JSON.parse(JSON.stringify({ army: simulation.snapshot.army, direct: simulation.snapshot.directControl }));
    advance(simulation, 4);
    expect(JSON.parse(JSON.stringify({ army: simulation.snapshot.army, direct: simulation.snapshot.directControl }))).toEqual(before);
    if (mode === "planning") simulation.setPlanningPaused(false); else simulation.togglePause();
    advance(simulation, 0.5);
    expect(controlled.x).toBeGreaterThan(before.army[1].x);
    expect(ordered.x).not.toBe(before.army[0].x);
  });

  it("keeps dance authoritative, frozen by pause, and cancelled by movement or attack", () => {
    const simulation = create();
    const unit = trainAt(simulation, "spearman", 2, 2);
    expect(simulation.enterDirectControl(unit.id)).toBe(true);
    expect(simulation.beginPreparation()).toBe(true);
    advance(simulation, 0.4);

    expect(simulation.toggleDirectControlDance()).toBe(true);
    expect(simulation.snapshot.directControl?.dancing).toBe(true);
    const position = { x: unit.x, z: unit.z };
    simulation.setDirectControlInput({ moveX: 0, moveZ: 0, heading: 1.2, sprint: false });
    expect(simulation.snapshot.directControl?.dancing).toBe(true);
    simulation.togglePause();
    advance(simulation, 2);
    expect(simulation.snapshot.directControl?.dancing).toBe(true);
    expect({ x: unit.x, z: unit.z }).toEqual(position);
    simulation.togglePause();

    simulation.setDirectControlInput({ moveX: 1, moveZ: 0, heading: 1.2, sprint: false });
    expect(simulation.snapshot.directControl?.dancing).toBe(false);
    simulation.setDirectControlInput({ moveX: 0, moveZ: 0, heading: 1.2, sprint: false });
    expect(simulation.toggleDirectControlDance()).toBe(true);
    unit.cooldown = 0;
    expect(simulation.requestDirectControlAttack({ x: unit.x + 1, z: unit.z })).toBe(true);
    expect(simulation.snapshot.directControl?.dancing).toBe(false);
  });

  it("rejects invalid ids and records an automatic death exit", () => {
    const simulation = create();
    expect(simulation.selectArmyUnits([1, 999])).toEqual([]);
    expect(simulation.issueArmyOrder("move", { x: 4, z: 4 })).toBe(false);
    expect(simulation.enterDirectControl(999)).toBe(false);
    expect(simulation.exitDirectControl()).toBe(false);

    const unit = trainAt(simulation, "spearman", 2, 2);
    simulation.enterDirectControl(unit.id);
    simulation.beginPreparation();
    simulation.debugSpawnWave();
    const [killer, ...others] = simulation.snapshot.raiders;
    unit.hp = 1;
    killer.x = unit.x;
    killer.z = unit.z;
    killer.damage = 100;
    killer.cooldown = 0;
    for (const raider of others) { raider.x = 17; raider.z = 17; raider.cooldown = 999; }
    simulation.setPlanningPaused(true);
    advance(simulation, 2);
    expect(simulation.snapshot.directControl?.unitId).toBe(unit.id);
    expect(unit.hp).toBe(1);
    simulation.setPlanningPaused(false);
    simulation.tick(0.05);
    expect(simulation.snapshot.army.some((candidate) => candidate.id === unit.id)).toBe(false);
    expect(simulation.snapshot.selectedArmyUnitIds).toEqual([]);
    expect(simulation.snapshot.directControl).toBeNull();
    expect(simulation.snapshot.lastDirectControlExit).toMatchObject({ unitId: unit.id, reason: "unit-dead" });
  });

  it("emits a JSON-safe manual exit state", () => {
    const simulation = create();
    const unit = trainAt(simulation, "spearman", 2, 2);
    simulation.enterDirectControl(unit.id);
    simulation.setDirectControlAim({ x: 6, z: 7 });
    expect(simulation.exitDirectControl()).toBe(true);
    const parsed = JSON.parse(JSON.stringify(simulation.snapshot));
    expect(parsed.selectedArmyUnitIds).toEqual([unit.id]);
    expect(parsed.directControl).toBeNull();
    expect(parsed.lastDirectControlExit).toMatchObject({ unitId: unit.id, reason: "manual", elapsed: 0 });
    expect(parsed.army[0].order).toBeNull();
  });

  it("clears control, selection and orders on restart and campaign return", () => {
    const simulation = create();
    let unit = trainAt(simulation, "spearman", 2, 2);
    simulation.selectArmyUnits([unit.id]);
    simulation.issueArmyOrder("move", { x: 12, z: 12 });
    simulation.enterDirectControl(unit.id);
    simulation.restart();
    expect(simulation.snapshot.selectedArmyUnitIds).toEqual([]);
    expect(simulation.snapshot.directControl).toBeNull();
    expect(simulation.snapshot.lastDirectControlExit).toBeNull();
    expect(simulation.snapshot.army).toEqual([]);

    unit = trainAt(simulation, "spearman", 2, 2);
    simulation.enterDirectControl(unit.id);
    simulation.returnToCampaign();
    expect(simulation.snapshot.status).toBe("title");
    expect(simulation.snapshot.selectedArmyUnitIds).toEqual([]);
    expect(simulation.snapshot.directControl).toBeNull();
    expect(simulation.snapshot.army).toEqual([]);
  });
});

describe("weapon-specific direct attacks", () => {
  it.each(["planning", "manual"] as const)("rejects rather than buffering a delayed direct attack during %s pause", (mode) => {
    const { simulation, unit, target } = combatSetup("archer");
    target.x = unit.x + 3;
    target.z = unit.z;
    if (mode === "planning") simulation.setPlanningPaused(true); else simulation.togglePause();
    expect(simulation.requestDirectControlAttack({ x: target.x, z: target.z })).toBe(false);
    const before = target.hp;
    advance(simulation, 2);
    expect(target.hp).toBe(before);
    expect(unit.attackPulse).toBe(0);
    if (mode === "planning") simulation.setPlanningPaused(false); else simulation.togglePause();
    simulation.tick(0.05);
    expect(target.hp).toBe(before);
    expect(unit.attackPulse).toBe(0);
  });

  it("lets an archer hit at range only inside the aim cone and emits an arrow pulse", () => {
    const projectiles: Array<{ source?: string }> = [];
    const simulation = new GameSimulation({ onProjectile: (event) => projectiles.push(event) });
    simulation.start();
    const unit = trainAt(simulation, "archer", 1, 1);
    unit.x = 1.5; unit.z = 1.5; unit.cooldown = 0;
    simulation.enterDirectControl(unit.id);
    simulation.beginPreparation(); simulation.debugSpawnWave();
    const [target, ...others] = simulation.snapshot.raiders;
    target.x = unit.x + 3; target.z = unit.z; target.cooldown = 999;
    for (const raider of others) { raider.x = 17; raider.z = 17; raider.cooldown = 999; }
    const before = target.hp;
    expect(simulation.requestDirectControlAttack({ x: unit.x - 4, z: unit.z })).toBe(true);
    simulation.tick(0.01);
    expect(target.hp).toBe(before);
    expect(unit.attackPulse).toBe(1);
    expect(projectiles).toHaveLength(1);
    advance(simulation, ARMY_UNITS.archer.cooldown + 0.02);
    const projectileTarget = { x: target.x, z: target.z };
    expect(simulation.requestDirectControlAttack({ x: target.x, z: target.z })).toBe(true);
    simulation.tick(0.01);
    expect(target.hp).toBe(before - ARMY_UNITS.archer.damage);
    expect(unit.attackPulse).toBe(2);
    expect(unit.attacking).toBe(true);
    expect(projectiles).toHaveLength(2);
    expect(projectiles[1]).toMatchObject({ fromX: 1.5, fromZ: 1.5, source: "archer" });
    expect((projectiles[1] as { toX: number }).toX).toBeCloseTo(projectileTarget.x);
    expect((projectiles[1] as { toZ: number }).toZ).toBeCloseTo(projectileTarget.z);
  });

  it("keeps an archer projectile on the crosshair ray instead of snapping to a side target", () => {
    const projectiles: Array<{ toX: number; toZ: number }> = [];
    const simulation = new GameSimulation({ onProjectile: (event) => projectiles.push(event) });
    simulation.start();
    const unit = trainAt(simulation, "archer", 1, 1);
    unit.x = 2; unit.z = 2; unit.cooldown = 0;
    expect(simulation.enterDirectControl(unit.id)).toBe(true);
    expect(simulation.beginPreparation()).toBe(true);
    simulation.debugSpawnWave();
    const [sideTarget, ...others] = simulation.snapshot.raiders;
    sideTarget.x = unit.x + 3;
    sideTarget.z = unit.z + 0.9;
    sideTarget.cooldown = 999;
    for (const raider of others) { raider.x = 17; raider.z = 17; raider.cooldown = 999; }
    const before = sideTarget.hp;

    expect(simulation.requestDirectControlAttack({ x: unit.x + 8, z: unit.z })).toBe(true);
    simulation.tick(0.01);

    expect(sideTarget.hp).toBe(before);
    expect(projectiles).toHaveLength(1);
    expect(projectiles[0].toX).toBeCloseTo(unit.x + ARMY_UNITS.archer.range);
    expect(projectiles[0].toZ).toBeCloseTo(unit.z);
  });

  it("requires a higher third-person aim for a distant archer target and leaves a grounded arrow", () => {
    const run = (pitch: number) => {
      const projectiles: Array<{ toX: number; ballistic?: { lingerSeconds: number; impact: string } }> = [];
      const simulation = new GameSimulation({ onProjectile: (event) => projectiles.push(event) });
      simulation.start();
      const unit = trainAt(simulation, "archer", 1, 1);
      unit.x = 2;
      unit.z = 2;
      unit.cooldown = 0;
      simulation.enterDirectControl(unit.id);
      simulation.beginPreparation();
      simulation.debugSpawnWave();
      const [target, ...others] = simulation.snapshot.raiders;
      target.x = unit.x + 4.65;
      target.z = unit.z;
      target.cooldown = 999;
      for (const raider of others) { raider.x = 17; raider.z = 17; raider.cooldown = 999; }
      const before = target.hp;
      expect(simulation.requestDirectControlAttack({ x: unit.x + 8, z: unit.z, pitch })).toBe(true);
      simulation.tick(0.01);
      return { damage: before - target.hp, projectile: projectiles[0] };
    };

    const low = run(0);
    // The release point now follows the smaller human model (0.36 world units).
    // A 0.25-radian elevation reaches the same distant target from this height.
    const raised = run(0.25);
    expect(low.damage).toBe(0);
    expect(low.projectile.toX).toBeLessThan(6);
    expect(raised.damage).toBe(ARMY_UNITS.archer.damage);
    expect(raised.projectile.ballistic).toMatchObject({ lingerSeconds: 1, impact: "target" });
  });

  it.each(["spearman", "swordsman", "knight"] as const)("uses %s melee range, damage and cooldown", (kind) => {
    const { simulation, unit, target } = combatSetup(kind);
    const definition = ARMY_UNITS[kind];
    target.x = unit.x + definition.range - 0.04;
    target.z = unit.z;
    const before = target.hp;
    expect(simulation.requestDirectControlAttack({ x: target.x, z: target.z })).toBe(true);
    simulation.tick(0.01);
    expect(target.hp).toBe(before - definition.damage);
    expect(unit.cooldown).toBeCloseTo(definition.cooldown);
    expect(unit.attackPulse).toBe(1);
    expect(simulation.requestDirectControlAttack({ x: target.x, z: target.z })).toBe(false);
    advance(simulation, definition.cooldown + 0.01);
    expect(simulation.snapshot.directControl?.attackReady).toBe(true);
    expect(simulation.requestDirectControlAttack({ x: target.x, z: target.z })).toBe(true);
    simulation.tick(0.01);
    expect(target.hp).toBe(before - definition.damage * 2);
    expect(unit.attackPulse).toBe(2);
  });

  it("keeps melee attacks out of archer range and respects facing", () => {
    const { simulation, unit, target } = combatSetup("spearman");
    target.x = unit.x + 2;
    target.z = unit.z;
    const before = target.hp;
    simulation.requestDirectControlAttack({ x: target.x, z: target.z });
    simulation.tick(0.01);
    expect(target.hp).toBe(before);
    advance(simulation, ARMY_UNITS.spearman.cooldown + 0.01);
    target.x = unit.x + ARMY_UNITS.spearman.range - 0.04;
    simulation.requestDirectControlAttack({ x: unit.x - 2, z: unit.z });
    simulation.tick(0.01);
    expect(target.hp).toBe(before);
  });
});
