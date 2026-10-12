import * as THREE from "three";
import { GRID_SIZE, TILE_SIZE } from "../../game/content";
import type { BuildingState, GridPoint, MapTheme, MissionDefinition } from "../../game/types";
import { SolidBatch } from "./SolidBatch";
import { disposeEntity } from "../objects/EntityDisposal";

export const WORLD_COLORS: Record<string, { sky: string; fog: string; ground: string; distant: string; underlay: string; rock: string; foliage: string }> = {
  oasis: { sky: "#d4dfd5", fog: "#d6c8a5", ground: "#d8c194", distant: "#c4b08b", underlay: "#a28367", rock: "#c4a381", foliage: "#4f8569" },
  "red-canyon": { sky: "#dccabd", fog: "#d7b89d", ground: "#d6af8b", distant: "#b58d74", underlay: "#9d6857", rock: "#bd8368", foliage: "#6e8260" },
  "salt-flat": { sky: "#d0e1dc", fog: "#d6d8c7", ground: "#e0d9bd", distant: "#c2c7b5", underlay: "#a2a493", rock: "#b7b6a1", foliage: "#7a9575" },
  "river-valley": { sky: "#c8ddd6", fog: "#c5d0b2", ground: "#ccca9e", distant: "#adba98", underlay: "#92947c", rock: "#b0ad8f", foliage: "#4c8468" },
  "ancient-ruins": { sky: "#d8d8c6", fog: "#d2c6aa", ground: "#d4c5a4", distant: "#bab299", underlay: "#999079", rock: "#b5ae93", foliage: "#678465" },
  "siege-frontier": { sky: "#ccd5d8", fog: "#c4c3b5", ground: "#c5baa0", distant: "#a9aa98", underlay: "#85877b", rock: "#a4a28f", foliage: "#618173" },
};

function randomSeed(seed: number): () => number {
  let value = seed >>> 0;
  return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; };
}

export function addPalm(batch: SolidBatch, x: number, z: number, height: number, foliage: string, baseY = 0): void {
  const lean = height * 0.08;
  batch.beam([x, baseY, z], [x + lean, baseY + height, z], height * 0.055, "#806047");
  for (let ring = 1; ring < 7; ring += 1) {
    const h = height * ring / 7;
    batch.cylinder(x + lean * ring / 7, baseY + h, z, height * 0.06, height * 0.065, 0.055, "#a38157", 7);
  }
  const top = baseY + height;
  const phase = Math.sin(x * 2.4 + z * 1.8);
  for (let index = 0; index < 9; index += 1) {
    const angle = index * Math.PI * 2 / 9 + phase;
    const length = height * (0.46 + (index % 3) * 0.055);
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const color = new THREE.Color(foliage).lerp(new THREE.Color("#aec07b"), index % 3 * 0.13);
    const at = (t: number): [number, number, number] => [x + lean + dx * length * t,
      top + height * (Math.sin(t * Math.PI) * 0.15 - t * t * 0.19), z + dz * length * t];
    // Split, arching leaflets leave daylight through the crown instead of a solid star.
    for (let leaflet = 0; leaflet < 6; leaflet++) {
      const t = 0.08 + leaflet * 0.145;
      const root = at(t), next = at(t + 0.15);
      const span = height * (0.025 + Math.sin(t * Math.PI) * 0.10);
      for (const side of [-1, 1]) {
        const tip: [number, number, number] = [root[0] - dz * span * side + dx * length * 0.15,
          root[1] - height * 0.024, root[2] + dx * span * side + dz * length * 0.15];
        batch.triangle(root, tip, next, color);
      }
    }
  }
  for (let index = 0; index < 3; index += 1) batch.rock(x + lean + Math.cos(index * 2.1) * 0.12, top - 0.07, z + Math.sin(index * 2.1) * 0.12, 0.11, "#b18a44", [0.75, 1.15, 0.75]);
}

function addGrassTuft(batch: SolidBatch, foliage: string): void {
  for (let blade = 0; blade < 7; blade++) {
    const angle = blade * 2.4, height = 0.18 + blade % 3 * 0.07;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const width = 0.022;
    const color = blade % 3 === 0 ? "#b6b27c" : foliage;
    const left: [number, number, number] = [-dz * width, 0, dx * width];
    const right: [number, number, number] = [dz * width, 0, -dx * width];
    const middle: [number, number, number] = [dx * 0.055, height * 0.62, dz * 0.055];
    const tip: [number, number, number] = [dx * 0.15, height, dz * 0.15];
    batch.triangle(left, right, middle, color);
    batch.triangle(left, middle, tip, color);
  }
}

