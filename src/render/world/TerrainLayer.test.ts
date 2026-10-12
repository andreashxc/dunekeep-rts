import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { MISSION_LIST, TILE_SIZE } from '../../game/content';
import { terrainAt, terrainFor } from '../../game/terrain';
import { TerrainLayer, terrainVisualCells } from './TerrainLayer';
import { isCompactLandscape } from '../GameRenderer';

describe('terrain rules and rendering agree', () => {
  it('maps every non-land cell to the exact world tile on every mission', () => {
    for (const mission of MISSION_LIST) {
      const map = terrainFor(mission.id, 2);
      const cells = terrainVisualCells(mission.id, 2);
      expect(cells.length).toBe(map.cells.filter(kind => kind !== 'land').length);
      for (const cell of cells) {
        expect(cell.kind).toBe(terrainAt(map, cell.gx, cell.gz));
        expect(cell.x).toBe((cell.gx - (map.size - 1) / 2) * TILE_SIZE);
        expect(cell.z).toBe((cell.gz - (map.size - 1) / 2) * TILE_SIZE);
      }
    }
  });
  it('renders exactly the two river columns and the two three-cell-wide crossings', () => {
    const cells = terrainVisualCells('river', 2);
    const crossings = cells.filter(cell => cell.kind === 'crossing');
    expect([...new Set(crossings.map(cell => cell.gx))]).toEqual([12, 13]);
    expect([...new Set(crossings.map(cell => cell.gz))]).toEqual([7, 8, 9, 16, 17, 18]);
    expect(cells.filter(cell => cell.kind === 'water')).toHaveLength(40);
    const layer = new TerrainLayer('river', 2);
    const water = layer.group.getObjectByName('terrain-water') as THREE.Mesh;
    expect(water.geometry.getAttribute('position').count).toBe((40 + 12) * 6);
    layer.dispose();
  });
  it('exposes upward-facing dry and wet shoreline surfaces on both river banks', () => {
    const layer = new TerrainLayer('river', 2);
    const banks = layer.group.getObjectByName('terrain-banks-bridges-rocks') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(banks.material.side).toBe(THREE.FrontSide);
    banks.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (const cell of layer.cells.filter(cell => cell.kind === 'water')) {
      const side = cell.gx === 12 ? -1 : 1;
      // The damp strip is at least 0.105 wide and at most 0.175 wide;
      // sample within each ribbon, away from sparse reeds and stones.
      for (const inset of [0.035, 0.19]) for (const along of [-0.375, 0.375]) {
        ray.set(new THREE.Vector3(cell.x + side * (TILE_SIZE / 2 - inset), 1, cell.z + TILE_SIZE * along), new THREE.Vector3(0, -1, 0));
        const hits = ray.intersectObject(banks);
        expect(hits.length, `missing bank ${side} at row ${cell.gz}, inset ${inset}`).toBeGreaterThan(0);
        expect(hits[0].point.y).toBeGreaterThan(0.045);
        expect(hits[0].point.y).toBeLessThan(0.07);
        expect(hits[0].face!.normal.y).toBeGreaterThan(0.95);
      }
    }
    layer.dispose();
  });
  it('leaves legacy maps unchanged and releases owned resources only once', () => {
    const legacy = new TerrainLayer('river', 1);
    expect(legacy.group.children).toHaveLength(0);
    const layer = new TerrainLayer('river', 2);
    const geometries = new Set<THREE.BufferGeometry>();
    layer.group.traverse(node => { if (node instanceof THREE.Mesh) geometries.add(node.geometry); });
    const spies = [...geometries].map(geometry => vi.spyOn(geometry, 'dispose'));
    layer.dispose(); layer.dispose();
    expect(layer.group.children).toHaveLength(0);
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
  });
  it('freezes water time on pause and removes fertile overlay beneath buildings', () => {
    const layer = new TerrainLayer('river', 2);
    const water = layer.group.getObjectByName('terrain-water') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    layer.update(12); layer.update(25, true);
    expect(water.material.uniforms.time.value).toBe(12);
    const cell = layer.cells.find(cell => cell.kind === 'fertile')!;
    layer.setOccupied([cell]);
    const fertile = layer.group.getObjectByName('terrain-fertile') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(); fertile.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixScale(matrix).length()).toBe(0);
    layer.setOccupied([]); fertile.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBe(1);
    layer.dispose();
  });
  it('recognises compact landscape while retaining normal portrait and desktop framing', () => {
    expect(isCompactLandscape(844, 390)).toBe(true);
    expect(isCompactLandscape(960, 480)).toBe(true);
    expect(isCompactLandscape(390, 844)).toBe(false);
    expect(isCompactLandscape(1280, 720)).toBe(false);
  });
});
