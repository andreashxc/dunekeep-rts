import { DIFFICULTIES, MISSIONS } from "./content";
import type { GameSaveDataV1 } from "./types";

export const GAME_SAVE_KEY = "dunekeep.save";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedSessionSummary {
  missionName: string;
  difficultyName: string;
  savedAt: number;
  elapsed: number;
  missionCompleted: boolean;
}

function looksLikeSave(value: unknown): value is GameSaveDataV1 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameSaveDataV1>;
  return candidate.version === 1
    && typeof candidate.savedAt === "number"
    && Number.isFinite(candidate.savedAt)
    && typeof candidate.missionId === "string"
    && Object.prototype.hasOwnProperty.call(MISSIONS, candidate.missionId)
    && typeof candidate.difficultyId === "string"
    && Object.prototype.hasOwnProperty.call(DIFFICULTIES, candidate.difficultyId)
    && (candidate.status === "playing" || candidate.status === "paused" || candidate.status === "victory")
    && Boolean(candidate.state && typeof candidate.state === "object");
}

export function loadSavedSession(storage: KeyValueStorage): GameSaveDataV1 | null {
  try {
    const serialized = storage.getItem(GAME_SAVE_KEY);
    if (!serialized) return null;
    const parsed: unknown = JSON.parse(serialized);
    if (parsed && typeof parsed === "object" && typeof (parsed as { version?: unknown }).version === "number"
      && (parsed as { version: number }).version !== 1) return null;
    if (!looksLikeSave(parsed)) {
      storage.removeItem(GAME_SAVE_KEY);
      return null;
    }
    return parsed;
  } catch {
    try { storage.removeItem(GAME_SAVE_KEY); } catch { /* unavailable storage remains non-fatal */ }
    return null;
  }
}

export function writeSavedSession(storage: KeyValueStorage, save: GameSaveDataV1): boolean {
  try {
    storage.setItem(GAME_SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedSession(storage: KeyValueStorage): void {
  try { storage.removeItem(GAME_SAVE_KEY); } catch { /* private browsing may reject storage */ }
}

export function summarizeSavedSession(save: GameSaveDataV1): SavedSessionSummary {
  return {
    missionName: MISSIONS[save.missionId].name,
    difficultyName: DIFFICULTIES[save.difficultyId].label,
    savedAt: save.savedAt,
    elapsed: save.state.elapsed,
    missionCompleted: save.state.missionCompleted || save.status === "victory",
  };
}

/** Tracks only successful writes, so quota failures remain retryable. */
export class SessionWriter {
  private lastPayload = "";
  constructor(private readonly storage: KeyValueStorage | null) {}
  reset(): void { this.lastPayload = ""; }
  write(save: GameSaveDataV1): "saved" | "unchanged" | "failed" {
    if (!this.storage) return "failed";
    const payload = JSON.stringify({ ...save, savedAt: 0 });
    if (payload === this.lastPayload) return "unchanged";
    if (!writeSavedSession(this.storage, save)) return "failed";
    this.lastPayload = payload;
    return "saved";
  }
}