export function addCrate(batch: SolidBatch, x: number, y: number, z: number, scale = 1): void {
  const size = 0.32 * scale;
  batch.box(x, y + size / 2, z, size, size, size, "#a47b4c");
  for (const offset of [-0.38, 0.38]) {
    batch.box(x + size * offset, y + size / 2, z, size * 0.11, size * 1.03, size * 1.03, "#735437");
    batch.box(x, y + size * (0.5 + offset), z, size * 1.04, size * 0.1, size * 1.04, "#c2965d");
  }
}

export function addJar(batch: SolidBatch, x: number, y: number, z: number, scale = 1, color = "#b67651"): void {
  batch.cylinder(x, y + 0.14 * scale, z, 0.14 * scale, 0.1 * scale, 0.28 * scale, color, 8);
  batch.cylinder(x, y + 0.29 * scale, z, 0.075 * scale, 0.14 * scale, 0.13 * scale, color, 8);
  batch.cylinder(x, y + 0.36 * scale, z, 0.078 * scale, 0.078 * scale, 0.03 * scale, "#e0b882", 8);
}

function addTent(batch: SolidBatch, x: number, z: number, scale: number, cloth: string): void {
  const width = 1.7 * scale, depth = 1.8 * scale, height = 1.25 * scale;
  const left = x - width / 2, right = x + width / 2;
  const front = z + depth / 2, back = z - depth / 2;
  batch.triangle([left, 0.08, front], [x, height, front], [left, 0.08, back], cloth);
  batch.triangle([left, 0.08, back], [x, height, front], [x, height, back], cloth);
  batch.triangle([x, height, front], [right, 0.08, front], [right, 0.08, back], "#d9bd83");
  batch.triangle([right, 0.08, back], [x, height, back], [x, height, front], "#d9bd83");
  batch.triangle([left, 0.08, back], [x, height, back], [right, 0.08, back], cloth);
  for (const zz of [front, back]) {
    batch.beam([x, 0, zz], [x, height + 0.12, zz], 0.04, "#634b35");
    for (const xx of [left, right]) batch.beam([x, height, zz], [xx + (xx < x ? -0.35 : 0.35), 0.04, zz], 0.013, "#806746", 4);
  }
  batch.box(x, 0.028, front + 0.25, width * 0.75, 0.025, depth * 0.48, cloth);
  addJar(batch, left - 0.25, 0, front, scale);
  addCrate(batch, right + 0.2, 0, back, scale);
}

function addCart(batch: SolidBatch, x: number, z: number, scale = 1): void {
  batch.box(x, 0.42 * scale, z, 0.75 * scale, 0.14 * scale, 1.2 * scale, "#805d3b");
  for (const xx of [-0.45, 0.45]) {
    batch.box(x + xx * scale, 0.7 * scale, z, 0.07 * scale, 0.48 * scale, 1.2 * scale, "#ac8150");
    for (const zz of [-0.38, 0.38]) {
      batch.cylinder(x + xx * scale, 0.3 * scale, z + zz * scale, 0.29 * scale, 0.29 * scale, 0.1 * scale, "#5e4a35", 10, [0, 0, Math.PI / 2]);
      batch.cylinder(x + xx * scale + (xx < 0 ? -0.06 : 0.06), 0.3 * scale, z + zz * scale, 0.07 * scale, 0.07 * scale, 0.13 * scale, "#c3975e", 8, [0, 0, Math.PI / 2]);
    }
  }
  batch.beam([x - 0.24 * scale, 0.4 * scale, z + 0.5 * scale], [x - 0.24 * scale, 0.22 * scale, z + 1.6 * scale], 0.035 * scale, "#805d3b");
  batch.beam([x + 0.24 * scale, 0.4 * scale, z + 0.5 * scale], [x + 0.24 * scale, 0.22 * scale, z + 1.6 * scale], 0.035 * scale, "#805d3b");
  addCrate(batch, x, 0.49 * scale, z - 0.18 * scale, scale * 1.3);
  addJar(batch, x + 0.13 * scale, 0.49 * scale, z + 0.3 * scale, scale);
}

