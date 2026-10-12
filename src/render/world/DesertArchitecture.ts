import * as THREE from "three";
import type { BuildingKind } from "../../game/types";
import { SolidBatch } from "./SolidBatch";

/** Original, texture-free limestone architecture. Front doors face +Z; ground is Y=0. */
export const DESERT_ARCHITECTURE_PALETTE = {
  limestone: "#eadab9",
  ivory: "#f6edda",
  shade: "#cfbd97",
  sandstone: "#b9a581",
  mortar: "#d4c3a3",
  dressedStone: "#e2d0ae",
  teal: "#237f80",
  tealLight: "#3c9992",
  tealShade: "#1b6167",
  terracotta: "#a95c42",
  terracottaLight: "#c17b57",
  timber: "#6d4937",
  timberLight: "#9b7652",
  brass: "#c89446",
  dark: "#343a35",
  water: "#55aeb0",
  leaf: "#688651",
  leafLight: "#91a569",
  soil: "#a98b5b",
  grain: "#d6b55d",
  grainLight: "#ecd28c",
  steel: "#93a5a1",
} as const;

const C = DESERT_ARCHITECTURE_PALETTE;
const TAU = Math.PI * 2;
type Point = readonly [number, number, number];
type MaterialKind = "stone" | "glaze" | "ember";
type Builder = (model: Architecture) => void;

const prototypes = new Map<BuildingKind, THREE.Group>();
let sharedMaterials: Record<MaterialKind, THREE.MeshStandardMaterial> | null = null;

function material(kind: MaterialKind): THREE.MeshStandardMaterial {
  if (!sharedMaterials) {
    sharedMaterials = {
      stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true }),
      glaze: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08, flatShading: true }),
      ember: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, emissive: "#de6824", emissiveIntensity: 0.65, flatShading: true }),
    };
    for (const [name, item] of Object.entries(sharedMaterials)) {
      item.name = `desert-architecture-${name}`;
      item.userData.shared = true;
    }
  }
  return sharedMaterials[kind];
}

class Architecture {
  readonly group = new THREE.Group();
  readonly stone = new SolidBatch();
  readonly glaze = new SolidBatch();
  readonly ember = new SolidBatch();

  constructor(readonly kind: BuildingKind) {
    this.group.name = `desert-${kind}`;
    this.group.userData.originalArchitecture = true;
    this.group.userData.buildingKind = kind;
    this.group.userData.front = "+Z";
  }

  part(batch: SolidBatch, name: string, materialKind: MaterialKind = "stone", position: Point = [0, 0, 0]): THREE.Mesh | null {
    const mesh = batch.mesh(name);
    // SolidBatch owns this temporary material; all shipping architecture shares three.
    (mesh.material as THREE.Material).dispose();
    if (!mesh.geometry.getAttribute("position")?.count) {
      mesh.geometry.dispose();
      return null;
    }
    mesh.material = material(materialKind);
    mesh.geometry.userData.shared = true;
    mesh.geometry.name = name;
    mesh.position.set(...position);
    this.group.add(mesh);
    return mesh;
  }

  finish(): THREE.Group {
    this.part(this.stone, `${this.kind}-masonry`);
    this.part(this.glaze, `${this.kind}-glazed-details`, "glaze");
    this.part(this.ember, `${this.kind}-hearth`, "ember");
    this.group.updateMatrixWorld(true);
    return this.group;
  }
}

function localPoint(origin: Point, x: number, y: number, z: number, yaw = 0): Point {
  return [origin[0] + Math.cos(yaw) * x + Math.sin(yaw) * z, origin[1] + y, origin[2] - Math.sin(yaw) * x + Math.cos(yaw) * z];
}

function faceBox(batch: SolidBatch, origin: Point, x: number, y: number, z: number, width: number, height: number, depth: number, color: THREE.ColorRepresentation, yaw = 0): void {
  const at = localPoint(origin, x, y, z, yaw);
  batch.box(at[0], at[1], at[2], width, height, depth, color, yaw);
}

/** Flush stone joints face out of the wall and need no hidden reverse triangles. */
function surfaceQuad(batch: SolidBatch, a: Point, b: Point, c: Point, d: Point, color: THREE.ColorRepresentation): void {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  batch.add(geometry, color);
}

function facePanel(batch: SolidBatch, origin: Point, x: number, y: number, width: number, height: number, color: THREE.ColorRepresentation, yaw = 0): void {
  const a = localPoint(origin, x - width / 2, y - height / 2, 0, yaw);
  const b = localPoint(origin, x + width / 2, y - height / 2, 0, yaw);
  const c = localPoint(origin, x + width / 2, y + height / 2, 0, yaw);
  const d = localPoint(origin, x - width / 2, y + height / 2, 0, yaw);
  surfaceQuad(batch, a, b, c, d, color);
}

function masonryFace(batch: SolidBatch, at: Point, width: number, height: number, yaw = 0): void {
  const rows = Math.max(1, Math.ceil(height / 0.17));
  const courseHeight = height / rows;
  const stoneWidth = 0.245;
  for (let row = 0; row < rows; row += 1) {
    const bottom = row * courseHeight;
    if (row > 0) facePanel(batch, at, 0, bottom, width, 0.0045, C.mortar, yaw);
    const offset = row % 2 ? stoneWidth / 2 : 0;
    for (let seam = -width / 2 + stoneWidth + offset; seam < width / 2 - 0.03; seam += stoneWidth) {
      facePanel(batch, at, seam, bottom + courseHeight / 2, 0.0045, courseHeight, C.mortar, yaw);
    }
    // A few dressed blocks give the wall a material scale without a noisy texture.
    if (width > 0.4 && row % 3 === 1) {
      const centre = -width / 2 + stoneWidth / 2 + offset;
      facePanel(batch, at, centre, bottom + courseHeight / 2, stoneWidth - 0.015, courseHeight - 0.014, C.dressedStone, yaw);
    }
  }
}

/** A chamfered footprint gives sunlit corners without a bevel modifier or textures. */
function block(batch: SolidBatch, x: number, y: number, z: number, width: number, height: number, depth: number, color: THREE.ColorRepresentation, bevel = 0.025): void {
  const w = width / 2, d = depth / 2, b = Math.min(bevel, w / 3, d / 3);
  const shape = new THREE.Shape();
  shape.moveTo(-w + b, -d);
  shape.lineTo(w - b, -d); shape.lineTo(w, -d + b); shape.lineTo(w, d - b);
  shape.lineTo(w - b, d); shape.lineTo(-w + b, d); shape.lineTo(-w, d - b);
  shape.lineTo(-w, -d + b); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1 });
  geometry.rotateX(-Math.PI / 2);
  batch.add(geometry, color, [x, y - height / 2, z]);
}

function groundedRock(batch: SolidBatch, x: number, y: number, z: number, radius: number, color: THREE.ColorRepresentation, scale: Point, yaw: number): void {
  const geometry = new THREE.DodecahedronGeometry(radius, 0);
  geometry.scale(...scale); geometry.rotateY(yaw); geometry.translate(x, y, z);
  const position = geometry.getAttribute("position");
  for (let index = 0; index < position.count; index += 1) position.setY(index, Math.max(0.075, position.getY(index)));
  geometry.computeVertexNormals();
  batch.add(geometry, color);
}

function archShape(width: number, height: number): THREE.Shape {
  const radius = width / 2, spring = Math.max(0, height - radius);
  const shape = new THREE.Shape();
  shape.moveTo(-radius, 0); shape.lineTo(-radius, spring);
  shape.absarc(0, spring, radius, Math.PI, 0, true);
  shape.lineTo(radius, 0); shape.closePath();
  return shape;
}

function archFill(batch: SolidBatch, at: Point, width: number, height: number, depth: number, color: THREE.ColorRepresentation, yaw = 0): void {
  const geometry = new THREE.ExtrudeGeometry(archShape(width, height), { depth, bevelEnabled: false, curveSegments: width > 0.3 ? 7 : 5 });
  geometry.translate(0, 0, -depth / 2);
  batch.add(geometry, color, at, [0, yaw, 0]);
}

/** An actual open-bottom arch, not a dark decal pretending to be a passage. */
function archFrame(batch: SolidBatch, at: Point, width: number, height: number, trim: number, depth: number, color: THREE.ColorRepresentation = C.ivory, yaw = 0): void {
  const r = width / 2, outer = r + trim, spring = height - r;
  const shape = new THREE.Shape();
  shape.moveTo(-outer, 0); shape.lineTo(-outer, spring);
  shape.absarc(0, spring, outer, Math.PI, 0, true);
  shape.lineTo(outer, 0); shape.lineTo(r, 0); shape.lineTo(r, spring);
  shape.absarc(0, spring, r, 0, Math.PI, false);
  shape.lineTo(-r, 0); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: width > 0.3 ? 7 : 5 });
  geometry.translate(0, 0, -depth / 2);
  batch.add(geometry, color, at, [0, yaw, 0]);
  if (width >= 0.18) {
    // Voussoir joints follow the real arch instead of a painted semicircle.
    for (let joint = 1; joint < 10; joint += 1) {
      const angle = joint * Math.PI / 10;
      const point = (radius: number, offset: number): Point => localPoint(at,
        Math.cos(angle) * radius - Math.sin(angle) * offset,
        spring + Math.sin(angle) * radius + Math.cos(angle) * offset,
        depth / 2 + 0.0015, yaw);
      const a = point(r + 0.003, -0.002), b = point(outer - 0.003, -0.002);
      const c = point(outer - 0.003, 0.002), d = point(r + 0.003, 0.002);
      surfaceQuad(batch, a, b, c, d, C.mortar);
    }
  }
}

function door(batch: SolidBatch, at: Point, width = 0.25, height = 0.48, yaw = 0, relief = 1): void {
  archFill(batch, at, width + 0.07, height + 0.035, 0.024 * relief, C.dark, yaw);
  archFrame(batch, localPoint(at, 0, -0.015, 0.018 * relief, yaw), width + 0.055, height + 0.045, 0.04, 0.058 * relief, C.ivory, yaw);
  const radius = width / 2, spring = height - radius;
  for (let plank = 0; plank < 5; plank += 1) {
    const x = (plank - 2) * width / 5;
    const h = spring + Math.sqrt(Math.max(0, radius * radius - x * x)) - 0.012;
    faceBox(batch, at, x, h / 2, 0.027 * relief, width / 5 - 0.004, h, 0.024 * relief, plank % 2 ? C.timber : C.timberLight, yaw);
  }
  for (const y of [height * 0.26, height * 0.61]) faceBox(batch, at, 0, y, 0.045 * relief, width * 0.87, 0.024, 0.018 * relief, C.timber, yaw);
  for (const x of [-0.035, 0.035]) {
    const p = localPoint(at, x, height * 0.42, 0.065 * relief, yaw);
    batch.add(new THREE.TorusGeometry(0.015, 0.005, 4, 8), C.brass, p, [0, yaw, 0]);
  }
}

