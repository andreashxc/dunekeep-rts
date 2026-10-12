import { describe, expect, it } from "vitest";
import { GameSimulation } from "./simulation";

function advance(simulation: GameSimulation, seconds: number): void {
  for (let remaining = seconds; remaining > 0.000001;) {
    const step = Math.min(0.05, remaining);
    simulation.tick(step);
    remaining -= step;
  }
}

function completeOasis(simulation: GameSimulation): void {
  expect(simulation.place("farm", 6, 10)).toBe(true);
  expect(simulation.place("tower", 5, 8)).toBe(true);
  expect(simulation.place("barracks", 5, 5)).toBe(true);
  const barracks = simulation.snapshot.buildings.find((building) => building.kind === "barracks")!;
  expect(simulation.trainUnit("spearman", barracks.id)).toBe(true);
  expect(simulation.trainUnit("spearman", barracks.id)).toBe(true);
  expect(simulation.beginPreparation()).toBe(true);
  while (simulation.snapshot.wave < simulation.snapshot.waveCount) simulation.debugSpawnWave();
  for (const raider of simulation.snapshot.raiders) raider.hp = 0;
  (simulation as unknown as { raidClock: number }).raidClock = 10_000;
  simulation.tick(0.05);
  expect(simulation.snapshot.status).toBe("victory");
}

describe("mission continuation and save restoration", () => {
  it("freezes at victory, then continues as a persistent sandbox without repeating the result", () => {
    const simulation = new GameSimulation();
    simulation.start();
    completeOasis(simulation);
    const frozen = simulation.snapshot.elapsed;
    advance(simulation, 3);
    expect(simulation.snapshot.elapsed).toBe(frozen);
    expect(simulation.snapshot.missionCompleted).toBe(true);

    expect(simulation.continueAfterVictory()).toBe(true);
    const wave = simulation.snapshot.wave;
    advance(simulation, 2.1);
    expect(simulation.snapshot.status).toBe("playing");
    expect(simulation.snapshot.missionCompleted).toBe(true);
    expect(simulation.snapshot.elapsed).toBeGreaterThan(frozen);
    expect(simulation.snapshot.wave).toBe(wave);
    expect(simulation.continueAfterVictory()).toBe(false);
  });

  it("round-trips authoritative world state without offline progress or transient controls", () => {
    const original = new GameSimulation();
    original.selectMission("river");
    original.selectDifficulty("veteran");
    original.start();
    original.place("wall", 2, 2);
    original.beginPreparation();
    advance(original, 2.65);
    const save = original.exportSave(999_000)!;

    const restored = new GameSimulation();
    expect(restored.restoreSave(save)).toBe(true);
    expect(restored.snapshot).toMatchObject({
      status: "playing",
      missionId: "river",
      difficultyId: "veteran",
      elapsed: save.state.elapsed,
      raidClock: save.state.raidClock,
      resources: save.state.resources,
      directControl: null,
      selectedArmyUnitIds: [],
      selectedCivilianId: null,
    });
    expect(restored.snapshot.buildings).toEqual(save.state.buildings);
  });

  it("upgrades an older fourth-stage save by adding the new rival castle", () => {
    const source = new GameSimulation();
    source.selectMission("river");
    source.start();
    const legacy = source.exportSave()!;
    legacy.state.duel = null;
    legacy.state.wave = 4;
    const restored = new GameSimulation();
    expect(restored.restoreSave(legacy)).toBe(true);
    expect(restored.snapshot).toMatchObject({ missionId: "river", wave: 0, status: "playing" });
    expect(restored.snapshot.duel).toMatchObject({ enemyName: "Замок Нахр", friendly: false });
  });

  it("restores a paused session without letting the world advance unexpectedly", () => {
    const original = new GameSimulation();
    original.start();
    original.beginPreparation();
    advance(original, 1);
    original.togglePause();
    const save = original.exportSave()!;
    const restored = new GameSimulation();
    expect(restored.restoreSave(save)).toBe(true);
    const elapsed = restored.snapshot.elapsed;
    advance(restored, 2);
    expect(restored.snapshot.status).toBe("paused");
    expect(restored.snapshot.elapsed).toBe(elapsed);
  });

  it("restores a completed mission to the result screen and keeps the sandbox available", () => {
    const original = new GameSimulation();
    original.start();
    completeOasis(original);
    const save = original.exportSave()!;
    const restored = new GameSimulation();
    expect(restored.restoreSave(save)).toBe(true);
    expect(restored.snapshot).toMatchObject({ status: "victory", missionCompleted: true });
    expect(restored.continueAfterVictory()).toBe(true);
    expect(restored.snapshot.status).toBe("playing");
  });

  it("does not start unplayed mission events after entering free play", () => {
    const source = new GameSimulation();
    source.start();
    const save = source.exportSave()!;
    save.status = "playing";
    save.state.missionCompleted = true;
    save.state.preparationStarted = true;
    save.state.wave = 1;
    save.state.raidClock = 0;
    save.state.chronicle = [];
    save.state.triggeredEvents = [];

    const restored = new GameSimulation();
    expect(restored.restoreSave(save)).toBe(true);
    advance(restored, 190);
    expect(restored.snapshot.missionCompleted).toBe(true);
    expect(restored.snapshot.chronicle).toEqual([]);
  });

  it("rejects malformed nested state transactionally", () => {
    const simulation = new GameSimulation();
    simulation.start();
    const before = JSON.stringify(simulation.snapshot);
    const invalid = simulation.exportSave()!;
    (invalid.state.buildings[0] as unknown as { kind: string }).kind = "unknown";
    expect(simulation.restoreSave(invalid)).toBe(false);
    expect(JSON.stringify(simulation.snapshot)).toBe(before);
  });

  it("rejects a completed save whose mission waves are inconsistent", () => {
    const source = new GameSimulation();
    source.start();
    const invalid = source.exportSave()!;
    invalid.status = "victory";
    invalid.state.missionCompleted = true;
    invalid.state.wave = 0;
    const restored = new GameSimulation();
    expect(restored.restoreSave(invalid)).toBe(false);
  });
});
