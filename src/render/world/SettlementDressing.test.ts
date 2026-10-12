import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GRID_SIZE, MISSION_LIST, TILE_SIZE } from "../../game/content";
import { GameSimulation } from "../../game/simulation";
import type { BuildingKind, BuildingState, MissionDefinition } from "../../game/types";
import { planSettlementStreets, SettlementDressing } from "./SettlementDressing";

const zones: MissionDefinition["resourceZones"] = {
  lumber: { gx: 1, gz: 1 }, quarry: { gx: 16, gz: 1 },
  iron: { gx: 16, gz: 16 }, fertile: { gx: 1, gz: 16 },
};
const site = (id: number, kind: BuildingKind, gx: number, gz: number): BuildingState => ({
  id, kind, gx, gz, hp: 100, maxHp: 100, cooldown: 0, efficiency: 1, enabled: true, priority: "normal",
});
const key = ({ gx, gz }: { gx: number; gz: number }): string => `${gx}:${gz}`;
const simpleTown = (): BuildingState[] => [site(1, "keep", 8, 8), site(2, "house", 7, 9), site(3, "market", 11, 10), site(4, "bakery", 6, 12)];
const meshes = (group: THREE.Group): THREE.Mesh[] => {
  const result: THREE.Mesh[] = [];
  group.traverse((node) => { if (node instanceof THREE.Mesh) result.push(node); });
  return result;
};