function windowNiche(batch: SolidBatch, at: Point, width = 0.13, height = 0.26, yaw = 0, shutter = false): void {
  archFill(batch, at, width, height, 0.022, shutter ? C.tealShade : C.dark, yaw);
  archFrame(batch, localPoint(at, 0, -0.008, 0.012, yaw), width, height, 0.025, 0.036, C.ivory, yaw);
  faceBox(batch, at, 0, -0.015, 0.025, width + 0.07, 0.035, 0.09, C.shade, yaw);
  faceBox(batch, at, 0, height * 0.4, 0.023, 0.014, height * 0.75, 0.014, shutter ? C.tealLight : C.timberLight, yaw);
  faceBox(batch, at, 0, height * 0.43, 0.023, width * 0.82, 0.014, 0.014, shutter ? C.tealLight : C.timberLight, yaw);
}

function parapet(batch: SolidBatch, x: number, y: number, z: number, width: number, depth: number, height = 0.11): void {
  block(batch, x, y - 0.055, z, width + 0.055, 0.075, depth + 0.055, C.shade, 0.02);
  block(batch, x, y - 0.014, z, width + 0.075, 0.055, depth + 0.075, C.ivory, 0.026);
  batch.box(x, y + 0.015, z, width - 0.02, 0.035, depth - 0.02, C.limestone);
  // Recessed roof tiles and shaded brackets keep the roof from reading as a lid.
  if (width > 0.25 && depth > 0.25) {
    batch.box(x, y + 0.035, z, width - 0.135, 0.008, depth - 0.135, C.dressedStone);
    for (let tile = -width / 2 + 0.22; tile < width / 2 - 0.09; tile += 0.19) {
      batch.box(x + tile, y + 0.041, z, 0.004, 0.003, depth - 0.135, C.mortar);
    }
    for (let tile = -depth / 2 + 0.2; tile < depth / 2 - 0.09; tile += 0.19) {
      batch.box(x, y + 0.041, z + tile, width - 0.135, 0.003, 0.004, C.mortar);
    }
  }
  for (const side of [-1, 1]) {
    batch.box(x, y + height / 2, z + side * (depth / 2 - 0.025), width, height, 0.06, C.ivory);
    batch.box(x + side * (width / 2 - 0.025), y + height / 2, z, 0.06, height, depth, C.ivory);
    for (let bracket = -width / 2 + 0.12; bracket < width / 2 - 0.08; bracket += 0.22) {
      batch.box(x + bracket, y - 0.1, z + side * (depth / 2 - 0.004), 0.043, 0.095, 0.062, C.shade);
      batch.box(x + bracket, y - 0.064, z + side * (depth / 2 + 0.005), 0.063, 0.036, 0.068, C.ivory);
    }
  }
}

function courses(batch: SolidBatch, x: number, z: number, width: number, height: number, depth: number, base = 0.04): void {
  block(batch, x, base + height / 2, z, width, height, depth, C.limestone);
  block(batch, x, base + 0.035, z, width + 0.035, 0.07, depth + 0.035, C.shade, 0.03);
  masonryFace(batch, [x, base + 0.075, z + depth / 2 + 0.0015], width - 0.055, height - 0.08);
  masonryFace(batch, [x, base + 0.075, z - depth / 2 - 0.0015], width - 0.055, height - 0.08, Math.PI);
  masonryFace(batch, [x + width / 2 + 0.0015, base + 0.075, z], depth - 0.055, height - 0.08, Math.PI / 2);
  masonryFace(batch, [x - width / 2 - 0.0015, base + 0.075, z], depth - 0.055, height - 0.08, -Math.PI / 2);
  for (const side of [-1, 1]) for (let row = 0; row < Math.floor(height / 0.19); row += 1) {
    const y = base + 0.16 + row * 0.19;
    batch.box(x + side * (width / 2 - 0.07), y, z + depth / 2 + 0.009, row % 2 ? 0.105 : 0.15, 0.065, 0.025, row % 3 ? C.ivory : C.shade);
    batch.box(x + width / 2 + 0.009, y, z + side * (depth / 2 - 0.07), 0.025, 0.065, row % 2 ? 0.15 : 0.105, row % 3 ? C.ivory : C.shade);
  }
}

function plinth(batch: SolidBatch, width = 1.16, depth = 1.16): void {
  block(batch, 0, 0.026, 0, width, 0.052, depth, C.shade, 0.045);
  block(batch, 0, 0.059, 0, width - 0.035, 0.032, depth - 0.035, C.limestone, 0.03);
}

function dome(model: Architecture, x: number, y: number, z: number, radius: number, height: number, finial = true): void {
  model.stone.cylinder(x, y - 0.035, z, radius * 1.035, radius * 1.035, 0.07, C.ivory, 16);
  model.stone.cylinder(x, y + 0.015, z, radius * 1.025, radius * 1.025, 0.035, C.brass, 16);
  const profile = [[1, 0], [1.035, 0.12], [0.99, 0.33], [0.84, 0.57], [0.62, 0.78], [0.31, 0.94], [0, 1.08]].map(([r, h]) => new THREE.Vector2(r * radius, h * height));
  model.glaze.add(new THREE.LatheGeometry(profile, 20), C.teal, [x, y + 0.026, z]);
  for (let rib = 0; rib < 10; rib += 1) {
    const angle = rib * TAU / 10;
    for (let p = 1; p < profile.length - 1; p += 1) {
      const from = profile[p - 1], to = profile[p];
      // Glazed ribs lie on the roof surface: ribbons avoid hidden cylinder caps
      // and preserve the curved highlight for a fraction of the triangles.
      const point = (profilePoint: THREE.Vector2, side: number): Point => [
        x + Math.sin(angle + side * 0.014) * profilePoint.x * 1.008,
        y + 0.028 + profilePoint.y,
        z + Math.cos(angle + side * 0.014) * profilePoint.x * 1.008,
      ];
      surfaceQuad(model.glaze, point(from, -1), point(from, 1), point(to, 1), point(to, -1), C.tealLight);
    }
  }
  if (finial) {
    const top = y + height * 1.08 + 0.026;
    model.stone.cylinder(x, top + 0.055, z, 0.009, 0.018, 0.13, C.brass, 6);
    model.stone.add(new THREE.SphereGeometry(0.028, 8, 5), C.brass, [x, top + 0.06, z]);
  }
}

function jar(batch: SolidBatch, x: number, y: number, z: number, size = 1, color: THREE.ColorRepresentation = C.terracotta): void {
  const profile = [[0.056, 0], [0.082, 0.045], [0.09, 0.12], [0.072, 0.175], [0.041, 0.20], [0.042, 0.23], [0.052, 0.235]].map(([r, h]) => new THREE.Vector2(r * size, h * size));
  batch.add(new THREE.LatheGeometry(profile, 10), color, [x, y, z]);
  batch.cylinder(x, y + 0.224 * size, z, 0.035 * size, 0.035 * size, 0.01 * size, C.dark, 10);
  batch.add(new THREE.TorusGeometry(0.047 * size, 0.009 * size, 4, 10), C.terracottaLight, [x, y + 0.231 * size, z], [Math.PI / 2, 0, 0]);
}

function crate(batch: SolidBatch, x: number, y: number, z: number, size = 0.2): void {
  batch.box(x, y + size / 2, z, size, size, size * 0.84, C.timberLight);
  for (const sign of [-1, 1]) {
    batch.box(x + sign * size * 0.38, y + size / 2, z + size * 0.44, size * 0.095, size, size * 0.065, C.timber);
    batch.box(x, y + size * 0.86, z + sign * size * 0.37, size, size * 0.09, size * 0.095, C.timber);
  }
  batch.beam([x - size * 0.42, y + size * 0.08, z + size * 0.46], [x + size * 0.42, y + size * 0.92, z + size * 0.46], size * 0.035, C.timber, 4);
}

function pottedPlant(batch: SolidBatch, x: number, y: number, z: number, size = 1): void {
  jar(batch, x, y, z, size * 0.7, C.terracotta);
  for (let leaf = 0; leaf < 6; leaf += 1) {
    const a = leaf * TAU / 6;
    const start: Point = [x, y + 0.14 * size, z];
    const end: Point = [x + Math.cos(a) * 0.09 * size, y + (0.25 + leaf % 2 * 0.055) * size, z + Math.sin(a) * 0.09 * size];
    batch.beam(start, end, 0.014 * size, leaf % 2 ? C.leaf : C.leafLight, 4);
  }
}

function lantern(batch: SolidBatch, at: Point, size = 1): void {
  batch.box(at[0], at[1] + 0.06 * size, at[2], 0.025 * size, 0.17 * size, 0.025 * size, C.timber);
  batch.add(new THREE.OctahedronGeometry(0.065 * size, 0), C.brass, [at[0], at[1] - 0.015 * size, at[2]], [0, 0, 0], [0.75, 1.2, 0.75]);
  batch.box(at[0], at[1] - 0.008 * size, at[2] + 0.041 * size, 0.047 * size, 0.069 * size, 0.013 * size, C.grainLight);
}

/** Curved cloth and scalloped valance; everything is real coloured geometry. */
function awning(batch: SolidBatch, x: number, y: number, z: number, width: number, depth: number, stripes = 7, color: THREE.ColorRepresentation = C.teal, posts = true): void {
  if (posts) for (const dx of [-1, 1]) {
    batch.box(x + dx * width * 0.45, y / 2, z + depth * 0.41, 0.035, y, 0.035, C.timber);
    batch.add(new THREE.SphereGeometry(0.031, 6, 4), C.brass, [x + dx * width * 0.45, y + 0.025, z + depth * 0.41]);
  }
  for (let stripe = 0; stripe < stripes; stripe += 1) {
    const x0 = x - width / 2 + stripe * width / stripes, x1 = x0 + width / stripes;
    const tint = stripe % 2 ? C.ivory : color;
    for (let section = 0; section < 4; section += 1) {
      const t0 = section / 4, t1 = (section + 1) / 4;
      const z0 = z - depth / 2 + depth * t0, z1 = z - depth / 2 + depth * t1;
      const y0 = y + 0.12 * (1 - t0) - Math.sin(t0 * Math.PI) * 0.045;
      const y1 = y + 0.12 * (1 - t1) - Math.sin(t1 * Math.PI) * 0.045;
      batch.triangle([x0, y0, z0], [x1, y0, z0], [x1, y1, z1], tint);
      batch.triangle([x0, y0, z0], [x1, y1, z1], [x0, y1, z1], tint);
    }
    const edge = z + depth / 2;
    batch.triangle([x0, y, edge], [x1, y, edge], [(x0 + x1) / 2, y - 0.1, edge + 0.012], tint);
  }
  batch.beam([x - width / 2, y + 0.12, z - depth / 2], [x + width / 2, y + 0.12, z - depth / 2], 0.018, C.timber, 6);
}

