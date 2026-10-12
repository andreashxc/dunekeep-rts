import * as THREE from "three";
import type { BuildingKind } from "../../game/types";
import { createDesertBuilding } from "./DesertArchitecture";
import { createWallMaterials, createWallTopology } from "./WallArchitecture";

/** The playable footprint stays fixed. Fortification decks retain simulation heights. */
export function buildingHeightScale(kind: BuildingKind): number {
  if (kind === "keep") return 1.25;
  if (["wall", "tower", "gate", "farm", "wheatFarm", "quarry", "well"].includes(kind)) return 1;
  return 1.2;
}

/** Shared by the map, placement preview and offline UI portrait renderer. */
export function createWorldBuilding(kind: BuildingKind, shadows = true): THREE.Group | null {
  if (kind === "wall") {
    const palette = createWallMaterials();
    // Preview/portrait walls own their small palette; runtime walls use the renderer's shared one.
    for (const material of Object.values(palette)) material.userData.shared = false;
    const wall = createWallTopology(10, palette, { lowPower: !shadows });
    palette.flame.dispose(); // A straight segment has no lamp.
    wall.userData.buildingKind = kind;
    return wall;
  }
  const architecture = createDesertBuilding(kind, shadows);
  if (!architecture) return null;
  const group = new THREE.Group();
  group.name = `world-${kind}`;
  group.userData = { ...architecture.userData };
  architecture.scale.y = buildingHeightScale(kind);
  group.add(architecture);
  group.updateMatrixWorld(true);
  group.userData.modelHeight = new THREE.Box3().setFromObject(group).max.y;
  return group;
}
