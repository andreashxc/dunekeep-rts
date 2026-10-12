import * as THREE from "three";
import type { BuildingKind } from "../../game/types";
import { SolidBatch } from "./SolidBatch";
import { addCrate, addJar } from "./WorldScenery";

const colors = { plaster: "#e7d3a4", stone: "#c3ab84", trim: "#f2dfb5", wood: "#826040", dark: "#4b4035", cloth: "#418184", steel: "#aeb9b4" };

function awning(batch: SolidBatch, x: number, z: number, width: number, depth: number, y: number, color = colors.cloth): void {
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) batch.box(x + dx * width * 0.44, y * 0.5, z + dz * depth * 0.4, 0.055, y, 0.055, colors.wood);
  for (let stripe = 0; stripe < 5; stripe += 1) {
    batch.box(x + (stripe - 2) * width / 5, y, z, width / 5, 0.055, depth, stripe % 2 ? colors.trim : color);
    batch.box(x + (stripe - 2) * width / 5, y - 0.07, z + depth / 2, width / 5, 0.14, 0.025, stripe % 2 ? colors.trim : color);
  }
}

function stoneCourses(batch: SolidBatch, x: number, z: number, width: number, height: number, depth: number): void {
  batch.box(x, height / 2, z, width, height, depth, colors.plaster);
  batch.box(x, 0.08, z, width + 0.045, 0.14, depth + 0.045, colors.stone);
  batch.box(x, height - 0.04, z, width + 0.065, 0.085, depth + 0.065, colors.trim);
  for (const side of [-1, 1]) for (let row = 0; row < 3; row += 1) {
    batch.box(x + side * (width / 2 - 0.025), 0.2 + row * height * 0.23, z + depth / 2 + 0.01, row % 2 ? 0.12 : 0.18, 0.09, 0.035, colors.stone);
  }
}

function sword(batch: SolidBatch, x: number, z: number, y: number): void {
  batch.box(x, y, z, 0.035, 0.36, 0.025, colors.steel);
  batch.box(x, y - 0.2, z, 0.13, 0.026, 0.036, "#c79d53");
  batch.box(x, y - 0.27, z, 0.027, 0.12, 0.027, colors.dark);
}

