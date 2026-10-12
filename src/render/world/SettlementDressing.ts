import * as THREE from "three";
import { GRID_SIZE, TILE_SIZE } from "../../game/content";
import type { BuildingKind, BuildingState, GridPoint, MissionDefinition } from "../../game/types";
import { disposeEntity } from "../objects/EntityDisposal";
import { SolidBatch } from "./SolidBatch";

type Zones = MissionDefinition["resourceZones"];
type Site = Pick<BuildingState, "id" | "kind" | "gx" | "gz">;
interface Point { x: number; z: number }

export interface SettlementEntrance {
  buildingId: number;
  kind: BuildingKind;
  cell: GridPoint;
  direction: GridPoint;
  doorstep: Point;
  connected: boolean;
}

export interface SettlementStreetPlan {
  cells: GridPoint[];
  edges: Array<{ from: GridPoint; to: GridPoint }>;
  entrances: SettlementEntrance[];
  routes: Array<{ buildingId: number; cells: GridPoint[] }>;
}

const COLORS = {
  sand: "#d1ab78", apron: "#d6b889", stone: "#dccca7",
  stoneWarm: "#d4c19b", trim: "#b58e5d", teal: "#327e77",
} as const;
const GROUND = { feather: 0.018, road: 0.025, apron: 0.029, paving: 0.038 } as const;
const DIRECTIONS = [{ gx: 0, gz: 1 }, { gx: 1, gz: 0 }, { gx: -1, gz: 0 }, { gx: 0, gz: -1 }] as const;
const ROAD_RADIUS = 0.22;
const ROAD_FEATHER = 0.13;
const nodeId = ({ gx, gz }: GridPoint): number => gz * GRID_SIZE + gx;
const pointAt = (id: number): GridPoint => ({ gx: id % GRID_SIZE, gz: Math.floor(id / GRID_SIZE) });
const inBounds = ({ gx, gz }: GridPoint): boolean => Number.isInteger(gx) && Number.isInteger(gz) && gx >= 0 && gz >= 0 && gx < GRID_SIZE && gz < GRID_SIZE;
const world = (cell: number): number => (cell - (GRID_SIZE - 1) / 2) * TILE_SIZE;
const worldPoint = (point: GridPoint): Point => ({ x: world(point.gx), z: world(point.gz) });
const edgeKey = (a: number, b: number): string => a < b ? `${a}:${b}` : `${b}:${a}`;

