import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  animateCharacter,
  createRaider,
  createSoldier,
  createVillager,
  getVillagerProfession,
} from "./CharacterFactory";

function meshes(group: THREE.Group): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  group.traverse((node) => { if (node instanceof THREE.Mesh) result.push(node); });
  return result;
}

function pose(group: THREE.Group): number[][] {
  const result: number[][] = [];
  group.traverse((node) => result.push([...node.position.toArray(), node.rotation.x, node.rotation.y, node.rotation.z, ...node.scale.toArray()]));
  return result;
}

describe("original articulated miniatures", () => {
  it("keeps civilians near one world unit high with grounded boots", () => {
    for (const job of ["resident", "farm", "lumber", "quarry", "market", "bakery", "blacksmith", "granary"]) {
      const person = createVillager(3, job);
      const bounds = new THREE.Box3().setFromObject(person);
      expect(bounds.min.y).toBeGreaterThan(-0.015);
      expect(bounds.max.y).toBeGreaterThan(0.99);
      expect(bounds.max.y).toBeLessThan(1.14);
      expect(person.userData.originalCharacter).toBe(true);
    }
  });

  it("uses six body meshes and at most one wrist tool per foot actor", () => {
    const characters = [createVillager(0, "farm"), createSoldier("spearman"), createSoldier("archer"), createSoldier("swordsman"), createRaider(), createRaider(true)];
    for (const character of characters) {
      expect(meshes(character)).toHaveLength(7);
      for (const part of meshes(character)) {
        expect(part.geometry.getAttribute("color").count).toBe(part.geometry.getAttribute("position").count);
        expect(part.geometry.groups).toHaveLength(0);
        expect((part.material as THREE.MeshStandardMaterial).map).toBeNull();
      }
    }
    expect(meshes(createVillager(0, "house"))).toHaveLength(6);
  });

  it("keeps a detailed horse and articulated rider within fourteen draws", () => {
    const knight = createSoldier("knight");
    const bounds = new THREE.Box3().setFromObject(knight);
    expect(meshes(knight)).toHaveLength(14);
    expect(knight.getObjectByName("mounted-rider")).toBeDefined();
    expect(knight.getObjectByName("horse-head")).toBeDefined();
    expect(bounds.min.y).toBeGreaterThan(-0.015);
    expect(bounds.max.y).toBeGreaterThan(1.4);
    expect(bounds.max.y).toBeLessThan(1.8);
  });

  it("shares geometries and the material across duplicate characters", () => {
    const a = meshes(createVillager(0, "farm"));
    const b = meshes(createVillager(6, "farm"));
    for (let index = 0; index < a.length; index += 1) {
      expect(a[index].geometry).toBe(b[index].geometry);
      expect(a[index].material).toBe(b[index].material);
    }
    expect(meshes(createRaider())[0].material).toBe(a[0].material);
  });

  it("maps workplace kinds to recognizable tools and professions", () => {
    expect(getVillagerProfession("farm")).toBe("farmer");
    expect(getVillagerProfession("lumber")).toBe("woodcutter");
    expect(getVillagerProfession("quarry")).toBe("mason");
    expect(getVillagerProfession("mill")).toBe("baker");
    expect(getVillagerProfession("smithy")).toBe("blacksmith");
    expect(getVillagerProfession("granary")).toBe("porter");
    expect(getVillagerProfession("house")).toBe("resident");
    expect(getVillagerProfession("wheatFarm")).toBe("farmer");
    expect(getVillagerProfession("ironMine")).toBe("mason");
    for (const profession of ["resident", "farmer", "woodcutter", "mason", "merchant", "baker", "blacksmith", "porter"]) expect(getVillagerProfession(profession)).toBe(profession);
    expect(createVillager(1, "quarry").userData.profession).toBe("mason");
  });

  it("articulates opposite legs and arms without changing map coordinates", () => {
    const person = createVillager(0);
    person.position.set(8, 0.2, -4);
    person.rotation.y = 1.3;
    animateCharacter(person, 1, true);
    const leftLeg = person.getObjectByName("left-leg")!;
    const rightLeg = person.getObjectByName("right-leg")!;
    expect(Math.abs(leftLeg.rotation.x)).toBeGreaterThan(0.01);
    expect(leftLeg.rotation.x).toBeCloseTo(-rightLeg.rotation.x, 10);
    expect(person.getObjectByName("left-arm")!.rotation.x).toBeCloseTo(-person.getObjectByName("right-arm")!.rotation.x, 10);
    expect(person.position.toArray()).toEqual([8, 0.2, -4]);
    expect(person.rotation.y).toBe(1.3);
  });

  it("freezes every pose component if simulation time stays unchanged", () => {
    const person = createSoldier("archer");
    animateCharacter(person, 12.3, true, false);
    const before = pose(person);
    animateCharacter(person, 12.3, false, true, true);
    animateCharacter(person, 12.3, true, true, true);
    expect(pose(person)).toEqual(before);
    animateCharacter(person, 12.4, false, true);
    expect(pose(person)).not.toEqual(before);
  });

  it("performs an original victory step without changing tactical position or heading", () => {
    const person = createVillager(2, "house");
    person.position.set(6.25, 0.015, -3.5);
    person.rotation.set(0, 1.17, 0);
    const rootPosition = person.position.toArray();
    const rootRotation = person.rotation.toArray();

    animateCharacter(person, 2.1, false, false, true);
    const first = pose(person);
    const motion = person.getObjectByName("character-motion")!;
    expect(Math.abs(motion.rotation.z)).toBeGreaterThan(0.005);
    expect(person.position.toArray()).toEqual(rootPosition);
    expect(person.rotation.toArray()).toEqual(rootRotation);

    animateCharacter(person, 2.35, false, false, true);
    expect(pose(person)).not.toEqual(first);
    expect(person.position.toArray()).toEqual(rootPosition);
    expect(person.rotation.toArray()).toEqual(rootRotation);
  });

  it("removes every dance-only transform when the emote ends", () => {
    const person = createSoldier("spearman");
    animateCharacter(person, 1.7, false, false, true);
    expect(Math.abs(person.getObjectByName("character-motion")!.rotation.z)).toBeGreaterThan(0.005);
    animateCharacter(person, 1.8, false, false, false);

    const motion = person.getObjectByName("character-motion")!;
    expect(motion.rotation.toArray()).toEqual([0, 0, 0, "XYZ"]);
    expect(person.getObjectByName("tailored-body")!.rotation.x).toBe(0);
    expect(person.getObjectByName("tailored-body")!.rotation.y).toBe(0);
    expect(person.getObjectByName("head")!.rotation.z).toBe(0);
    expect(person.getObjectByName("left-leg")!.rotation.z).toBe(0);
    expect(person.getObjectByName("right-leg")!.rotation.z).toBe(0);
  });

  it("keeps the bow upright and points the spear forward in combat", () => {
    const archer = createSoldier("archer");
    animateCharacter(archer, 3.4, false, true);
    expect(archer.getObjectByName("left-arm")!.rotation.x + archer.getObjectByName("left-wrist-tool")!.rotation.x).toBeCloseTo(0, 8);
    const spear = createSoldier("spearman");
    animateCharacter(spear, 3.4, false, true);
    expect(spear.getObjectByName("right-arm")!.rotation.x + spear.getObjectByName("right-wrist-tool")!.rotation.x).toBeCloseTo(1.34, 8);
  });

  it("freezes the mount and rider together and resumes four-legged gait", () => {
    const knight = createSoldier("knight");
    animateCharacter(knight, 4.1, true, true);
    const before = pose(knight);
    animateCharacter(knight, 4.1, false, false);
    expect(pose(knight)).toEqual(before);
    animateCharacter(knight, 4.3, true, true);
    expect(pose(knight)).not.toEqual(before);
    expect(knight.getObjectByName("horse-leg-0")!.rotation.x).toBeCloseTo(knight.getObjectByName("horse-leg-3")!.rotation.x, 10);
    expect(knight.getObjectByName("horse-leg-1")!.rotation.x).toBeCloseTo(-knight.getObjectByName("horse-leg-0")!.rotation.x, 10);
  });

  it("gives a mounted knight a finite prance and rider salute without root drift", () => {
    const knight = createSoldier("knight");
    knight.position.set(-2, 0, 7);
    knight.rotation.y = -0.72;
    const rootPosition = knight.position.toArray();
    const rootRotation = knight.rotation.toArray();

    animateCharacter(knight, 3.1, false, false, true);
    const first = pose(knight);
    expect(knight.getObjectByName("horse-leg-0")!.rotation.x).not.toBe(0);
    expect(Math.abs(knight.getObjectByName("mounted-rider")!.getObjectByName("right-arm")!.rotation.x)).toBeGreaterThan(0.8);
    expect(first.flat().every(Number.isFinite)).toBe(true);
    expect(knight.position.toArray()).toEqual(rootPosition);
    expect(knight.rotation.toArray()).toEqual(rootRotation);

    animateCharacter(knight, 3.35, false, false, true);
    expect(pose(knight)).not.toEqual(first);
    expect(pose(knight).flat().every(Number.isFinite)).toBe(true);
    animateCharacter(knight, 3.45, false, false, false);
    expect(knight.getObjectByName("character-motion")!.rotation.toArray()).toEqual([0, 0, 0, "XYZ"]);
  });

  it("does not create invalid transforms for nonfinite or negative time", () => {
    const person = createRaider(true);
    const initial = pose(person);
    animateCharacter(person, Number.NaN, true);
    animateCharacter(person, Number.POSITIVE_INFINITY, false);
    expect(pose(person)).toEqual(initial);
    animateCharacter(person, -0.5, true);
    expect(pose(person).flat().every(Number.isFinite)).toBe(true);
  });

  it("keeps merged triangle counts small enough for dozens of actors", () => {
    const triangleCount = (group: THREE.Group): number => meshes(group).reduce((sum, part) => sum + part.geometry.getAttribute("position").count / 3, 0);
    expect(triangleCount(createVillager(0, "farm"))).toBeLessThan(1800);
    expect(triangleCount(createSoldier("spearman"))).toBeLessThan(2000);
    expect(triangleCount(createSoldier("knight"))).toBeLessThan(3500);
  });
});
