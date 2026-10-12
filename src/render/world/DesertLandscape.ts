import * as THREE from "three";
import { GRID_SIZE, TILE_SIZE } from "../../game/content";
import type { MapTheme } from "../../game/types";
import { disposeEntity } from "../objects/EntityDisposal";
import { SolidBatch } from "./SolidBatch";

export interface LandscapePalette {
  sky: string;
  fog: string;
  ground: string;
  distant: string;
  underlay: string;
  rock: string;
  foliage: string;
}

type Point = [number, number, number];

/** The whole logical grid stays level. Elevation belongs to the surrounding landform. */
export function plateauOutline(gridSize = GRID_SIZE): THREE.Vector2[] {
  const half = gridSize * TILE_SIZE / 2;
  const points: THREE.Vector2[] = [];
  for (let index = 0; index < 40; index += 1) {
    const angle = index / 40 * Math.PI * 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    // A generously padded irregular square, not a round board that cuts buildable corners.
    const radius = (half + 0.9) / Math.max(Math.abs(c), Math.abs(s));
    const shelf = 0.48 + Math.sin(index * 1.77) * 0.29 + Math.cos(index * 0.87) * 0.22;
    points.push(new THREE.Vector2(c * (radius + shelf), s * (radius + shelf)));
  }
  return points;
}

function face(batch: SolidBatch, a: Point, b: Point, c: Point, d: Point, color: THREE.ColorRepresentation): void {
  batch.triangle(a, b, c, color);
  batch.triangle(a, c, d, color);
}

function ringPoint(point: THREE.Vector2, outward: number, y: number): Point {
  const direction = point.clone().normalize();
  return [point.x + direction.x * outward, y, point.y + direction.y * outward];
}