/** Pure, cosmetic street graph. It never changes construction, collisions or simulation paths. */
export function planSettlementStreets(buildings: readonly Site[], zones: Zones): SettlementStreetPlan {
  const sites = buildings.filter(inBounds).slice().sort((a, b) => a.id - b.id);
  const keep = sites.find((building) => building.kind === "keep");
  const occupied = new Set(sites.filter((building) => building.kind !== "gate").map(nodeId));
  const gates = new Map<number, "x" | "z">();
  const fortifications = new Set(sites.filter((building) => ["wall", "gate", "tower"].includes(building.kind)).map(nodeId));
  for (const zone of Object.values(zones)) if (inBounds(zone)) occupied.add(nodeId(zone));

  // The visual citadel is deliberately larger than one cell. Do not send a road
  // through its north range or side towers; its narrow southern courtyard is open.
  if (keep) for (const dx of [-1, 0, 1]) for (const dz of [-1, 0]) {
    const point = { gx: keep.gx + dx, gz: keep.gz + dz };
    if (inBounds(point)) occupied.add(nodeId(point));
  }
  for (const gate of sites.filter((building) => building.kind === "gate")) {
    const neighbour = (dx: number, dz: number): number => {
      const point = { gx: gate.gx + dx, gz: gate.gz + dz };
      return inBounds(point) && fortifications.has(nodeId(point)) ? 1 : 0;
    };
    // Match GameRenderer: side-wall neighbours rotate the gate's open passage.
    gates.set(nodeId(gate), neighbour(0, -1) + neighbour(0, 1) > neighbour(-1, 0) + neighbour(1, 0) ? "x" : "z");
  }
  const walkable = (point: GridPoint): boolean => inBounds(point) && !occupied.has(nodeId(point));
  const traversable = (from: GridPoint, to: GridPoint): boolean => {
    if (!walkable(from) || !walkable(to)) return false;
    for (const point of [from, to]) {
      const axis = gates.get(nodeId(point));
      if (axis === "x" && from.gz !== to.gz) return false;
      if (axis === "z" && from.gx !== to.gx) return false;
    }
    return true;
  };

  const network = new Set<number>();
  const edges = new Map<string, { from: GridPoint; to: GridPoint }>();
  const entrances: SettlementEntrance[] = [];
  const routes: SettlementStreetPlan["routes"] = [];
  const addRoute = (route: GridPoint[]): void => {
    route.forEach((point) => network.add(nodeId(point)));
    for (let index = 1; index < route.length; index += 1) {
      const from = route[index - 1], to = route[index];
      edges.set(edgeKey(nodeId(from), nodeId(to)), { from, to });
    }
  };
  const routeToNetwork = (start: GridPoint): GridPoint[] | null => {
    if (!network.size) return [start];
    const previous = new Int16Array(GRID_SIZE * GRID_SIZE).fill(-2);
    const queue = [nodeId(start)];
    previous[queue[0]] = -1;
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      if (network.has(current)) {
        const route: GridPoint[] = [];
        for (let cursor = current; cursor !== -1; cursor = previous[cursor]) route.push(pointAt(cursor));
        return route.reverse();
      }
      const from = pointAt(current);
      for (const direction of DIRECTIONS) {
        const to = { gx: from.gx + direction.gx, gz: from.gz + direction.gz };
        if (!traversable(from, to)) continue;
        const next = nodeId(to);
        if (previous[next] !== -2) continue;
        previous[next] = current;
        queue.push(next);
      }
    }
    return null;
  };

  const ordered = sites.filter((site) => site.kind !== "wall" && site.kind !== "tower").sort((a, b) => {
    if (a.kind === "keep") return -1;
    if (b.kind === "keep") return 1;
    const distance = (site: Site): number => Math.abs(site.gx - (keep?.gx ?? 8)) + Math.abs(site.gz - (keep?.gz ?? 8));
    return distance(a) - distance(b) || a.id - b.id;
  });
  for (const building of ordered) {
    const isGate = building.kind === "gate";
    const directions: readonly GridPoint[] = isGate
      ? [gates.get(nodeId(building)) === "x" ? DIRECTIONS[1] : DIRECTIONS[0]]
      : building.kind === "keep" ? [DIRECTIONS[0]] : DIRECTIONS;
    const candidates = directions.map((direction) => ({
      direction,
      cell: isGate ? { gx: building.gx, gz: building.gz } : { gx: building.gx + direction.gx, gz: building.gz + direction.gz },
    })).filter(({ cell }) => walkable(cell));
    if (!candidates.length) continue;
    let selected = candidates[0];
    let route: GridPoint[] | null = null;
    // Prefer the real +Z doorway. Other open sides are a last resort when the
    // player has built directly against it; never jump over an occupied cell.
    for (const candidate of candidates) {
      const result = routeToNetwork(candidate.cell);
      if (result) { selected = candidate; route = result; break; }
    }
    const centre = worldPoint(building);
    const doorOffset = isGate ? 0 : building.kind === "keep" ? 1.035 : 0.615;
    entrances.push({
      buildingId: building.id, kind: building.kind, cell: selected.cell,
      direction: { ...selected.direction }, connected: route !== null,
      doorstep: { x: centre.x + selected.direction.gx * doorOffset, z: centre.z + selected.direction.gz * doorOffset },
    });
    if (!route) continue;
    addRoute(route);
    routes.push({ buildingId: building.id, cells: route });
    if (isGate) for (const sign of [-1, 1]) {
      const mouth = { gx: building.gx + selected.direction.gx * sign, gz: building.gz + selected.direction.gz * sign };
      if (traversable(selected.cell, mouth)) addRoute([selected.cell, mouth]);
    }
  }
  return {
    cells: [...network].sort((a, b) => a - b).map(pointAt),
    edges: [...edges.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, edge]) => edge),
    entrances, routes,
  };
}

/** Vertex alpha supplies a soft sand edge without adding a ground texture. */
class FeatherBatch {
  private positions: number[] = [];
  private colors: number[] = [];
  private readonly tint = new THREE.Color(COLORS.sand);

  private triangle(a: Point, b: Point, c: Point, alphaA: number, alphaB: number, alphaC: number): void {
    if ((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x) > 0) {
      [b, c] = [c, b]; [alphaB, alphaC] = [alphaC, alphaB];
    }
    for (const [point, alpha] of [[a, alphaA], [b, alphaB], [c, alphaC]] as const) {
      this.positions.push(point.x, GROUND.feather, point.z);
      this.colors.push(this.tint.r, this.tint.g, this.tint.b, alpha);
    }
  }

  private quad(a: Point, b: Point, c: Point, d: Point): void {
    this.triangle(a, b, c, 0.72, 0.72, 0);
    this.triangle(a, c, d, 0.72, 0, 0);
  }

