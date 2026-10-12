import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Original, texture-free miniatures. Model space is Y-up, feet at zero, facing +Z. */
export type CharacterSoldierKind = "spearman" | "archer" | "knight" | "swordsman";
export type VillagerProfession = "resident" | "farmer" | "woodcutter" | "mason" | "merchant" | "baker" | "blacksmith" | "porter";

type Vec3 = readonly [number, number, number];
type Headwear = "wrap" | "helmet" | "straw" | "cap";
type Weapon = "none" | "hoe" | "axe" | "pick" | "hammer" | "bread" | "scroll" | "spear" | "bow" | "sword" | "scimitar";

interface Appearance {
  coat: string;
  trim: string;
  trousers: string;
  skin: string;
  headwear: Headwear;
  beard: boolean;
  weapon: Weapon;
  shield?: boolean;
  armor?: boolean;
  profession?: VillagerProfession;
}

interface HumanParts {
  body: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  leftArm: THREE.BufferGeometry;
  rightArm: THREE.BufferGeometry;
  leftLeg: THREE.BufferGeometry;
  rightLeg: THREE.BufferGeometry;
  leftTool?: THREE.BufferGeometry;
  rightTool?: THREE.BufferGeometry;
}

interface HumanRig {
  type: "human";
  motion: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftTool?: THREE.Group;
  rightTool?: THREE.Group;
  weapon: Weapon;
  shield: boolean;
  mounted: boolean;
  phase: number;
  lastElapsed?: number;
}

interface HorseRig {
  type: "horse";
  motion: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  legs: THREE.Group[];
  rider: THREE.Group;
  phase: number;
  lastElapsed?: number;
}

const rigs = new WeakMap<THREE.Group, HumanRig | HorseRig>();
const humanParts = new Map<string, HumanParts>();
const horseParts = new Map<string, THREE.BufferGeometry>();
let sharedMaterial: THREE.MeshStandardMaterial | null = null;

const colors = {
  leather: "#62452f",
  leatherLight: "#976a40",
  boot: "#3d332b",
  sole: "#242d2b",
  wood: "#98613a",
  woodLight: "#c09858",
  steel: "#a9bbc0",
  steelLight: "#e1e8dc",
  steelDark: "#5f747b",
  brass: "#dfb75a",
  linen: "#e9d6aa",
  linenShadow: "#c8b484",
  dark: "#302d2c",
  bread: "#d49a50",
  breadLight: "#f4d18a",
};

// Primitives are only CPU-side authoring templates; cached merged meshes are uploaded.
const shapes = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 7),
  sleeve: new THREE.CylinderGeometry(0.88, 1, 1, 6),
  sphere: new THREE.SphereGeometry(1, 8, 5),
  rock: new THREE.IcosahedronGeometry(1, 0),
  helmet: new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
  point: new THREE.ConeGeometry(1, 1, 4),
  wrap: new THREE.TorusGeometry(0.112, 0.025, 4, 10),
  torso: createTorsoShape(),
};

/** Every batch is a single colored draw call, including trim, eyes and equipment. */
class Batch {
  private geometries: THREE.BufferGeometry[] = [];

  add(shape: THREE.BufferGeometry, color: string, position: Vec3, scale: Vec3, rotation: Vec3 = [0, 0, 0]): this {
    const geometry = shape.index ? shape.toNonIndexed() : shape.clone();
    geometry.deleteAttribute("uv");
    geometry.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...scale),
    ));
    const tint = new THREE.Color(color);
    const vertexColors = new Float32Array(geometry.getAttribute("position").count * 3);
    for (let i = 0; i < vertexColors.length; i += 3) {
      vertexColors[i] = tint.r;
      vertexColors[i + 1] = tint.g;
      vertexColors[i + 2] = tint.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(vertexColors, 3));
    this.geometries.push(geometry);
    return this;
  }

  box(color: string, position: Vec3, scale: Vec3, rotation?: Vec3): this {
    return this.add(shapes.box, color, position, scale, rotation);
  }

  rod(color: string, start: Vec3, end: Vec3, radius: number): this {
    const from = new THREE.Vector3(...start);
    const to = new THREE.Vector3(...end);
    const direction = to.clone().sub(from);
    const rotation = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()),
    );
    const midpoint = from.add(to).multiplyScalar(0.5);
    return this.add(shapes.cylinder, color, [midpoint.x, midpoint.y, midpoint.z], [radius, direction.length(), radius], [rotation.x, rotation.y, rotation.z]);
  }

  finish(name: string): THREE.BufferGeometry {
    const result = mergeGeometries(this.geometries, false);
    for (const geometry of this.geometries) geometry.dispose();
    if (!result) throw new Error(`Unable to merge character part: ${name}`);
    result.name = name;
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
  }
}

