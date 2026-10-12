import type { BuildingKind, BuildingState, GarrisonBuildingKind } from "./types";

export interface GarrisonSlotPosition {
  x: number;
  z: number;
}

export interface ConnectedFortificationSlot extends GarrisonSlotPosition {
  buildingId: number;
  buildingKind: GarrisonBuildingKind;
  gx: number;
  gz: number;
  slot: number;
}

export type GarrisonBuildingPlacement = Pick<BuildingState, "gx" | "gz"> & {
  kind: GarrisonBuildingKind;
};

interface GarrisonProfile {
  deckHeight: number;
  slots: readonly GarrisonSlotPosition[];
}

const GARRISON_PROFILES: Record<GarrisonBuildingKind, GarrisonProfile> = {
  // The connected-wall cap ends at Y=1.14 in GameRenderer.
  wall: {
    deckHeight: 1.14,
    slots: [{ x: 0, z: 0 }],
  },
  // Two forward positions avoid the small rear dome on DesertArchitecture's tower.
  tower: {
    deckHeight: 1.7,
    slots: [
      { x: -0.18, z: 0.16 },
      { x: 0.18, z: 0.16 },
    ],
  },
};

const CARDINAL_DIRECTIONS = [
  { gx: 0, gz: -1 },
  { gx: 1, gz: 0 },
  { gx: 0, gz: 1 },
  { gx: -1, gz: 0 },
] as const;

export function isGarrisonBuildingKind(kind: BuildingKind): kind is GarrisonBuildingKind {
  return kind === "wall" || kind === "tower";
}

export function garrisonCapacity(kind: GarrisonBuildingKind): number {
  return GARRISON_PROFILES[kind].slots.length;
}

export function garrisonDeckHeight(kind: GarrisonBuildingKind): number {
  return GARRISON_PROFILES[kind].deckHeight;
}

/** Returns simulation-space x/z for one deterministic slot on a fortification deck. */
export function garrisonSlotPosition(building: GarrisonBuildingPlacement, slot: number): GarrisonSlotPosition {
  const offset = Number.isInteger(slot) ? GARRISON_PROFILES[building.kind].slots[slot] : undefined;
  if (!offset) throw new RangeError(`Invalid ${building.kind} garrison slot: ${slot}`);
  return { x: building.gx + offset.x, z: building.gz + offset.z };
}

/**
 * Enumerates every slot in the living cardinally-connected fortification component.
 * The start building is always first, neighbours use N/E/S/W order, duplicate cells
 * use ascending ids, and each building contributes slots in ascending index order.
 */
export function enumerateConnectedFortificationSlots(
  start: BuildingState,
  buildings: readonly BuildingState[],
): ConnectedFortificationSlot[] {
  const eligible = buildings
    .filter((building): building is BuildingState & { kind: GarrisonBuildingKind } =>
      building.hp > 0 && isGarrisonBuildingKind(building.kind))
    .sort((a, b) => a.id - b.id);
  const canonicalStart = eligible.find((building) => building.id === start.id);
  if (!canonicalStart) return [];

  const byCell = new Map<string, Array<BuildingState & { kind: GarrisonBuildingKind }>>();
  for (const building of eligible) {
    const key = `${building.gx}:${building.gz}`;
    const occupants = byCell.get(key) ?? [];
    occupants.push(building);
    byCell.set(key, occupants);
  }

  const result: ConnectedFortificationSlot[] = [];
  const visited = new Set<number>([canonicalStart.id]);
  const queue: Array<BuildingState & { kind: GarrisonBuildingKind }> = [canonicalStart];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const building = queue[cursor];
    for (let slot = 0; slot < garrisonCapacity(building.kind); slot += 1) {
      const position = garrisonSlotPosition(building, slot);
      result.push({
        buildingId: building.id,
        buildingKind: building.kind,
        gx: building.gx,
        gz: building.gz,
        slot,
        ...position,
      });
    }

    for (const direction of CARDINAL_DIRECTIONS) {
      const neighbours = byCell.get(`${building.gx + direction.gx}:${building.gz + direction.gz}`) ?? [];
      for (const neighbour of neighbours) {
        if (visited.has(neighbour.id)) continue;
        visited.add(neighbour.id);
        queue.push(neighbour);
      }
    }
  }
  return result;
}
