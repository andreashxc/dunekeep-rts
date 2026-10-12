import { GRID_SIZE } from "../../game/content";
import type { BuildingState, GridPoint } from "../../game/types";

export interface PedestrianPose { gx: number; gz: number; moving: boolean; working: boolean }

const neighbours = [[0, 1], [1, 0], [0, -1], [-1, 0]] as const;
const cellKey = (gx: number, gz: number): string => `${gx}:${gz}`;

/** Cosmetic pedestrian routes use the same occupied cells as construction; never walk through a wall. */
export function pedestrianRoute(buildings: readonly BuildingState[], workplace: BuildingState | undefined, index: number): GridPoint[] {
  const occupied = new Set(buildings.filter((building) => building.kind !== "gate").map((building) => cellKey(building.gx, building.gz)));
  const keep = buildings.find((building) => building.kind === "keep");
  const walkable = (gx: number, gz: number): boolean => gx >= 0 && gz >= 0 && gx < GRID_SIZE && gz < GRID_SIZE && !occupied.has(cellKey(gx, gz));
  const entrance = (building: BuildingState | undefined, rotation: number): GridPoint | undefined => {
    const gx = building?.gx ?? 8, gz = building?.gz ?? 8;
    for (let distance = 1; distance <= 3; distance += 1) {
      for (let offset = 0; offset < 4; offset += 1) {
        const [dx, dz] = neighbours[(offset + rotation) % 4];
        if (walkable(gx + dx * distance, gz + dz * distance)) return { gx: gx + dx * distance, gz: gz + dz * distance };
      }
    }
    return undefined;
  };
  const start = entrance(keep, index % 4);
  const destination = entrance(workplace ?? keep, (index + 1) % 4);
  if (!start) return [];
  if (!destination) return [start];
  const queue = [start];
  const previous = new Map<string, GridPoint | null>([[cellKey(start.gx, start.gz), null]]);
  for (let head = 0; head < queue.length; head += 1) {
    const point = queue[head];
    if (point.gx === destination.gx && point.gz === destination.gz) {
      const route: GridPoint[] = [];
      let cursor: GridPoint | null = point;
      while (cursor) {
        route.push(cursor);
        cursor = previous.get(cellKey(cursor.gx, cursor.gz)) ?? null;
      }
      return route.reverse();
    }
    for (let offset = 0; offset < 4; offset += 1) {
      const [dx, dz] = neighbours[(offset + index) % 4];
      const next = { gx: point.gx + dx, gz: point.gz + dz };
      const key = cellKey(next.gx, next.gz);
      if (!walkable(next.gx, next.gz) || previous.has(key)) continue;
      previous.set(key, point);
      queue.push(next);
    }
  }
  return [start];
}

/** Pure simulation-time sampling: rendering the same time yields the exact same pose. */
export function samplePedestrianRoute(route: readonly GridPoint[], elapsed: number, index: number): PedestrianPose | null {
  if (!route.length) return null;
  if (route.length === 1) return { ...route[0], moving: false, working: false };
  const speed = 0.55 + (index % 3) * 0.065;
  const travel = (route.length - 1) / speed;
  const rest = 2.3 + (index % 4) * 0.45;
  const duration = travel * 2 + rest * 2;
  const phase = ((elapsed + index * 4.37) % duration + duration) % duration;
  if (phase < rest) return { ...route[0], moving: false, working: false };
  if (phase >= rest + travel && phase < rest * 2 + travel) return { ...route[route.length - 1], moving: false, working: true };
  const returning = phase >= rest * 2 + travel;
  const progress = returning ? (route.length - 1) - (phase - rest * 2 - travel) * speed : (phase - rest) * speed;
  const segment = Math.max(0, Math.min(route.length - 2, Math.floor(progress)));
  const fraction = Math.max(0, Math.min(1, progress - segment));
  const start = route[segment], end = route[segment + 1];
  return { gx: start.gx + (end.gx - start.gx) * fraction, gz: start.gz + (end.gz - start.gz) * fraction, moving: true, working: false };
}