function banner(model: Architecture, x: number, y: number, z: number, width = 0.28, height = 0.17): void {
  model.stone.cylinder(x, y - 0.18, z, 0.014, 0.018, 0.49, C.timber, 6);
  model.stone.add(new THREE.OctahedronGeometry(0.029, 0), C.brass, [x, y + 0.085, z]);
  const cloth = new SolidBatch();
  for (let section = 0; section < 4; section += 1) {
    const x0 = section * width / 4, x1 = (section + 1) * width / 4;
    const z0 = Math.sin(section * 1.3) * 0.02, z1 = Math.sin((section + 1) * 1.3) * 0.02;
    const end = section === 3 ? height * 0.18 : 0;
    cloth.triangle([x0, 0, z0], [x1, -end, z1], [x1, -height + end, z1], C.teal);
    cloth.triangle([x0, 0, z0], [x1, -height + end, z1], [x0, -height, z0], C.teal);
    cloth.box((x0 + x1) / 2, -height * 0.12, (z0 + z1) / 2 + 0.005, width / 4 + 0.002, 0.014, 0.006, C.brass);
  }
  model.part(cloth, "banner-cloth", "stone", [x, y + 0.035, z]);
}

function keep(model: Architecture): void {
  const b = model.stone;
  // Rear massing is broad; the forward entrance narrows to leave the two initial
  // diagonal house/farm cells untouched (centres at ±1.25, +1.25).
  block(b, 0, 0.035, -0.35, 2.2, 0.07, 1.62, C.shade, 0.085);
  block(b, 0, 0.044, 0.74, 1.16, 0.088, 0.55, C.limestone, 0.04);
  block(b, 0, 0.085, -0.02, 1.77, 0.085, 1.15, C.ivory, 0.06);
  // A real U-shaped palace, with a visible tiled court and raised throne hall.
  courses(b, 0, -0.59, 0.94, 1.85, 0.69, 0.08);
  parapet(b, 0, 1.93, -0.59, 0.99, 0.74, 0.08);
  for (const x of [-0.48, 0.48]) for (const z of [-0.91, -0.59, -0.27]) block(b, x, 2.065, z, 0.13, 0.18, 0.15, C.ivory, 0.016);
  // A projecting gallery separates the throne hall from its upper chambers.
  for (const y of [1.18, 1.31]) block(b, 0, y, -0.59, 0.975, 0.048, 0.73, C.ivory, 0.022);
  b.box(0, 1.245, -0.217, 0.81, 0.072, 0.022, C.tealShade);
  for (let tile = 0; tile < 9; tile += 1) {
    b.box(-0.36 + tile * 0.09, 1.246, -0.2, 0.042, 0.037, 0.012, tile % 2 ? C.brass : C.tealLight, Math.PI / 4);
  }
  for (const side of [-1, 1]) {
    courses(b, side * 0.705, -0.26, 0.44, 1.04, 1.2, 0.08);
    parapet(b, side * 0.705, 1.12, -0.26, 0.46, 1.2);
    // Squat forward bastions and a broad machicolated cornice give the palace a
    // defensive silhouette. The court stays open between them.
    courses(b, side * 0.705, 0.145, 0.46, 1.25, 0.49, 0.08);
    parapet(b, side * 0.705, 1.35, 0.145, 0.51, 0.54, 0.075);
    for (const dx of [-0.2, 0.2]) for (const dz of [-0.21, 0.21]) block(b, side * 0.705 + dx, 1.535, 0.145 + dz, 0.14, 0.24, 0.15, C.ivory, 0.016);
    for (const dz of [-0.21, 0.21]) block(b, side * 0.705, 1.515, 0.145 + dz, 0.13, 0.20, 0.15, C.ivory, 0.016);
    for (const dx of [-0.17, 0, 0.17]) b.box(side * 0.705 + dx, 1.25, 0.432, 0.065, 0.15, 0.07, C.shade);
    for (const z of [-0.65, -0.16, 0.2]) {
      block(b, side * 0.925, 0.47, z, 0.13, 0.85, 0.16, C.ivory, 0.015);
      windowNiche(b, [side * 0.478, 0.61, z], 0.105, 0.25, side < 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    // Slender corner towers rise above the parapet, instead of bare cylinders.
    const x = side * 0.86, z = -0.875;
    b.cylinder(x, 0.75, z, 0.19, 0.255, 1.36, C.limestone, 10);
    b.cylinder(x, 0.20, z, 0.24, 0.27, 0.26, C.shade, 10);
    b.cylinder(x, 1.27, z, 0.26, 0.22, 0.12, C.ivory, 10);
    b.cylinder(x, 1.42, z, 0.225, 0.225, 0.22, C.limestone, 10);
    b.cylinder(x, 1.54, z, 0.255, 0.255, 0.065, C.ivory, 10);
    for (const y of [0.43, 0.75, 1.07]) b.cylinder(x, y, z, 0.226 - (y - 0.43) * 0.045, 0.23 - (y - 0.43) * 0.045, 0.022, C.dressedStone, 10);
    windowNiche(b, [x, 1.32, z + 0.224], 0.07, 0.16);
    dome(model, x, 1.58, z, 0.21, 0.18);
  }
  // Arched sally ports in the bastions flank the open central entrance.
  for (const x of [-0.69, 0.69]) {
    door(b, [x, 0.14, 0.407], 0.23, 0.58);
    windowNiche(b, [x, 0.93, 0.407], 0.073, 0.23);
  }
  door(b, [0, 0.16, -0.218], 0.39, 0.81);
  for (const x of [-0.3, 0, 0.3]) windowNiche(b, [x, 1.47, -0.236], 0.125, 0.31, 0, true);
  for (const side of [-1, 1]) {
    windowNiche(b, [side * 0.477, 1.48, -0.58], 0.13, 0.31, side * Math.PI / 2, true);
    // Arcaded walkways shelter the edges of the court while its central route stays clear.
    for (const z of [-0.05, 0.235]) archFrame(b, [side * 0.485, 0.15, z], 0.19, 0.63, 0.035, 0.045, C.ivory, side * -Math.PI / 2);
  }
  for (const x of [-0.29, 0.29]) {
    b.box(x, 0.143, 0.18, 0.035, 0.015, 0.65, C.tealShade);
    b.box(x, 0.149, 0.18, 0.015, 0.016, 0.65, C.brass);
  }
  // The court slab tops out at .1275: its inlay must sit above it, not inside.
  block(b, 0, 0.141, 0.19, 0.44, 0.026, 0.61, C.teal);
  for (const z of [-0.06, 0.44]) b.box(0, 0.159, z, 0.44, 0.012, 0.025, C.brass);
  archFrame(b, [0, 0.095, 0.55], 0.43, 0.67, 0.075, 0.12);
  for (const x of [-0.425, 0.425]) {
    courses(b, x, 0.49, 0.19, 0.76, 0.22, 0.075);
    block(b, x, 0.86, 0.49, 0.245, 0.12, 0.28, C.ivory);
    lantern(b, [x, 0.77, 0.633], 0.8);
  }
  for (let step = 0; step < 4; step += 1) block(b, 0, 0.021 + step * 0.013, 0.94 - step * 0.072, 0.58, 0.042 + step * 0.026, 0.084, step % 2 ? C.ivory : C.limestone, 0.008);
  pottedPlant(b, -0.36, 0.088, 0.85, 0.9); pottedPlant(b, 0.36, 0.088, 0.85, 0.9);
  b.cylinder(0, 1.997, -0.59, 0.413, 0.413, 0.1, C.limestone, 20);
  dome(model, 0, 2.025, -0.59, 0.44, 0.44);
  banner(model, 0.69, 1.57, 0.03, 0.3, 0.19);
}

function house(model: Architecture): void {
  const b = model.stone;
  plinth(b);
  courses(b, -0.15, -0.22, 0.76, 0.77, 0.62, 0.07);
  parapet(b, -0.15, 0.85, -0.22, 0.79, 0.65);
  courses(b, 0.36, -0.26, 0.27, 0.45, 0.56, 0.07);
  parapet(b, 0.36, 0.53, -0.26, 0.29, 0.56, 0.07);
  door(b, [-0.26, 0.082, 0.097], 0.235, 0.48);
  windowNiche(b, [0.019, 0.45, 0.097], 0.125, 0.25, 0, true);
  windowNiche(b, [-0.535, 0.41, -0.18], 0.13, 0.26, -Math.PI / 2, true);
  awning(b, 0.16, 0.6, 0.292, 0.72, 0.41, 5);
  b.box(-0.43, 0.19, 0.35, 0.12, 0.23, 0.37, C.limestone);
  b.box(-0.43, 0.31, 0.35, 0.14, 0.04, 0.39, C.ivory);
  b.box(0.14, 0.093, 0.315, 0.4, 0.025, 0.29, C.terracotta);
  for (const side of [-1, 1]) b.box(0.14 + side * 0.16, 0.108, 0.315, 0.018, 0.008, 0.29, C.grainLight);
  jar(b, 0.41, 0.08, 0.42, 0.7, C.tealShade); pottedPlant(b, -0.46, 0.07, 0.05, 0.8);
  // A set-back upper room and roof terrace give the home a believable two-storey mass.
  courses(b, -0.19, -0.285, 0.56, 0.54, 0.45, 0.885);
  parapet(b, -0.19, 1.435, -0.285, 0.59, 0.48, 0.085);
  for (const x of [-0.335, -0.075]) {
    windowNiche(b, [x, 1.035, -0.052], 0.115, 0.235, 0, true);
    // Small timber screens shade the upper windows, with clear individual slats.
    for (const dx of [-0.035, 0, 0.035]) b.box(x + dx, 1.119, -0.003, 0.009, 0.16, 0.009, C.timberLight);
  }
  windowNiche(b, [-0.477, 1.045, -0.285], 0.12, 0.225, -Math.PI / 2, true);
  for (const x of [-0.39, -0.19, 0.01]) {
    b.box(x, 1.33, -0.005, 0.038, 0.045, 0.14, C.timber);
    b.beam([x, 1.257, -0.045], [x, 1.33, 0.053], 0.013, C.timberLight, 4);
  }
  b.box(-0.19, 1.363, 0.008, 0.58, 0.026, 0.155, C.terracottaLight);
  // The low side roof is an inhabited terrace rather than an empty extrusion.
  pottedPlant(b, 0.37, 0.572, -0.36, 0.66);
  b.box(0.345, 0.577, -0.08, 0.18, 0.025, 0.19, C.tealShade);
  for (let slat = 0; slat < 4; slat += 1) b.box(0.282 + slat * 0.042, 0.597, -0.08, 0.025, 0.014, 0.16, C.timberLight);
  lantern(b, [-0.46, 0.57, 0.123], 0.62);
}

function market(model: Architecture): void {
  const b = model.stone;
  plinth(b);
  courses(b, 0, -0.41, 1.02, 0.6, 0.26, 0.075);
  parapet(b, 0, 0.68, -0.41, 1.03, 0.27, 0.06);
  door(b, [0.31, 0.09, -0.27], 0.19, 0.39);
  awning(b, 0, 0.8, 0.07, 1.1, 0.85, 9);
  b.box(0, 0.31, 0.29, 0.93, 0.31, 0.24, C.timber);
  b.box(0, 0.49, 0.29, 0.995, 0.075, 0.29, C.timberLight);
  for (let board = 0; board < 8; board += 1) b.box(-0.405 + board * 0.116, 0.33, 0.416, 0.098, 0.255, 0.023, board % 2 ? C.timberLight : C.timber);
  for (let tray = 0; tray < 3; tray += 1) {
    const x = -0.31 + tray * 0.3;
    b.box(x, 0.545, 0.30, 0.255, 0.032, 0.205, C.terracotta);
    for (let fruit = 0; fruit < 6; fruit += 1) b.add(new THREE.IcosahedronGeometry(0.037, 0), [C.grainLight, C.terracottaLight, C.leafLight][tray], [x - 0.072 + fruit % 3 * 0.072, 0.59 + Math.floor(fruit / 3) * 0.025, 0.266 + Math.floor(fruit / 3) * 0.063]);
  }
  jar(b, -0.43, 0.08, -0.13, 1.05); jar(b, -0.245, 0.08, -0.16, 0.8, C.tealLight);
  crate(b, 0.37, 0.08, -0.05, 0.22);
  b.box(0.32, 0.089, 0.515, 0.32, 0.018, 0.105, C.tealShade);
  // A merchant's balance hangs in the central opening, clear of the fruit trays.
  b.beam([0.08, 0.53, -0.04], [0.08, 0.735, -0.04], 0.009, C.brass, 5);
  b.beam([-0.03, 0.706, -0.04], [0.19, 0.706, -0.04], 0.009, C.brass, 5);
  for (const x of [-0.02, 0.18]) {
    b.beam([x, 0.706, -0.04], [x, 0.614, -0.04], 0.0045, C.brass, 4);
    b.cylinder(x, 0.604, -0.04, 0.06, 0.025, 0.029, C.brass, 8);
  }
  lantern(b, [0.51, 0.68, -0.17], 0.75);
}

function tower(model: Architecture): void {
  const b = model.stone;
  plinth(b, 1.2, 1.2);
  courses(b, 0, 0, 0.88, 1.46, 0.88, 0.07);
  // Cardinal piers meet the wall ends throughout their height. Corner buttresses
  // alone leave a slit on the centreline where a neighbouring wall joins.
  for (const side of [-1, 1]) {
    block(b, side * 0.48, 0.625, 0, 0.16, 1.10, 0.31, C.limestone, 0.012);
    block(b, 0, 0.625, side * 0.48, 0.31, 1.10, 0.16, C.limestone, 0.012);
    masonryFace(b, [side * 0.5615, 0.15, 0], 0.26, 0.99, side * Math.PI / 2);
    masonryFace(b, [0, 0.15, side * 0.5615], 0.26, 0.99, side < 0 ? Math.PI : 0);
    block(b, side * 0.48, 1.17, 0, 0.20, 0.075, 0.35, C.ivory, 0.012);
    block(b, 0, 1.17, side * 0.48, 0.35, 0.075, 0.20, C.ivory, 0.012);
  }
  for (const x of [-0.465, 0.465]) for (const z of [-0.465, 0.465]) {
    block(b, x, 0.49, z, 0.18, 0.84, 0.18, C.shade, 0.025);
    block(b, x, 0.93, z, 0.14, 0.11, 0.14, C.ivory, 0.02);
  }
  for (const x of [-0.23, 0.23]) windowNiche(b, [x, 1.01, 0.454], 0.078, 0.28);
  windowNiche(b, [0.454, 1.22, 0], 0.09, 0.20, Math.PI / 2);
  door(b, [0, 0.085, 0.555], 0.24, 0.59, 0, 0.65);
  block(b, 0, 1.51, 0, 1.08, 0.15, 1.08, C.ivory, 0.035);
  block(b, 0, 1.603, 0, 1.16, 0.05, 1.16, C.shade, 0.04);
  block(b, 0, 1.646, 0, 1.2, 0.045, 1.2, C.ivory, 0.045);
  b.box(0, 1.68, 0, 1.03, 0.04, 1.03, C.limestone);
  for (const side of [-1, 1]) for (const p of [-0.46, 0, 0.46]) {
    block(b, p, 1.785, side * 0.51, 0.205, 0.23, 0.15, C.ivory, 0.015);
    if (p === 0) block(b, side * 0.51, 1.785, 0, 0.15, 0.23, 0.205, C.ivory, 0.015);
  }
  for (const x of [-0.18, 0.18]) b.box(x, 1.855, -0.18, 0.04, 0.36, 0.045, C.timber);
  dome(model, 0, 2.01, -0.18, 0.255, 0.22);
  banner(model, -0.38, 2.05, 0.2, 0.25, 0.17);
}

function gate(model: Architecture): void {
  const b = model.stone;
  // Piers reach ±0.61. Connected walls reach 0.72 from their own adjacent cells,
  // overlapping the pier by 0.08 at TILE=1.25, while the centre stays passable.
  for (const x of [-0.455, 0.455]) {
    courses(b, x, 0, 0.26, 1.14, 1.075, 0.035);
    block(b, x, 0.12, 0, 0.31, 0.24, 1.18, C.shade, 0.025);
    block(b, x, 1.135, 0, 0.3, 0.105, 1.16, C.ivory, 0.025);
    for (const z of [-0.39, 0.39]) windowNiche(b, [x, 0.79, z > 0 ? 0.537 : -0.537], 0.065, 0.21, z > 0 ? 0 : Math.PI);
  }
  archFrame(b, [0, 0.025, 0], 0.59, 0.95, 0.115, 0.78, C.limestone);
  archFrame(b, [0, 0.025, 0.405], 0.59, 0.95, 0.062, 0.065, C.ivory);
  archFrame(b, [0, 0.025, -0.405], 0.59, 0.95, 0.062, 0.065, C.ivory);
  block(b, 0, 1.122, 0, 1.12, 0.205, 0.9, C.limestone);
  block(b, 0, 1.25, 0, 1.22, 0.085, 1.18, C.ivory, 0.035);
  b.box(0, 1.301, 0, 1.02, 0.025, 0.91, C.shade);
  for (const z of [-0.49, 0.49]) for (const x of [-0.49, -0.245, 0, 0.245, 0.49]) block(b, x, 1.39, z, 0.15, 0.19, 0.16, C.ivory, 0.012);
  for (const x of [-0.23, 0.23]) {
    b.box(x, 0.35, 0.15, 0.04, 0.65, 0.42, C.timber);
    b.box(x, 0.17, 0.15, 0.052, 0.035, 0.45, C.brass);
    b.box(x, 0.49, 0.15, 0.052, 0.035, 0.45, C.brass);
  }
  for (const x of [-0.22, -0.11, 0, 0.11, 0.22]) b.box(x, 0.89, -0.11, 0.019, 0.2, 0.025, C.timber);
  b.box(0, 0.82, -0.11, 0.47, 0.027, 0.03, C.timber);
  for (const x of [-0.48, 0.48]) lantern(b, [x, 0.72, 0.57], 0.65);
  banner(model, -0.28, 1.72, 0.03, 0.31, 0.18);
}

function log(batch: SolidBatch, x: number, y: number, z: number, length: number, radius: number): void {
  batch.cylinder(x, y, z, radius * 0.91, radius, length, C.timber, 9, [0, 0, Math.PI / 2]);
  for (const end of [-1, 1]) {
    batch.cylinder(x + end * length * 0.5, y, z, radius * 0.81, radius * 0.81, 0.007, C.timberLight, 9, [0, 0, Math.PI / 2]);
    batch.cylinder(x + end * (length * 0.5 + 0.005), y, z, radius * 0.37, radius * 0.37, 0.008, C.grainLight, 9, [0, 0, Math.PI / 2]);
  }
}

function sack(batch: SolidBatch, x: number, y: number, z: number, size = 1): void {
  batch.add(new THREE.SphereGeometry(0.105, 9, 6), C.grainLight, [x, y + 0.123 * size, z], [0, 0, 0.07], [size, size * 1.28, size * 0.84]);
  batch.cylinder(x + 0.007 * size, y + 0.257 * size, z, 0.037 * size, 0.028 * size, 0.075 * size, C.limestone, 7);
  batch.cylinder(x + 0.007 * size, y + 0.231 * size, z, 0.032 * size, 0.032 * size, 0.025 * size, C.timber, 7);
}

function barrel(batch: SolidBatch, x: number, y: number, z: number, size = 1): void {
  const profile = [[0.095, 0], [0.12, 0.05], [0.128, 0.17], [0.115, 0.29], [0.094, 0.32]].map(([r, h]) => new THREE.Vector2(r * size, h * size));
  batch.add(new THREE.LatheGeometry(profile, 10), C.timberLight, [x, y, z]);
  batch.cylinder(x, y + 0.318 * size, z, 0.095 * size, 0.095 * size, 0.016 * size, C.timber, 10);
  for (const h of [0.07, 0.255]) batch.add(new THREE.TorusGeometry(0.119 * size, 0.011 * size, 4, 10), C.steel, [x, y + h * size, z], [Math.PI / 2, 0, 0]);
}

function sword(batch: SolidBatch, x: number, y: number, z: number, size = 1): void {
  batch.box(x, y + 0.20 * size, z, 0.031 * size, 0.33 * size, 0.014 * size, C.steel);
  batch.add(new THREE.ConeGeometry(0.022 * size, 0.065 * size, 4), C.ivory, [x, y + 0.397 * size, z], [0, Math.PI / 4, 0], [1, 1, 0.5]);
  batch.box(x, y + 0.037 * size, z, 0.115 * size, 0.028 * size, 0.031 * size, C.brass);
  batch.box(x, y - 0.018 * size, z, 0.025 * size, 0.095 * size, 0.022 * size, C.timber);
}

function shield(batch: SolidBatch, x: number, y: number, z: number, radius = 0.12): void {
  batch.cylinder(x, y, z, radius, radius, 0.04, C.brass, 12, [Math.PI / 2, 0, 0]);
  batch.cylinder(x, y, z + 0.024, radius * 0.86, radius * 0.86, 0.014, C.teal, 12, [Math.PI / 2, 0, 0]);
  batch.add(new THREE.SphereGeometry(radius * 0.23, 8, 5), C.brass, [x, y, z + 0.04], [0, 0, 0], [1, 1, 0.55]);
}

function lumber(model: Architecture): void {
  const b = model.stone;
  plinth(b);
  courses(b, -0.225, -0.285, 0.61, 0.61, 0.49, 0.075);
  parapet(b, -0.225, 0.69, -0.285, 0.64, 0.51, 0.075);
  door(b, [-0.28, 0.09, -0.03], 0.22, 0.43);
  awning(b, 0.215, 0.68, -0.045, 0.59, 0.87, 5, C.tealShade);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3 - row; column += 1) log(b, 0.13, 0.14 + row * 0.12, 0.215 + column * 0.128 + row * 0.064, 0.76, 0.065);
  }
  for (const z of [-0.28, -0.14, 0]) b.box(0.36, 0.17, z, 0.3, 0.18, 0.055, C.timberLight);
  b.cylinder(-0.41, 0.195, 0.4, 0.115, 0.135, 0.245, C.timber, 9);
  b.cylinder(-0.41, 0.324, 0.4, 0.113, 0.113, 0.016, C.grainLight, 9);
  b.beam([-0.44, 0.32, 0.405], [-0.34, 0.64, 0.405], 0.013, C.timber, 5);
  b.add(new THREE.BoxGeometry(0.12, 0.075, 0.023), C.steel, [-0.315, 0.59, 0.407], [0, 0, -0.2]);
  // A framed pit-saw is the workshop's readable trade sign.
  b.box(-0.14, 0.39, 0.045, 0.027, 0.25, 0.023, C.steel);
  for (const y of [0.27, 0.52]) b.box(-0.14, y, 0.045, 0.115, 0.025, 0.035, C.timber);
  jar(b, -0.43, 0.075, -0.46, 0.6, C.teal);
}

