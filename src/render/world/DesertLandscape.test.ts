import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GRID_SIZE, MISSION_LIST, TILE_SIZE } from "../../game/content";
import { DesertLandscape, plateauOutline, sandPlateauGeometry } from "./DesertLandscape";
import { WORLD_COLORS } from "./WorldScenery";
import { ContactShadows } from "./ContactShadows";

describe("landscape composition", () => {
  it("contains every legal build cell inside the level plateau", () => {
    const outline = plateauOutline();
    const shape = new THREE.Shape(outline);
    const geometry = sandPlateauGeometry(shape.getPoints().slice(0, -1), WORLD_COLORS.oasis.ground);
    const ground = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    ground.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (let x = 0; x < GRID_SIZE; x += 1) for (let z = 0; z < GRID_SIZE; z += 1) {
      ray.set(new THREE.Vector3((x - 8.5) * TILE_SIZE, 3, (z - 8.5) * TILE_SIZE), new THREE.Vector3(0, -1, 0));
      expect(ray.intersectObject(ground).length).toBeGreaterThan(0);
    }
    geometry.dispose();
    (ground.material as THREE.Material).dispose();
  });

  it("contains every cell of the enlarged thirty-cell duel plateau", () => {
    const gridSize = 30;
    const outline = plateauOutline(gridSize);
    const geometry = sandPlateauGeometry(outline, WORLD_COLORS.oasis.ground);
    const ground = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    ground.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (let gx = 0; gx < gridSize; gx += 1) for (let gz = 0; gz < gridSize; gz += 1) {
      ray.set(
        new THREE.Vector3((gx - (gridSize - 1) / 2) * TILE_SIZE, 3, (gz - (gridSize - 1) / 2) * TILE_SIZE),
        new THREE.Vector3(0, -1, 0),
      );
      expect(ray.intersectObject(ground).length).toBeGreaterThan(0);
    }
    geometry.dispose();
    (ground.material as THREE.Material).dispose();
  });

  it("adds smooth sand variation while all construction vertices and normals remain level", () => {
    const landscape = new DesertLandscape("oasis", WORLD_COLORS.oasis, true, 30);
    const ground = landscape.group.getObjectByName("untextured-buildable-ground") as THREE.Mesh;
    const positions = ground.geometry.getAttribute("position"), normals = ground.geometry.getAttribute("normal");
    const colors = ground.geometry.getAttribute("color");
    const shades = new Set<number>();
    for (let i = 0; i < positions.count; i++) {
      expect(positions.getY(i)).toBe(0);
      expect(normals.getY(i)).toBeCloseTo(1);
      shades.add(Math.round(colors.getX(i) * 1000));
    }
    expect(shades.size).toBeGreaterThan(25);
    const lagoon = landscape.group.getObjectByName("turquoise-oasis")!;
    const lagoonBounds = new THREE.Box3().setFromObject(lagoon);
    expect(lagoonBounds.max.x).toBeLessThan(-30 * TILE_SIZE / 2 - 1);
    landscape.dispose();
  });

  it.each(MISSION_LIST)("keeps $id terrain batched, finite and image-free", (mission) => {
    const landscape = new DesertLandscape(mission.theme, WORLD_COLORS[mission.theme], true);
    let meshes = 0, vertices = 0;
    landscape.group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      meshes += 1;
      const position = node.geometry.getAttribute("position");
      expect([...position.array].every(Number.isFinite)).toBe(true);
      vertices += position.count;
    });
    expect(meshes).toBeLessThanOrEqual(5);
    expect(vertices).toBeLessThan(30_000);
    expect(landscape.groundMaterial.map).toBeNull();
    expect(landscape.groundMaterial.normalMap).toBeNull();
    expect(landscape.groundMaterial.roughnessMap).toBeNull();
    const ground = landscape.group.getObjectByName("untextured-buildable-ground")!;
    const bounds = new THREE.Box3().setFromObject(ground);
    expect(Math.abs(bounds.max.y)).toBeLessThan(0.00001);
    expect(Math.abs(bounds.min.y)).toBeLessThan(0.00001);
    landscape.dispose();
    expect(landscape.group.children).toHaveLength(0);
  });

  it("freezes even the water shader at the exact simulation time", () => {
    const landscape = new DesertLandscape("oasis", WORLD_COLORS.oasis, true);
    const water = landscape.group.getObjectByName("turquoise-oasis") as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    landscape.update(18.4);
    for (let frame = 0; frame < 120; frame += 1) landscape.update(18.4);
    expect(water.material.uniforms.uTime.value).toBe(18.4);
    landscape.update(18.5);
    expect(water.material.uniforms.uTime.value).toBe(18.5);
    landscape.dispose();
  });

  it("releases contact instance buffers once and caps crowded scenes", () => {
    const contacts = new ContactShadows(4);
    contacts.begin();
    for (let i = 0; i < 8; i += 1) contacts.add(i, 0, 0.5);
    contacts.end();
    expect(contacts.mesh.count).toBe(4);
    let freed = 0;
    contacts.mesh.addEventListener("dispose", () => freed++);
    contacts.dispose();
    contacts.dispose();
    expect(freed).toBe(1);
  });
});
