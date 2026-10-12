import * as THREE from "three";
import type { ArmyUnitKind } from "../../game/types";

type SiegeKind = Extract<ArmyUnitKind, "catapult" | "batteringRam">;

const material = (color: THREE.ColorRepresentation, roughness = 0.9): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });

function mesh(geometry: THREE.BufferGeometry, surface: THREE.Material, name: string): THREE.Mesh {
  const result = new THREE.Mesh(geometry, surface);
  result.name = name;
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

export function createSiegeEngine(kind: SiegeKind, enemy = false): THREE.Group {
  const group = new THREE.Group();
  group.name = kind === "catapult" ? "siege-catapult" : "siege-battering-ram";
  group.userData.siegeEngine = true;
  group.userData.siegeKind = kind;
  const wood = material("#765237");
  const woodLight = material("#a47850");
  const iron = material("#59666a", 0.72);
  const stone = material("#88908d", 1);
  const cloth = material(enemy ? "#a54d45" : "#248a83", 0.82);
  const dark = material("#3c322b", 1);

  for (const x of [-0.43, 0.43]) for (const z of [-0.38, 0.38]) {
    const wheel = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.09, 12), dark, "siege-wheel");
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.18, z);
    group.add(wheel);
  }
  const chassis = mesh(new THREE.BoxGeometry(0.78, 0.14, 0.9), wood, "siege-chassis");
  chassis.position.y = 0.32;
  group.add(chassis);

  if (kind === "catapult") {
    for (const x of [-0.32, 0.32]) {
      const brace = mesh(new THREE.BoxGeometry(0.1, 0.72, 0.12), woodLight, "catapult-brace");
      brace.position.set(x, 0.66, 0.06);
      brace.rotation.x = -0.12;
      group.add(brace);
    }
    const axle = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.78, 8), iron, "catapult-axle");
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.72, 0.02);
    group.add(axle);
    const armPivot = new THREE.Group();
    armPivot.name = "catapult-arm-pivot";
    armPivot.position.set(0, 0.72, 0.02);
    armPivot.rotation.x = -0.55;
    const arm = mesh(new THREE.BoxGeometry(0.09, 0.09, 1.28), woodLight, "catapult-arm");
    arm.position.z = -0.34;
    armPivot.add(arm);
    const cup = mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.12, 10), iron, "catapult-cup");
    cup.position.set(0, 0.06, -0.98);
    armPivot.add(cup);
    const rock = mesh(new THREE.DodecahedronGeometry(0.13, 0), stone, "catapult-load");
    rock.position.set(0, 0.17, -0.98);
    armPivot.add(rock);
    group.add(armPivot);
    const shield = mesh(new THREE.BoxGeometry(0.66, 0.36, 0.055), cloth, "siege-side-shield");
    shield.position.set(0, 0.51, 0.43);
    group.add(shield);
  } else {
    for (const x of [-0.38, 0.38]) for (const z of [-0.32, 0.32]) {
      const post = mesh(new THREE.BoxGeometry(0.08, 0.72, 0.08), woodLight, "ram-post");
      post.position.set(x, 0.69, z);
      group.add(post);
    }
    const canopy = mesh(new THREE.ConeGeometry(0.72, 0.38, 4), cloth, "ram-canopy");
    canopy.rotation.y = Math.PI / 4;
    canopy.scale.z = 1.18;
    canopy.position.y = 1.1;
    group.add(canopy);
    const log = mesh(new THREE.CylinderGeometry(0.105, 0.13, 1.35, 10), wood, "ram-log");
    log.rotation.x = Math.PI / 2;
    log.position.set(0, 0.58, -0.12);
    group.add(log);
    const head = mesh(new THREE.ConeGeometry(0.16, 0.34, 8), iron, "ram-head");
    head.rotation.x = -Math.PI / 2;
    head.position.set(0, 0.58, -0.96);
    group.add(head);
  }

  group.scale.setScalar(0.88);
  return group;
}
