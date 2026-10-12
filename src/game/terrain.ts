import { GRID_SIZE, MISSIONS } from './content';
import type { MissionId } from './types';

export type TerrainKind = 'land' | 'fertile' | 'water' | 'rock' | 'crossing';
export interface TerrainMap { version: 1 | 2; size: number; cells: readonly TerrainKind[] }
const maps = new Map<string, TerrainMap>();
/** Immutable, deterministic rules shared by navigation, construction and rendering. */
export function terrainFor(missionId: MissionId, version: 1 | 2 = 2): TerrainMap {
  const key = `${missionId}:${version}`;
  const cached = maps.get(key); if (cached) return cached;
  const mission = MISSIONS[missionId];
  const size = mission.gridSize ?? GRID_SIZE;
  const cells: TerrainKind[] = Array(size * size).fill('land');
  if (version === 2) {
    const zones = [mission.resourceZones.fertile, ...(mission.duel ? [mission.duel.enemyResourceZones.fertile] : [])];
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
      if (zones.some(p => Math.hypot(x-p.gx, z-p.gz) < 3)) cells[z*size+x] = 'fertile';
    }
    if (missionId === 'river') {
      const bridges = [Math.floor(size / 3), Math.floor(size * 2 / 3)];
      for (let z = 0; z < size; z++) for (let x = 12; x <= 13; x++) {
        cells[z*size+x] = bridges.some(b => Math.abs(z-b) <= 1) ? 'crossing' : 'water';
      }
    } else if (missionId !== 'oasis') {
      // Small rock shoulders leave the centre, starting buildings and resource zones clear.
      for (let z = Math.floor(size*.4); z <= Math.floor(size*.6); z++) {
        cells[z*size+1] = 'rock'; cells[z*size+size-2] = 'rock';
      }
    }
  }
  const map = Object.freeze({version, size, cells: Object.freeze(cells)});
  maps.set(key,map); return map;
}
export function terrainAt(map: TerrainMap, gx: number, gz: number): TerrainKind {
  const x = Math.round(gx), z = Math.round(gz);
  if (x < 0 || z < 0 || x >= map.size || z >= map.size) return 'rock';
  return map.cells[z*map.size+x] ?? 'rock';
}
export function terrainPassable(kind: TerrainKind): boolean { return kind !== 'water' && kind !== 'rock'; }
export function terrainBuildable(kind: TerrainKind): boolean { return kind === 'land' || kind === 'fertile'; }