/** A level, finely sampled cap gives sand continuous tonal variation without texture downloads. */
export function sandPlateauGeometry(outline: readonly THREE.Vector2[], ground: string): THREE.BufferGeometry {
  const positions: number[] = [0, 0, 0], colors: number[] = [], indices: number[] = [];
  const base = new THREE.Color(ground);
  const ochre = new THREE.Color("#b19570");
  const pale = new THREE.Color("#efdbb1");
  const tintAt = (x: number, z: number) => {
    const broad = Math.sin(x * 0.24 + Math.sin(z * 0.19) * 1.8) * Math.cos(z * 0.29 - x * 0.08);
    const sand = Math.sin(x * 0.79 + z * 0.44 + Math.sin(z * 0.67) * 0.9);
    const tint = base.clone().lerp(broad > 0 ? pale : ochre, Math.abs(broad) * 0.19);
    tint.multiplyScalar(1 + sand * 0.025);
    colors.push(tint.r, tint.g, tint.b);
  };
  tintAt(0, 0);
  const edge: THREE.Vector2[] = [];
  for (let i = 0; i < outline.length; i++) {
    for (let split = 0; split < 3; split++) edge.push(outline[i].clone().lerp(outline[(i + 1) % outline.length], split / 3));
  }
  const rings = Math.ceil(Math.max(...outline.map(point => point.length())) * 1.35);
  for (let ring = 1; ring <= rings; ring++) {
    const radius = ring / rings;
    for (const point of edge) {
      const x = point.x * radius, z = -point.y * radius;
      positions.push(x, 0, z);
      tintAt(x, z);
    }
    const start = 1 + (ring - 1) * edge.length;
    for (let i = 0; i < edge.length; i++) {
      const next = (i + 1) % edge.length;
      if (ring === 1) indices.push(0, start + i, start + next);
      else {
        const inside = start - edge.length;
        indices.push(inside + i, start + i, start + next, inside + i, start + next, inside + next);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addDune(batch: SolidBatch, x: number, z: number, length: number, width: number, height: number, color: string, yaw: number): void {
  const base = new THREE.Color(color);
  const point = (along: number, across: number, rise: number): Point => [
    x + Math.cos(yaw) * along - Math.sin(yaw) * across,
    -2.44 + rise,
    z + Math.sin(yaw) * along + Math.cos(yaw) * across,
  ];
  for (let segment = 0; segment < 18; segment++) {
    const u = segment / 18, v = (segment + 1) / 18;
    const a = (u - 0.5) * length, b = (v - 0.5) * length;
    const ha = Math.pow(Math.sin(u * Math.PI), 1.3) * height;
    const hb = Math.pow(Math.sin(v * Math.PI), 1.3) * height;
    const bendA = Math.sin(u * Math.PI * 1.4) * width * 0.2;
    const bendB = Math.sin(v * Math.PI * 1.4) * width * 0.2;
    face(batch, point(a, -width, 0), point(a, bendA, ha), point(b, bendB, hb), point(b, -width, 0), base.clone().multiplyScalar(1.05));
    face(batch, point(a, bendA, ha), point(a, width * 0.6, 0), point(b, width * 0.6, 0), point(b, bendB, hb), base.clone().multiplyScalar(0.92));
  }
}

function addButte(batch: SolidBatch, x: number, z: number, width: number, depth: number, height: number, color: THREE.ColorRepresentation, seed: number): void {
  const points: THREE.Vector2[] = [];
  for (let index = 0; index < 9; index += 1) {
    const angle = index / 9 * Math.PI * 2;
    const radius = 0.87 + Math.sin(index * 9.3 + seed) * 0.13;
    points.push(new THREE.Vector2(Math.cos(angle) * width * radius, Math.sin(angle) * depth * radius));
  }
  const colors = [new THREE.Color(color).multiplyScalar(0.74), new THREE.Color(color).multiplyScalar(0.9), new THREE.Color(color), new THREE.Color(color).lerp(new THREE.Color("#f3dcb1"), 0.22)];
  const tiers = [
    { y: -2.4, scale: 1.16 }, { y: height * 0.2 - 2.4, scale: 1.05 },
    { y: height * 0.25 - 2.4, scale: 0.9 }, { y: height * 0.79 - 2.4, scale: 0.78 },
    { y: height - 2.4, scale: 0.65 },
  ];
  for (let tier = 0; tier < tiers.length - 1; tier += 1) {
    for (let index = 0; index < points.length; index += 1) {
      const p = points[index], q = points[(index + 1) % points.length];
      const low = tiers[tier], high = tiers[tier + 1];
      const tint = colors[tier].clone().multiplyScalar(index % 3 === 0 ? 0.94 : 1);
      face(batch, [x + p.x * low.scale, low.y, z + p.y * low.scale], [x + q.x * low.scale, low.y, z + q.y * low.scale], [x + q.x * high.scale, high.y, z + q.y * high.scale], [x + p.x * high.scale, high.y, z + p.y * high.scale], tint);
    }
  }
  for (let index = 0; index < points.length; index += 1) {
    const p = points[index], q = points[(index + 1) % points.length];
    batch.triangle([x, height - 2.4, z], [x + p.x * 0.65, height - 2.4, z + p.y * 0.65], [x + q.x * 0.65, height - 2.4, z + q.y * 0.65], colors[3]);
  }
}

/** Texture-free sandstone terraces and a lower oasis, built in four to five draw calls. */
export class DesertLandscape {
  readonly group = new THREE.Group();
  readonly groundMaterial: THREE.MeshStandardMaterial;
  private waterMaterial: THREE.ShaderMaterial | null = null;

  constructor(theme: MapTheme, colors: LandscapePalette, shadows: boolean, gridSize = GRID_SIZE) {
    this.group.name = `landscape:${theme}`;
    const outline = plateauOutline(gridSize);
    const half = gridSize * TILE_SIZE / 2;
    const groundGeometry = sandPlateauGeometry(outline, colors.ground);
    const ground = new THREE.Mesh(groundGeometry, this.groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    ground.name = "untextured-buildable-ground";
    ground.receiveShadow = true;
    this.group.add(ground);

    // Match the ground cap orientation before building the cliff bands below it.
    const edge = outline.map((point) => new THREE.Vector2(point.x, -point.y));
    const cliffs = new SolidBatch();
    const strata = [
      { y: -0.02, out: 0, color: new THREE.Color(colors.ground).multiplyScalar(0.96) },
      { y: -0.2, out: 0.04, color: new THREE.Color(colors.ground).multiplyScalar(0.84) },
      { y: -0.32, out: 0.28, color: new THREE.Color(colors.rock).lerp(new THREE.Color("#edcc9b"), 0.25) },
      { y: -1.24, out: 0.64, color: new THREE.Color(colors.underlay) },
      { y: -1.38, out: 0.98, color: new THREE.Color(colors.rock).multiplyScalar(0.88) },
      { y: -2.42, out: 1.26, color: new THREE.Color(colors.underlay).multiplyScalar(0.83) },
    ];
    for (let band = 0; band < strata.length - 1; band += 1) {
      const upper = strata[band], lower = strata[band + 1];
      for (let index = 0; index < edge.length; index += 1) {
        const p = edge[index], q = edge[(index + 1) % edge.length];
        const variation = 0.96 + (Math.sin(index * 3.7) + 1) * 0.035;
        face(cliffs, ringPoint(p, upper.out, upper.y), ringPoint(q, upper.out, upper.y), ringPoint(q, lower.out, lower.y), ringPoint(p, lower.out, lower.y), upper.color.clone().multiplyScalar(variation));
      }
    }
    const cliffMesh = cliffs.mesh("sandstone-escarpment-strata", shadows);
    this.group.add(cliffMesh);

    const distant = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.MeshStandardMaterial({ color: colors.distant, roughness: 1 }));
    distant.name = "distant-desert-floor";
    distant.rotation.x = -Math.PI / 2;
    distant.position.y = -2.45;
    distant.receiveShadow = true;
    this.group.add(distant);

    const horizon = new SolidBatch();
    const canyon = theme === "red-canyon";
    const horizonScale = Math.max(1, half / (GRID_SIZE * TILE_SIZE / 2));
    addButte(horizon, -19 * horizonScale, -18 * horizonScale, 5, 4.3, canyon ? 9 : 6.5, colors.rock, 7);
    addButte(horizon, -8 * horizonScale, -23 * horizonScale, 6.4, 3.8, canyon ? 7.7 : 5.5, colors.rock, 17);
    addButte(horizon, 8 * horizonScale, -23.5 * horizonScale, 4.1, 3.6, canyon ? 10 : 7.2, colors.rock, 29);
    addButte(horizon, 21 * horizonScale, -12 * horizonScale, 4, 5, canyon ? 7.5 : 4.6, colors.rock, 37);
    addButte(horizon, 24 * horizonScale, 9 * horizonScale, 3.7, 4.4, 3.8, colors.rock, 41);
    addButte(horizon, -23 * horizonScale, 15 * horizonScale, 4.5, 2.9, 3.4, colors.rock, 53);
    // Low shelves frame the foreground without occluding playable cells.
    addButte(horizon, 6 * horizonScale, 22 * horizonScale, 6.5, 2.1, 1.05, colors.rock, 61);
    addButte(horizon, -10 * horizonScale, 23 * horizonScale, 4.1, 3.1, 1.5, colors.rock, 79);
    // Long wind-shaped ridges live below and beyond the flat construction plateau.
    for (let dune = 0; dune < 8; dune++) {
      const side = dune < 4 ? 1 : -1;
      const x = side * (half + 5.5 + dune % 2 * 3.4);
      const z = (dune % 4 - 1.5) * 9;
      addDune(horizon, x, z, 9 + dune % 3 * 2.5, 2.1, 0.55 + dune % 3 * 0.22, colors.distant, -0.48 + dune % 2 * 0.16);
    }
    this.group.add(horizon.mesh("distant-rock-terraces", shadows));

    if (theme === "oasis" || theme === "river-valley" || theme === "salt-flat") {
      this.addWater(theme, half);
    }
  }

  private addWater(theme: MapTheme, half: number): void {
    const river = theme === "river-valley";
    const salt = theme === "salt-flat";
    const shape = new THREE.Shape();
    const radiusX = river ? 4.2 : 4.6, radiusZ = river ? 34 : 7;
    for (let index = 0; index <= 64; index += 1) {
      const angle = index / 64 * Math.PI * 2;
      const wobble = 1 + Math.sin(angle * 5.0 + 1.2) * 0.075 + Math.cos(angle * 3) * 0.04;
      const x = Math.cos(angle) * radiusX * wobble;
      const y = Math.sin(angle) * radiusZ * wobble;
      if (index === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    const geometry = new THREE.ShapeGeometry(shape, 40);
    geometry.rotateX(-Math.PI / 2);
    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRadius: { value: new THREE.Vector2(radiusX, radiusZ) },
        uDeep: { value: new THREE.Color(salt ? "#7caaa2" : "#267f7d") },
        uShallow: { value: new THREE.Color(salt ? "#c0d7bd" : "#75b9a7") },
      },
      vertexShader: `varying vec2 vGround; void main() { vGround = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float uTime; uniform vec2 uRadius; uniform vec3 uDeep; uniform vec3 uShallow;
        varying vec2 vGround;
        void main() {
          float shore = smoothstep(0.40, 1.06, length(vGround / uRadius));
          vec3 color = mix(uDeep, uShallow, shore);
          float ripples = sin(vGround.y * 4.1 + sin(vGround.x * 1.5) * .6 + uTime * .55);
          float glint = smoothstep(.983, 1.0, ripples) * .045;
          color += vec3(glint);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    const water = new THREE.Mesh(geometry, this.waterMaterial);
    water.name = river ? "turquoise-wadi" : salt ? "mineral-lagoon" : "turquoise-oasis";
    water.position.set(-half - 6.4, -2.36, river ? 0 : 3.7);
    this.group.add(water);
  }

  update(elapsed: number): void {
    if (this.waterMaterial) this.waterMaterial.uniforms.uTime.value = elapsed;
  }

  dispose(): void {
    disposeEntity(this.group);
  }
}
