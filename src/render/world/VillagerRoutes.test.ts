import { describe, expect, it } from "vitest";
import type { BuildingState } from "../../game/types";
import { pedestrianRoute, samplePedestrianRoute } from "./VillagerRoutes";

const building = (id: number, kind: BuildingState["kind"], gx: number, gz: number): BuildingState => ({ id, kind, gx, gz, hp: 100, maxHp: 100, cooldown: 0, efficiency: 1, enabled: true, priority: "normal" });

describe("pedestrian visual routes", () => {
  it("routes citizens around buildings and walls, using an open gate", () => {
    const keep = building(1, "keep", 3, 7), bakery = building(2, "bakery", 10, 7);
    const walls = Array.from({ length: 18 }, (_, z) => building(z + 3, z === 8 ? "gate" : "wall", 7, z));
    const buildings = [keep, bakery, ...walls];
    const route = pedestrianRoute(buildings, bakery, 0);
    expect(route.some((point) => point.gx === 7 && point.gz === 8)).toBe(true);
    for (const point of route) expect(buildings.some((item) => item.kind !== "gate" && item.gx === point.gx && item.gz === point.gz)).toBe(false);
  });

  it("stays in the courtyard when a wall seals the route", () => {
    const keep = building(1, "keep", 3, 7), bakery = building(2, "bakery", 10, 7);
    const walls = Array.from({ length: 18 }, (_, z) => building(z + 3, "wall", 7, z));
    const route = pedestrianRoute([keep, bakery, ...walls], bakery, 0);
    expect(route).toHaveLength(1);
    expect(samplePedestrianRoute(route, 20, 0)?.moving).toBe(false);
  });

  it("has no wall-clock dependency, including while stopped mid-stride", () => {
    const route = [{ gx: 2, gz: 3 }, { gx: 3, gz: 3 }, { gx: 4, gz: 3 }];
    const pose = samplePedestrianRoute(route, 3.14, 0);
    expect(pose?.moving).toBe(true);
    for (let frame = 0; frame < 120; frame += 1) expect(samplePedestrianRoute(route, 3.14, 0)).toEqual(pose);
    expect(samplePedestrianRoute(route, 4.14, 0)).not.toEqual(pose);
  });
});