function quarry(model: Architecture): void {
  const b = model.stone;
  plinth(b);
  block(b, 0.1, 0.205, -0.18, 0.94, 0.28, 0.76, C.sandstone, 0.075);
  block(b, 0.19, 0.43, -0.3, 0.77, 0.24, 0.52, C.limestone, 0.07);
  block(b, 0.28, 0.62, -0.38, 0.6, 0.16, 0.37, C.ivory, 0.045);
  for (let cut = 0; cut < 3; cut += 1) {
    b.box(-0.16 + cut * 0.26, 0.558, -0.29, 0.012, 0.006, 0.45, C.shade);
    b.box(-0.16 + cut * 0.26, 0.431, -0.032, 0.012, 0.24, 0.012, C.shade);
  }
  for (const z of [-0.19, 0.28]) b.beam([-0.45, 0.085, z], [-0.37, 0.94, 0.02], 0.035, C.timber, 5);
  b.beam([-0.4, 0.91, 0.02], [0.31, 1.005, 0.02], 0.034, C.timber, 5);
  b.beam([-0.4, 0.5, 0.02], [0.2, 0.99, 0.02], 0.018, C.timberLight, 5);
  b.cylinder(0.26, 0.965, 0.02, 0.055, 0.055, 0.045, C.brass, 8, [Math.PI / 2, 0, 0]);
  b.beam([0.26, 0.95, 0.02], [0.26, 0.62, 0.02], 0.009, C.timberLight, 4);
  block(b, 0.26, 0.52, 0.02, 0.23, 0.18, 0.21, C.ivory, 0.02);
  b.box(0.26, 0.52, 0.02, 0.022, 0.205, 0.232, C.timber);
  for (const x of [-0.33, -0.095, 0.14]) block(b, x, 0.14, 0.41, 0.185, 0.14, 0.2, x < 0 ? C.ivory : C.limestone, 0.013);
  b.beam([0.44, 0.09, 0.3], [0.39, 0.57, 0.29], 0.012, C.timber, 5);
  b.beam([0.29, 0.56, 0.29], [0.52, 0.6, 0.29], 0.018, C.steel, 4);
  jar(b, -0.5, 0.075, 0.46, 0.6);
}

