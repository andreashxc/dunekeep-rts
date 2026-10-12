import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createSoldier } from "./CharacterFactory";
import { disposeEntity } from "./EntityDisposal";

describe("entity resource ownership", () => {
  it("detaches, clears and disposes duplicate owned resources only once", () => {
    const world = new THREE.Group();
    const entity = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshStandardMaterial();
    const disposeGeometry = vi.spyOn(geometry, "dispose");
    const disposeMaterial = vi.spyOn(material, "dispose");
    entity.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
    world.add(entity);
    disposeEntity(entity);
    disposeEntity(entity);
    expect(disposeGeometry).toHaveBeenCalledTimes(1);
    expect(disposeMaterial).toHaveBeenCalledTimes(1);
    expect(world.children).toHaveLength(0);
    expect(entity.children).toHaveLength(0);
    expect(entity.parent).toBeNull();
  });

  it("preserves marked geometry and material independently", () => {
    const root = new THREE.Group();
    const sharedGeometry = new THREE.BoxGeometry();
    const ownedGeometry = new THREE.SphereGeometry();
    const sharedMaterial = new THREE.MeshStandardMaterial();
    const ownedMaterial = new THREE.MeshStandardMaterial();
    sharedGeometry.userData.shared = true;
    sharedMaterial.userData.shared = true;
    const sharedGeometryDisposal = vi.spyOn(sharedGeometry, "dispose");
    const ownedGeometryDisposal = vi.spyOn(ownedGeometry, "dispose");
    const sharedMaterialDisposal = vi.spyOn(sharedMaterial, "dispose");
    const ownedMaterialDisposal = vi.spyOn(ownedMaterial, "dispose");
    root.add(new THREE.Mesh(sharedGeometry, ownedMaterial), new THREE.Mesh(ownedGeometry, sharedMaterial));
    disposeEntity(root);
    expect(sharedGeometryDisposal).not.toHaveBeenCalled();
    expect(sharedMaterialDisposal).not.toHaveBeenCalled();
    expect(ownedGeometryDisposal).toHaveBeenCalledOnce();
    expect(ownedMaterialDisposal).toHaveBeenCalledOnce();
  });

  it("disposes health-sprite materials but never Three.js shared sprite geometry", () => {
    const health = new THREE.Sprite(new THREE.SpriteMaterial());
    const geometryDisposal = vi.spyOn(health.geometry, "dispose");
    const materialDisposal = vi.spyOn(health.material, "dispose");
    disposeEntity(health);
    expect(geometryDisposal).not.toHaveBeenCalled();
    expect(materialDisposal).toHaveBeenCalledOnce();
    geometryDisposal.mockRestore();
  });

  it("does not dispose shared maps when retiring cloned glTF materials", () => {
    const texture = new THREE.Texture();
    const source = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
    const clone = source.clone();
    const cloneDisposal = vi.spyOn(clone, "dispose");
    const sourceDisposal = vi.spyOn(source, "dispose");
    const textureDisposal = vi.spyOn(texture, "dispose");
    disposeEntity(new THREE.Mesh(new THREE.BoxGeometry(), clone));
    expect(cloneDisposal).toHaveBeenCalledOnce();
    expect(sourceDisposal).not.toHaveBeenCalled();
    expect(textureDisposal).not.toHaveBeenCalled();
    expect(source.map).toBe(texture);
  });

  it("handles mixed material arrays, outlines and point effects", () => {
    const root = new THREE.Group();
    const shared = new THREE.MeshBasicMaterial();
    shared.userData.shared = true;
    const owned = new THREE.MeshBasicMaterial();
    const lineMaterial = new THREE.LineBasicMaterial();
    const pointMaterial = new THREE.PointsMaterial();
    const sharedDisposal = vi.spyOn(shared, "dispose");
    const ownedDisposal = vi.spyOn(owned, "dispose");
    const lineDisposal = vi.spyOn(lineMaterial, "dispose");
    const pointDisposal = vi.spyOn(pointMaterial, "dispose");
    const geometry = new THREE.BoxGeometry();
    const geometryDisposal = vi.spyOn(geometry, "dispose");
    root.add(new THREE.Mesh(geometry, [shared, owned, owned]));
    root.add(new THREE.LineSegments(geometry, lineMaterial), new THREE.Points(geometry, pointMaterial));
    disposeEntity(root);
    expect(sharedDisposal).not.toHaveBeenCalled();
    expect(ownedDisposal).toHaveBeenCalledOnce();
    expect(lineDisposal).toHaveBeenCalledOnce();
    expect(pointDisposal).toHaveBeenCalledOnce();
    expect(geometryDisposal).toHaveBeenCalledOnce();
  });

  it("releases instancing buffers even when source geometry/material are shared", () => {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    geometry.userData.shared = true;
    material.userData.shared = true;
    const mesh = new THREE.InstancedMesh(geometry, material, 2);
    const instanceDisposal = vi.spyOn(mesh, "dispose");
    const geometryDisposal = vi.spyOn(geometry, "dispose");
    const materialDisposal = vi.spyOn(material, "dispose");
    disposeEntity(mesh);
    expect(instanceDisposal).toHaveBeenCalledOnce();
    expect(geometryDisposal).not.toHaveBeenCalled();
    expect(materialDisposal).not.toHaveBeenCalled();
  });

  it("preserves cached character bodies while releasing their unique rings and bars", () => {
    const actor = createSoldier("spearman");
    const ownedRing = new THREE.Mesh(new THREE.RingGeometry(), new THREE.MeshBasicMaterial());
    const health = new THREE.Sprite(new THREE.SpriteMaterial());
    const cachedBody = actor.getObjectByName("tailored-body") as THREE.Mesh;
    const bodyGeometryDisposal = vi.spyOn(cachedBody.geometry, "dispose");
    const bodyMaterialDisposal = vi.spyOn(cachedBody.material as THREE.Material, "dispose");
    const ringGeometryDisposal = vi.spyOn(ownedRing.geometry, "dispose");
    const ringMaterialDisposal = vi.spyOn(ownedRing.material, "dispose");
    const healthDisposal = vi.spyOn(health.material, "dispose");
    actor.add(ownedRing, health);
    disposeEntity(actor);
    expect(bodyGeometryDisposal).not.toHaveBeenCalled();
    expect(bodyMaterialDisposal).not.toHaveBeenCalled();
    expect(ringGeometryDisposal).toHaveBeenCalledOnce();
    expect(ringMaterialDisposal).toHaveBeenCalledOnce();
    expect(healthDisposal).toHaveBeenCalledOnce();
    const replacement = createSoldier("spearman");
    expect((replacement.getObjectByName("tailored-body") as THREE.Mesh).geometry).toBe(cachedBody.geometry);
    bodyGeometryDisposal.mockRestore();
    bodyMaterialDisposal.mockRestore();
  });
});