  ribbon(from: Point, to: Point, radius: number): void {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length < 0.001) return;
    const dx = -(to.z - from.z) / length, dz = (to.x - from.x) / length;
    for (const sign of [-1, 1]) {
      const offset = (point: Point, distance: number): Point => ({ x: point.x + dx * distance * sign, z: point.z + dz * distance * sign });
      this.quad(offset(from, radius), offset(to, radius), offset(to, radius + ROAD_FEATHER), offset(from, radius + ROAD_FEATHER));
    }
  }

  ellipse(centre: Point, rx: number, rz = rx): void {
    for (let index = 0; index < 20; index += 1) {
      const a = index * Math.PI / 10, b = (index + 1) * Math.PI / 10;
      const point = (angle: number, feather: number): Point => ({ x: centre.x + Math.cos(angle) * (rx + feather), z: centre.z + Math.sin(angle) * (rz + feather) });
      this.quad(point(a, 0), point(b, 0), point(b, ROAD_FEATHER), point(a, ROAD_FEATHER));
    }
  }

  mesh(): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 4));
    const normals = new Float32Array(this.positions.length);
    for (let index = 1; index < normals.length; index += 3) normals[index] = 1;
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true, transparent: true, depthWrite: false, roughness: 1,
    }));
    mesh.name = "settlement-soft-sand-edges";
    mesh.receiveShadow = true;
    return mesh;
  }
}

function flatRectangle(batch: SolidBatch, centre: Point, width: number, depth: number, y: number, color: string, yaw = 0): void {
  const geometry = new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2).rotateY(yaw);
  batch.add(geometry, color, [centre.x, y, centre.z]);
}

function flatEllipse(batch: SolidBatch, centre: Point, rx: number, rz: number, y: number, color: string): void {
  const geometry = new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  batch.add(geometry, color, [centre.x, y, centre.z], [0, 0, 0], [rx, 1, rz]);
}

function sandRibbon(batch: SolidBatch, feather: FeatherBatch, from: Point, to: Point): void {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  if (length < 0.001) return;
  flatRectangle(batch, { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 }, ROAD_RADIUS * 2, length, GROUND.road, COLORS.sand, Math.atan2(to.x - from.x, to.z - from.z));
  feather.ribbon(from, to, ROAD_RADIUS);
}

function localPoint(entrance: SettlementEntrance, across: number, along: number): Point {
  const centre = worldPoint(entrance.cell);
  return { x: centre.x + entrance.direction.gz * across + entrance.direction.gx * along, z: centre.z - entrance.direction.gx * across + entrance.direction.gz * along };
}

function addPaving(batch: SolidBatch, entrance: SettlementEntrance): void {
  const grand = entrance.kind === "keep" || entrance.kind === "market";
  const yaw = Math.atan2(entrance.direction.gx, entrance.direction.gz);
  if (grand) {
    // A small, legible forecourt rather than a repeating texture over the map.
    const rows = entrance.kind === "keep" ? 4 : 3;
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < 4; column += 1) {
      const point = localPoint(entrance, (column - 1.5) * 0.215, (row - (rows - 1) / 2) * 0.19);
      flatRectangle(batch, point, 0.202, 0.177, GROUND.paving, (row + column) % 3 === 0 ? COLORS.stoneWarm : COLORS.stone, yaw);
    }
    if (entrance.kind === "keep") {
      for (const across of [-0.095, 0.095]) flatRectangle(batch, localPoint(entrance, across, 0), 0.085, 0.085, 0.041, COLORS.teal, yaw + Math.PI / 4);
      for (const along of [-0.39, 0.39]) flatRectangle(batch, localPoint(entrance, 0, along), 0.90, 0.026, 0.043, COLORS.trim, yaw);
    }
    return;
  }
  if (["farm", "wheatFarm", "ironMine", "quarry"].includes(entrance.kind)) return;
  const centre = worldPoint(entrance.cell);
  const dx = centre.x - entrance.doorstep.x, dz = centre.z - entrance.doorstep.z;
  const length = Math.hypot(dx, dz);
  const rows = entrance.kind === "gate" ? 5 : 3;
  for (let index = 0; index < rows; index += 1) {
    const fraction = (index + 0.5) / rows;
    const point = entrance.kind === "gate"
      ? localPoint(entrance, 0, (index - 2) * 0.18)
      : { x: entrance.doorstep.x + dx * fraction, z: entrance.doorstep.z + dz * fraction };
    flatRectangle(batch, point, entrance.kind === "gate" ? 0.47 : 0.34, entrance.kind === "gate" ? 0.16 : Math.min(0.17, length / rows * 0.84), GROUND.paving, entrance.kind === "lumber" ? COLORS.trim : index % 2 ? COLORS.stoneWarm : COLORS.stone, yaw);
  }
}