/** New economic buildings are recognisable by silhouette and props, with no image textures. */
export function createWorkshop(kind: BuildingKind, shadows: boolean): THREE.Group | null {
  if (!["wheatFarm", "mill", "bakery", "ironMine", "blacksmith", "well"].includes(kind)) return null;
  const group = new THREE.Group();
  const batch = new SolidBatch();

  if (kind === "wheatFarm") {
    batch.box(0, 0.035, 0, 1.1, 0.06, 1.1, "#a08652");
    for (const x of [-0.55, 0.55]) batch.box(x, 0.075, 0, 0.05, 0.09, 1.14, colors.wood);
    for (let row = 0; row < 5; row += 1) {
      const x = (row - 2) * 0.21;
      batch.box(x, 0.075, 0, 0.07, 0.045, 1.02, "#826a42");
      for (let stem = 0; stem < 5; stem += 1) {
        const z = (stem - 2) * 0.2, height = 0.36 + ((row + stem) % 3) * 0.035;
        batch.beam([x, 0.07, z], [x + 0.026, height, z], 0.011, "#baa052", 4);
        batch.cylinder(x + 0.026, height + 0.055, z, 0.025, 0.037, 0.15, (row + stem) % 2 ? "#e0bb62" : "#efd28a", 5, [0, 0, -0.16]);
        batch.beam([x, height * 0.48, z], [x - 0.075, height * 0.7, z + 0.04], 0.01, "#9e9950", 4);
      }
    }
    addJar(batch, 0.47, 0.04, -0.46, 0.55, "#b1955d");
  } else if (kind === "mill") {
    batch.cylinder(0, 0.58, 0, 0.35, 0.48, 1.16, colors.plaster, 10);
    batch.cylinder(0, 0.1, 0, 0.48, 0.5, 0.19, colors.stone, 10);
    batch.cylinder(0, 1.12, 0, 0.4, 0.4, 0.09, colors.trim, 10);
    batch.cylinder(0, 1.32, 0, 0, 0.46, 0.36, "#9b5e43", 10);
    batch.box(0, 0.24, 0.433, 0.21, 0.4, 0.04, colors.dark);
    batch.box(-0.28, 0.8, 0.29, 0.08, 0.17, 0.04, colors.dark, -0.5);
    addJar(batch, 0.43, 0, 0.29, 0.65, "#c8b17d");
    const sails = new SolidBatch();
    for (let blade = 0; blade < 4; blade += 1) {
      const angle = blade * Math.PI / 2;
      const dx = Math.sin(angle), dy = Math.cos(angle);
      sails.beam([0, 0, 0], [dx * 0.9, dy * 0.9, 0], 0.022, colors.wood);
      for (let slat = 0; slat < 4; slat += 1) {
        const d = 0.34 + slat * 0.135;
        sails.add(new THREE.BoxGeometry(0.25, 0.105, 0.02), slat % 2 ? "#ecd9af" : "#d8c192", [dx * d, dy * d, 0.025], [0, 0, -angle]);
      }
    }
    sails.cylinder(0, 0, 0.025, 0.085, 0.085, 0.14, colors.dark, 8, [Math.PI / 2, 0, 0]);
    const blades = sails.mesh("mill-sails", shadows);
    blades.position.set(0, 1.2, 0.45);
    group.add(blades);
  } else if (kind === "bakery") {
    stoneCourses(batch, 0.18, -0.15, 0.74, 0.85, 0.75);
    batch.box(0.2, 0.88, -0.15, 0.81, 0.09, 0.82, colors.trim);
    batch.box(0.38, 1.06, -0.3, 0.16, 0.43, 0.18, colors.stone);
    batch.box(0.38, 1.29, -0.3, 0.2, 0.08, 0.22, colors.trim);
    batch.box(0.38, 1.335, -0.3, 0.12, 0.006, 0.14, colors.dark);
    batch.cylinder(-0.31, 0.18, 0.12, 0.34, 0.37, 0.36, "#b68257", 12);
    batch.add(new THREE.SphereGeometry(0.34, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), "#d2a778", [-0.31, 0.35, 0.12]);
    batch.box(-0.31, 0.22, 0.43, 0.23, 0.25, 0.025, "#483729");
    batch.box(-0.31, 0.14, 0.45, 0.17, 0.045, 0.02, "#ef9a45");
    batch.box(0.26, 0.33, 0.48, 0.62, 0.08, 0.23, colors.wood);
    for (const x of [0.02, 0.48]) batch.box(x, 0.16, 0.48, 0.045, 0.3, 0.045, colors.wood);
    for (let loaf = 0; loaf < 3; loaf += 1) {
      const x = 0.05 + loaf * 0.2;
      batch.rock(x, 0.415, 0.48, 0.08, "#dbaa59", [0.8, 0.6, 1.1]);
      for (let score = 0; score < 2; score += 1) batch.box(x, 0.455, 0.455 + score * 0.05, 0.075, 0.009, 0.011, "#f4d697", 0.25);
    }
    addJar(batch, -0.54, 0, -0.37, 0.6);
  } else if (kind === "ironMine") {
    batch.rock(0, 0.28, -0.1, 0.65, "#928d78", [0.86, 0.76, 0.72]);
    batch.rock(-0.38, 0.25, -0.2, 0.28, "#707c78", [0.8, 1.1, 0.8]);
    batch.box(0, 0.25, 0.26, 0.38, 0.45, 0.04, "#333e3b");
    for (const x of [-0.23, 0.23]) {
      batch.box(x, 0.28, 0.29, 0.09, 0.55, 0.11, colors.wood);
      batch.beam([x * 1.5, 0.05, 0.38], [x, 0.43, 0.29], 0.027, "#a68559");
    }
    batch.box(0, 0.56, 0.29, 0.58, 0.09, 0.13, "#b19568");
    for (const x of [-0.13, 0.13]) batch.box(x, 0.035, 0.38, 0.025, 0.025, 0.55, colors.steel);
    batch.box(0.18, 0.18, 0.48, 0.31, 0.22, 0.3, colors.dark);
    for (const x of [0, 0.36]) batch.cylinder(x, 0.1, 0.48, 0.065, 0.065, 0.035, colors.steel, 8, [0, 0, Math.PI / 2]);
    for (let ore = 0; ore < 4; ore += 1) batch.rock(0.1 + ore % 2 * 0.16, 0.3, 0.42 + Math.floor(ore / 2) * 0.1, 0.07, "#6c8384");
    batch.beam([-0.49, 0, 0.07], [-0.41, 0.5, 0], 0.018, colors.wood);
    batch.beam([-0.54, 0.48, 0], [-0.28, 0.52, 0], 0.025, colors.steel);
  } else if (kind === "blacksmith") {
    batch.box(0, 0.03, 0, 1.1, 0.06, 1.1, "#a69b80");
    stoneCourses(batch, -0.26, -0.23, 0.48, 0.58, 0.53);
    batch.box(-0.26, 0.43, 0.045, 0.28, 0.27, 0.025, colors.dark);
    batch.box(-0.26, 0.32, 0.065, 0.24, 0.055, 0.02, "#e99137");
    batch.box(-0.29, 0.82, -0.26, 0.22, 0.48, 0.24, colors.stone);
    batch.box(-0.29, 1.08, -0.26, 0.28, 0.08, 0.3, colors.trim);
    awning(batch, 0.14, 0.01, 0.75, 0.86, 0.88, "#89624d");
    batch.cylinder(0.18, 0.17, 0.35, 0.16, 0.18, 0.32, colors.wood, 8);
    batch.box(0.18, 0.4, 0.35, 0.29, 0.1, 0.16, colors.steel);
    batch.cylinder(0.35, 0.405, 0.35, 0, 0.07, 0.2, colors.steel, 6, [0, 0, -Math.PI / 2]);
    batch.box(0.16, 0.48, 0.34, 0.035, 0.045, 0.19, colors.wood, -0.3);
    for (const x of [0.05, 0.4]) batch.box(x, 0.34, -0.4, 0.035, 0.64, 0.05, colors.wood);
    batch.box(0.225, 0.54, -0.4, 0.45, 0.05, 0.06, colors.wood);
    for (const x of [0.1, 0.24, 0.37]) sword(batch, x, -0.375, 0.57);
    addJar(batch, -0.45, 0, 0.4, 0.57, "#697f78");
  } else if (kind === "well") {
    batch.cylinder(0, 0.22, 0, 0.43, 0.46, 0.43, colors.stone, 12);
    batch.cylinder(0, 0.455, 0, 0.33, 0.33, 0.01, "#385d59", 12);
    for (let stone = 0; stone < 12; stone += 1) {
      const angle = stone * Math.PI / 6;
      batch.box(Math.sin(angle) * 0.395, 0.49, Math.cos(angle) * 0.395, 0.19, 0.1, 0.13, stone % 2 ? colors.trim : "#d6c092", angle);
    }
    for (const x of [-0.44, 0.44]) batch.box(x, 0.57, 0, 0.06, 1.14, 0.08, colors.wood);
    batch.beam([-0.51, 1.04, 0], [0.51, 1.04, 0], 0.046, "#a28152");
    batch.beam([0, 1.06, 0], [0, 0.62, 0], 0.012, "#c5ae7a", 4);
    batch.cylinder(0, 0.59, 0, 0.095, 0.075, 0.16, colors.wood, 8);
    batch.cylinder(0, 0.675, 0, 0.09, 0.09, 0.018, "#aeb8a4", 8);
    addJar(batch, 0.51, 0, 0.43, 0.62);
    batch.box(-0.34, 0.02, 0.5, 0.5, 0.035, 0.22, "#b8a777");
  }

  group.add(batch.mesh(`workshop-${kind}`, shadows));
  return group;
}

