import { describe, expect, it } from "vitest";
import { GameSimulation } from "./simulation";
import { SessionWriter, GAME_SAVE_KEY, clearSavedSession, loadSavedSession, summarizeSavedSession, writeSavedSession, type KeyValueStorage } from "./sessionStorage";

class MemoryStorage implements KeyValueStorage {
  values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

describe("saved browser sessions", () => {
  it("round-trips a versioned simulation save and exposes friendly metadata", () => {
    const storage = new MemoryStorage();
    const simulation = new GameSimulation();
    simulation.selectMission("river");
    simulation.selectDifficulty("relaxed");
    simulation.start();
    simulation.place("wall", 2, 2);
    const save = simulation.exportSave(1_234)!;

    expect(writeSavedSession(storage, save)).toBe(true);
    const loaded = loadSavedSession(storage)!;
    expect(loaded).toEqual(save);
    expect(summarizeSavedSession(loaded)).toMatchObject({
      missionName: "Долина двух рек",
      difficultyName: "Спокойно",
      savedAt: 1_234,
      missionCompleted: false,
    });
  });

  it("removes malformed data but preserves future versions for migration", () => {
    const storage = new MemoryStorage();
    storage.setItem(GAME_SAVE_KEY, "{broken");
    expect(loadSavedSession(storage)).toBeNull();
    expect(storage.getItem(GAME_SAVE_KEY)).toBeNull();
    storage.setItem(GAME_SAVE_KEY, JSON.stringify({ version: 99 }));
    expect(loadSavedSession(storage)).toBeNull();
    expect(storage.getItem(GAME_SAVE_KEY)).not.toBeNull();
  });

  it("clears an existing continuation", () => {
    const storage = new MemoryStorage();
    storage.setItem(GAME_SAVE_KEY, "saved");
    clearSavedSession(storage);
    expect(storage.getItem(GAME_SAVE_KEY)).toBeNull();
  });
});


describe("changed session writes", () => {
  it("skips timestamp-only changes but writes after reset or a real action", () => {
    const storage = new MemoryStorage();
    const writer = new SessionWriter(storage);
    const game = new GameSimulation(); game.start();
    expect(writer.write(game.exportSave(1)!)).toBe("saved");
    expect(writer.write(game.exportSave(2)!)).toBe("unchanged");
    game.beginPreparation(); game.tick(0.1);
    expect(writer.write(game.exportSave(3)!)).toBe("saved");
    clearSavedSession(storage); writer.reset();
    expect(writer.write(game.exportSave(4)!)).toBe("saved");
    expect(loadSavedSession(storage)?.savedAt).toBe(4);
  });
  it("retries a failed write of the same state", () => {
    const storage = new MemoryStorage();
    const original = storage.setItem.bind(storage);
    storage.setItem = () => { throw new Error("quota"); };
    const writer = new SessionWriter(storage);
    const game = new GameSimulation(); game.start();
    expect(writer.write(game.exportSave(1)!)).toBe("failed");
    storage.setItem = original;
    expect(writer.write(game.exportSave(2)!)).toBe("saved");
    expect(loadSavedSession(storage)?.savedAt).toBe(2);
  });
  it("reports unavailable browser storage without throwing", () => {
    const game = new GameSimulation(); game.start();
    expect(new SessionWriter(null).write(game.exportSave()!)).toBe("failed");
  });
});