function gardenBoundary(batch: SolidBatch): void {
  block(batch, 0, 0.035, 0, 1.14, 0.07, 1.14, C.shade, 0.045);
  batch.box(0, 0.08, 0, 1.025, 0.04, 1.025, C.soil);
  for (const sign of [-1, 1]) {
    batch.box(sign * 0.545, 0.115, 0, 0.075, 0.12, 1.1, C.limestone);
    batch.box(0, 0.115, sign * 0.545, 1.1, 0.12, 0.075, C.limestone);
    for (const z of [-0.545, 0.545]) block(batch, sign * 0.545, 0.19, z, 0.09, 0.18, 0.09, C.ivory, 0.014);
  }
}

function farm(model: Architecture): void {
  const b = model.stone;
  gardenBoundary(b);
  // A date orchard, not a vegetable plot: three miniature palms with pinnate
  // fronds, fruit bunches and individual irrigation basins. Crowns stay in-tile.
  b.box(-0.45, 0.114, 0, 0.055, 0.019, 0.98, C.shade);
  model.glaze.box(-0.45, 0.127, 0, 0.034, 0.01, 0.97, C.water);
  for (const z of [-0.22, 0.27]) {
    b.box(-0.075, 0.114, z, 0.77, 0.019, 0.055, C.shade);
    model.glaze.box(-0.075, 0.127, z, 0.75, 0.01, 0.029, C.water);
  }
  const palms = [[-0.25, -0.24, 1.31, 0.25], [0.25, -0.20, 1.23, 1.7], [0.02, 0.26, 1.17, 0.9]] as const;
  for (const [x, z, crownY, seed] of palms) {
    b.cylinder(x, 0.12, z, 0.135, 0.135, 0.025, C.timberLight, 12);
    b.add(new THREE.TorusGeometry(0.145, 0.019, 4, 12), C.limestone, [x, 0.143, z], [Math.PI / 2, 0, 0]);
    model.glaze.add(new THREE.TorusGeometry(0.115, 0.01, 4, 12), C.water, [x, 0.141, z], [Math.PI / 2, 0, 0]);
    const leanX = Math.sin(seed) * 0.025, leanZ = Math.cos(seed) * 0.02;
    const trunkPoint = (t: number): Point => [x + leanX * t * t, 0.12 + (crownY - 0.12) * t, z + leanZ * t * t];
    for (let segment = 0; segment < 4; segment += 1) b.beam(trunkPoint(segment / 4), trunkPoint((segment + 1) / 4), 0.035 - segment * 0.0045, C.timber, 7);
    for (let ring = 0; ring < 7; ring += 1) {
      const t = (ring + 0.5) / 7, point = trunkPoint(t);
      b.cylinder(point[0], point[1], point[2], 0.038 - t * 0.017, 0.042 - t * 0.017, 0.023, ring % 2 ? C.timberLight : C.shade, 7);
    }
    const crown = trunkPoint(1);
    for (let frond = 0; frond < 8; frond += 1) {
      const angle = frond * TAU / 8 + seed, dx = Math.sin(angle), dz = Math.cos(angle);
      const length = 0.29 + frond % 2 * 0.025;
      const rib = (t: number): Point => [crown[0] + dx * length * t, crownY + Math.sin(t * Math.PI) * 0.105 - t * 0.095, crown[2] + dz * length * t];
      for (let segment = 0; segment < 3; segment += 1) b.beam(rib(segment / 3), rib((segment + 1) / 3), 0.005, C.leaf, 4);
      // Separated leaflets leave light between them and read as date-palm fronds.
      for (let leaflet = 0; leaflet < 5; leaflet += 1) {
        const t = 0.15 + leaflet * 0.145, root = rib(t), next = rib(Math.min(1, t + 0.16));
        const width = (0.055 - leaflet * 0.006) * (frond % 2 ? 0.93 : 1);
        for (const side of [-1, 1]) {
          const tip: Point = [root[0] + dx * 0.042 + dz * width * side, root[1] - 0.025, root[2] + dz * 0.042 - dx * width * side];
          b.triangle(root, tip, next, (leaflet + frond) % 3 ? C.leaf : C.leafLight);
        }
      }
      b.triangle(rib(0.77), [rib(0.84)[0] + dz * 0.019, rib(0.84)[1], rib(0.84)[2] - dx * 0.019], rib(1), C.leafLight);
    }
    for (let bunch = 0; bunch < 3; bunch += 1) {
      const angle = bunch * TAU / 3 + seed, bx = crown[0] + Math.sin(angle) * 0.055, bz = crown[2] + Math.cos(angle) * 0.055;
      b.beam(crown, [bx, crownY - 0.105, bz], 0.005, C.grain, 4);
      for (let fruit = 0; fruit < 5; fruit += 1) b.add(new THREE.IcosahedronGeometry(0.024, 0), fruit % 2 ? C.terracotta : C.grain, [bx + (fruit % 2 - 0.5) * 0.03, crownY - 0.12 - Math.floor(fruit / 2) * 0.028, bz + (fruit % 3 - 1) * 0.017], [0, seed, 0.13], [0.83, 1.3, 0.8]);
    }
  }
  // Low wicker baskets make the crop readable even while the crowns overlap.
  for (const [x, z] of [[-0.30, 0.39], [0.37, 0.39]] as const) {
    b.cylinder(x, 0.175, z, 0.092, 0.066, 0.14, C.timberLight, 10);
    for (const y of [0.13, 0.18, 0.24]) b.add(new THREE.TorusGeometry(0.069 + (y - 0.13) * 0.21, 0.006, 4, 10), C.grainLight, [x, y, z], [Math.PI / 2, 0, 0]);
    b.cylinder(x, 0.243, z, 0.08, 0.08, 0.01, C.timber, 10);
    for (let fruit = 0; fruit < 8; fruit += 1) {
      const angle = fruit * 2.4, radius = fruit < 3 ? 0.02 : 0.055;
      b.add(new THREE.IcosahedronGeometry(0.021, 0), fruit % 3 ? C.terracotta : C.terracottaLight, [x + Math.cos(angle) * radius, 0.257 + fruit % 2 * 0.012, z + Math.sin(angle) * radius], [0.35, angle, 0.7], [0.8, 1.4, 0.7]);
    }
  }
}