function addForecourtMarkers(batch: SolidBatch, entrance: SettlementEntrance): void {
  // Two low, grouped boundary stones frame a real forecourt. They live entirely
  // in its free cell and disappear on rebuild if construction occupies that cell.
  for (const side of [-1, 1]) {
    const point = localPoint(entrance, side * 0.46, 0.24);
    batch.cylinder(point.x, 0.043, point.z, 0.087, 0.09, 0.035, COLORS.stoneWarm, 6);
    batch.cylinder(point.x, 0.128, point.z, 0.052, 0.073, 0.16, COLORS.stone, 6);
    batch.cylinder(point.x, 0.178, point.z, 0.058, 0.058, 0.024, COLORS.teal, 6);
    batch.cylinder(point.x, 0.215, point.z, 0.068, 0.064, 0.025, COLORS.trim, 6);
  }
}

/** Three texture-free batches, rebuilt only when the settlement's topology changes. */
export class SettlementDressing {
  readonly group = new THREE.Group();
  private signature = "";
  private disposed = false;
  private revision = 0;

  constructor() { this.group.name = "settlement-dressing"; }

  sync(buildings: readonly BuildingState[], zones: Zones): void {
    if (this.disposed) return;
    const signature = buildings.map(({ id, kind, gx, gz }) => `${id}:${kind}:${gx}:${gz}`).sort().join("|")
      + ";" + (["lumber", "quarry", "iron", "fertile"] as const).map((key) => `${zones[key].gx}:${zones[key].gz}`).join("|");
    if (signature === this.signature) return;
    this.signature = signature;
    for (const child of [...this.group.children]) disposeEntity(child);
    this.revision += 1;
    const plan = planSettlementStreets(buildings, zones);
    this.group.userData.revision = this.revision;
    this.group.userData.streetCells = plan.cells.length;
    this.group.userData.connectedBuildings = plan.entrances.filter((entrance) => entrance.connected).length;
    this.group.userData.forecourtMarkers = 0;
    if (!plan.entrances.length) return;

    const ground = new SolidBatch(), props = new SolidBatch(), feather = new FeatherBatch();
    const entranceCells = new Set(plan.entrances.map((entrance) => nodeId(entrance.cell)));
    const position = (point: GridPoint): Point => {
      const centre = worldPoint(point);
      // A little survey irregularity between doorways avoids ruler-perfect ribbons.
      if (!entranceCells.has(nodeId(point))) {
        centre.x += Math.sin(point.gx * 2.17 + point.gz * 4.31) * 0.035;
        centre.z += Math.sin(point.gx * 5.13 - point.gz * 1.79) * 0.035;
      }
      return centre;
    };
    for (const edge of plan.edges) sandRibbon(ground, feather, position(edge.from), position(edge.to));
    for (const cell of plan.cells) {
      const centre = position(cell);
      flatEllipse(ground, centre, ROAD_RADIUS, ROAD_RADIUS, GROUND.road, COLORS.sand);
      feather.ellipse(centre, ROAD_RADIUS);
    }
    let markerCount = 0;
    for (const entrance of plan.entrances) {
      const centre = worldPoint(entrance.cell);
      if (entrance.kind !== "gate") {
        sandRibbon(ground, feather, entrance.doorstep, centre);
        const grand = entrance.kind === "keep" || entrance.kind === "market";
        const rx = grand ? 0.49 : 0.28, rz = grand ? 0.44 : 0.30;
        flatEllipse(ground, centre, rx, rz, GROUND.apron, COLORS.apron);
        feather.ellipse(centre, rx, rz);
      }
      addPaving(ground, entrance);
      if (entrance.connected && (entrance.kind === "keep" || entrance.kind === "market")) {
        addForecourtMarkers(props, entrance);
        markerCount += 2;
      }
    }
    this.group.add(ground.mesh("settlement-streets-and-courtyards", false));
    this.group.add(feather.mesh());
    if (markerCount) this.group.add(props.mesh("settlement-forecourt-markers", true));
    this.group.userData.forecourtMarkers = markerCount;
  }

  /** Static street furniture deliberately has no wall-clock animation or pause drift. */
  update(_elapsed: number, _paused: boolean): void { /* Simulation time cannot move a road. */ }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    disposeEntity(this.group);
  }
}
