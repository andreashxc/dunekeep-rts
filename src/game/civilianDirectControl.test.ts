import { describe, expect, it } from "vitest";
import { GameSimulation } from "./simulation";
import type { BuildingKind, CivilianState } from "./types";

function advance(simulation: GameSimulation, seconds: number): void {
  let remaining = seconds;
  while (remaining > 0.000001) {
    const step = Math.min(0.05, remaining);
    simulation.tick(step);
    remaining -= step;
  }
}

function create(): GameSimulation {
  const simulation = new GameSimulation();
  simulation.start();
  return simulation;
}

function building(simulation: GameSimulation, kind: BuildingKind) {
  return simulation.snapshot.buildings.find((candidate) => candidate.kind === kind)!;
}

function assignedCivilian(simulation: GameSimulation): CivilianState {
  return simulation.snapshot.civilianEntities.find((civilian) => civilian.jobBuildingId !== null)!;
}

describe("civilian simulation entities", () => {
  it("exposes stable JSON-safe identities and concrete economy assignments", () => {
    const simulation = create();
    const first = simulation.snapshot;
    expect(first.civilianEntities).toHaveLength(first.civilians);
    expect(new Set(first.civilianEntities.map((civilian) => civilian.id)).size).toBe(first.civilians);
    expect(first.civilianEntities.every((civilian) => civilian.entityKind === "civilian")).toBe(true);
    const initialPositions = new Set(first.civilianEntities.map((civilian) => `${civilian.x.toFixed(6)}:${civilian.z.toFixed(6)}`));
    expect(initialPositions.size).toBe(first.civilianEntities.length);

    const assignedByBuilding = new Map<number, number>();
    for (const civilian of first.civilianEntities) {
      if (civilian.jobBuildingId !== null) {
        assignedByBuilding.set(civilian.jobBuildingId, (assignedByBuilding.get(civilian.jobBuildingId) ?? 0) + 1);
      }
    }
    for (const production of first.economy.production) {
      expect(assignedByBuilding.get(production.buildingId) ?? 0).toBe(production.workersAssigned);
    }

    simulation.beginPreparation();
    advance(simulation, 6);
    expect(simulation.snapshot.civilianEntities.map((civilian) => civilian.id)).toEqual(first.civilianEntities.map((civilian) => civilian.id));
    const freeResidents = simulation.snapshot.civilianEntities.filter((civilian) => civilian.jobBuildingId === null);
    const residentPositions = new Set(freeResidents.map((civilian) => `${civilian.x.toFixed(5)}:${civilian.z.toFixed(5)}`));
    expect(residentPositions.size).toBe(freeResidents.length);
    const parsed = JSON.parse(JSON.stringify(simulation.snapshot));
    expect(parsed.civilianEntities).toHaveLength(first.civilians);
    expect(parsed.civilianEntities[0]).toMatchObject({ entityKind: "civilian", id: first.civilianEntities[0].id });
  });

  it("keeps the controlled worker in the same job and economy allocation", () => {
    const simulation = create();
    const civilian = assignedCivilian(simulation);
    const jobId = civilian.jobBuildingId!;
    const staffingBefore = simulation.snapshot.economy.production.find((entry) => entry.buildingId === jobId)!.workersAssigned;
    const freeWorkersBefore = simulation.snapshot.freeWorkers;
    expect(simulation.selectCivilian(civilian.id)).toBe(true);
    expect(simulation.enterCivilianDirectControl(civilian.id)).toBe(true);
    expect(simulation.snapshot.directControl).toMatchObject({
      entityKind: "civilian", entityId: civilian.id, unitId: civilian.id, canAttack: false, attackReady: false,
    });
    expect(simulation.snapshot.selectedCivilianId).toBe(civilian.id);
    expect(simulation.requestDirectControlAttack()).toBe(false);

    simulation.setDirectControlInput({ moveX: 1, moveZ: 0, heading: Math.PI / 2, sprint: false });
    simulation.beginPreparation();
    const before = { x: civilian.x, z: civilian.z };
    advance(simulation, 0.6);
    expect(civilian.x).toBeGreaterThan(before.x + 0.25);
    expect(civilian.activity).toBe("controlled");
    expect(civilian.jobBuildingId).toBe(jobId);
    expect(simulation.snapshot.economy.production.find((entry) => entry.buildingId === jobId)!.workersAssigned).toBe(staffingBefore);
    expect(simulation.snapshot.freeWorkers).toBe(freeWorkersBefore);
  });

  it("makes the third-person run button 2.2 times faster than walking", () => {
    const travel = (sprint: boolean) => {
      const simulation = create();
      const civilian = assignedCivilian(simulation);
      civilian.x = 2;
      civilian.z = 2;
      expect(simulation.enterCivilianDirectControl(civilian.id)).toBe(true);
      simulation.setDirectControlInput({ moveX: 1, moveZ: 0, heading: Math.PI / 2, sprint });
      simulation.beginPreparation();
      advance(simulation, 0.5);
      return civilian.x - 2;
    };

    const walk = travel(false);
    const sprint = travel(true);
    expect(walk).toBeGreaterThan(0);
    expect(sprint).toBeCloseTo(walk * 2.2, 4);
  });

  it("lets a controlled worker dance without losing their job", () => {
    const simulation = create();
    const civilian = assignedCivilian(simulation);
    const jobId = civilian.jobBuildingId;
    expect(simulation.enterCivilianDirectControl(civilian.id)).toBe(true);
    expect(simulation.beginPreparation()).toBe(true);
    expect(simulation.toggleDirectControlDance()).toBe(true);
    expect(simulation.snapshot.directControl?.dancing).toBe(true);
    expect(civilian.jobBuildingId).toBe(jobId);
    simulation.setDirectControlInput({ moveX: 0.5, moveZ: 0, heading: Math.PI / 2, sprint: false });
    expect(simulation.snapshot.directControl?.dancing).toBe(false);
    expect(civilian.jobBuildingId).toBe(jobId);
  });

  it("produces exactly the same economy tick while a worker is player-controlled", () => {
    const controlled = create();
    const baseline = create();
    const civilian = assignedCivilian(controlled);
    expect(controlled.enterCivilianDirectControl(civilian.id)).toBe(true);
    controlled.setDirectControlInput({ moveX: 1, moveZ: 0, heading: Math.PI / 2, sprint: true });
    controlled.beginPreparation();
    baseline.beginPreparation();
    advance(controlled, 2.1);
    advance(baseline, 2.1);
    expect(controlled.snapshot.resources).toEqual(baseline.snapshot.resources);
    expect(controlled.snapshot.economy.netPerTick).toEqual(baseline.snapshot.economy.netPerTick);
  });

  it("preserves analogue joystick magnitude and only clamps over-range input", () => {
    const partial = create();
    const full = create();
    const partialCivilian = partial.snapshot.civilianEntities[0];
    const fullCivilian = full.snapshot.civilianEntities[0];
    partialCivilian.x = 2; partialCivilian.z = 2;
    fullCivilian.x = 2; fullCivilian.z = 2;
    expect(partial.enterCivilianDirectControl(partialCivilian.id)).toBe(true);
    expect(full.enterCivilianDirectControl(fullCivilian.id)).toBe(true);
    expect(partial.setDirectControlInput({ moveX: 0.25, moveZ: 0, heading: Math.PI / 2, sprint: false })).toBe(true);
    expect(full.setDirectControlInput({ moveX: 2, moveZ: 0, heading: Math.PI / 2, sprint: false })).toBe(true);
    expect(partial.snapshot.directControl).toMatchObject({ moveX: 0.25, moveZ: 0 });
    expect(full.snapshot.directControl).toMatchObject({ moveX: 1, moveZ: 0 });

    partial.beginPreparation();
    full.beginPreparation();
    advance(partial, 0.5);
    advance(full, 0.5);
    const partialDistance = partialCivilian.x - 2;
    const fullDistance = fullCivilian.x - 2;
    expect(partialDistance).toBeCloseTo(fullDistance * 0.25, 4);
    expect(fullDistance).toBeGreaterThan(partialDistance * 3.9);
  });

  it("resumes the previous work route from the manual position without teleporting", () => {
    const simulation = create();
    const civilian = assignedCivilian(simulation);
    const originalJob = civilian.jobBuildingId;
    simulation.enterCivilianDirectControl(civilian.id);
    simulation.setDirectControlInput({ moveX: -1, moveZ: 0, heading: -Math.PI / 2, sprint: true });
    simulation.beginPreparation();
    advance(simulation, 0.8);
    simulation.setDirectControlInput({ moveX: 0, moveZ: 0, heading: -Math.PI / 2, sprint: false });
    const manualPosition = { x: civilian.x, z: civilian.z };

    expect(simulation.exitDirectControl()).toBe(true);
    expect(civilian.jobBuildingId).toBe(originalJob);
    expect(civilian.activity).toBe("commuting");
    simulation.tick(0.01);
    expect(Math.hypot(civilian.x - manualPosition.x, civilian.z - manualPosition.z)).toBeLessThanOrEqual(civilian.speed * 0.011);
    const afterFirstStep = { x: civilian.x, z: civilian.z };
    advance(simulation, 1.5);
    expect(Math.hypot(civilian.x - afterFirstStep.x, civilian.z - afterFirstStep.z)).toBeGreaterThan(0.2);
    expect(simulation.snapshot.lastDirectControlExit).toMatchObject({
      entityKind: "civilian", entityId: civilian.id, unitId: civilian.id, reason: "manual",
    });
  });

  it.each(["planning", "manual"] as const)("freezes controlled and AI civilians during %s pause", (mode) => {
    const simulation = create();
    const controlled = assignedCivilian(simulation);
    const ai = simulation.snapshot.civilianEntities.find((civilian) => civilian.id !== controlled.id && civilian.jobBuildingId !== null)!;
    simulation.enterCivilianDirectControl(controlled.id);
    simulation.setDirectControlInput({ moveX: 1, moveZ: 0, heading: Math.PI / 2, sprint: true });
    simulation.beginPreparation();
    if (mode === "planning") simulation.setPlanningPaused(true); else simulation.togglePause();
    const before = JSON.parse(JSON.stringify({ controlled, ai, direct: simulation.snapshot.directControl }));
    advance(simulation, 3);
    expect(JSON.parse(JSON.stringify({ controlled, ai, direct: simulation.snapshot.directControl }))).toEqual(before);
    if (mode === "planning") simulation.setPlanningPaused(false); else simulation.togglePause();
    advance(simulation, 0.5);
    expect(controlled.x).toBeGreaterThan(before.controlled.x);
  });

  it("uses the same solid-building and open-gate collision rules as soldiers", () => {
    const blocked = create();
    expect(blocked.place("wall", 5, 2)).toBe(true);
    const blockedCivilian = blocked.snapshot.civilianEntities[0];
    blockedCivilian.x = 4.1;
    blockedCivilian.z = 2;
    blocked.enterCivilianDirectControl(blockedCivilian.id);
    blocked.setDirectControlInput({ moveX: 1, moveZ: 0, heading: Math.PI / 2, sprint: true });
    blocked.beginPreparation();
    advance(blocked, 3);
    expect(blockedCivilian.x).toBeLessThan(4.55);

    const throughGate = create();
    expect(throughGate.place("gate", 5, 2)).toBe(true);
    const gateCivilian = throughGate.snapshot.civilianEntities[0];
    gateCivilian.x = 4.1;
    gateCivilian.z = 2;
    throughGate.enterCivilianDirectControl(gateCivilian.id);
    throughGate.setDirectControlInput({ moveX: 1, moveZ: 0, heading: Math.PI / 2, sprint: true });
    throughGate.beginPreparation();
    advance(throughGate, 3);
    expect(gateCivilian.x).toBeGreaterThan(5.3);
  });

  it("exits cleanly on civilian death and restores a fresh AI population on restart", () => {
    const simulation = create();
    const civilian = assignedCivilian(simulation);
    const populationBefore = simulation.snapshot.civilians;
    simulation.selectCivilian(civilian.id);
    simulation.enterCivilianDirectControl(civilian.id);
    civilian.hp = 0;
    simulation.tick(0.01);
    expect(simulation.snapshot.civilians).toBe(populationBefore - 1);
    expect(simulation.snapshot.civilianEntities.some((candidate) => candidate.id === civilian.id)).toBe(false);
    expect(simulation.snapshot.directControl).toBeNull();
    expect(simulation.snapshot.selectedCivilianId).toBeNull();
    expect(simulation.snapshot.lastDirectControlExit).toMatchObject({
      entityKind: "civilian", entityId: civilian.id, reason: "civilian-dead",
    });

    simulation.restart();
    expect(simulation.snapshot.directControl).toBeNull();
    expect(simulation.snapshot.lastDirectControlExit).toBeNull();
    expect(simulation.snapshot.selectedCivilianId).toBeNull();
    expect(simulation.snapshot.civilianEntities).toHaveLength(simulation.snapshot.civilians);
    expect(new Set(simulation.snapshot.civilianEntities.map((candidate) => candidate.id)).size).toBe(simulation.snapshot.civilians);
    expect(simulation.snapshot.civilianEntities.every((candidate) => candidate.hp === candidate.maxHp && candidate.activity !== "controlled")).toBe(true);
  });

  it("switches between civilian and army control without corrupting either lifecycle", () => {
    const simulation = create();
    expect(simulation.place("barracks", 2, 2)).toBe(true);
    const barracks = building(simulation, "barracks");
    expect(simulation.trainUnit("spearman", barracks.id)).toBe(true);
    const soldier = simulation.snapshot.army[0];
    const civilian = assignedCivilian(simulation);
    const jobId = civilian.jobBuildingId;
    simulation.selectArmyUnits([soldier.id]);
    expect(simulation.issueArmyOrder("move", { x: 12, z: 12 })).toBe(true);
    const order = { ...soldier.order! };

    expect(simulation.enterCivilianDirectControl(civilian.id)).toBe(true);
    expect(simulation.snapshot.directControl).toMatchObject({ entityKind: "civilian", entityId: civilian.id });
    expect(soldier.order).toEqual(order);
    expect(civilian.jobBuildingId).toBe(jobId);

    expect(simulation.enterDirectControl(soldier.id)).toBe(true);
    expect(simulation.snapshot.directControl).toMatchObject({ entityKind: "army", entityId: soldier.id, unitId: soldier.id, canAttack: true });
    expect(civilian.activity).not.toBe("controlled");
    expect(civilian.jobBuildingId).toBe(jobId);
    expect(simulation.snapshot.selectedCivilianId).toBeNull();
    expect(simulation.snapshot.selectedArmyUnitIds).toEqual([soldier.id]);
  });
});
