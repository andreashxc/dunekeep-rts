import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { TILE_SIZE } from "../../game/content";

export interface WallMaterials {
  body: THREE.Material;
  face: THREE.Material;
  cap: THREE.Material;
  shadow: THREE.Material;
  flame: THREE.Material;
}

export const WALL_WALK_HEIGHT = 1.14;
export const WALL_HEALTH_BAR_HEIGHT = 1.78;

/** The caller owns this palette; wall instances own only their geometries. */
export function createWallMaterials(enemy = false): WallMaterials {
  const materials = {
    body: new THREE.MeshStandardMaterial({ color: enemy ? "#b98577" : "#d6c29b", roughness: 0.96, flatShading: true }),
    face: new THREE.MeshStandardMaterial({ color: enemy ? "#d2a192" : "#eadab9", roughness: 0.92, flatShading: true }),
    cap: new THREE.MeshStandardMaterial({ color: enemy ? "#e4baaa" : "#f3e6c8", roughness: 0.9, flatShading: true }),
    shadow: new THREE.MeshStandardMaterial({ color: enemy ? "#785951" : "#9c8970", roughness: 1, flatShading: true }),
    flame: new THREE.MeshStandardMaterial({
      color: enemy ? "#ff7f54" : "#ffb145", emissive: enemy ? "#9f251d" : "#b84e16",
      emissiveIntensity: 2.2, roughness: 0.7,
    }),
  };
  for (const [name, material] of Object.entries(materials)) {
    material.name = `${enemy ? "enemy-" : ""}wall-${name}`;
    material.userData.shared = true;
  }
  return materials;
}

/**
 * Shared by the game and UI portrait renderer. Mask bits are N=1, E=2, S=4, W=8.
 * Preserve the simulation's tile spacing and garrison deck while batching all
 * masonry into four draws; a junction lamp is the only optional extra draw.
 */
