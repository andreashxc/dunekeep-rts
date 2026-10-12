import { describe, expect, it } from "vitest";
import {
  enumerateConnectedFortificationSlots,
  garrisonCapacity,
  garrisonDeckHeight,
  garrisonSlotPosition,
  isGarrisonBuildingKind,
} from "./fortifications";
import type { BuildingKind, BuildingState, GarrisonBuildingKind } from "./types";

function building(id: number, kind: BuildingKind, gx: number, gz: number, hp = 100): BuildingState {
  return {
    id,
    kind,
    gx,
    gz,
    hp,
    maxHp: 100,
    cooldown: 0,
    efficiency: 1,
    enabled: true,
    priority: "normal",
  };
}

function garrisonBuilding(kind: GarrisonBuildingKind, gx: number, gz: number) {
  return { kind, gx, gz } as const;
}

describe("fortification garrison profiles", () => {
  it("accepts only living-surface building kinds", () => {
    expect(isGarrisonBuildingKind("wall")).toBe(true);
    expect(isGarrisonBuildingKind("tower")).toBe(true);
    for (const kind of ["gate", "keep", "house", "barracks", "stable"] as BuildingKind[]) {
      expect(isGarrisonBuildingKind(kind)).toBe(false);
    }
  });

  it("uses one centered wall slot and two forward tower slots", () => {
    expect(garrisonCapacity("wall")).toBe(1);
    expect(garrisonCapacity("tower")).toBe(2);
    expect(garrisonSlotPosition(garrisonBuilding("wall", 5, 7), 0)).toEqual({ x: 5, z: 7 });
    expect(garrisonSlotPosition(garrisonBuilding("tower", 5, 7), 0)).toEqual({ x: 4.82, z: 7.16 });
    expect(garrisonSlotPosition(garrisonBuilding("tower", 5, 7), 1)).toEqual({ x: 5.18, z: 7.16 });
  });

  it("matches the rendered wall and tower deck heights and rejects invalid slots", () => {
    expect(garrisonDeckHeight("wall")).toBe(1.14);
    expect(garrisonDeckHeight("tower")).toBe(1.7);
    expect(() => garrisonSlotPosition(garrisonBuilding("wall", 0, 0), 1)).toThrow(RangeError);
    expect(() => garrisonSlotPosition(garrisonBuilding("tower", 0, 0), -1)).toThrow(RangeError);
    expect(() => garrisonSlotPosition(garrisonBuilding("tower", 0, 0), 0.5)).toThrow(RangeError);
  });
});

describe("connected fortification slot enumeration", () => {
  const start = building(40, "wall", 5, 5);
  const northTower = building(10, "tower", 5, 4);
  const eastWall = building(90, "wall", 6, 5);
  const northWall = building(70, "wall", 5, 3);
  const eastTower = building(20, "tower", 7, 5);
  const diagonal = building(30, "tower", 4, 6);
  const deadBridge = building(50, "wall", 4, 5, 0);
  const behindDeadBridge = building(60, "tower", 3, 5);
  const gate = building(80, "gate", 5, 6);
  const behindGate = building(100, "wall", 5, 7);
  const all = [eastTower, behindGate, diagonal, start, northWall, gate, northTower, behindDeadBridge, deadBridge, eastWall];

  it("uses deterministic cardinal BFS with the start and each building's slots first", () => {
    const slots = enumerateConnectedFortificationSlots(start, all);
    expect(slots.map(({ buildingId, slot }) => `${buildingId}:${slot}`)).toEqual([
      "40:0",
      "10:0", "10:1",
      "90:0",
      "70:0",
      "20:0", "20:1",
    ]);
    expect(slots[0]).toMatchObject({ buildingId: 40, buildingKind: "wall", gx: 5, gz: 5, slot: 0, x: 5, z: 5 });
    expect(slots[1]).toMatchObject({ buildingId: 10, buildingKind: "tower", gx: 5, gz: 4, slot: 0, x: 4.82, z: 4.16 });
  });

  it("ignores disconnected, diagonal, dead and non-garrison buildings", () => {
    const ids = new Set(enumerateConnectedFortificationSlots(start, all).map((slot) => slot.buildingId));
    expect(ids).toEqual(new Set([40, 10, 90, 70, 20]));
    expect(ids.has(diagonal.id)).toBe(false);
    expect(ids.has(deadBridge.id)).toBe(false);
    expect(ids.has(behindDeadBridge.id)).toBe(false);
    expect(ids.has(gate.id)).toBe(false);
    expect(ids.has(behindGate.id)).toBe(false);
  });

  it("is independent of input array order", () => {
    const forward = enumerateConnectedFortificationSlots(start, all);
    const reversed = enumerateConnectedFortificationSlots(start, [...all].reverse());
    const shuffled = enumerateConnectedFortificationSlots(start, [gate, northWall, eastWall, start, eastTower, diagonal, deadBridge, northTower, behindGate, behindDeadBridge]);
    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it("returns no slots when the start is absent, dead, or not a garrison building", () => {
    expect(enumerateConnectedFortificationSlots(building(999, "wall", 5, 5), all)).toEqual([]);
    expect(enumerateConnectedFortificationSlots(deadBridge, all)).toEqual([]);
    expect(enumerateConnectedFortificationSlots(gate, all)).toEqual([]);
  });
});
