import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ProductionEffects } from './ProductionEffects';
import { createDesertBuilding } from './DesertArchitecture';
function workshop(kind: 'bakery' | 'blacksmith', operating: boolean) {
  const group = new THREE.Group();
  group.userData.buildingKind = kind; group.userData.isOperating = operating;
  const hearth = new THREE.Object3D(); hearth.name = `${kind}-hearth`; group.add(hearth);
  const outlet = new THREE.Object3D(); outlet.name = 'chimney-outlet'; outlet.position.set(0, 1.25, 0); group.add(outlet);
  return group;
}
it('shows smoke and hearth only for working producers and removes it immediately when stalled', () => {
  const effects = new ProductionEffects();
  const bakery = workshop('bakery', true), forge = workshop('blacksmith', false);
  const buildings = new Map([[1, bakery], [2, forge]]);
  effects.update(buildings, 2, false, false);
  expect(effects.mesh.count).toBe(3);
  expect(bakery.children[0].visible).toBe(true);
  expect(forge.children[0].visible).toBe(false);
  bakery.userData.isOperating = false;
  effects.update(buildings, 2, true, false);
  expect(effects.mesh.count).toBe(0);
  expect(effects.mesh.visible).toBe(false);
  expect(bakery.children[0].visible).toBe(false);
  effects.dispose();
});
it('freezes particle transforms on pause and reuses geometry/material/buffers', () => {
  const effects = new ProductionEffects();
  const buildings = new Map([[1, workshop('blacksmith', true)]]);
  effects.update(buildings, 2, false, false);
  const matrix = Array.from(effects.mesh.instanceMatrix.array);
  const geometry = effects.mesh.geometry, material = effects.mesh.material, buffer = effects.mesh.instanceMatrix.array;
  effects.update(buildings, 10, true, false);
  expect(Array.from(effects.mesh.instanceMatrix.array)).toEqual(matrix);
  effects.update(buildings, 2.1, false, false);
  expect(Array.from(effects.mesh.instanceMatrix.array)).not.toEqual(matrix);
  expect(effects.mesh.geometry).toBe(geometry);
  expect(effects.mesh.material).toBe(material);
  expect(effects.mesh.instanceMatrix.array).toBe(buffer);
  effects.dispose();
});
it('bounds low quality to sixteen puffs and releases resources once', () => {
  const effects = new ProductionEffects();
  const buildings = new Map(Array.from({ length: 80 }, (_, i) => [i, workshop('bakery', true)] as const));
  effects.update(buildings, 3, false, true);
  expect(effects.mesh.count).toBe(16);
  effects.update(buildings, 3, false, false);
  expect(effects.mesh.count).toBe(192);
  const geometry = vi.spyOn(effects.mesh.geometry, 'dispose');
  const material = vi.spyOn(effects.mesh.material, 'dispose');
  effects.reset(); expect(effects.mesh.count).toBe(0);
  effects.dispose(); effects.dispose();
  expect(geometry).toHaveBeenCalledOnce(); expect(material).toHaveBeenCalledOnce();
});

it('emits above actual authored chimney caps and follows transformed model anchors', () => {
  for (const kind of ['bakery', 'blacksmith'] as const) {
    const model = createDesertBuilding(kind)!;
    const outlet = model.getObjectByName('chimney-outlet')!;
    expect(outlet).toBeDefined();
    const masonry = model.getObjectByName(`${kind}-masonry`) as THREE.Mesh;
    masonry.geometry.computeBoundingBox();
    expect(outlet.position.y).toBeGreaterThan(masonry.geometry.boundingBox!.max.y);
    expect(outlet.position.y - masonry.geometry.boundingBox!.max.y).toBeLessThan(0.02);
    model.position.set(7, 2, -4); model.rotation.y = Math.PI / 2; model.scale.setScalar(1.5);
    model.userData.isOperating = true;
    const effects = new ProductionEffects();
    effects.update(new Map([[0, model]]), 0, false, false);
    const origin = outlet.getWorldPosition(new THREE.Vector3());
    const matrix = new THREE.Matrix4(); effects.mesh.getMatrixAt(0, matrix);
    const emitter = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(emitter.distanceTo(origin)).toBeLessThan(0.00001);
    effects.dispose();
  }
});

it('keeps smoke readable at strategic zoom without adding draw instances', () => {
  const effects = new ProductionEffects();
  effects.update(new Map([[0, workshop('blacksmith', true)]]), 0.5 / 0.34, false, false);
  const state = effects.diagnostics();
  expect(state.count).toBe(3);
  expect(state.particles[0].size).toBeCloseTo(0.445);
  expect(state.particles[0].alpha).toBeCloseTo(0.42);
  effects.dispose();
});
