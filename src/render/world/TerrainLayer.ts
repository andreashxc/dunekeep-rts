import * as THREE from 'three';
import { TILE_SIZE } from '../../game/content';
import { terrainFor, type TerrainKind } from '../../game/terrain';
import type { BuildingState, MissionId } from '../../game/types';
import { disposeEntity } from '../objects/EntityDisposal';
import { SolidBatch } from './SolidBatch';

export interface TerrainCellVisual { gx: number; gz: number; kind: TerrainKind; x: number; z: number }
/** Geometry positions come only from the authoritative terrain grid. */
export function terrainVisualCells(missionId: MissionId, version: 1 | 2): TerrainCellVisual[] {
  const map = terrainFor(missionId, version);
  return map.cells.flatMap((kind, index) => kind === 'land' ? [] : [{ kind, gx: index % map.size,
    gz: Math.floor(index / map.size), x: (index % map.size - (map.size - 1) / 2) * TILE_SIZE,
    z: (Math.floor(index / map.size) - (map.size - 1) / 2) * TILE_SIZE }]);
}

export class TerrainLayer {
  readonly group = new THREE.Group();
  readonly cells: readonly TerrainCellVisual[];
  readonly blockingCells: readonly TerrainCellVisual[];
  private waterMaterial: THREE.ShaderMaterial | null = null;
  private fertile: THREE.InstancedMesh | null = null;
  private fertileCells: TerrainCellVisual[] = [];
  private occupancy = '';
  private disposed = false;