function addRuins(batch: SolidBatch, x: number, z: number, scale: number, color: string): void {
  for (let index = 0; index < 3; index += 1) {
    const xx = x + (index - 1) * 0.85 * scale;
    const height = (index === 2 ? 0.76 : 1.65) * scale;
    batch.box(xx, 0.09, z, 0.54 * scale, 0.18, 0.54 * scale, color);
    batch.cylinder(xx, height / 2 + 0.14, z, 0.16 * scale, 0.19 * scale, height, color, 8);
    batch.box(xx, height + 0.18, z, 0.48 * scale, 0.2 * scale, 0.48 * scale, "#d5c097");
  }
  batch.box(x - 0.42 * scale, 1.96 * scale, z, 1.42 * scale, 0.3 * scale, 0.48 * scale, color);
  for (let index = 0; index < 8; index += 1) batch.box(x + Math.sin(index * 2.4) * 1.4 * scale, 0.08, z + Math.cos(index * 2.4) * 0.75 * scale, 0.4 * scale, 0.17, 0.29 * scale, index % 2 ? color : "#ceba94", index * 0.75);
}

interface ScatterLayer {
  mesh: THREE.InstancedMesh;
  points: Array<{ x: number; z: number; scale: number; yaw: number; gx: number; gz: number }>;
}

export class WorldScenery {
  readonly group = new THREE.Group();
  private scatters: ScatterLayer[] = [];
  private ripples: THREE.Mesh[] = [];
  private occupationKey = "";
  private readonly gridSize: number;
  private readonly half: number;

  constructor(
    theme: MapTheme,
    zones: MissionDefinition["resourceZones"],
    lowPower: boolean,
    gridSize = GRID_SIZE,
    enemyZones?: MissionDefinition["resourceZones"],
  ) {
    this.gridSize = gridSize;
    this.half = gridSize * TILE_SIZE / 2;
    this.group.name = `living-world:${theme}`;
    const colors = WORLD_COLORS[theme] ?? WORLD_COLORS.oasis;
    const seed = [...theme].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 719);
    const random = randomSeed(seed);
    const batch = new SolidBatch();
    const green = theme === "oasis" || theme === "river-valley";
    const ruins = theme === "ancient-ruins";
    const siege = theme === "siege-frontier";

    // Composed groups with breathing room, not a ring of equally spaced pebbles.
    // All large landmarks remain outside the logical building grid.
    const clusterCount = lowPower ? 21 : 28;
    const edgeScale = this.half / (GRID_SIZE * TILE_SIZE / 2);
    const groves = [[-12.6, -7.8], [-12.7, 4.2], [-8.2, 12.5], [6.8, 12.3], [12.6, 6.3], [12.5, -7.1], [1.2, -12.8]]
      .map(([x, z]) => [x * edgeScale, z * edgeScale]);
    for (let index = 0; index < clusterCount; index += 1) {
      const grove = groves[index % groves.length];
      const x = grove[0] + (random() - 0.5) * 1.35;
      const z = grove[1] + (random() - 0.5) * 1.3;
      const scale = 0.6 + random() * 0.85;
      if (green && index % 7 < 3) addPalm(batch, x, z, 1.65 + scale, colors.foliage);
      else if (theme === "red-canyon" && index % 3 !== 0) {
        const height = 1.1 + random() * 1.9;
        for (let layer = 0; layer < 3; layer += 1) batch.cylinder(x, height * (0.18 + layer * 0.27), z, scale * (1.12 - layer * 0.13), scale * (1.25 - layer * 0.15), height * 0.34, layer % 2 ? "#c7835c" : colors.rock, 5);
      } else if (theme === "salt-flat" && index % 2 === 0) {
        for (let crystal = 0; crystal < 4; crystal += 1) batch.cylinder(x + crystal * 0.16, 0.23 + crystal * 0.1, z + Math.sin(crystal) * 0.35, 0.015, 0.17 + scale * 0.1, 0.4 + crystal * 0.22, crystal % 2 ? "#eef0d5" : "#bbcfc9", 5, [0.1, crystal, crystal * 0.05]);
      } else {
        batch.rock(x, scale * 0.22, z, scale, colors.rock, [1.1, 0.55 + random() * 0.5, 0.86], random() * 4);
        batch.rock(x + scale * 0.65, 0.15, z + 0.35, scale * 0.44, "#cfb187", [1.1, 0.65, 1]);
      }
      if (index % 2 === 0) {
        for (let stalk = 0; stalk < 5; stalk += 1) batch.beam([x + 0.42, 0.02, z], [x + 0.42 + Math.sin(stalk * 2) * 0.2, 0.22 + (stalk % 2) * 0.13, z + Math.cos(stalk * 2) * 0.16], 0.026, colors.foliage, 4);
      }
    }