function wheatFarm(model: Architecture): void {
  const b = model.stone;
  gardenBoundary(b);
  for (let row = 0; row < 4; row += 1) {
    const x = -0.36 + row * 0.24;
    b.box(x, 0.113, 0, 0.065, 0.036, 0.9, C.timberLight);
    for (let plant = 0; plant < 5; plant += 1) {
      const z = -0.38 + plant * 0.18, height = 0.37 + (plant + row) % 3 * 0.035;
      b.beam([x, 0.12, z], [x + 0.013, height, z], 0.009, C.grain, 4);
      for (const side of [-1, 1]) {
        b.beam([x, 0.22, z], [x + side * 0.045, height - 0.025, z + 0.018], 0.006, C.grain, 4);
        b.add(new THREE.IcosahedronGeometry(0.038, 0), side < 0 ? C.grain : C.grainLight, [x + side * 0.045, height + 0.033, z + 0.018], [0, 0, side * -0.18], [0.54, 1.65, 0.5]);
      }
      b.add(new THREE.IcosahedronGeometry(0.04, 0), C.grainLight, [x + 0.013, height + 0.08, z], [0, 0, -0.08], [0.53, 1.7, 0.5]);
    }
  }
  model.glaze.box(0.495, 0.106, 0, 0.029, 0.01, 0.96, C.water);
  // A tiny straw-hatted scarecrow marks the wheat field without a tall flag.
  b.beam([-0.43, 0.08, 0.43], [-0.43, 0.7, 0.43], 0.014, C.timber, 5);
  b.beam([-0.55, 0.52, 0.43], [-0.31, 0.52, 0.43], 0.012, C.timber, 5);
  b.box(-0.43, 0.465, 0.43, 0.13, 0.19, 0.04, C.ivory);
  b.add(new THREE.IcosahedronGeometry(0.052, 0), C.grainLight, [-0.43, 0.63, 0.43]);
  b.cylinder(-0.43, 0.679, 0.43, 0.08, 0.08, 0.018, C.grain, 9);
  b.cylinder(-0.43, 0.703, 0.43, 0.04, 0.05, 0.045, C.grainLight, 9);
}

function mill(model: Architecture): void {
  const b = model.stone;
  plinth(b, 1.09, 1.09);
  b.cylinder(0, 0.66, -0.035, 0.32, 0.41, 1.17, C.limestone, 12);
  b.cylinder(0, 0.13, -0.035, 0.425, 0.445, 0.14, C.shade, 12);
  for (const side of [-1, 1]) block(b, side * 0.33, 0.37, -0.005, 0.14, 0.59, 0.42, C.ivory, 0.024);
  b.cylinder(0, 0.8, -0.035, 0.365, 0.365, 0.055, C.shade, 12);
  b.cylinder(0, 1.235, -0.035, 0.36, 0.36, 0.085, C.ivory, 12);
  door(b, [0, 0.078, 0.374], 0.22, 0.49);
  windowNiche(b, [-0.26, 0.89, 0.225], 0.1, 0.23, -0.65);
  dome(model, 0, 1.29, -0.035, 0.335, 0.22);
  sack(b, -0.38, 0.075, 0.34, 0.85); sack(b, 0.37, 0.075, 0.32, 0.72);
  const sails = new SolidBatch();
  for (let blade = 0; blade < 4; blade += 1) {
    const angle = blade * Math.PI / 2, dx = Math.sin(angle), dy = Math.cos(angle);
    sails.beam([0, 0, 0], [dx * 0.56, dy * 0.56, 0], 0.013, C.timber, 5);
    for (let slat = 0; slat < 5; slat += 1) {
      const distance = 0.19 + slat * 0.079;
      sails.add(new THREE.BoxGeometry(0.155, 0.058, 0.018), slat < 2 ? C.grainLight : C.teal, [dx * distance, dy * distance, 0.025], [0, 0, -angle]);
    }
    for (const edge of [-1, 1]) sails.beam([dx * 0.15 + dy * edge * 0.075, dy * 0.15 - dx * edge * 0.075, 0.023], [dx * 0.54 + dy * edge * 0.075, dy * 0.54 - dx * edge * 0.075, 0.023], 0.006, C.timberLight, 4);
  }
  sails.cylinder(0, 0, 0.03, 0.062, 0.062, 0.13, C.timber, 10, [Math.PI / 2, 0, 0]);
  sails.cylinder(0, 0, 0.105, 0.027, 0.027, 0.025, C.brass, 8, [Math.PI / 2, 0, 0]);
  model.part(sails, "mill-sails", "stone", [0, 1.18, 0.435]);
}

function bakery(model: Architecture): void {
  const b = model.stone;
  plinth(b);
  courses(b, 0.20, -0.27, 0.65, 0.69, 0.56, 0.075);
  parapet(b, 0.20, 0.775, -0.27, 0.67, 0.57, 0.07);
  door(b, [0.28, 0.09, 0.019], 0.19, 0.43);
  block(b, 0.32, 0.97, -0.365, 0.17, 0.43, 0.18, C.shade, 0.018);
  block(b, 0.32, 1.188, -0.365, 0.23, 0.09, 0.24, C.ivory, 0.012);
  b.box(0.32, 1.238, -0.365, 0.12, 0.008, 0.13, C.dark);
  const chimneyOutlet = new THREE.Object3D();
  chimneyOutlet.name = "chimney-outlet";
  chimneyOutlet.position.set(0.32, 1.25, -0.365);
  model.group.add(chimneyOutlet);
  // Low terracotta bread oven, with a pale curved shell and visible hearth.
  b.cylinder(-0.26, 0.24, 0.075, 0.275, 0.3, 0.32, C.terracotta, 14);
  b.add(new THREE.SphereGeometry(0.282, 16, 8, 0, TAU, 0, Math.PI / 2), C.limestone, [-0.26, 0.37, 0.075], [0, 0, 0], [1, 0.88, 1]);
  archFill(b, [-0.26, 0.15, 0.347], 0.23, 0.27, 0.026, C.dark);
  archFrame(b, [-0.26, 0.15, 0.362], 0.23, 0.27, 0.045, 0.05, C.ivory);
  model.ember.box(-0.26, 0.171, 0.38, 0.18, 0.029, 0.016, "#ec9a43");
  for (const x of [0.15, 0.43]) b.box(x, 0.21, 0.375, 0.033, 0.31, 0.033, C.timber);
  b.box(0.29, 0.4, 0.375, 0.46, 0.065, 0.255, C.timberLight);
  for (let loaf = 0; loaf < 4; loaf += 1) {
    const x = 0.13 + loaf % 2 * 0.19, z = 0.322 + Math.floor(loaf / 2) * 0.11;
    b.add(new THREE.SphereGeometry(0.064, 9, 6), loaf % 2 ? C.grainLight : C.grain, [x, 0.454, z], [0, 0.15, 0], [1.1, 0.54, 0.67]);
    for (const groove of [-0.026, 0.026]) b.box(x + groove, 0.483, z, 0.01, 0.007, 0.062, C.ivory, -0.23);
  }
  b.beam([-0.52, 0.07, -0.28], [-0.44, 0.71, -0.33], 0.012, C.timberLight, 5);
  b.box(-0.445, 0.63, -0.325, 0.13, 0.15, 0.017, C.timberLight);
  sack(b, -0.46, 0.075, -0.44, 0.7);
  b.box(0.39, 0.572, 0.077, 0.165, 0.11, 0.02, C.teal);
  b.add(new THREE.SphereGeometry(0.061, 8, 5), C.grainLight, [0.39, 0.575, 0.1], [0, 0, 0], [1, 0.48, 0.3]);
}

function ironMine(model: Architecture): void {
  const b = model.stone;
  plinth(b);
  groundedRock(b, 0.015, 0.35, -0.13, 0.59, "#8e9587", [0.94, 0.94, 0.68], 0.16);
  groundedRock(b, -0.32, 0.27, -0.30, 0.31, C.sandstone, [0.75, 0.98, 0.75], -0.27);
  groundedRock(b, 0.28, 0.25, -0.27, 0.31, "#777f77", [0.81, 0.86, 0.72], 0.32);
  archFill(b, [0, 0.075, 0.19], 0.48, 0.59, 0.025, C.dark);
  archFrame(b, [0, 0.075, 0.208], 0.48, 0.59, 0.059, 0.08, C.shade);
  for (const x of [-0.293, 0.293]) {
    b.box(x, 0.4, 0.237, 0.07, 0.65, 0.08, C.timber);
    b.beam([x * 1.37, 0.08, 0.31], [x, 0.52, 0.238], 0.019, C.timberLight, 5);
  }
  b.box(0, 0.742, 0.237, 0.68, 0.085, 0.11, C.timberLight);
  for (const x of [-0.12, 0.12]) b.box(x, 0.097, 0.375, 0.022, 0.025, 0.42, C.steel);
  for (const z of [0.24, 0.38, 0.52]) b.box(0, 0.083, z, 0.36, 0.024, 0.044, C.timber);
  b.box(0.095, 0.245, 0.4, 0.31, 0.205, 0.25, C.timber);
  for (const x of [-0.085, 0.275]) for (const z of [0.32, 0.48]) b.cylinder(x, 0.145, z, 0.057, 0.057, 0.029, C.steel, 8, [0, 0, Math.PI / 2]);
  for (let ore = 0; ore < 5; ore += 1) b.rock(0.01 + ore % 3 * 0.08, 0.365, 0.355 + Math.floor(ore / 3) * 0.09, 0.059, ore % 2 ? C.steel : "#566f71", [1, 0.72, 1], ore);
  for (const [x, y, z] of [[0.39, 0.42, 0.04], [-0.38, 0.37, -0.035], [0.17, 0.71, -0.14]]) b.rock(x, y, z, 0.058, C.steel, [0.85, 0.75, 0.45], x * 4);
  lantern(b, [-0.41, 0.59, 0.26], 0.75);
}

