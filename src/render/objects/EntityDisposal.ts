import * as THREE from "three";

const retiredEntities = new WeakSet<THREE.Object3D>();

/**
 * Retire a render entity and release its owned GPU resources exactly once.
 *
 * Shared resource owners must set geometry.userData.shared/material.userData.shared.
 * Textures stay alive unless explicitly marked entityOwned: cloned glTF materials
 * often share maps with the asset library. Sprite geometry is a Three.js singleton.
 * The root is detached and cleared; a retired entity must not be reused.
 */
export function disposeEntity(root: THREE.Object3D): void {
  if (retiredEntities.has(root)) return;
  retiredEntities.add(root);

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const ownedTextures = new Set<THREE.Texture>();
  const instances: THREE.InstancedMesh[] = [];
  const collectMaterial = (material: THREE.Material | THREE.Material[] | undefined): void => {
    if (!material) return;
    for (const item of Array.isArray(material) ? material : [material]) materials.add(item);
  };

  root.traverse((node) => {
    if (node instanceof THREE.Sprite) {
      collectMaterial(node.material);
      return;
    }
    if (!(node instanceof THREE.Mesh || node instanceof THREE.Line || node instanceof THREE.Points)) return;
    geometries.add(node.geometry);
    collectMaterial(node.material);
    if (node instanceof THREE.Mesh) {
      collectMaterial(node.customDepthMaterial);
      collectMaterial(node.customDistanceMaterial);
    }
    if (node instanceof THREE.InstancedMesh) instances.push(node);
  });

  root.removeFromParent();
  for (const instance of instances) instance.dispose();
  for (const geometry of geometries) if (geometry.userData.shared !== true) geometry.dispose();
  for (const material of materials) if (material.userData.shared !== true) {
    // Label canvases belong to their marker, unlike cached model texture maps.
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture && value.userData.entityOwned === true) ownedTextures.add(value);
    }
    material.dispose();
  }
  for (const texture of ownedTextures) texture.dispose();
  root.clear();
}