describe("settlement street planning", () => {
  it("connects the actual doorways without mutating the snapshot", () => {
    const buildings = simpleTown().map((building) => Object.freeze(building));
    const before = JSON.stringify(buildings);
    const plan = planSettlementStreets(Object.freeze(buildings), zones);
    expect(JSON.stringify(buildings)).toBe(before);
    expect(plan.entrances.map((entrance) => entrance.buildingId).sort()).toEqual([1, 2, 3, 4]);
    expect(plan.entrances.every((entrance) => entrance.connected)).toBe(true);
    expect(plan.entrances.every((entrance) => entrance.direction.gx === 0 && entrance.direction.gz === 1)).toBe(true);
    expect(plan.edges.length).toBeGreaterThan(2);
    const occupied = new Set(buildings.map(key));
    const resources = new Set(Object.values(zones).map(key));
    for (const cell of plan.cells) {
      expect(occupied.has(key(cell))).toBe(false);
      expect(resources.has(key(cell))).toBe(false);
      expect(cell.gx >= 0 && cell.gz >= 0 && cell.gx < GRID_SIZE && cell.gz < GRID_SIZE).toBe(true);
    }
  });

  it("does not draw a fictitious passage through a sealed wall", () => {
    const buildings = [site(1, "keep", 8, 8), site(2, "house", 8, 14)];
    for (let gx = 0; gx < GRID_SIZE; gx += 1) buildings.push(site(10 + gx, "wall", gx, 11));
    const plan = planSettlementStreets(buildings, zones);
    expect(plan.entrances.find((entrance) => entrance.buildingId === 2)?.connected).toBe(false);
    expect(plan.routes.some((route) => route.buildingId === 2)).toBe(false);
    expect(plan.cells.every((cell) => cell.gz < 11)).toBe(true);
  });

  it.each(["z", "x"] as const)("uses only the open %s axis of a gate", (axis) => {
    const buildings = [site(1, "keep", 8, 8), site(2, "house", axis === "z" ? 8 : 14, axis === "z" ? 14 : 8)];
    for (let coordinate = 0; coordinate < GRID_SIZE; coordinate += 1) {
      buildings.push(site(10 + coordinate, coordinate === 8 ? "gate" : "wall", axis === "z" ? coordinate : 11, axis === "z" ? 11 : coordinate));
    }
    const plan = planSettlementStreets(buildings, zones);
    const gate = buildings.find((building) => building.kind === "gate")!;
    expect(plan.entrances.find((entrance) => entrance.buildingId === 2)?.connected).toBe(true);
    const gateEdges = plan.edges.filter((edge) => key(edge.from) === key(gate) || key(edge.to) === key(gate));
    expect(gateEdges).toHaveLength(2);
    for (const edge of gateEdges) {
      expect(axis === "z" ? edge.from.gx === edge.to.gx : edge.from.gz === edge.to.gz).toBe(true);
    }
    const wallCells = new Set(buildings.filter((building) => building.kind === "wall").map(key));
    expect(plan.cells.some((cell) => wallCells.has(key(cell)))).toBe(false);
  });

  it("leaves room around the wider citadel instead of clipping its towers", () => {
    const buildings = [site(1, "keep", 8, 8), site(2, "house", 8, 4), site(3, "blacksmith", 12, 8)];
    const plan = planSettlementStreets(buildings, zones);
    expect(plan.entrances.every((entrance) => entrance.connected)).toBe(true);
    const excluded = new Set(["7:7", "8:7", "9:7", "7:8", "8:8", "9:8"]);
    expect(plan.cells.some((cell) => excluded.has(key(cell)))).toBe(false);
    const entrance = plan.entrances.find((item) => item.kind === "keep")!;
    expect(entrance.cell).toEqual({ gx: 8, gz: 9 });
    expect(entrance.doorstep.z).toBeCloseTo((8 - (GRID_SIZE - 1) / 2) * TILE_SIZE + 1.035);
  });

  it("removes door furniture when construction occupies its courtyard", () => {
    const buildings = [site(1, "keep", 8, 8), site(2, "market", 11, 10)];
    const open = planSettlementStreets(buildings, zones);
    expect(open.entrances.find((entry) => entry.kind === "keep")?.cell).toEqual({ gx: 8, gz: 9 });
    buildings.push(site(3, "house", 8, 9), site(4, "wall", 11, 11));
    const blocked = planSettlementStreets(buildings, zones);
    expect(blocked.entrances.some((entry) => entry.kind === "keep")).toBe(false);
    expect(blocked.entrances.find((entry) => entry.kind === "market")?.cell).not.toEqual({ gx: 11, gz: 11 });
    const occupied = new Set(buildings.map(key));
    expect(blocked.entrances.some((entry) => occupied.has(key(entry.cell)))).toBe(false);
  });

  it("is independent of snapshot array order and has no duplicate road edges", () => {
    const buildings = simpleTown();
    const first = planSettlementStreets(buildings, zones);
    expect(planSettlementStreets([...buildings].reverse(), zones)).toEqual(first);
    const keys = first.edges.map(({ from, to }) => [key(from), key(to)].sort().join("|"));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("batched, texture-free settlement geometry", () => {
  it.each(MISSION_LIST)("uses at most three finite drawables in $id", (mission) => {
    const simulation = new GameSimulation();
    simulation.selectMission(mission.id);
    const snapshot = simulation.snapshot;
    const dressing = new SettlementDressing();
    dressing.sync(snapshot.buildings, snapshot.resourceZones);
    const drawables = meshes(dressing.group);
    expect(drawables.length).toBeGreaterThanOrEqual(2);
    expect(drawables.length).toBeLessThanOrEqual(3);
    let vertices = 0;
    for (const mesh of drawables) {
      const position = mesh.geometry.getAttribute("position");
      const normal = mesh.geometry.getAttribute("normal");
      const color = mesh.geometry.getAttribute("color");
      expect([...position.array].every(Number.isFinite)).toBe(true);
      expect([...normal.array].every(Number.isFinite)).toBe(true);
      expect([...color.array].every(Number.isFinite)).toBe(true);
      expect(normal.count).toBe(position.count);
      expect(color.count).toBe(position.count);
      vertices += position.count;
      const material = mesh.material as THREE.MeshStandardMaterial;
      expect(material.map).toBeNull();
      expect(material.normalMap).toBeNull();
      expect(material.roughnessMap).toBeNull();
      expect(material.vertexColors).toBe(true);
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox!;
      expect(bounds.min.x).toBeGreaterThanOrEqual(-GRID_SIZE * TILE_SIZE / 2);
      expect(bounds.max.x).toBeLessThanOrEqual(GRID_SIZE * TILE_SIZE / 2);
      expect(bounds.min.z).toBeGreaterThanOrEqual(-GRID_SIZE * TILE_SIZE / 2);
      expect(bounds.max.z).toBeLessThanOrEqual(GRID_SIZE * TILE_SIZE / 2);
      expect(bounds.min.y).toBeGreaterThanOrEqual(0.015);
      if (mesh.name !== "settlement-forecourt-markers") {
        expect(bounds.max.y).toBeLessThanOrEqual(0.045);
        expect(mesh.castShadow).toBe(false);
      } else expect(bounds.max.y).toBeLessThan(0.25);
    }
    expect(vertices).toBeGreaterThan(100);
    expect(vertices).toBeLessThan(30_000);
    const feather = drawables.find((mesh) => mesh.name === "settlement-soft-sand-edges")!;
    expect(feather.geometry.getAttribute("color").itemSize).toBe(4);
    expect((feather.material as THREE.MeshStandardMaterial).transparent).toBe(true);
    expect((feather.material as THREE.MeshStandardMaterial).depthWrite).toBe(false);
    const alphas = Array.from(feather.geometry.getAttribute("color").array).filter((_, index) => index % 4 === 3);
    expect(Math.min(...alphas)).toBe(0);
    expect(Math.max(...alphas)).toBeCloseTo(0.72);
    dressing.dispose();
  });

  it("stays batched in a large player-built town", () => {
    const buildings = [site(1, "keep", 8, 8)];
    for (let gz = 1; gz < 17; gz += 2) for (let gx = 1; gx < 17; gx += 2) {
      if (Object.values(zones).some((zone) => zone.gx === gx && zone.gz === gz)) continue;
      buildings.push(site(buildings.length + 1, buildings.length % 6 === 0 ? "market" : "house", gx, gz));
    }
    const dressing = new SettlementDressing();
    dressing.sync(buildings, zones);
    expect(meshes(dressing.group)).toHaveLength(3);
    expect(meshes(dressing.group).reduce((sum, mesh) => sum + mesh.geometry.getAttribute("position").count, 0)).toBeLessThan(100_000);
    expect(dressing.group.userData.connectedBuildings).toBeGreaterThan(50);
    dressing.dispose();
  });

  it("keeps paving and feather faces upward for the real WebGL back-face test", () => {
    const dressing = new SettlementDressing();
    dressing.sync(simpleTown(), zones);
    for (const mesh of meshes(dressing.group).filter((item) => item.name !== "settlement-forecourt-markers")) {
      const position = mesh.geometry.getAttribute("position");
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
      for (let index = 0; index < position.count; index += 3) {
        a.fromBufferAttribute(position, index);
        b.fromBufferAttribute(position, index + 1);
        c.fromBufferAttribute(position, index + 2);
        expect(b.sub(a).cross(c.sub(a)).y).toBeGreaterThan(0);
      }
    }
    dressing.dispose();
  });

  it("keeps edge-of-map courtyards inside the playable ground", () => {
    const dressing = new SettlementDressing();
    dressing.sync([site(1, "keep", 0, 0), site(2, "market", 17, 17), site(3, "house", 0, 16)], zones);
    const bounds = new THREE.Box3().setFromObject(dressing.group);
    const edge = GRID_SIZE * TILE_SIZE / 2;
    expect(bounds.min.x).toBeGreaterThanOrEqual(-edge);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-edge);
    expect(bounds.max.x).toBeLessThanOrEqual(edge);
    expect(bounds.max.z).toBeLessThanOrEqual(edge);
    dressing.dispose();
  });

  it("does not rebuild for hp, cooldown, workers, pause or reordered snapshots", () => {
    const dressing = new SettlementDressing();
    const buildings = simpleTown();
    dressing.sync(buildings, zones);
    const drawables = meshes(dressing.group);
    const changed = buildings.map((building) => ({ ...building, hp: 37, cooldown: 1.7, efficiency: 0.5, enabled: false, priority: "high" as const })).reverse();
    dressing.sync(changed, zones);
    for (let frame = 0; frame < 120; frame += 1) dressing.update(frame * 100, true);
    expect(dressing.group.userData.revision).toBe(1);
    expect(meshes(dressing.group)).toEqual(drawables);
    const before = dressing.group.toJSON();
    dressing.update(12, false);
    dressing.update(Number.NaN, true);
    expect(dressing.group.toJSON()).toEqual(before);
    dressing.dispose();
  });

  it.each(["id", "kind", "position", "resources", "remove"] as const)("rebuilds and retires old buffers on structural %s changes", (change) => {
    const dressing = new SettlementDressing();
    const buildings = simpleTown();
    dressing.sync(buildings, zones);
    const old = meshes(dressing.group);
    let geometryDisposals = 0, materialDisposals = 0;
    old.forEach((mesh) => {
      mesh.geometry.addEventListener("dispose", () => { geometryDisposals += 1; });
      (mesh.material as THREE.Material).addEventListener("dispose", () => { materialDisposals += 1; });
    });
    const next = buildings.map((building) => ({ ...building }));
    const nextZones = { ...zones };
    if (change === "id") next[1].id += 100;
    if (change === "kind") next[1].kind = "bakery";
    if (change === "position") next[1].gx -= 1;
    if (change === "resources") nextZones.iron = { gx: 8, gz: 9 };
    if (change === "remove") next.pop();
    dressing.sync(next, nextZones);
    expect(dressing.group.userData.revision).toBe(2);
    expect(geometryDisposals).toBe(old.length);
    expect(materialDisposals).toBe(old.length);
    old.forEach((mesh) => expect(mesh.parent).toBeNull());
    dressing.dispose();
    expect(geometryDisposals).toBe(old.length);
    expect(materialDisposals).toBe(old.length);
  });

  it("cleans up empty maps and disposes the root idempotently", () => {
    const dressing = new SettlementDressing();
    const scene = new THREE.Scene();
    scene.add(dressing.group);
    dressing.sync(simpleTown(), zones);
    dressing.sync([], zones);
    expect(dressing.group.children).toHaveLength(0);
    expect(dressing.group.userData.forecourtMarkers).toBe(0);
    dressing.sync(simpleTown(), zones);
    const drawables = meshes(dressing.group);
    let released = 0;
    drawables.forEach((mesh) => mesh.geometry.addEventListener("dispose", () => { released += 1; }));
    dressing.dispose();
    dressing.dispose();
    expect(released).toBe(drawables.length);
    expect(dressing.group.children).toHaveLength(0);
    expect(dressing.group.parent).toBeNull();
    dressing.sync(simpleTown(), zones);
    expect(dressing.group.children).toHaveLength(0);
  });
});