/** A single extra draw call supplies useful-scale details to existing CC0 silhouettes. */
export function addBuildingDressing(group: THREE.Group, kind: BuildingKind, shadows: boolean): void {
  if (["wall", "gate", "tower", "wheatFarm", "mill", "bakery", "ironMine", "blacksmith", "well"].includes(kind)) return;
  const batch = new SolidBatch();
  if (kind === "keep") {
    batch.box(0, 0.015, 1.12, 0.52, 0.025, 0.74, "#478180");
    for (const x of [-0.24, 0.24]) batch.box(x, 0.03, 1.12, 0.025, 0.018, 0.68, "#ddbb73");
    addJar(batch, -0.8, 0, 0.98, 0.75);
    addCrate(batch, 0.9, 0, 0.75, 0.8);
  } else if (kind === "house") {
    addJar(batch, -0.5, 0, 0.46, 0.6);
    batch.box(0.43, 0.14, 0.43, 0.17, 0.25, 0.25, "#966447");
    for (let sprig = 0; sprig < 4; sprig += 1) batch.beam([0.43, 0.22, 0.43], [0.38 + (sprig % 2) * 0.12, 0.37, 0.37 + Math.floor(sprig / 2) * 0.13], 0.024, "#76925b", 4);
    batch.box(0.16, 0.024, 0.56, 0.36, 0.03, 0.2, "#a77b4e");
  } else if (kind === "lumber") {
    batch.cylinder(0.47, 0.1, 0.5, 0.12, 0.14, 0.2, "#977046", 7);
    batch.beam([0.43, 0.13, 0.5], [0.56, 0.52, 0.5], 0.014, colors.wood);
    batch.box(0.57, 0.49, 0.5, 0.16, 0.08, 0.026, colors.steel);
    batch.box(-0.42, 0.065, 0.42, 0.26, 0.11, 0.13, "#d4b67c");
  } else if (kind === "farm") {
    addJar(batch, -0.51, 0, -0.51, 0.55);
    batch.beam([0.5, 0, -0.48], [0.48, 0.8, -0.48], 0.016, colors.wood);
    batch.beam([0.31, 0.58, -0.48], [0.67, 0.58, -0.48], 0.016, colors.wood);
    batch.box(0.48, 0.52, -0.48, 0.22, 0.25, 0.045, "#c2a66f");
    batch.rock(0.48, 0.75, -0.48, 0.075, "#dcc38b");
  } else if (kind === "barracks" || kind === "archery") {
    addCrate(batch, -0.5, 0, 0.48, 0.7);
    for (const x of [0.28, 0.45]) batch.beam([x, 0, 0.5], [x - 0.06, 0.93, 0.43], 0.014, colors.wood);
    batch.box(0.36, 0.31, 0.5, 0.34, 0.04, 0.06, colors.wood);
    sword(batch, 0.33, 0.52, 0.64);
  } else if (kind === "stable") {
    batch.box(0, 0.1, 0.55, 0.62, 0.19, 0.21, colors.wood);
    batch.box(0, 0.2, 0.55, 0.54, 0.035, 0.13, "#62958e");
    batch.rock(-0.5, 0.15, 0.45, 0.18, "#d7b774", [0.8, 0.85, 1]);
  } else {
    addCrate(batch, -0.47, 0, 0.45, 0.68);
    addJar(batch, 0.5, 0, 0.38, 0.55, kind === "market" ? "#749087" : "#ba9864");
  }
  group.add(batch.mesh(`dressing-${kind}`, shadows));
}