  constructor(missionId: MissionId, version: 1 | 2) {
    this.group.name = 'authoritative-terrain';
    this.cells = terrainVisualCells(missionId, version);
    this.blockingCells = this.cells.filter(cell => cell.kind === "water" || cell.kind === "crossing" || cell.kind === "rock");
    if (version === 1) return;
    const map = terrainFor(missionId, version);
    const solid = new SolidBatch();
    const waterPositions: number[] = [];
    const isRiver = (gx: number, gz: number) => {
      const kind = map.cells[gz * map.size + gx];
      return kind === 'water' || kind === 'crossing';
    };
    for (const cell of this.cells) {
      const { gx, gz, x, z, kind } = cell;
      if (kind === 'fertile') { this.fertileCells.push(cell); continue; }
      if (kind === 'rock') {
        solid.rock(x, 0.43, z, TILE_SIZE * 0.46, '#a6977d', [0.9, 1.5, 0.84], gx + gz);
        solid.rock(x + TILE_SIZE * 0.28, 0.15, z - TILE_SIZE * 0.22, TILE_SIZE * 0.2, '#c4b193', [1, 1.2, 1]);
        for (let chip = 0; chip < 4; chip++) {
          const angle = chip * 1.7 + gx * 0.8;
          solid.rock(x + Math.cos(angle) * TILE_SIZE * 0.35, 0.06, z + Math.sin(angle) * TILE_SIZE * 0.36,
            0.075 + chip % 2 * 0.025, '#c9bb9d', [1.3, 0.6, 0.8], angle);
        }
        continue;
      }
      const h = TILE_SIZE / 2;
      // Exact cell footprint: crossings have water below the deck as well.
      waterPositions.push(x-h,0.045,z-h, x-h,0.045,z+h, x+h,0.045,z+h,
        x-h,0.045,z-h, x+h,0.045,z+h, x+h,0.045,z-h);
      for (const side of [-1, 1]) if (!isRiver(gx + side, gz)) {
        // Keep every shoreline vertex inside the authoritative water tile. A shallow,
        // irregular wet fringe softens the grid without implying extra blocked land.
        for (let section = 0; section < 4; section++) {
          const za = z - h + section * TILE_SIZE / 4, zb = za + TILE_SIZE / 4;
          const boundary = x + side * h;
          const widthAt = (zz: number) => 0.14 + Math.sin(zz * 4.7 + side) * 0.035;
          const aa: [number, number, number] = [boundary, 0.069, za];
          const ab: [number, number, number] = [boundary, 0.069, zb];
          const ba: [number, number, number] = [boundary - side * widthAt(za), 0.052, za];
          const bb: [number, number, number] = [boundary - side * widthAt(zb), 0.052, zb];
          solid.triangle(aa, ab, bb, '#abae82'); solid.triangle(aa, bb, ba, '#abae82');
          const ca: [number, number, number] = [ba[0] - side * 0.09, 0.047, za];
          const cb: [number, number, number] = [bb[0] - side * 0.09, 0.047, zb];
          solid.triangle(ba, bb, cb, '#779788'); solid.triangle(ba, cb, ca, '#779788');
        }
        if (kind === 'water' && gz % 4 === 1) {
          for (let reed = 0; reed < 4; reed++) {
            const rz = z - 0.22 + reed * 0.11, rx = x + side * (h - 0.07);
            solid.beam([rx, 0.06, rz], [rx - side * 0.035, 0.26 + reed % 3 * 0.055, rz + 0.04], 0.012, '#71875a', 4);
          }
          solid.rock(x + side * (h - 0.065), 0.07, z + 0.3, 0.065, '#cec7a4', [0.8, 0.6, 1.1]);
        }
      }
      if (kind === 'crossing') {
        // Broad, low decks match walkable terrain; rails run only along outer banks.
        const wooden = gz < map.size / 2;
        solid.box(x, 0.065, z, TILE_SIZE, 0.09, TILE_SIZE, wooden ? '#a88050' : '#c8bea4');
        for (let strip = 0; strip < 6; strip++) {
          const stripZ = z - h + (strip + 0.5) * TILE_SIZE / 6;
          solid.box(x, 0.114, stripZ, TILE_SIZE * 0.98, 0.008, 0.026, wooden ? '#735838' : '#aaa38e');
        }
        for (const side of [-1, 1]) if (!isRiver(gx, gz + side)) {
          solid.box(x, 0.24, z + side * (h - 0.055), TILE_SIZE, 0.28, 0.11, wooden ? '#86603c' : '#b9b09b');
        }
        // Outer edge of a crossing borders water, rather than ordinary land.
        for (const side of [-1, 1]) if (map.cells[(gz + side) * map.size + gx] === 'water') {
          solid.box(x, 0.28, z + side * (h - 0.065), TILE_SIZE, 0.08, 0.10, wooden ? '#755438' : '#cfc3a8');
          for (const offset of [-0.37, 0.37]) solid.box(x + TILE_SIZE * offset, 0.2, z + side * (h - 0.065), 0.12, 0.38, 0.12, wooden ? '#997347' : '#b5aa92');
        }
      }
    }
    const solids = solid.mesh('terrain-banks-bridges-rocks');
    this.group.add(solids);
    if (waterPositions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(waterPositions, 3));
      geometry.computeVertexNormals();
      const riverCells = this.cells.filter(cell => cell.kind === 'water' || cell.kind === 'crossing');
      this.waterMaterial = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, banks: { value: new THREE.Vector2(
          Math.min(...riverCells.map(cell => cell.x)) - TILE_SIZE / 2,
          Math.max(...riverCells.map(cell => cell.x)) + TILE_SIZE / 2,
        ) } },
        vertexShader: 'varying vec2 p; void main(){p=position.xz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: `
          uniform float time; uniform vec2 banks; varying vec2 p;
          void main() {
            float depth = smoothstep(0.02, 0.66, min(p.x-banks.x, banks.y-p.x));
            vec3 color = mix(vec3(.29,.54,.44), vec3(.055,.29,.31), depth);
            float current = sin(p.y*5.6-time*.75+sin(p.x*3.3)*.7);
            float glint = pow(current*.5+.5, 22.)*.035;
            color += vec3(glint) + sin(p.x*9.0+p.y*2.1-time*.36)*.009;
            gl_FragColor = vec4(color,1.);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
      });
      const water = new THREE.Mesh(geometry, this.waterMaterial);
      water.name = 'terrain-water';
      this.group.add(water);
    }
    if (this.fertileCells.length) {
      // Vertex alpha softens a low green patch without adding image assets.
      const geometry = new THREE.CircleGeometry(TILE_SIZE * 0.67, 24);
      geometry.rotateX(-Math.PI / 2);
      const colors = new Float32Array(geometry.getAttribute('position').count * 4);
      for (let i = 0; i < colors.length / 4; i++) colors.set([1, 1, 1, i === 0 ? 0.18 : 0], i * 4);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
      const material = new THREE.MeshBasicMaterial({ color: '#859465', vertexColors: true, transparent: true, depthWrite: false });
      this.fertile = new THREE.InstancedMesh(geometry, material, this.fertileCells.length);
      this.fertile.name = 'terrain-fertile';
      this.group.add(this.fertile);
      this.setOccupied([]);
    }
  }

  setOccupied(buildings: readonly Pick<BuildingState, 'gx' | 'gz'>[]): void {
    if (!this.fertile) return;
    const key = buildings.map(({ gx, gz }) => `${gx}:${gz}`).join('|');
    if (key === this.occupancy && this.occupancy !== '') return;
    this.occupancy = key;
    const occupied = new Set(buildings.map(({ gx, gz }) => `${gx}:${gz}`));
    const transform = new THREE.Object3D();
    this.fertileCells.forEach((cell, index) => {
      transform.position.set(cell.x, 0.018, cell.z);
      transform.scale.setScalar(occupied.has(`${cell.gx}:${cell.gz}`) ? 0 : 1);
      transform.updateMatrix();
      this.fertile!.setMatrixAt(index, transform.matrix);
    });
    this.fertile.instanceMatrix.needsUpdate = true;
    this.fertile.computeBoundingSphere();
  }
  update(elapsed: number, paused = false): void {
    if (!paused && this.waterMaterial) this.waterMaterial.uniforms.time.value = elapsed;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeEntity(this.group);
  }
}
