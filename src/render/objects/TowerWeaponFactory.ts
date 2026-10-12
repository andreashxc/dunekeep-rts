import * as THREE from "three";
import type { TowerUpgradeKind } from "../../game/types";

export function createTowerWeapon(kind: Exclude<TowerUpgradeKind, "none">, enemy = false): THREE.Group {
  const group = new THREE.Group();
  group.name = "tower-weapon";
  group.userData.towerUpgrade = kind;
  const wood = new THREE.MeshStandardMaterial({ color: "#725039", roughness: 0.9, flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: "#657579", roughness: 0.68, flatShading: true });
  const accent = new THREE.MeshStandardMaterial({ color: enemy ? "#a84e46" : "#2a8d86", roughness: 0.82, flatShading: true });
  const add = (geometry: THREE.BufferGeometry, surface: THREE.Material, position: [number, number, number], name: string): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, surface);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  add(new THREE.CylinderGeometry(0.22, 0.27, 0.12, 10), accent, [0, 0.08, 0], "tower-weapon-base");
  if (kind === "light") {
    add(new THREE.BoxGeometry(0.78, 0.07, 0.08), wood, [0, 0.23, 0], "ballista-bow");
    add(new THREE.BoxGeometry(0.08, 0.08, 0.72), wood, [0, 0.21, -0.17], "ballista-stock");
    const bolt = add(new THREE.CylinderGeometry(0.012, 0.012, 0.78, 5), metal, [0, 0.29, -0.2], "ballista-bolt");
    bolt.rotation.x = Math.PI / 2;
  } else {
    const pivot = new THREE.Group();
    pivot.name = "tower-catapult-pivot";
    pivot.position.y = 0.24;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.88), wood);
    arm.position.z = -0.22;
    arm.rotation.x = -0.62;
    arm.castShadow = true;
    pivot.add(arm);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1, 0), metal);
    rock.position.set(0, 0.24, -0.62);
    rock.castShadow = true;
    pivot.add(rock);
    group.add(pivot);
  }
  // The authored tower's walkable deck is at y=1.68. Keep the mechanism above
  // the parapet floor so it reads clearly and never clips into the masonry.
  group.position.set(0, kind === "light" ? 1.72 : 1.7, -0.08);
  group.scale.setScalar(0.76);
  return group;
}
