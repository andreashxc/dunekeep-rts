import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { disposeEntity } from "./EntityDisposal";
import { createSiegeEngine } from "./SiegeEngineFactory";
import { createTowerWeapon } from "./TowerWeaponFactory";

function expectFiniteTextureFree(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const position = node.geometry.getAttribute("position");
    expect(position).toBeDefined();
    expect([...position.array].every(Number.isFinite)).toBe(true);
    for (const surface of Array.isArray(node.material) ? node.material : [node.material]) {
      if (surface instanceof THREE.MeshStandardMaterial) expect(surface.map).toBeNull();
    }
  });
  const bounds = new THREE.Box3().setFromObject(root);
  expect(bounds.isEmpty()).toBe(false);
  expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
}

describe("duel siege visuals", () => {
  it.each(["catapult", "batteringRam"] as const)("builds a compact ally and rival %s", (kind) => {
    for (const enemy of [false, true]) {
      const engine = createSiegeEngine(kind, enemy);
      expect(engine.userData.siegeKind).toBe(kind);
      expect(engine.getObjectsByProperty("name", "siege-wheel")).toHaveLength(4);
      expectFiniteTextureFree(engine);
      const size = new THREE.Box3().setFromObject(engine).getSize(new THREE.Vector3());
      expect(size.x).toBeLessThan(2.2);
      expect(size.y).toBeLessThan(2.2);
      expect(size.z).toBeLessThan(2.2);
      disposeEntity(engine);
      expect(engine.children).toHaveLength(0);
    }
  });

  it.each(["light", "heavy"] as const)("places the %s module on the tower deck", (kind) => {
    const weapon = createTowerWeapon(kind, false);
    expect(weapon.userData.towerUpgrade).toBe(kind);
    expect(weapon.position.y).toBeGreaterThanOrEqual(1.7);
    expectFiniteTextureFree(weapon);
    disposeEntity(weapon);
  });
});