    const campX = Math.min(6.1 * edgeScale, this.half - 1), campZ = -this.half - 1.5;
    addTent(batch, campX, campZ, 0.92, siege ? "#9d5144" : "#477c7b");
    addTent(batch, campX + 2.5, campZ + 0.2, 0.65, siege ? "#835249" : "#ac704c");
    addCart(batch, campX - 2, campZ, 0.95);
    for (let index = 0; index < 5; index += 1) addCrate(batch, campX - 0.5 + index * 0.36, index % 2 ? 0 : 0.12, campZ + 1.4, 0.8);

    addRuins(batch, -7.2 * edgeScale, -this.half - 1.0, ruins ? 1.5 : 0.85, "#cfb58b");
    if (ruins) {
      addRuins(batch, this.half + 1.3, 3.5 * edgeScale, 1.15, "#beab86");
      batch.cylinder(-this.half - 1.25, 1.4, -2.6, 0.13, 0.42, 2.8, "#cbb38c", 4);
      batch.box(-this.half - 1.25, 0.1, -2.6, 1, 0.2, 1, "#9a896a");
    }
    if (siege) {
      for (let index = 0; index < 18; index += 1) batch.cylinder(this.half + 1.1, 0.65, -6 + index * 0.42, 0.03, 0.12, 1.3, index % 2 ? "#785d41" : "#8d6d46", 5, [0, 0, 0.08]);
      addCart(batch, -this.half - 1.4, 3, 1.2);
      for (let index = 0; index < 7; index += 1) batch.rock(-this.half - 0.9, 0.18, -1 + index * 0.55, 0.32, "#605e50", [1, 0.6, 1]);
    }