export function createWallTopology(mask: number, materials: WallMaterials, options: { lowPower?: boolean } = {}): THREE.Group {
  const lowPower = options.lowPower ?? false;
  const topology = new THREE.Group();
  topology.name = "wall-topology";
  const geometryBuckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material): void => {
    const bucket = geometryBuckets.get(material) ?? [];
    bucket.push(geometry);
    geometryBuckets.set(material, bucket);
  };
  const addBox = (width: number, height: number, depth: number, x: number, y: number, z: number, material: THREE.Material): void => {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    geometry.translate(x, y, z);
    add(geometry, material);
  };
  const panel = (width: number, height: number, x: number, y: number, z: number, yaw: number): void => {
    const geometry = new THREE.PlaneGeometry(width, height);
    geometry.rotateY(yaw);
    geometry.translate(x, y, z);
    add(geometry, materials.shadow);
  };
  const masonry = (width: number, x: number, z: number, yaw: number): void => {
    const height = 0.96;
    const rows = 5;
    const course = height / rows;
    const block = 0.24;
    const joint = 0.004;
    const facePanel = (offset: number, y: number, w: number, h: number): void => {
      panel(w, h, x + Math.cos(yaw) * offset, y, z - Math.sin(yaw) * offset, yaw);
    };
    for (let row = 0; row < rows; row += 1) {
      const bottom = 0.01 + row * course;
      if (row) facePanel(0, bottom, width, joint);
      const stagger = row % 2 ? block / 2 : 0;
      for (let seam = -width / 2 + block + stagger; seam < width / 2 - 0.03; seam += block) {
        facePanel(seam, bottom + course / 2, joint, course);
      }
    }
  };

  const directions = [
    { bit: 1, x: 0, z: -1 }, { bit: 2, x: 1, z: 0 },
    { bit: 4, x: 0, z: 1 }, { bit: 8, x: -1, z: 0 },
  ];
  const active = directions.filter((direction) => (mask & direction.bit) !== 0);
  const isStraight = mask === (1 | 4) || mask === (2 | 8);
  const coreSize = active.length === 2 && !isStraight || active.length >= 3 || active.length === 0 ? 0.76 : 0.6;
  const coreHalf = coreSize * 0.5;

  addBox(coreSize, 0.98, coreSize, 0, 0.49, 0, materials.body);
  addBox(coreSize + 0.1, 0.14, coreSize + 0.1, 0, 1.01, 0, materials.face);
  addBox(coreSize - 0.06, 0.07, coreSize - 0.06, 0, WALL_WALK_HEIGHT - 0.035, 0, materials.cap);
  for (const direction of directions) {
    if (mask & direction.bit) continue;
    const yaw = direction.x ? direction.x * Math.PI / 2 : direction.z < 0 ? Math.PI : 0;
    masonry(coreSize, direction.x * (coreHalf + 0.001), direction.z * (coreHalf + 0.001), yaw);
  }

  const outer = TILE_SIZE * 0.5 + 0.065;
  for (const direction of active) {
    const start = Math.max(0.18, coreHalf - 0.055);
    const length = outer - start;
    const distance = start + length * 0.5;
    const alongX = direction.x !== 0;
    const width = alongX ? length : 0.58;
    const depth = alongX ? 0.58 : length;
    const x = direction.x * distance;
    const z = direction.z * distance;
    addBox(width + (alongX ? 0.06 : 0), 0.98, depth + (alongX ? 0 : 0.06), x, 0.49, z, materials.body);
    addBox(width + (alongX ? 0.09 : 0.1), 0.14, depth + (alongX ? 0.1 : 0.09), x, 1.01, z, materials.face);
    addBox(width + (alongX ? 0.06 : 0), 0.07, depth + (alongX ? 0 : 0.06), x, WALL_WALK_HEIGHT - 0.035, z, materials.cap);
    for (const side of [-1, 1]) {
      masonry(length + 0.06, alongX ? x : side * 0.291, alongX ? side * 0.291 : z,
        alongX ? side < 0 ? Math.PI : 0 : side * Math.PI / 2);
    }

    const merlonDistances = active.length <= 1 ? [outer - 0.08, Math.max(start + 0.04, outer - 0.4)] : [outer - 0.1];
    for (const merlonDistance of merlonDistances) {
      for (const side of [-1, 1]) {
        if (alongX) addBox(0.19, 0.27, 0.18, direction.x * merlonDistance, 1.255, side * 0.27, materials.cap);
        else addBox(0.18, 0.27, 0.19, side * 0.27, 1.255, direction.z * merlonDistance, materials.cap);
      }
    }
    if (active.length === 1) {
      addBox(alongX ? 0.13 : 0.72, 0.36, alongX ? 0.72 : 0.13, direction.x * outer, 0.42, direction.z * outer, materials.face);
    }
  }

  if (!isStraight || active.length === 0) {
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      addBox(0.2, 0.29, 0.2, x * (coreHalf - 0.08), 1.265, z * (coreHalf - 0.08), materials.cap);
    }
  } else {
    const alongX = mask === (2 | 8);
    for (const side of [-1, 1]) {
      addBox(alongX ? 0.2 : 0.18, 0.27, alongX ? 0.18 : 0.2, alongX ? 0 : side * 0.27, 1.255, alongX ? side * 0.27 : 0, materials.cap);
    }
  }

  if (active.length !== 2 || !isStraight) {
    addBox(coreSize + 0.035, 0.07, coreSize + 0.035, 0, 0.67, 0, materials.shadow);
    addBox(coreSize + 0.065, 0.055, coreSize + 0.065, 0, 0.705, 0, materials.face);
    if (!lowPower && active.length > 1) {
      const lamp = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), materials.flame);
      lamp.name = "wall-lamp";
      lamp.position.set(coreHalf - 0.03, 1.48, coreHalf - 0.03);
      topology.add(lamp);
      addBox(0.035, 0.42, 0.035, coreHalf - 0.03, 1.29, coreHalf - 0.03, materials.shadow);
    }
  }

  for (const [material, geometries] of geometryBuckets) {
    const geometry = mergeGeometries(geometries, false);
    for (const source of geometries) source.dispose();
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `wall-${Object.entries(materials).find(([, value]) => value === material)?.[0] ?? "masonry"}`;
    mesh.castShadow = !lowPower;
    mesh.receiveShadow = true;
    topology.add(mesh);
  }
  return topology;
}