function createTorsoShape(): THREE.BufferGeometry {
  // A broad-shouldered tailored tunic, not a cone or a cylinder.
  const bottom = [[-0.37, -0.5, -0.43], [0.37, -0.5, -0.43], [0.37, -0.5, 0.43], [-0.37, -0.5, 0.43]];
  const top = [[-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]];
  const vertices = [...bottom, ...top];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  const positions: number[] = [];
  for (const [a, b, c, d] of faces) {
    for (const index of [a, c, b, a, d, c]) positions.push(...vertices[index]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function material(): THREE.MeshStandardMaterial {
  sharedMaterial ??= new THREE.MeshStandardMaterial({
    name: "original-miniature-vertex-colors",
    color: "#ffffff",
    vertexColors: true,
    flatShading: true,
    roughness: 0.88,
    metalness: 0.035,
  });
  sharedMaterial.userData.shared = true;
  return sharedMaterial;
}

function mesh(geometry: THREE.BufferGeometry, name: string): THREE.Mesh {
  geometry.userData.shared = true;
  const result = new THREE.Mesh(geometry, material());
  result.name = name;
  result.castShadow = true;
  result.receiveShadow = true;
  result.userData.sharedCharacterGeometry = true;
  return result;
}

function limb(geometry: THREE.BufferGeometry, name: string, position: Vec3): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  group.add(mesh(geometry, `${name}-mesh`));
  return group;
}

/** Accepts either a profession or its workplace building kind. */
export function getVillagerProfession(profession = "resident"): VillagerProfession {
  switch (profession) {
    case "farmer": case "farm": case "wheatFarm": case "well": return "farmer";
    case "woodcutter": case "lumberjack": case "lumber": return "woodcutter";
    case "mason": case "quarry": case "ironMine": case "miner": case "builder": return "mason";
    case "merchant": case "market": return "merchant";
    case "baker": case "bakery": case "mill": case "miller": return "baker";
    case "blacksmith": case "smithy": case "forge": case "workshop": return "blacksmith";
    case "porter": case "granary": case "stockpile": return "porter";
    default: return "resident";
  }
}

export function createVillager(index: number, profession = "resident"): THREE.Group {
  const job = getVillagerProfession(profession);
  const variant = Math.abs(Math.trunc(index)) % 6;
  const palette = ["#619184", "#b88450", "#96765b", "#809b91", "#bb9068", "#758599"];
  const skin = ["#ba825a", "#a16844", "#d09a70", "#8c5a3d", "#ba885f", "#a87652"];
  const weapons: Record<VillagerProfession, Weapon> = {
    resident: "none", farmer: "hoe", woodcutter: "axe", mason: "pick", merchant: "scroll", baker: "bread", blacksmith: "hammer", porter: "none",
  };
  const appearance: Appearance = {
    coat: job === "blacksmith" ? "#657b7c" : job === "baker" ? "#d5be91" : palette[variant],
    trim: variant % 2 === 0 ? colors.linen : "#b8c4b0",
    trousers: variant % 2 === 0 ? "#c6b48f" : "#807764",
    skin: skin[variant],
    headwear: job === "farmer" ? "straw" : job === "baker" ? "cap" : "wrap",
    beard: variant % 3 === 0,
    profession: job,
    weapon: weapons[job],
  };
  const result = createHuman(`villager-${job}-${variant}`, appearance, index * 1.73);
  result.name = `villager-${job}`;
  result.userData.profession = job;
  return result;
}

export function createSoldier(kind: CharacterSoldierKind): THREE.Group {
  if (kind === "knight") return createKnight();
  const appearance: Appearance = {
    coat: kind === "archer" ? "#4a8580" : "#2b777c",
    trim: colors.linen,
    trousers: "#a5a58d",
    skin: "#b67d52",
    headwear: kind === "archer" ? "wrap" : "helmet",
    beard: kind === "spearman",
    weapon: kind === "spearman" ? "spear" : kind === "archer" ? "bow" : "sword",
    shield: kind !== "archer",
    armor: kind !== "archer",
  };
  const result = createHuman(`soldier-${kind}`, appearance);
  result.name = `soldier-${kind}`;
  result.userData.unitKind = kind;
  result.userData.healthTone = "ally";
  return result;
}

export function createRaider(elite = false): THREE.Group {
  const appearance: Appearance = {
    coat: elite ? "#863f32" : "#b6553e",
    trim: elite ? "#c5914e" : "#dbb781",
    trousers: "#656457",
    skin: elite ? "#a6724d" : "#ae754f",
    headwear: elite ? "helmet" : "wrap",
    beard: true,
    weapon: elite ? "axe" : "scimitar",
    shield: elite,
    armor: elite,
  };
  const result = createHuman(`raider-${elite ? "elite" : "scout"}`, appearance);
  result.name = elite ? "raider-captain" : "raider-scout";
  result.scale.setScalar(elite ? 1.055 : 1.015);
  result.userData.healthTone = "enemy";
  result.userData.elite = elite;
  return result;
}

function createHuman(key: string, appearance: Appearance, phase?: number): THREE.Group {
  let parts = humanParts.get(key);
  if (!parts) {
    parts = buildHumanParts(key, appearance);
    humanParts.set(key, parts);
  }
  const root = new THREE.Group();
  root.userData.originalCharacter = true;
  const motion = new THREE.Group();
  motion.name = "character-motion";
  const body = mesh(parts.body, "tailored-body");
  const head = limb(parts.head, "head", [0, 0.82, 0]);
  const leftArm = limb(parts.leftArm, "left-arm", [-0.176, 0.712, 0]);
  const rightArm = limb(parts.rightArm, "right-arm", [0.176, 0.712, 0]);
  const leftLeg = limb(parts.leftLeg, "left-leg", [-0.071, 0.4, 0]);
  const rightLeg = limb(parts.rightLeg, "right-leg", [0.071, 0.4, 0]);
  const leftTool = parts.leftTool ? limb(parts.leftTool, "left-wrist-tool", [0, -0.275, 0.018]) : undefined;
  const rightTool = parts.rightTool ? limb(parts.rightTool, "right-wrist-tool", [0, -0.275, 0.018]) : undefined;
  if (leftTool) leftArm.add(leftTool);
  if (rightTool) rightArm.add(rightTool);
  motion.add(body, head, leftArm, rightArm, leftLeg, rightLeg);
  root.add(motion);
  rigs.set(root, {
    type: "human", motion, body, head, leftArm, rightArm, leftLeg, rightLeg, leftTool, rightTool,
    weapon: appearance.weapon, shield: Boolean(appearance.shield), mounted: false,
    phase: phase ?? (root.id % 31) * 0.61,
  });
  animateCharacter(root, 0, false);
  return root;
}

function buildHumanParts(key: string, appearance: Appearance): HumanParts {
  const body = new Batch();
  body.add(shapes.torso, appearance.coat, [0, 0.592, 0], [0.33, 0.31, 0.22]);
  body.box(appearance.coat, [0, 0.425, 0], [0.251, 0.087, 0.2]);
  body.box(appearance.trim, [0, 0.472, 0.096], [0.245, 0.026, 0.025]);
  body.box(colors.leather, [0, 0.5, 0], [0.262, 0.045, 0.219]);
  body.box(colors.brass, [0.017, 0.499, 0.117], [0.038, 0.032, 0.016]);
  body.box(colors.leather, [0.017, 0.499, 0.129], [0.018, 0.017, 0.012]);
  body.add(shapes.cylinder, appearance.skin, [0, 0.768, 0], [0.047, 0.065, 0.046]);
  body.box(appearance.trim, [-0.055, 0.678, 0.117], [0.032, 0.144, 0.018], [0, 0, -0.53]);
  body.box(appearance.trim, [0.055, 0.678, 0.117], [0.032, 0.144, 0.018], [0, 0, 0.53]);
  body.box(appearance.trim, [0.014, 0.595, 0.114], [0.026, 0.12, 0.018]);
  for (let index = 0; index < 3; index += 1) {
    body.box(colors.brass, [0.016, 0.558 + index * 0.039, 0.127], [0.009, 0.012, 0.007]);
  }
  body.box(colors.leatherLight, [0.137, 0.471, 0.015], [0.075, 0.09, 0.081], [0, 0, -0.08]);
  body.box(colors.brass, [0.137, 0.491, 0.058], [0.018, 0.014, 0.01]);

  if (appearance.armor) {
    body.add(shapes.torso, colors.steelDark, [0, 0.614, 0.002], [0.327, 0.204, 0.242]);
    body.box(appearance.coat, [0, 0.613, 0.128], [0.147, 0.21, 0.022]);
    body.box(appearance.trim, [0, 0.654, 0.143], [0.112, 0.021, 0.012]);
    body.box(appearance.trim, [0, 0.644, 0.145], [0.022, 0.1, 0.012]);
    body.box(colors.steel, [-0.105, 0.683, 0.12], [0.043, 0.038, 0.026], [0, 0, -0.22]);
    body.box(colors.steel, [0.105, 0.683, 0.12], [0.043, 0.038, 0.026], [0, 0, 0.22]);
  }
  if (appearance.weapon === "bow") addQuiver(body);
  if (appearance.profession === "woodcutter") {
    for (let index = 0; index < 3; index += 1) {
      body.add(shapes.cylinder, index === 1 ? colors.woodLight : colors.wood, [(index - 1) * 0.078, 0.607, -0.167], [0.043, 0.35, 0.043], [0, 0, -0.24]);
    }
    body.box(colors.leather, [0, 0.612, -0.213], [0.242, 0.042, 0.018]);
  }
  if (appearance.profession === "porter" || appearance.profession === "merchant") addPack(body, appearance.profession === "merchant");
  if (appearance.profession === "baker" || appearance.profession === "blacksmith") {
    const apron = appearance.profession === "baker" ? colors.linen : colors.leather;
    body.box(apron, [0, 0.573, 0.132], [0.2, 0.249, 0.018]);
    body.box(apron, [0, 0.414, 0.109], [0.215, 0.083, 0.025]);
    body.box(colors.leatherLight, [0, 0.556, 0.147], [0.124, 0.028, 0.008]);
  }

  let rightTool: THREE.BufferGeometry | undefined;
  let leftTool: THREE.BufferGeometry | undefined;
  if (!["none", "bow", "bread"].includes(appearance.weapon)) {
    const tool = new Batch();
    addHandTool(tool, appearance.weapon);
    rightTool = tool.finish(`${key}-hand-tool`).translate(0, 0.275, -0.018);
  }
  if (appearance.weapon === "bow") {
    const bow = new Batch();
    addBow(bow);
    leftTool = bow.finish(`${key}-bow`).translate(0, 0.275, -0.018);
  }

  return {
    body: body.finish(`${key}-body`),
    head: buildHead(appearance).finish(`${key}-head`),
    leftArm: buildArm(appearance, true).finish(`${key}-left-arm`),
    rightArm: buildArm(appearance, false).finish(`${key}-right-arm`),
    leftLeg: buildLeg(appearance).finish(`${key}-left-leg`),
    rightLeg: buildLeg(appearance).finish(`${key}-right-leg`),
    leftTool,
    rightTool,
  };
}

function buildHead(appearance: Appearance): Batch {
  const head = new Batch();
  head.add(shapes.sphere, appearance.skin, [0, 0.043, 0.009], [0.106, 0.122, 0.091]);
  head.add(shapes.sphere, appearance.skin, [-0.104, 0.032, 0.004], [0.018, 0.037, 0.022]);
  head.add(shapes.sphere, appearance.skin, [0.104, 0.032, 0.004], [0.018, 0.037, 0.022]);
  head.add(shapes.rock, appearance.skin, [0, 0.035, 0.098], [0.022, 0.032, 0.03]);
  for (const side of [-1, 1]) {
    head.box(colors.dark, [side * 0.039, 0.062, 0.091], [0.017, 0.012, 0.008]);
    head.box(colors.dark, [side * 0.04, 0.081, 0.087], [0.028, 0.009, 0.009], [0, 0, side * -0.1]);
  }
  head.box("#855539", [0, -0.012, 0.092], [0.038, 0.012, 0.008]);
  if (appearance.beard) {
    head.add(shapes.sphere, colors.dark, [0, -0.035, 0.049], [0.078, 0.053, 0.059]);
    head.box(colors.dark, [0, 0.0, 0.092], [0.058, 0.012, 0.009]);
  }
  if (appearance.headwear === "helmet") {
    head.add(shapes.helmet, colors.steel, [0, 0.093, 0], [0.128, 0.124, 0.119]);
    head.add(shapes.cylinder, colors.steelDark, [0, 0.09, 0], [0.129, 0.035, 0.122]);
    head.box(colors.steelLight, [0, 0.038, 0.119], [0.016, 0.137, 0.018]);
    head.box(colors.steel, [-0.107, 0.005, 0.015], [0.036, 0.105, 0.065]);
    head.box(colors.steel, [0.107, 0.005, 0.015], [0.036, 0.105, 0.065]);
    head.box(appearance.coat, [0, 0.185, -0.016], [0.047, 0.075, 0.1]);
    head.box(appearance.trim, [0, 0.235, -0.04], [0.03, 0.042, 0.098], [-0.2, 0, 0]);
  } else if (appearance.headwear === "straw") {
    head.add(shapes.cylinder, "#d6b765", [0, 0.125, 0], [0.174, 0.025, 0.17]);
    head.add(shapes.helmet, "#e4c477", [0, 0.136, 0], [0.106, 0.092, 0.102]);
    head.add(shapes.cylinder, appearance.coat, [0, 0.144, 0], [0.107, 0.025, 0.103]);
  } else if (appearance.headwear === "cap") {
    head.add(shapes.sphere, colors.linen, [0, 0.134, -0.004], [0.126, 0.068, 0.116]);
    head.add(shapes.cylinder, colors.linenShadow, [0, 0.101, 0], [0.116, 0.029, 0.105]);
  } else {
    head.add(shapes.sphere, appearance.trim, [0, 0.137, -0.005], [0.123, 0.073, 0.113]);
    head.add(shapes.wrap, appearance.coat, [0, 0.102, 0], [1, 0.93, 0.95], [Math.PI / 2, 0.04, -0.07]);
    head.add(shapes.wrap, appearance.trim, [0, 0.137, 0], [0.99, 0.89, 0.82], [Math.PI / 2, -0.08, 0.04]);
    head.box(appearance.trim, [-0.096, 0.017, -0.063], [0.048, 0.162, 0.041], [0.1, 0, -0.17]);
  }
  return head;
}

function buildLeg(appearance: Appearance): Batch {
  const leg = new Batch();
  leg.add(shapes.sleeve, appearance.trousers, [0, -0.079, 0], [0.06, 0.17, 0.061]);
  leg.add(shapes.sleeve, appearance.trousers, [0, -0.219, 0.004], [0.047, 0.159, 0.048]);
  leg.box(colors.boot, [0, -0.338, 0.025], [0.109, 0.124, 0.169]);
  leg.box(colors.sole, [0, -0.384, 0.03], [0.111, 0.031, 0.173]);
  leg.add(shapes.cylinder, colors.leatherLight, [0, -0.278, 0.004], [0.055, 0.039, 0.052]);
  leg.box(colors.linenShadow, [0, -0.244, 0.049], [0.05, 0.014, 0.014]);
  return leg;
}

function buildArm(appearance: Appearance, left: boolean): Batch {
  const arm = new Batch();
  arm.add(shapes.sleeve, appearance.coat, [0, -0.055, 0], [0.068, 0.143, 0.065]);
  arm.add(shapes.sleeve, appearance.skin, [0, -0.187, 0.009], [0.043, 0.151, 0.043]);
  arm.add(shapes.sphere, appearance.skin, [0, -0.275, 0.018], [0.043, 0.049, 0.038]);
  arm.add(shapes.cylinder, appearance.trim, [0, -0.118, 0.002], [0.061, 0.029, 0.056]);
  arm.add(shapes.cylinder, colors.leather, [0, -0.24, 0.016], [0.048, 0.032, 0.044]);
  if (appearance.armor) arm.add(shapes.sphere, colors.steel, [0, -0.014, -0.004], [0.089, 0.055, 0.079]);
  if (left && appearance.shield) addShield(arm, appearance);
  if (left && appearance.weapon === "bread") addBreadBasket(arm);
  return arm;
}

function addShield(batch: Batch, appearance: Appearance): void {
  batch.add(shapes.cylinder, colors.leather, [-0.016, -0.151, 0.096], [0.177, 0.045, 0.181], [Math.PI / 2, 0, 0]);
  batch.add(shapes.cylinder, appearance.trim, [-0.016, -0.151, 0.124], [0.167, 0.018, 0.171], [Math.PI / 2, 0, 0]);
  batch.add(shapes.cylinder, appearance.coat, [-0.016, -0.151, 0.138], [0.145, 0.017, 0.149], [Math.PI / 2, 0, 0]);
  batch.box(colors.brass, [-0.016, -0.151, 0.15], [0.019, 0.228, 0.016]);
  batch.box(colors.brass, [-0.016, -0.151, 0.15], [0.219, 0.019, 0.016]);
  batch.add(shapes.sphere, colors.steelLight, [-0.016, -0.151, 0.165], [0.041, 0.041, 0.024]);
}

function addHandTool(batch: Batch, weapon: Weapon): void {
  if (weapon === "spear") {
    batch.rod(colors.wood, [0.017, -0.635, 0.035], [0.017, 0.71, 0.035], 0.016);
    batch.add(shapes.point, colors.steelLight, [0.017, 0.781, 0.035], [0.048, 0.175, 0.037]);
    batch.box(colors.linen, [0.035, 0.577, 0.035], [0.08, 0.15, 0.019]);
    return;
  }
  if (weapon === "sword" || weapon === "scimitar") {
    batch.rod(colors.leather, [0.013, -0.314, 0.037], [0.013, -0.179, 0.037], 0.023);
    batch.box(colors.brass, [0.013, -0.169, 0.037], [0.143, 0.027, 0.034]);
    if (weapon === "scimitar") {
      batch.box(colors.steel, [0.014, -0.025, 0.037], [0.048, 0.27, 0.022]);
      batch.box(colors.steel, [0.042, 0.153, 0.037], [0.048, 0.153, 0.022], [0, 0, -0.35]);
      batch.add(shapes.point, colors.steelLight, [0.078, 0.239, 0.037], [0.024, 0.075, 0.013], [0, 0, -0.58]);
    } else {
      batch.box(colors.steel, [0.013, 0.039, 0.037], [0.051, 0.387, 0.025]);
      batch.box(colors.steelLight, [0.031, 0.039, 0.051], [0.008, 0.373, 0.004]);
      batch.add(shapes.point, colors.steelLight, [0.013, 0.273, 0.037], [0.034, 0.085, 0.018]);
    }
    return;
  }
  if (["hoe", "axe", "pick", "hammer"].includes(weapon)) {
    const long = weapon === "hoe" || weapon === "pick";
    const top = long ? 0.245 : 0.104;
    batch.rod(colors.wood, [0.016, -0.377, 0.035], [0.016, top, 0.035], 0.018);
    if (weapon === "axe") {
      batch.box(colors.steelDark, [0.061, top - 0.016, 0.035], [0.17, 0.086, 0.035], [0, 0, -0.06]);
      batch.box(colors.steelLight, [0.146, top - 0.022, 0.035], [0.019, 0.119, 0.045], [0, 0, -0.06]);
    } else if (weapon === "pick") {
      batch.rod(colors.steel, [-0.123, top - 0.023, 0.035], [0.133, top + 0.009, 0.035], 0.025);
      batch.add(shapes.point, colors.steelLight, [0.158, top - 0.012, 0.035], [0.026, 0.092, 0.021], [0, 0, -1.97]);
    } else if (weapon === "hoe") {
      batch.box(colors.steelDark, [0.016, top - 0.005, 0.118], [0.096, 0.026, 0.18]);
      batch.box(colors.steel, [0.016, top - 0.017, 0.195], [0.134, 0.033, 0.041]);
    } else {
      batch.box(colors.steelDark, [0.017, top - 0.024, 0.035], [0.153, 0.088, 0.076]);
      batch.box(colors.steel, [-0.063, top - 0.024, 0.035], [0.022, 0.095, 0.083]);
    }
  } else if (weapon === "scroll") {
    batch.add(shapes.cylinder, colors.linen, [0, -0.275, 0.055], [0.034, 0.204, 0.034], [0, 0, Math.PI / 2]);
    batch.add(shapes.cylinder, colors.brass, [0, -0.275, 0.055], [0.038, 0.038, 0.038], [0, 0, Math.PI / 2]);
  }
}

function addBow(batch: Batch): void {
  for (let segment = 0; segment < 6; segment += 1) {
    const a = segment / 6 * Math.PI;
    const b = (segment + 1) / 6 * Math.PI;
    batch.rod(colors.wood, [0, -0.224 + Math.cos(a) * 0.24, 0.04 + Math.sin(a) * 0.113], [0, -0.224 + Math.cos(b) * 0.24, 0.04 + Math.sin(b) * 0.113], 0.016);
  }
  batch.rod(colors.linen, [0, 0.016, 0.04], [0, -0.464, 0.04], 0.004);
  batch.rod(colors.leather, [0, -0.185, 0.15], [0, -0.263, 0.15], 0.022);
}

function addQuiver(batch: Batch): void {
  batch.add(shapes.cylinder, colors.leather, [-0.085, 0.578, -0.167], [0.071, 0.31, 0.071], [0, 0, -0.22]);
  batch.add(shapes.cylinder, colors.leatherLight, [-0.052, 0.713, -0.167], [0.075, 0.035, 0.075], [0, 0, -0.22]);
  batch.box(colors.leather, [0.012, 0.618, 0.139], [0.033, 0.277, 0.018], [0, 0, -0.66]);
  for (let index = 0; index < 3; index += 1) {
    const x = -0.08 + index * 0.032;
    batch.rod(colors.woodLight, [x - 0.027, 0.615, -0.16], [x + 0.011, 0.829, -0.16], 0.005);
    batch.box(colors.linen, [x + 0.009, 0.808, -0.16], [0.024, 0.044, 0.007], [0, 0, -0.18]);
  }
}

function addPack(batch: Batch, merchant: boolean): void {
  const cloth = merchant ? "#a58662" : colors.woodLight;
  batch.box(cloth, [0, 0.609, -0.176], [0.248, 0.259, 0.134], [-0.05, 0, 0]);
  for (const side of [-1, 1]) {
    batch.box(colors.leather, [side * 0.076, 0.642, 0.125], [0.021, 0.184, 0.018], [0, 0, side * -0.14]);
    batch.box(colors.leather, [side * 0.076, 0.609, -0.249], [0.022, 0.256, 0.012]);
  }
  if (!merchant) {
    for (let index = 0; index < 4; index += 1) {
      batch.box(colors.wood, [0, 0.505 + index * 0.064, -0.248], [0.254, 0.018, 0.016]);
    }
    batch.add(shapes.sphere, colors.linen, [-0.047, 0.739, -0.175], [0.096, 0.077, 0.072]);
  } else {
    batch.add(shapes.cylinder, "#809592", [0, 0.771, -0.158], [0.064, 0.314, 0.064], [0, 0, Math.PI / 2]);
    batch.box(colors.leather, [0, 0.771, -0.218], [0.028, 0.117, 0.018]);
  }
}

function addBreadBasket(batch: Batch): void {
  batch.box(colors.woodLight, [0, -0.284, 0.108], [0.245, 0.047, 0.164]);
  batch.box(colors.wood, [0, -0.263, 0.195], [0.252, 0.035, 0.018]);
  for (let index = 0; index < 3; index += 1) {
    const x = (index - 1) * 0.072;
    batch.add(shapes.sphere, colors.bread, [x, -0.24, 0.11], [0.04, 0.039, 0.066]);
    batch.box(colors.breadLight, [x, -0.203, 0.11], [0.043, 0.007, 0.009], [0, -0.3, 0]);
  }
}

function horseGeometry(key: string, build: () => Batch): THREE.BufferGeometry {
  let result = horseParts.get(key);
  if (!result) {
    result = build().finish(`horse-${key}`);
    horseParts.set(key, result);
  }
  return result;
}

function createKnight(): THREE.Group {
  const chestnut = "#91603f";
  const chestnutLight = "#ae8054";
  const mane = "#473a2e";
  const root = new THREE.Group();
  root.name = "soldier-knight";
  root.userData.originalCharacter = true;
  root.userData.unitKind = "knight";
  root.userData.healthTone = "ally";
  const motion = new THREE.Group();
  motion.name = "character-motion";
  const body = horseGeometry("body", () => {
    const batch = new Batch();
    batch.add(shapes.sphere, chestnut, [0, 0.638, -0.017], [0.263, 0.233, 0.478]);
    batch.add(shapes.sphere, chestnutLight, [0, 0.628, 0.284], [0.22, 0.204, 0.188]);
    batch.add(shapes.sleeve, chestnut, [0, 0.877, 0.319], [0.135, 0.51, 0.157], [0.33, 0, 0]);
    batch.box(mane, [0, 0.887, 0.231], [0.062, 0.427, 0.07], [0.33, 0, 0]);
    batch.box("#337b80", [0, 0.816, -0.058], [0.515, 0.085, 0.471]);
    for (const side of [-1, 1]) {
      batch.box("#337b80", [side * 0.248, 0.686, -0.068], [0.047, 0.278, 0.404], [0, 0, side * 0.15]);
      batch.box(colors.brass, [side * 0.274, 0.606, -0.067], [0.022, 0.023, 0.4]);
      batch.box(colors.linen, [side * 0.28, 0.71, -0.074], [0.024, 0.035, 0.132]);
      batch.box(colors.linen, [side * 0.281, 0.707, -0.074], [0.024, 0.139, 0.033]);
      batch.rod(colors.leather, [side * 0.114, 1.077, 0.488], [side * 0.12, 1.091, 0.016], 0.008);
      batch.box(colors.steelDark, [side * 0.279, 0.66, -0.036], [0.067, 0.059, 0.066]);
    }
    batch.box(colors.leather, [0, 0.872, -0.042], [0.331, 0.085, 0.306]);
    batch.add(shapes.cylinder, colors.leatherLight, [0, 0.921, 0.089], [0.036, 0.287, 0.036], [0, 0, Math.PI / 2]);
    batch.add(shapes.cylinder, colors.leatherLight, [0, 0.926, -0.192], [0.042, 0.288, 0.042], [0, 0, Math.PI / 2]);
    return batch;
  });
  const headGeometry = horseGeometry("head", () => {
    const batch = new Batch();
    batch.add(shapes.sphere, chestnut, [0, 0.019, 0.039], [0.106, 0.136, 0.187], [0.28, 0, 0]);
    batch.add(shapes.sphere, chestnutLight, [0, -0.06, 0.182], [0.094, 0.081, 0.119]);
    batch.box("#cbb58c", [0, 0.047, 0.166], [0.025, 0.113, 0.056], [0.49, 0, 0]);
    batch.box(colors.leather, [0, -0.053, 0.226], [0.191, 0.029, 0.054]);
    batch.box(colors.leather, [0, 0.068, 0.019], [0.213, 0.022, 0.16], [0.3, 0, 0]);
    for (const side of [-1, 1]) {
      batch.add(shapes.point, chestnut, [side * 0.064, 0.188, -0.029], [0.034, 0.138, 0.037], [-0.18, 0, side * -0.16]);
      batch.box(colors.dark, [side * 0.099, 0.055, 0.098], [0.015, 0.021, 0.024]);
      batch.box(colors.dark, [side * 0.071, -0.046, 0.283], [0.016, 0.021, 0.012]);
      batch.add(shapes.sphere, colors.brass, [side * 0.104, -0.026, 0.163], [0.02, 0.022, 0.018]);
    }
    batch.box(mane, [0, 0.15, -0.012], [0.061, 0.077, 0.091], [-0.29, 0, 0]);
    return batch;
  });
  const legGeometry = horseGeometry("leg", () => {
    const batch = new Batch();
    batch.add(shapes.sleeve, chestnut, [0, -0.116, 0], [0.061, 0.246, 0.066]);
    batch.add(shapes.sphere, chestnutLight, [0, -0.257, 0.014], [0.05, 0.052, 0.052]);
    batch.add(shapes.sleeve, chestnutLight, [0, -0.365, 0.014], [0.035, 0.204, 0.039]);
    batch.add(shapes.cylinder, "#d0bd95", [0, -0.456, 0.015], [0.04, 0.052, 0.042]);
    batch.box(colors.sole, [0, -0.505, 0.038], [0.086, 0.07, 0.123]);
    return batch;
  });
  const tailGeometry = horseGeometry("tail", () => {
    const batch = new Batch();
    batch.rod(mane, [0, 0, 0], [0, -0.25, -0.108], 0.038);
    batch.add(shapes.sleeve, mane, [0, -0.284, -0.097], [0.055, 0.236, 0.053], [-0.31, 0, 0]);
    return batch;
  });
  const head = limb(headGeometry, "horse-head", [0, 1.021, 0.421]);
  const tail = limb(tailGeometry, "horse-tail", [0, 0.755, -0.456]);
  const legs = [[-0.173, -0.318], [0.173, -0.318], [-0.173, 0.289], [0.173, 0.289]].map(([x, z], index) => limb(legGeometry, `horse-leg-${index}`, [x, 0.548, z]));
  const rider = createHuman("knight-rider", {
    coat: "#2f797c", trim: colors.linen, trousers: "#75888b", skin: "#b6825c", headwear: "helmet", beard: false, weapon: "sword", shield: true, armor: true,
  });
  rider.name = "mounted-rider";
  rider.scale.setScalar(0.76);
  rider.position.set(0, 0.658, -0.072);
  const riderRig = rigs.get(rider) as HumanRig;
  riderRig.mounted = true;
  riderRig.leftLeg.position.x = -0.224;
  riderRig.rightLeg.position.x = 0.224;
  riderRig.lastElapsed = undefined;
  motion.add(mesh(body, "horse-body"), head, tail, ...legs, rider);
  root.add(motion);
  rigs.set(root, { type: "horse", motion, head, tail, legs, rider, phase: (root.id % 31) * 0.61 });
  animateCharacter(root, 0, false);
  return root;
}

/**
 * Feed simulation time, never performance.now(). The root transform is untouched.
 * Repeating the same elapsed value freezes the full pose, even if input changes.
 */
export function animateCharacter(group: THREE.Group, elapsed: number, moving: boolean, inCombat = false, dancing = false): void {
  const rig = rigs.get(group);
  if (!rig || !Number.isFinite(elapsed) || rig.lastElapsed === elapsed) return;
  rig.lastElapsed = elapsed;
  const time = elapsed + rig.phase;
  // Locomotion and combat always win over an emote. This keeps the renderer
  // defensive even if a stale UI frame still reports the dance button active.
  const danceActive = dancing && !moving && !inCombat;
  if (rig.type === "horse") {
    if (danceActive) {
      // Mounted version of the fortress victory step: the horse performs a
      // contained alternating prance while the rider salutes. All offsets are
      // local to the motion rig, so tactical position and heading never drift.
      const beat = time * (Math.PI * 2 / 2.4);
      const prance = Math.sin(beat * 2);
      const bounce = (1 - Math.cos(beat * 4)) * 0.5;
      const sway = Math.sin(beat);
      rig.motion.position.set(0, bounce * 0.026, 0);
      rig.motion.rotation.set(0, sway * 0.025, sway * 0.026);
      rig.legs.forEach((leg, index) => {
        const leftLead = index === 0 || index === 3;
        const lift = Math.max(0, leftLead ? prance : -prance);
        leg.rotation.set(-lift * 0.34, 0, (index % 2 === 0 ? 1 : -1) * lift * 0.025);
      });
      rig.head.rotation.set(-0.045 - bounce * 0.07, sway * 0.045, -sway * 0.025);
      rig.tail.rotation.set(0.08 + bounce * 0.08, Math.sin(beat * 3) * 0.2, 0);
    } else {
      const gait = time * 7.2;
      rig.motion.position.set(0, moving ? Math.abs(Math.sin(gait)) * 0.018 : 0, 0);
      rig.motion.rotation.set(0, 0, 0);
      rig.legs.forEach((leg, index) => {
        const phase = index === 0 || index === 3 ? 0 : Math.PI;
        leg.rotation.set(moving ? Math.sin(gait + phase) * 0.44 : 0, 0, 0);
      });
      rig.head.rotation.set(
        moving ? Math.sin(gait) * 0.035 : Math.sin(time * 0.8) * 0.035,
        moving ? 0 : Math.sin(time * 0.53) * 0.035,
        0,
      );
      rig.tail.rotation.set(0, Math.sin(time * 2.1) * 0.13, 0);
    }
    animateCharacter(rig.rider, elapsed, false, inCombat, danceActive);
    return;
  }

  if (danceActive) {
    // Original "fortress victory step": alternating heel stamps, a restrained
    // shoulder wave, and a proud counter-sway of the head. It is intentionally
    // readable from the strategy camera without resembling a licensed emote.
    const beat = time * (Math.PI * 2 / 2.4);
    const step = Math.sin(beat * 2);
    const sway = Math.sin(beat);
    const wave = Math.sin(beat * 2 + Math.PI / 4);
    const bounce = (1 - Math.cos(beat * 4)) * 0.5;
    const mountedScale = rig.mounted ? 0.55 : 1;
    const equipmentScale = rig.weapon === "none" || rig.weapon === "scroll" || rig.weapon === "bread" ? 1 : 0.58;

    rig.motion.position.set(0, (rig.mounted ? 0.004 : 0.012) + bounce * 0.018 * mountedScale, 0);
    rig.motion.rotation.set(0, sway * 0.045 * mountedScale, sway * 0.07 * mountedScale);
    rig.body.scale.set(1, 1 + bounce * 0.008, 1);
    rig.body.rotation.set(0, -sway * 0.08 * mountedScale, -sway * 0.11 * mountedScale);
    rig.head.rotation.set(-bounce * 0.025, -sway * 0.09 * mountedScale, sway * 0.07 * mountedScale);

    if (rig.mounted) {
      rig.leftLeg.rotation.set(-0.1, 0, -0.34);
      rig.rightLeg.rotation.set(-0.1, 0, 0.34);
      // The shield hand stays composed while the weapon hand gives a clear
      // salute, avoiding large sword arcs through the horse's neck.
      rig.leftArm.rotation.set(-0.3, 0.08, 0.18);
      rig.rightArm.rotation.set(-1.02 - wave * 0.16, -0.08, -0.28 - sway * 0.13);
    } else {
      rig.leftLeg.rotation.set(0.04 + Math.max(0, step) * 0.34, 0, -sway * 0.045);
      rig.rightLeg.rotation.set(0.04 + Math.max(0, -step) * 0.34, 0, sway * 0.045);
      rig.leftArm.rotation.set(-0.88 - wave * 0.24 * equipmentScale, 0.12 * sway, 0.48 + sway * 0.16 * equipmentScale);
      rig.rightArm.rotation.set(-0.88 + wave * 0.24 * equipmentScale, -0.12 * sway, -0.48 - sway * 0.16 * equipmentScale);
    }
    // Keep wrist-held silhouettes controlled while their shoulders celebrate.
    rig.leftTool?.rotation.set(-rig.leftArm.rotation.x, 0, -rig.leftArm.rotation.z * 0.2);
    rig.rightTool?.rotation.set(-rig.rightArm.rotation.x * 0.78, 0, -rig.rightArm.rotation.z * 0.16);
    return;
  }

  const walking = moving && !rig.mounted;
  const gait = Math.sin(time * 6.5);
  const breathe = Math.sin(time * 1.7);
  // Reset every axis touched by the dance branch. Without these full sets an
  // emote would leak a torso twist or wrist roll into idle/combat afterwards.
  rig.motion.position.set(0, walking ? Math.abs(Math.sin(time * 13)) * 0.008 : 0, 0);
  rig.motion.rotation.set(0, 0, 0);
  rig.body.scale.set(1, 1 + breathe * 0.004, 1);
  rig.body.rotation.set(0, 0, walking ? gait * 0.018 : 0);
  rig.head.rotation.set(
    walking ? 0.025 : breathe * 0.018,
    inCombat ? 0 : Math.sin(time * 0.74) * (walking ? 0.025 : 0.075),
    0,
  );
  rig.leftLeg.rotation.set(walking ? gait * 0.43 : rig.mounted ? -0.1 : 0, 0, rig.mounted ? -0.34 : 0);
  rig.rightLeg.rotation.set(walking ? -gait * 0.43 : rig.mounted ? -0.1 : 0, 0, rig.mounted ? 0.34 : 0);
  const toolHeld = rig.weapon !== "none" && rig.weapon !== "scroll";
  const armSwing = walking ? gait * (toolHeld ? 0.15 : 0.31) : breathe * 0.018;
  rig.leftArm.rotation.set(-armSwing - (rig.shield ? 0.12 : 0), 0, 0.055);
  rig.rightArm.rotation.set(armSwing - (toolHeld ? 0.1 : 0), 0, -0.055);
  // Wrist pivots preserve the tool's grip while the shoulder moves. In particular,
  // a raised bow stays upright instead of tilting with the entire arm.
  rig.leftTool?.rotation.set(-rig.leftArm.rotation.x, 0, 0);
  rig.rightTool?.rotation.set(-rig.rightArm.rotation.x * 0.7, 0, 0);
  if (rig.weapon === "bread") rig.leftArm.rotation.x = -0.37;
  if (inCombat) {
    const attack = Math.max(0, Math.sin(time * 7.4));
    if (rig.weapon === "bow") {
      rig.leftArm.rotation.set(-1.15, -0.05, -0.04);
      rig.rightArm.rotation.set(-0.88 - attack * 0.12, -0.22, 0.38 + attack * 0.09);
      rig.leftTool?.rotation.set(1.15, 0, 0);
    } else {
      rig.rightArm.rotation.x = rig.weapon === "spear" ? -1.12 - attack * 0.25 : -0.48 - attack * 0.45;
      rig.rightArm.rotation.z = -0.1 - attack * 0.17;
      rig.leftArm.rotation.x = rig.shield ? -0.27 : -0.1;
      const bladeAngle = rig.weapon === "spear" ? 1.34 : 0.2 + attack * 1.2;
      rig.rightTool?.rotation.set(bladeAngle - rig.rightArm.rotation.x, 0, 0);
    }
  }
}

/** Call once at renderer teardown, never when an individual unit is removed. */
export function disposeCharacterResources(): void {
  for (const parts of humanParts.values()) {
    for (const geometry of Object.values(parts)) geometry?.dispose();
  }
  for (const geometry of horseParts.values()) geometry.dispose();
  humanParts.clear();
  horseParts.clear();
  sharedMaterial?.dispose();
  sharedMaterial = null;
}