    this.addResourcePockets(batch, zones, colors.foliage, colors.rock);
    this.addSoilPatches(zones, colors, green);
    if (enemyZones) {
      this.addResourcePockets(batch, enemyZones, colors.foliage, colors.rock);
      this.addSoilPatches(enemyZones, colors, green);
    }
    if (green) this.addOasisBanks(theme, batch, colors.foliage);
    this.group.add(batch.mesh("landmarks-and-resource-props", true));
    this.addScatter(random, colors, zones, lowPower);
  }

  private world(cell: number): number {
    return (cell - (this.gridSize - 1) / 2) * TILE_SIZE;
  }

  private addResourcePockets(batch: SolidBatch, zones: MissionDefinition["resourceZones"], foliage: string, rock: string): void {
    const lumber = zones.lumber;
    const x = this.world(lumber.gx), z = this.world(lumber.gz);
    for (let index = 0; index < 4; index += 1) addPalm(batch, x + Math.sin(index * 1.8) * 0.42, z + Math.cos(index * 1.8) * 0.42, 1.65 + index * 0.16, foliage);
    for (let index = 0; index < 4; index += 1) batch.cylinder(x - 0.17 + index * 0.12, 0.1, z + 0.34, 0.065, 0.065, 0.44, "#967047", 7, [Math.PI / 2, 0, 0]);
    const qx = this.world(zones.quarry.gx), qz = this.world(zones.quarry.gz);
    for (let index = 0; index < 6; index += 1) batch.rock(qx + Math.sin(index * 2.1) * 0.36, 0.18 + index % 2 * 0.1, qz + Math.cos(index * 2.1) * 0.36, 0.31 + index % 3 * 0.1, rock, [1.1, 0.75, 0.8], index);
    const iron: GridPoint = zones.iron;
    const ix = this.world(iron.gx), iz = this.world(iron.gz);
    for (let index = 0; index < 5; index += 1) {
      batch.rock(ix + Math.sin(index * 2.2) * 0.3, 0.22, iz + Math.cos(index * 2.2) * 0.32, 0.35, "#777d78", [1, 0.9, 0.8], index);
      batch.box(ix + Math.sin(index * 2.2) * 0.32, 0.43, iz + Math.cos(index * 2.2) * 0.3, 0.13, 0.1, 0.22, "#b18a61", index);
    }
  }

  private addSoilPatches(zones: MissionDefinition["resourceZones"], colors: typeof WORLD_COLORS[string], green: boolean): void {
    const positions: number[] = [], tints: number[] = [], indices: number[] = [];
    const patches = [
      { x: this.world(zones.fertile.gx), z: this.world(zones.fertile.gz), rx: 3.6, rz: 2.8, color: green ? "#96b277" : "#b4b48a" },
      { x: this.world(zones.lumber.gx), z: this.world(zones.lumber.gz), rx: 2.8, rz: 3.2, color: green ? "#86a878" : "#b4b593" },
      { x: this.world(zones.quarry.gx), z: this.world(zones.quarry.gz), rx: 1.75, rz: 1.45, color: "#c3b699" },
    ];
    const ground = new THREE.Color(colors.ground);
    patches.forEach((patch, patchIndex) => {
      const baseIndex = positions.length / 3;
      const inner = new THREE.Color(patch.color);
      positions.push(patch.x, 0.006 + patchIndex * 0.001, patch.z);
      tints.push(inner.r, inner.g, inner.b, 0.52);
      // Concentric painted-geometry rings make a broad calm tonal field, not a texture.
      for (const radius of [0.52, 1]) {
        const tint = inner.clone().lerp(ground, 0.12);
        for (let i = 0; i < 24; i += 1) {
          const angle = i / 24 * Math.PI * 2;
          const wobble = 1 + Math.sin(angle * 3 + patchIndex) * 0.13 + Math.sin(angle * 5.1) * 0.06;
          positions.push(
            THREE.MathUtils.clamp(patch.x + Math.cos(angle) * patch.rx * radius * wobble, -this.half + 0.15, this.half - 0.15),
            0.006 + patchIndex * 0.001,
            THREE.MathUtils.clamp(patch.z + Math.sin(angle) * patch.rz * radius * wobble, -this.half + 0.15, this.half - 0.15),
          );
          tints.push(tint.r, tint.g, tint.b, radius === 1 ? 0 : 0.38);
        }
      }
      for (let i = 0; i < 24; i += 1) {
        const j = (i + 1) % 24;
        indices.push(baseIndex, baseIndex + j + 1, baseIndex + i + 1);
        indices.push(baseIndex + i + 1, baseIndex + j + 1, baseIndex + 25 + j);
        indices.push(baseIndex + i + 1, baseIndex + 25 + j, baseIndex + 25 + i);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(tints, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, transparent: true, depthWrite: false }));
    mesh.name = "oasis-and-fertile-soil-tonal-fields";
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private addOasisBanks(theme: MapTheme, batch: SolidBatch, foliage: string): void {
    const river = theme === "river-valley";
    for (let grove = 0; grove < 3; grove += 1) {
      const x = -this.half - 7.7 + grove % 2 * 0.5;
      const z = river ? -10 + grove * 9 : -1.8 + grove * 5.2;
      for (let palm = 0; palm < 3; palm += 1) {
        addPalm(batch, x + Math.sin(palm * 2.4) * 0.7, z + Math.cos(palm * 2.4) * 0.8, 2.3 + palm * 0.4, foliage, -2.38);
      }
      for (let reed = 0; reed < 12; reed += 1) {
        const rx = x + 0.9 + reed % 3 * 0.12, rz = z + (reed - 6) * 0.2;
        batch.beam([rx, -2.38, rz], [rx + 0.08, -1.97 + reed % 3 * 0.08, rz], 0.018, foliage, 4);
      }
    }
    // One restrained moving glint layer. Its clock is the simulation clock.
    const ripple = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.815, 40), new THREE.MeshBasicMaterial({ color: "#badfd0", transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.set(-this.half - 4.9, -2.34, 4.5);
    ripple.scale.set(1.4, 0.65, 1);
    this.ripples.push(ripple);
    this.group.add(ripple);
  }

  private addScatter(random: () => number, colors: typeof WORLD_COLORS[string], zones: MissionDefinition["resourceZones"], lowPower: boolean): void {
    const count = Math.round((lowPower ? 36 : 64) * Math.min(1.8, this.gridSize / GRID_SIZE));
    for (let layer = 0; layer < 3; layer += 1) {
      const shrubs = new SolidBatch();
      if (layer === 2) addGrassTuft(shrubs, colors.foliage);
      else for (let leaf = 0; leaf < 4; leaf += 1) {
        const angle = leaf * Math.PI * 0.5;
        const x = Math.cos(angle) * 0.11, z = Math.sin(angle) * 0.11;
        shrubs.rock(x, 0.13 + (leaf % 2) * 0.045, z, 0.15, leaf % 2 ? colors.foliage : "#91a67b", [0.94, 0.82, 0.86], leaf);
      }
      const shrub = shrubs.mesh("scrub-prototype", false);
      const geometry = layer === 0 ? new THREE.DodecahedronGeometry(0.1, 0) : shrub.geometry;
      const material = layer === 0 ? new THREE.MeshStandardMaterial({ color: colors.rock, roughness: 1, flatShading: true }) : shrub.material;
      if (layer === 0) { shrub.geometry.dispose(); (shrub.material as THREE.Material).dispose(); }
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.name = layer === 0 ? "pebbles" : layer === 1 ? "desert-scrub" : "oasis-grasses";
      const points: ScatterLayer["points"] = [];
      for (let index = 0; index < count; index += 1) {
        // Distinct natural places: fertile grasses, a grove edge, ore scree and a few wild bushes.
        const centers = layer === 0
          ? [[this.world(zones.quarry.gx), this.world(zones.quarry.gz)], [this.world(zones.iron.gx), this.world(zones.iron.gz)], [8.5, -8], [-8, 7.8]]
          : [[this.world(zones.fertile.gx), this.world(zones.fertile.gz)], [this.world(zones.lumber.gx), this.world(zones.lumber.gz)], [this.world(zones.fertile.gx) - 1.2, this.world(zones.fertile.gz) + 1.1], [4.5, 8.2], [-6.5, -7.8]];
        const center = centers[index % centers.length];
        const angle = random() * Math.PI * 2, radius = 0.7 + Math.sqrt(random()) * (layer === 0 ? 1.35 : 2);
        const x = THREE.MathUtils.clamp(center[0] + Math.cos(angle) * radius, -this.half + 0.3, this.half - 0.3);
        const z = THREE.MathUtils.clamp(center[1] + Math.sin(angle) * radius * 0.85, -this.half + 0.3, this.half - 0.3);
        points.push({ x, z, scale: 0.65 + random() * 0.85, yaw: random() * 6.28, gx: Math.round(x / TILE_SIZE + (this.gridSize - 1) / 2), gz: Math.round(z / TILE_SIZE + (this.gridSize - 1) / 2) });
      }
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.scatters.push({ mesh, points });
      this.group.add(mesh);
    }
    this.setOccupied([]);
  }

  setOccupied(buildings: readonly Pick<BuildingState, "gx" | "gz">[]): void {
    const key = buildings.map((building) => `${building.gx}:${building.gz}`).join("|");
    if (key === this.occupationKey && this.occupationKey !== "") return;
    this.occupationKey = key;
    const occupied = new Set(buildings.map((building) => `${building.gx}:${building.gz}`));
    const transform = new THREE.Object3D();
    for (const layer of this.scatters) {
      layer.points.forEach((point, index) => {
        const scale = occupied.has(`${point.gx}:${point.gz}`) ? 0 : point.scale;
        transform.position.set(point.x, 0.025, point.z);
        transform.rotation.set(0.08, point.yaw, 0.1);
        transform.scale.set(scale, scale * 0.6, scale);
        transform.updateMatrix();
        layer.mesh.setMatrixAt(index, transform.matrix);
      });
      layer.mesh.instanceMatrix.needsUpdate = true;
      layer.mesh.computeBoundingSphere();
    }
  }

  update(elapsed: number): void {
    this.ripples.forEach((ripple, index) => {
      ripple.scale.setScalar(0.85 + Math.sin(elapsed * 0.8 + index * 1.7) * 0.16);
      (ripple.material as THREE.MeshBasicMaterial).opacity = 0.27 + Math.sin(elapsed * 0.8 + index) * 0.09;
    });
  }

  dispose(): void {
    disposeEntity(this.group);
  }
}
