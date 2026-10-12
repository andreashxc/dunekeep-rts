import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GRID_SIZE, MISSION_LIST } from "../../game/content";
import { WorldScenery } from "./WorldScenery";
import { createWorkshop } from "./BuildingWorkshop";
import { disposeEntity } from "../objects/EntityDisposal";
import type { BuildingKind } from "../../game/types";

function inspectGeometry(root: THREE.Object3D): { meshes: number; vertices: number } {
  let meshes = 0, vertices = 0;
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    meshes += 1;
    const position = node.geometry.getAttribute("position");
    vertices += position.count;
    expect([...position.array].every(Number.isFinite)).toBe(true);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material instanceof THREE.MeshStandardMaterial) {
        expect(material.map).toBeNull();
        expect(material.normalMap).toBeNull();
        expect(material.roughnessMap).toBeNull();
      }
    }
  });
  return { meshes, vertices };
}

describe("texture-free world scenery", () => {
  it.each(MISSION_LIST)("batches the $id environment into at most nine drawables", (mission) => {
    const scenery = new WorldScenery(mission.theme, mission.resourceZones, false);
    const stats = inspectGeometry(scenery.group);
    expect(stats.meshes).toBeLessThanOrEqual(9);
    expect(stats.vertices).toBeGreaterThan(1000);
    expect(stats.vertices).toBeLessThan(180_000);
    scenery.dispose();
  });

  it("does not advance ripples when simulation time is frozen", () => {
    const mission = MISSION_LIST[0];
    const scenery = new WorldScenery(mission.theme, mission.resourceZones, true);
    scenery.update(8.12);
    const before = scenery.group.children.map((node) => [...node.scale.toArray(), ...node.position.toArray()]);
    for (let frame = 0; frame < 60; frame += 1) scenery.update(8.12);
    expect(scenery.group.children.map((node) => [...node.scale.toArray(), ...node.position.toArray()])).toEqual(before);
    scenery.dispose();
  });

  it("releases every instanced scatter buffer exactly once when retiring a map", () => {
    const mission = MISSION_LIST[0];
    const scenery = new WorldScenery(mission.theme, mission.resourceZones, true);
    const instances: THREE.InstancedMesh[] = [];
    scenery.group.traverse((node) => {
      if (node instanceof THREE.InstancedMesh) instances.push(node);
    });
    expect(instances).toHaveLength(3);
    let disposals = 0;
    for (const instance of instances) instance.addEventListener("dispose", () => { disposals += 1; });
    scenery.dispose();
    scenery.dispose();
    expect(disposals).toBe(instances.length);
    expect(scenery.group.children).toHaveLength(0);
  });

  it("clears all vegetation and scree under occupied cells and restores the same composition", () => {
    const mission = MISSION_LIST[0];
    const scenery = new WorldScenery(mission.theme, mission.resourceZones, false);
    const instances = scenery.group.children.filter((node): node is THREE.InstancedMesh => node instanceof THREE.InstancedMesh);
    const original = instances.map(mesh => [...mesh.instanceMatrix.array]);
    const occupied = Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => ({ gx: index % GRID_SIZE, gz: Math.floor(index / GRID_SIZE) }));
    scenery.setOccupied(occupied);
    const transform = new THREE.Matrix4();
    for (const mesh of instances) for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, transform);
      expect(new THREE.Vector3().setFromMatrixScale(transform).length()).toBe(0);
    }
    scenery.setOccupied([]);
    expect(instances.map(mesh => [...mesh.instanceMatrix.array])).toEqual(original);
    scenery.dispose();
  });

  it("uses fewer scatter instances on low-power devices with the same three batched silhouettes", () => {
    const mission = MISSION_LIST[0];
    const full = new WorldScenery(mission.theme, mission.resourceZones, false);
    const low = new WorldScenery(mission.theme, mission.resourceZones, true);
    for (const name of ["pebbles", "desert-scrub", "oasis-grasses"]) {
      expect((low.group.getObjectByName(name) as THREE.InstancedMesh).count)
        .toBeLessThan((full.group.getObjectByName(name) as THREE.InstancedMesh).count);
    }
    full.dispose(); low.dispose();
  });
});

describe("new workshop miniatures", () => {
  it.each<BuildingKind>(["wheatFarm", "mill", "bakery", "ironMine", "blacksmith", "well"])("renders %s without image textures", (kind) => {
    const workshop = createWorkshop(kind, false)!;
    const stats = inspectGeometry(workshop);
    expect(stats.meshes).toBeLessThanOrEqual(2);
    expect(stats.vertices).toBeGreaterThan(100);
    const bounds = new THREE.Box3().setFromObject(workshop);
    expect(bounds.max.y).toBeGreaterThan(0.3);
    // Ore boulders are deliberately embedded in the ground, not floating above it.
    expect(bounds.min.y).toBeGreaterThanOrEqual(kind === "ironMine" ? -0.25 : -0.12);
    expect(bounds.getSize(new THREE.Vector3()).length()).toBeLessThan(3.5);
    disposeEntity(workshop);
  });
});