function blacksmith(model: Architecture): void {
  const b = model.stone;
  plinth(b);
  courses(b, -0.32, -0.27, 0.4, 0.52, 0.49, 0.075);
  archFill(b, [-0.32, 0.24, -0.01], 0.245, 0.27, 0.021, C.dark);
  archFrame(b, [-0.32, 0.23, 0.008], 0.245, 0.29, 0.037, 0.042, C.ivory);
  model.ember.box(-0.32, 0.279, 0.041, 0.197, 0.054, 0.014, "#ef9340");
  block(b, -0.32, 0.82, -0.315, 0.205, 0.51, 0.225, C.terracotta, 0.018);
  for (const y of [0.66, 0.84, 1.03]) block(b, -0.32, y, -0.315, 0.232, 0.047, 0.249, C.ivory, 0.014);
  block(b, -0.32, 1.099, -0.315, 0.278, 0.088, 0.29, C.limestone, 0.018);
  b.box(-0.32, 1.148, -0.315, 0.148, 0.009, 0.16, C.dark);
  const chimneyOutlet = new THREE.Object3D();
  chimneyOutlet.name = "chimney-outlet";
  chimneyOutlet.position.set(-0.32, 1.16, -0.315);
  model.group.add(chimneyOutlet);
  awning(b, 0.14, 0.87, 0.015, 0.76, 0.85, 5, C.tealShade);
  b.cylinder(0.14, 0.2, 0.27, 0.127, 0.155, 0.25, C.timber, 9);
  b.box(0.14, 0.393, 0.27, 0.215, 0.13, 0.115, C.steel);
  b.box(0.14, 0.477, 0.27, 0.3, 0.065, 0.155, C.steel);
  b.cylinder(0.335, 0.466, 0.27, 0, 0.054, 0.17, C.steel, 7, [0, 0, -Math.PI / 2]);
  b.box(0.08, 0.522, 0.267, 0.025, 0.024, 0.17, C.timberLight, -0.4);
  b.box(0.08, 0.544, 0.19, 0.089, 0.052, 0.05, C.dark, -0.4);
  for (const x of [0.015, 0.43]) b.box(x, 0.37, -0.45, 0.037, 0.59, 0.04, C.timber);
  b.box(0.222, 0.58, -0.45, 0.49, 0.05, 0.058, C.timberLight);
  for (const x of [0.08, 0.24, 0.39]) sword(b, x, 0.30, -0.415, 0.83);
  shield(b, -0.42, 0.255, 0.38, 0.115);
  barrel(b, 0.445, 0.075, 0.435, 0.71);
  lantern(b, [-0.17, 0.75, 0.13], 0.65);
}

function well(model: Architecture): void {
  const b = model.stone;
  b.cylinder(0, 0.039, 0, 0.52, 0.56, 0.078, C.shade, 12);
  b.cylinder(0, 0.086, 0, 0.47, 0.51, 0.038, C.ivory, 12);
  const rim = new THREE.Shape();
  rim.absarc(0, 0, 0.34, 0, TAU, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.247, 0, TAU, true); rim.holes.push(hole);
  const curb = new THREE.ExtrudeGeometry(rim, { depth: 0.25, bevelEnabled: false, curveSegments: 8 });
  curb.rotateX(-Math.PI / 2);
  b.add(curb, C.limestone, [0, 0.105, 0]);
  for (let stone = 0; stone < 12; stone += 1) {
    const a = stone * TAU / 12;
    b.box(Math.sin(a) * 0.304, 0.383, Math.cos(a) * 0.304, 0.151, 0.062, 0.104, stone % 3 ? C.ivory : C.shade, a);
  }
  model.glaze.cylinder(0, 0.272, 0, 0.245, 0.245, 0.01, C.water, 24);
  for (const x of [-0.275, 0.275]) for (const z of [-0.225, 0.225]) {
    b.cylinder(x, 0.56, z, 0.029, 0.038, 0.93, C.limestone, 8);
    b.cylinder(x, 0.865, z, 0.055, 0.04, 0.07, C.ivory, 8);
  }
  b.box(0, 0.92, 0, 0.69, 0.082, 0.61, C.ivory);
  dome(model, 0, 0.97, 0, 0.367, 0.28);
  b.beam([-0.27, 0.72, 0], [0.27, 0.72, 0], 0.025, C.timber, 7);
  b.beam([0, 0.73, 0], [0, 0.452, 0], 0.007, C.timberLight, 4);
  b.cylinder(0, 0.447, 0, 0.055, 0.044, 0.105, C.timberLight, 8);
  b.add(new THREE.TorusGeometry(0.053, 0.008, 4, 8), C.steel, [0, 0.498, 0], [Math.PI / 2, 0, 0]);
  jar(b, -0.39, 0.08, 0.34, 0.75); jar(b, 0.41, 0.08, 0.27, 0.64, C.tealShade);
  block(b, 0.05, 0.097, 0.459, 0.36, 0.04, 0.23, C.ivory, 0.016);
}

function granary(model: Architecture): void {
  const b = model.stone;
  plinth(b);
  courses(b, 0, -0.205, 0.96, 0.50, 0.65, 0.075);
  for (const x of [-0.255, 0.255]) {
    b.cylinder(x, 0.68, -0.205, 0.207, 0.25, 0.63, C.limestone, 12);
    b.cylinder(x, 0.952, -0.205, 0.239, 0.239, 0.09, C.ivory, 12);
    b.add(new THREE.SphereGeometry(0.227, 14, 7, 0, TAU, 0, Math.PI / 2), C.ivory, [x, 0.984, -0.205], [0, 0, 0], [1, 0.68, 1]);
    b.cylinder(x, 1.135, -0.205, 0.042, 0.052, 0.04, C.terracotta, 8);
    windowNiche(b, [x, 0.707, 0.01], 0.085, 0.185);
  }
  door(b, [-0.1, 0.085, 0.132], 0.265, 0.39);
  awning(b, 0.075, 0.575, 0.345, 0.69, 0.345, 5, C.tealShade);
  for (const [x, z, scale] of [[-0.44, 0.35, 0.98], [-0.235, 0.43, 0.8], [0.335, 0.37, 0.99]]) sack(b, x, 0.075, z, scale);
  jar(b, 0.445, 0.075, 0.07, 0.85, C.terracottaLight);
  // A loading ladder and sealed grain marks differentiate the twin silos.
  for (const x of [0.40, 0.52]) b.beam([x, 0.085, -0.02], [x, 1.01, -0.235], 0.012, C.timber, 5);
  for (let rung = 0; rung < 6; rung += 1) b.box(0.46, 0.17 + rung * 0.14, -0.04 - rung * 0.032, 0.15, 0.016, 0.02, C.timberLight);
  b.box(-0.355, 0.48, 0.145, 0.10, 0.15, 0.019, C.teal);
  b.beam([-0.355, 0.43, 0.16], [-0.355, 0.53, 0.16], 0.007, C.brass, 4);
}

function barracks(model: Architecture): void {
  const b = model.stone;
  plinth(b);
  courses(b, 0.13, -0.18, 0.8, 0.83, 0.71, 0.075);
  parapet(b, 0.13, 0.91, -0.18, 0.82, 0.72, 0.12);
  courses(b, -0.415, -0.3, 0.26, 0.99, 0.47, 0.075);
  parapet(b, -0.415, 1.075, -0.3, 0.28, 0.47, 0.12);
  door(b, [0.1, 0.085, 0.184], 0.30, 0.58);
  shield(b, 0.38, 0.69, 0.202, 0.13);
  windowNiche(b, [0.531, 0.49, -0.24], 0.095, 0.27, Math.PI / 2);
  for (const x of [-0.43, -0.265, -0.10]) {
    b.beam([x, 0.085, 0.36], [x + 0.025, 0.84, 0.29], 0.009, C.timber, 5);
    b.add(new THREE.ConeGeometry(0.031, 0.12, 4), C.steel, [x + 0.027, 0.88, 0.282], [0.07, Math.PI / 4, 0], [0.7, 1, 0.7]);
  }
  for (const x of [-0.44, -0.10]) b.box(x, 0.31, 0.385, 0.027, 0.42, 0.032, C.timber);
  b.box(-0.27, 0.42, 0.385, 0.39, 0.04, 0.045, C.timberLight);
  crate(b, 0.4, 0.075, 0.43, 0.22);
  b.box(0.13, 0.09, 0.39, 0.19, 0.025, 0.30, C.tealShade);
  for (const z of [0.277, 0.51]) b.box(0.13, 0.108, z, 0.195, 0.012, 0.013, C.brass);
  banner(model, -0.425, 1.395, -0.3, 0.3, 0.175);
  lantern(b, [-0.13, 0.63, 0.219], 0.65);
}

function archery(model: Architecture): void {
  const b = model.stone;
  plinth(b);
  courses(b, 0, -0.445, 1.04, 0.54, 0.15, 0.075);
  parapet(b, 0, 0.627, -0.445, 1.065, 0.18, 0.065);
  for (const x of [-0.35, 0, 0.35]) {
    for (const side of [-1, 1]) b.beam([x + side * 0.073, 0.08, -0.16], [x, 0.48, -0.28], 0.017, C.timber, 5);
    b.cylinder(x, 0.45, -0.268, 0.145, 0.145, 0.045, C.timberLight, 14, [Math.PI / 2, 0, 0]);
    b.cylinder(x, 0.45, -0.239, 0.132, 0.132, 0.018, C.ivory, 14, [Math.PI / 2, 0, 0]);
    b.cylinder(x, 0.45, -0.226, 0.093, 0.093, 0.014, C.teal, 14, [Math.PI / 2, 0, 0]);
    b.cylinder(x, 0.45, -0.216, 0.052, 0.052, 0.014, C.grainLight, 14, [Math.PI / 2, 0, 0]);
    b.cylinder(x, 0.45, -0.207, 0.021, 0.021, 0.01, C.terracotta, 10, [Math.PI / 2, 0, 0]);
    b.box(x, 0.093, 0.15, 0.033, 0.013, 0.56, C.ivory);
  }
  awning(b, 0, 0.845, -0.415, 1.085, 0.275, 9, C.teal, false);
  for (const x of [-0.505, 0.505]) b.box(x, 0.48, -0.405, 0.038, 0.81, 0.04, C.timber);
  b.beam([-0.325, 0.462, -0.195], [-0.26, 0.478, 0.115], 0.006, C.timberLight, 5);
  b.triangle([-0.26, 0.478, 0.10], [-0.283, 0.5, 0.07], [-0.24, 0.496, 0.07], C.ivory);
  // Bow rack and arrow basket occupy the sides of the shooting lanes.
  for (const x of [-0.46, -0.29]) b.box(x, 0.28, 0.355, 0.023, 0.4, 0.028, C.timber);
  b.box(-0.375, 0.44, 0.355, 0.23, 0.025, 0.031, C.timberLight);
  for (const x of [-0.425, -0.325]) {
    b.add(new THREE.TorusGeometry(0.111, 0.012, 5, 16, Math.PI * 1.14), C.timberLight, [x, 0.29, 0.388], [0, 0, -Math.PI * 0.07], [0.58, 1.22, 1]);
    b.beam([x, 0.16, 0.389], [x, 0.42, 0.389], 0.003, C.ivory, 3);
  }
  b.cylinder(0.43, 0.21, 0.4, 0.082, 0.067, 0.26, C.timber, 9);
  for (const [dx, dz] of [[-0.03, 0], [0.015, 0.02], [0.027, -0.02]]) {
    b.beam([0.43 + dx, 0.1, 0.4 + dz], [0.43 + dx, 0.55, 0.4 + dz], 0.005, C.timberLight, 4);
    b.box(0.43 + dx, 0.51, 0.4 + dz, 0.014, 0.045, 0.012, C.ivory);
  }
}

