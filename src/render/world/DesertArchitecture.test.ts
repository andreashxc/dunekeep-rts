import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { BUILDINGS } from "../../game/content";
import type { BuildingKind } from "../../game/types";
import { disposeEntity } from "../objects/EntityDisposal";
import { createDesertBuilding, disposeDesertArchitectureResources } from "./DesertArchitecture";

const kinds = (Object.keys(BUILDINGS) as BuildingKind[]).filter((kind) => kind !== "wall");

function meshes(group: THREE.Group): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  group.traverse((node) => { if (node instanceof THREE.Mesh) result.push(node); });
  return result;
}

function model(kind: BuildingKind): THREE.Group {
  const result = createDesertBuilding(kind);
  expect(result, kind).not.toBeNull();
  return result!;
}

describe("original unified desert architecture", () => {
  it("covers all nineteen non-wall kinds and leaves connected walls to the renderer", () => {
    expect(kinds).toHaveLength(19);
    for (const kind of kinds) {
      const group = model(kind);
      expect(group.userData.originalArchitecture).toBe(true);
      expect(group.userData.buildingKind).toBe(kind);
      expect(group.userData.front).toBe("+Z");
      expect(group.position.toArray()).toEqual([0, 0, 0]);
      expect(group.scale.toArray()).toEqual([1, 1, 1]);
    }
    expect(createDesertBuilding("wall")).toBeNull();
  }, 15_000);

  it.each(kinds)("%s stays within its tile and is grounded", (kind) => {
    const bounds = new THREE.Box3().setFromObject(model(kind));
    const half = kind === "keep" ? 1.25 : 0.611;
    expect(bounds.min.x, `${kind}: min X`).toBeGreaterThanOrEqual(-half);
    expect(bounds.max.x, `${kind}: max X`).toBeLessThanOrEqual(half);
    expect(bounds.min.z, `${kind}: min Z`).toBeGreaterThanOrEqual(-half);
    expect(bounds.max.z, `${kind}: max Z`).toBeLessThanOrEqual(half);
    expect(bounds.min.y, `${kind}: feet`).toBeGreaterThanOrEqual(-0.015);
    expect(bounds.min.y, `${kind}: floating`).toBeLessThan(0.08);
    expect(bounds.max.y).toBeGreaterThan(0.25);
    expect(bounds.max.y).toBeLessThan(3);
  });

  it.each(kinds)("%s uses at most three texture-free draws with valid merged attributes", (kind) => {
    const parts = meshes(model(kind));
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.length).toBeLessThanOrEqual(3);
    let triangles = 0;
    for (const part of parts) {
      const geometry = part.geometry;
      const position = geometry.getAttribute("position");
      expect(position.count).toBeGreaterThan(0);
      expect(geometry.getAttribute("normal").count).toBe(position.count);
      expect(geometry.getAttribute("color").count).toBe(position.count);
      expect(geometry.getAttribute("uv")).toBeUndefined();
      expect(geometry.groups).toHaveLength(0);
      expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
      expect(Array.from(geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
      expect(Array.from(geometry.getAttribute("color").array).every(Number.isFinite)).toBe(true);
      expect((part.material as THREE.MeshStandardMaterial).map).toBeNull();
      expect((part.material as THREE.MeshStandardMaterial).vertexColors).toBe(true);
      expect(geometry.userData.shared).toBe(true);
      expect((part.material as THREE.Material).userData.shared).toBe(true);
      triangles += (geometry.index?.count ?? position.count) / 3;
    }
    expect(triangles, `${kind} triangle count`).toBeLessThan(kind === "keep" ? 14000 : 7500);
  });

  it("keeps the broad citadel out of both initial diagonal neighbours", () => {
    for (const mesh of meshes(model("keep"))) {
      const position = mesh.geometry.getAttribute("position");
      for (let index = 0; index < position.count; index += 1) {
        const vertex = new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
        if (vertex.z > 0.625) expect(Math.abs(vertex.x)).toBeLessThanOrEqual(0.612);
      }
    }
  });

  it("keeps gate passage open while both piers join neighbouring walls", () => {
    const gate = model("gate");
    gate.updateMatrixWorld(true);
    const passage = new THREE.Raycaster(new THREE.Vector3(0, 0.34, -1), new THREE.Vector3(0, 0, 1), 0, 2);
    expect(passage.intersectObject(gate, true)).toHaveLength(0);
    for (const side of [-1, 1]) {
      const across = new THREE.Raycaster(new THREE.Vector3(side, 0.32, 0), new THREE.Vector3(-side, 0, 0), 0, 1);
      const hit = across.intersectObject(gate, true)[0];
      expect(hit).toBeDefined();
      expect(Math.abs(hit.point.x)).toBeGreaterThan(0.58);
    }
  });

  it("shows the citadel courtyard inlay above the structural floor", () => {
    const keep = model("keep");
    keep.updateMatrixWorld(true);
    const down = new THREE.Raycaster(new THREE.Vector3(0, 1, 0.2), new THREE.Vector3(0, -1, 0), 0, 2);
    const hit = down.intersectObject(keep, true)[0];
    expect(hit).toBeDefined();
    expect(hit.point.y).toBeCloseTo(0.154, 4);
  });

  it("adds inhabited upper storeys while keeping the citadel court open", () => {
    // Probe solid rooms, so a taller flag or finial cannot masquerade as a bigger building.
    const home = model("house");
    const upperHome = new THREE.Raycaster(new THREE.Vector3(-0.19, 1.2, 0.6), new THREE.Vector3(0, 0, -1), 0, 1.2);
    const homeHit = upperHome.intersectObject(home, true)[0];
    expect(homeHit).toBeDefined();
    expect(homeHit.point.z).toBeGreaterThan(-0.1);
    expect(homeHit.point.z).toBeLessThan(0);

    const citadel = model("keep");
    const upperHall = new THREE.Raycaster(new THREE.Vector3(0, 1.82, 0.2), new THREE.Vector3(0, 0, -1), 0, 0.8);
    const hallHit = upperHall.intersectObject(citadel, true)[0];
    expect(hallHit).toBeDefined();
    expect(hallHit.point.z).toBeGreaterThan(-0.26);
    expect(hallHit.point.z).toBeLessThan(-0.2);
    const court = new THREE.Raycaster(new THREE.Vector3(0, 0.45, 0.45), new THREE.Vector3(0, 0, -1), 0, 0.5);
    expect(court.intersectObject(citadel, true)).toHaveLength(0);
  });

  it("raises date-palm crowns above the workers without enlarging the planting tile", () => {
    const bounds = new THREE.Box3().setFromObject(model("farm"), true);
    expect(bounds.max.y).toBeGreaterThan(1.3);
    expect(bounds.max.y).toBeLessThan(1.45);
    expect(bounds.getSize(new THREE.Vector3()).x).toBeLessThanOrEqual(1.22);
    expect(bounds.getSize(new THREE.Vector3()).z).toBeLessThanOrEqual(1.22);
  });

  it("keeps a rotating mill wheel in its own tile at every angle", () => {
    const mill = model("mill");
    const sails = mill.getObjectByName("mill-sails")!;
    expect(sails).toBeDefined();
    for (let frame = 0; frame < 16; frame += 1) {
      sails.rotation.z = frame * Math.PI / 8;
      const bounds = new THREE.Box3().setFromObject(mill, true);
      expect(bounds.min.x).toBeGreaterThanOrEqual(-0.611);
      expect(bounds.max.x).toBeLessThanOrEqual(0.611);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.015);
    }
  });

  it("shares GPU data but keeps placement, banners and mill poses independent", () => {
    for (const kind of ["keep", "house", "mill", "barracks"] as const) {
      const first = model(kind), second = model(kind);
      const a = meshes(first), b = meshes(second);
      expect(a.length).toBe(b.length);
      for (let index = 0; index < a.length; index += 1) {
        expect(a[index]).not.toBe(b[index]);
        expect(a[index].geometry).toBe(b[index].geometry);
        expect(a[index].material).toBe(b[index].material);
      }
      const partName = kind === "mill" ? "mill-sails" : "banner-cloth";
      const firstPart = first.getObjectByName(partName);
      if (firstPart) {
        firstPart.rotation.z = 0.8;
        expect(second.getObjectByName(partName)!.rotation.z).toBeCloseTo(0, 10);
      }
      first.position.set(8, 0, 7);
      expect(second.position.toArray()).toEqual([0, 0, 0]);
    }
  });

  it("supports a low-power shadow setting without mutating other instances", () => {
    const low = createDesertBuilding("keep", false)!;
    const high = createDesertBuilding("keep", true)!;
    for (const mesh of meshes(low)) {
      expect(mesh.castShadow).toBe(false);
      expect(mesh.receiveShadow).toBe(false);
    }
    for (const mesh of meshes(high)) {
      expect(mesh.castShadow).toBe(true);
      expect(mesh.receiveShadow).toBe(true);
    }
  });

  it("protects cached resources during entity disposal and releases them only at teardown", () => {
    const first = model("house"), second = model("house");
    const mesh = meshes(first)[0];
    const geometryDisposal = vi.spyOn(mesh.geometry, "dispose");
    const materialDisposal = vi.spyOn(mesh.material as THREE.Material, "dispose");
    disposeEntity(first);
    expect(geometryDisposal).not.toHaveBeenCalled();
    expect(materialDisposal).not.toHaveBeenCalled();
    expect(meshes(second)[0].geometry).toBe(mesh.geometry);
    disposeDesertArchitectureResources();
    expect(geometryDisposal).toHaveBeenCalledOnce();
    expect(materialDisposal).toHaveBeenCalledOnce();
    const rebuilt = meshes(model("house"))[0];
    expect(rebuilt.geometry).not.toBe(mesh.geometry);
    expect(rebuilt.material).not.toBe(mesh.material);
  });
});
