import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { TILE_SIZE } from "../../game/content";
import { garrisonDeckHeight } from "../../game/fortifications";
import { disposeEntity } from "../objects/EntityDisposal";
import { createDesertBuilding } from "./DesertArchitecture";
import { createWallMaterials, createWallTopology } from "./WallArchitecture";

const palettes: ReturnType<typeof createWallMaterials>[] = [];
const walls: THREE.Group[] = [];
function wall(mask: number, lowPower = false): THREE.Group {
  const palette = createWallMaterials();
  const result = createWallTopology(mask, palette, { lowPower });
  palettes.push(palette);
  walls.push(result);
  result.updateMatrixWorld(true);
  return result;
}
function meshes(group: THREE.Group): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  group.traverse((node) => { if (node instanceof THREE.Mesh) result.push(node); });
  return result;
}
function deckAt(group: THREE.Group, x: number, z: number): number | undefined {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0), 0, 3);
  return ray.intersectObject(group, true)[0]?.point.y;
}

afterEach(() => {
  for (const item of walls.splice(0)) disposeEntity(item);
  for (const palette of palettes.splice(0)) for (const material of Object.values(palette)) material.dispose();
});

describe("shared connected wall architecture", () => {
  it.each(Array.from({ length: 16 }, (_, mask) => mask))("mask %i preserves the garrison deck and covers every connected tile edge", (mask) => {
    const model = wall(mask);
    expect(deckAt(model, 0, 0)).toBeCloseTo(garrisonDeckHeight("wall"), 5);
    for (const [bit, dx, dz] of [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]]) {
      for (const distance of [TILE_SIZE / 2 - 0.01, TILE_SIZE / 2, TILE_SIZE / 2 + 0.02]) {
        const deck = deckAt(model, dx * distance, dz * distance);
        if (mask & bit) expect(deck).toBeCloseTo(garrisonDeckHeight("wall"), 5);
        else expect(deck).toBeUndefined();
      }
    }
    const bounds = new THREE.Box3().setFromObject(model);
    expect(bounds.min.y).toBeCloseTo(0, 6);
    for (const edge of [bounds.min.x, bounds.max.x, bounds.min.z, bounds.max.z]) {
      expect(Math.abs(edge)).toBeLessThan(0.756);
    }
  });

  it.each([5, 10])("straight mask %i forms a continuous walking surface between adjacent walls", (mask) => {
    const alongX = mask === 10;
    const first = wall(mask);
    const second = wall(mask);
    second.position.set(alongX ? TILE_SIZE : 0, 0, alongX ? 0 : TILE_SIZE);
    const row = new THREE.Group();
    row.add(first, second);
    row.updateMatrixWorld(true);
    for (let index = 0; index <= 40; index += 1) {
      const distance = -TILE_SIZE / 2 + index * TILE_SIZE * 2 / 40;
      expect(deckAt(row, alongX ? distance : 0, alongX ? 0 : distance)).toBeCloseTo(garrisonDeckHeight("wall"), 5);
    }
  });

  it.each([
    { kind: "gate", dx: 1, dz: 0, mask: 2 }, { kind: "gate", dx: -1, dz: 0, mask: 8 },
    { kind: "tower", dx: 1, dz: 0, mask: 2 }, { kind: "tower", dx: -1, dz: 0, mask: 8 },
    { kind: "tower", dx: 0, dz: 1, mask: 4 }, { kind: "tower", dx: 0, dz: -1, mask: 1 },
  ] as const)("retains stone overlap with the neighbouring $kind along ($dx, $dz)", ({ kind, dx, dz, mask }) => {
    const neighbour = createDesertBuilding(kind)!;
    walls.push(neighbour);
    neighbour.position.set(dx * TILE_SIZE, 0, dz * TILE_SIZE);
    neighbour.updateMatrixWorld(true);
    const connected = wall(mask);
    const wallBody = new THREE.Box3().setFromObject(connected.getObjectByName("wall-body")!);
    const end = dx ? dx < 0 ? -wallBody.min.x : wallBody.max.x : dz < 0 ? -wallBody.min.z : wallBody.max.z;
    for (const height of [0.32, 1.1]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(0, height, 0), new THREE.Vector3(dx, 0, dz), 0, 2);
      const hit = ray.intersectObject(neighbour, true)[0];
      expect(hit).toBeDefined();
      expect(hit.distance).toBeLessThan(end);
    }
  });

  it.each(Array.from({ length: 16 }, (_, mask) => mask))("mask %i batches masonry into four draws with an optional junction lamp", (mask) => {
    for (const lowPower of [false, true]) {
      const parts = meshes(wall(mask, lowPower));
      const masonry = parts.filter((part) => part.name !== "wall-lamp");
      expect(masonry).toHaveLength(4);
      expect(parts.length).toBeLessThanOrEqual(lowPower ? 4 : 5);
      let triangles = 0;
      for (const part of masonry) {
        const position = part.geometry.getAttribute("position");
        expect(position.count).toBeGreaterThan(0);
        expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
        expect(part.geometry.getAttribute("normal").count).toBe(position.count);
        expect(part.geometry.groups).toHaveLength(0);
        expect(Array.isArray(part.material)).toBe(false);
        expect(part.castShadow).toBe(!lowPower);
        expect(part.receiveShadow).toBe(true);
        triangles += (part.geometry.index?.count ?? position.count) / 3;
      }
      expect(triangles).toBeLessThan(1400);
    }
  });

  it("owns each instance geometry while keeping the shared palette alive on removal", () => {
    const palette = createWallMaterials();
    palettes.push(palette);
    const first = createWallTopology(10, palette);
    const second = createWallTopology(10, palette);
    walls.push(second);
    const firstMeshes = meshes(first);
    const secondMeshes = meshes(second);
    const released = firstMeshes.map((part) => vi.spyOn(part.geometry, "dispose"));
    const paletteReleased = Object.values(palette).map((material) => vi.spyOn(material, "dispose"));
    for (let index = 0; index < firstMeshes.length; index += 1) {
      expect(firstMeshes[index].geometry).not.toBe(secondMeshes[index].geometry);
      expect(firstMeshes[index].material).toBe(secondMeshes[index].material);
    }
    disposeEntity(first);
    for (const release of released) expect(release).toHaveBeenCalledOnce();
    for (const release of paletteReleased) expect(release).not.toHaveBeenCalled();
    expect(meshes(second)).toHaveLength(4);
  });
});
