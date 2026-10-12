import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BUILDINGS } from "../../game/content";
import type { BuildingKind } from "../../game/types";
import { HUMAN_WORLD_SCALE, HUMAN_RELEASE_HEIGHT } from "../../game/worldScale";
import { createSoldier, createVillager } from "../objects/CharacterFactory";
import { addHealthBar } from "../objects/HealthBar";
import { createDesertBuilding } from "./DesertArchitecture";
import { createWorldBuilding } from "./WorldBuilding";

describe("world architecture and human proportions", () => {
  it("gives homes two habitable storeys and the citadel a commanding silhouette", () => {
    const resident = createVillager(0);
    resident.scale.setScalar(HUMAN_WORLD_SCALE);
    const humanHeight = new THREE.Box3().setFromObject(resident, true).max.y;
    const house = new THREE.Box3().setFromObject(createWorldBuilding("house")!, true);
    const keep = new THREE.Box3().setFromObject(createWorldBuilding("keep")!, true);
    expect(humanHeight).toBeGreaterThan(0.4);
    expect(humanHeight).toBeLessThan(0.49);
    expect(house.max.y / humanHeight).toBeGreaterThan(3.4);
    expect(keep.max.y / humanHeight).toBeGreaterThan(7);
    // Ordinary arched doors are 0.48 high in the authored models.
    expect(humanHeight).toBeLessThan(0.48 * 1.2);
  });

  it("preserves footprints, grounded foundations and stable construction roots for every building", () => {
    for (const kind of Object.keys(BUILDINGS) as BuildingKind[]) {
      if (kind === "wall") continue;
      const original = new THREE.Box3().setFromObject(createDesertBuilding(kind)!, true);
      const group = createWorldBuilding(kind)!;
      const current = new THREE.Box3().setFromObject(group, true);
      expect(current.min.x).toBeCloseTo(original.min.x, 6);
      expect(current.max.z).toBeCloseTo(original.max.z, 6);
      expect(current.min.y).toBeGreaterThan(-0.02);
      expect(current.min.y).toBeLessThan(0.1);
      expect(group.scale.toArray()).toEqual([1, 1, 1]);
      expect(group.userData.modelHeight).toBeCloseTo(current.max.y, 5);
    }
  });

  it("preserves tower decks and an open gate for a human and mounted rider", () => {
    const original = new THREE.Box3().setFromObject(createDesertBuilding("tower")!);
    const tower = new THREE.Box3().setFromObject(createWorldBuilding("tower")!);
    expect(tower.max.y).toBeCloseTo(original.max.y, 7);
    const knight = createSoldier("knight");
    knight.scale.setScalar(HUMAN_WORLD_SCALE);
    const rider = new THREE.Box3().setFromObject(knight, true);
    const gate = createWorldBuilding("gate")!;
    for (const y of [HUMAN_RELEASE_HEIGHT, rider.max.y]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(0, y, -1), new THREE.Vector3(0, 0, 1), 0, 2);
      expect(ray.intersectObject(gate, true)).toHaveLength(0);
    }
  });

  it("places health bars above a scaled person's head", () => {
    const person = createVillager(0);
    person.scale.setScalar(HUMAN_WORLD_SCALE);
    person.position.set(7, 1.7, -4);
    const headY = new THREE.Box3().setFromObject(person, true).max.y;
    addHealthBar(person, false);
    const barY = person.getObjectByName("health-bar")!.getWorldPosition(new THREE.Vector3()).y;
    expect(barY - headY).toBeGreaterThan(0.08);
    expect(barY - headY).toBeLessThan(0.2);
  });
});