function stableHorse(batch: SolidBatch, x: number, z: number, color: THREE.ColorRepresentation): void {
  batch.add(new THREE.SphereGeometry(0.14, 10, 6), color, [x, 0.335, z - 0.06], [0, 0, 0], [0.76, 0.96, 1.53]);
  batch.add(new THREE.CylinderGeometry(0.071, 0.102, 0.3, 8), color, [x, 0.46, z + 0.105], [-0.32, 0, 0]);
  batch.add(new THREE.SphereGeometry(0.085, 9, 6), color, [x, 0.6, z + 0.17], [0.3, 0, 0], [0.75, 0.9, 1.55]);
  batch.add(new THREE.SphereGeometry(0.061, 8, 5), C.timberLight, [x, 0.555, z + 0.254], [0, 0, 0], [0.92, 0.67, 1.12]);
  for (const side of [-1, 1]) {
    batch.add(new THREE.ConeGeometry(0.021, 0.105, 5), color, [x + side * 0.038, 0.708, z + 0.117], [-0.1, 0, side * 0.12]);
    batch.add(new THREE.SphereGeometry(0.009, 6, 4), C.dark, [x + side * 0.062, 0.627, z + 0.208]);
    for (const dz of [-0.19, 0.05]) batch.box(x + side * 0.073, 0.174, z + dz, 0.033, 0.225, 0.044, color);
  }
  batch.box(x, 0.594, z + 0.249, 0.121, 0.015, 0.018, C.brass);
  batch.box(x, 0.479, z - 0.08, 0.21, 0.024, 0.16, C.teal);
  batch.box(x, 0.642, z + 0.085, 0.032, 0.12, 0.07, C.timber);
}

function stable(model: Architecture): void {
  const b = model.stone;
  plinth(b);
  courses(b, 0, -0.454, 1.08, 0.72, 0.13, 0.075);
  for (const x of [-0.505, 0.505]) courses(b, x, -0.05, 0.115, 0.65, 0.84, 0.075);
  for (const x of [-0.35, 0, 0.35]) archFrame(b, [x, 0.075, 0.354], 0.245, 0.66, 0.047, 0.095, C.ivory);
  for (const x of [-0.34, 0, 0.34]) {
    const vault = new THREE.ExtrudeGeometry(archShape(0.355, 0.1775), { depth: 0.94, bevelEnabled: false, curveSegments: 12 });
    model.glaze.add(vault, x === 0 ? C.tealLight : C.teal, [x, 0.812, -0.53]);
    b.box(x, 0.811, -0.06, 0.37, 0.065, 0.975, C.ivory);
  }
  stableHorse(b, -0.31, 0.02, "#8b644b"); stableHorse(b, 0.28, -0.035, "#b6956f");
  for (const x of [-0.36, 0.36]) {
    b.box(x, 0.23, 0.409, 0.26, 0.17, 0.059, C.timberLight);
    b.box(x, 0.325, 0.409, 0.29, 0.035, 0.075, C.timber);
  }
  block(b, 0, 0.17, 0.49, 0.23, 0.19, 0.17, C.shade, 0.015);
  model.glaze.box(0, 0.27, 0.49, 0.176, 0.017, 0.12, C.water);
  b.cylinder(0.45, 0.215, -0.33, 0.115, 0.115, 0.22, C.grain, 10, [0, 0, Math.PI / 2]);
  for (const x of [0.385, 0.49]) b.add(new THREE.TorusGeometry(0.116, 0.009, 4, 10), C.timber, [x, 0.215, -0.33], [0, Math.PI / 2, 0]);
  lantern(b, [0.0, 0.69, 0.421], 0.65);
}

function siegeWorkshop(model: Architecture): void {
  const b = model.stone;
  plinth(b);
  // A vaulted stone workshop behind an open assembly apron.
  courses(b, 0, -0.47, 1.06, 0.76, 0.12, 0.075);
  for (const x of [-0.49, 0.49]) courses(b, x, -0.21, 0.12, 0.76, 0.52, 0.075);
  for (const x of [-0.325, 0, 0.325]) {
    archFrame(b, [x, 0.075, 0.07], 0.235, 0.70, 0.045, 0.10, C.ivory);
    const vault = new THREE.ExtrudeGeometry(archShape(0.34, 0.17), { depth: 0.65, bevelEnabled: false, curveSegments: 12 });
    model.glaze.add(vault, x === 0 ? C.tealLight : C.teal, [x, 0.86, -0.55]);
    b.box(x, 0.842, -0.225, 0.35, 0.055, 0.69, C.ivory);
  }
  // Workbench, brass lamp and a rack of timber and tools remain visible through the arcade.
  b.box(0, 0.36, -0.26, 0.66, 0.065, 0.23, C.timberLight);
  for (const x of [-0.27, 0.27]) for (const z of [-0.33, -0.19]) b.box(x, 0.21, z, 0.045, 0.27, 0.045, C.timber);
  model.glaze.box(0.08, 0.397, -0.245, 0.22, 0.01, 0.145, C.teal);
  b.box(0, 0.59, -0.397, 0.65, 0.045, 0.03, C.timberLight);
  for (const x of [-0.22, 0, 0.22]) {
    b.box(x, 0.52, -0.373, 0.02, 0.17, 0.025, C.timber);
    b.box(x, 0.59, -0.357, 0.085, 0.04, 0.04, C.steel);
  }
  lantern(b, [0, 0.73, 0.14], 0.55);
  crate(b, -0.34, 0.077, -0.22, 0.19);
  // Compact wheeled catapult: four iron-rimmed wheels, braced trestle, winch and throwing cup.
  const cx = -0.13;
  for (const x of [cx - 0.13, cx + 0.13]) b.box(x, 0.19, 0.34, 0.06, 0.07, 0.40, C.timberLight);
  for (const z of [0.20, 0.47]) {
    b.cylinder(cx, 0.175, z, 0.022, 0.022, 0.43, C.dark, 8, [0, 0, Math.PI / 2]);
    b.box(cx, 0.23, z, 0.30, 0.045, 0.06, C.timber);
    for (const x of [cx - 0.19, cx + 0.19]) {
      b.cylinder(x, 0.178, z, 0.10, 0.10, 0.045, C.dark, 12, [0, 0, Math.PI / 2]);
      b.cylinder(x + (x < cx ? -0.026 : 0.026), 0.178, z, 0.078, 0.078, 0.012, C.timberLight, 12, [0, 0, Math.PI / 2]);
    }
  }
  for (const x of [cx - 0.115, cx + 0.115]) {
    b.beam([x, 0.23, 0.17], [x, 0.44, 0.31], 0.025, C.timberLight, 4);
    b.beam([x, 0.23, 0.51], [x, 0.44, 0.31], 0.025, C.timberLight, 4);
  }
  b.cylinder(cx, 0.435, 0.31, 0.03, 0.03, 0.31, C.dark, 8, [0, 0, Math.PI / 2]);
  b.beam([cx, 0.27, 0.23], [cx, 0.63, 0.50], 0.034, C.timberLight, 4);
  b.add(new THREE.SphereGeometry(0.079, 10, 6, 0, TAU, Math.PI / 2, Math.PI / 2), C.dark, [cx, 0.65, 0.50]);
  b.add(new THREE.TorusGeometry(0.076, 0.012, 4, 10), C.steel, [cx, 0.65, 0.50], [Math.PI / 2, 0, 0]);
  b.cylinder(cx, 0.29, 0.20, 0.042, 0.042, 0.18, C.grain, 10, [0, 0, Math.PI / 2]);
  for (const [x, y, z] of [[0.32, 0.15, 0.37], [0.46, 0.15, 0.40], [0.39, 0.15, 0.50], [0.39, 0.26, 0.43]]) b.rock(x, y, z, 0.073, C.steel);
  for (const x of [0.32, 0.39, 0.46]) b.box(x, 0.28, 0.16, 0.045, 0.40, 0.05, C.timberLight);
  b.box(0.39, 0.20, 0.20, 0.23, 0.035, 0.035, C.dark);
}

const builders: Record<Exclude<BuildingKind, "wall">, Builder> = {
  keep, house, lumber, quarry, farm, wheatFarm, mill, bakery, ironMine,
  blacksmith, well, granary, market, tower, gate, barracks, archery, stable, siegeWorkshop,
};

/**
 * Geometry and materials are shared; transforms and animated parts are per entity.
 * `wall` intentionally stays with GameRenderer's connected-wall topology.
 */
export function createDesertBuilding(kind: BuildingKind, shadows = true): THREE.Group | null {
  if (kind === "wall") return null;
  const build = builders[kind];
  if (!build) return null;
  let prototype = prototypes.get(kind);
  if (!prototype) {
    const model = new Architecture(kind);
    build(model);
    prototype = model.finish();
    prototypes.set(kind, prototype);
  }
  const group = prototype.clone(true);
  group.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.castShadow = shadows;
      node.receiveShadow = shadows;
    }
  });
  return group;
}

/** Only call after every live architecture entity/thumbnail has been retired. */
export function disposeDesertArchitectureResources(): void {
  const geometries = new Set<THREE.BufferGeometry>();
  for (const prototype of prototypes.values()) prototype.traverse((node) => {
    if (node instanceof THREE.Mesh) geometries.add(node.geometry);
  });
  for (const geometry of geometries) geometry.dispose();
  prototypes.clear();
  if (sharedMaterials) for (const item of Object.values(sharedMaterials)) item.dispose();
  sharedMaterials = null;
}
