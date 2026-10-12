import { describe, expect, it } from "vitest";
import { solveBallisticArc, type BallisticInput, type BallisticSolution } from "./ballistics";

const baseInput: BallisticInput = {
  sourceX: 5,
  sourceY: 1.5,
  sourceZ: 5,
  aimDirection: { x: 1, y: 0.2, z: 0 },
  maxRangeGrid: 20,
  tileSize: 1.25,
  speed: 8,
  gravity: 9.81,
  groundY: 0,
  bounds: { minX: 0, maxX: 30, minZ: 0, maxZ: 30 },
};

function expectGroundEndpoint(input: BallisticInput, result: BallisticSolution): void {
  const calculatedY = input.sourceY
    + result.initialVelocityY * result.flightSeconds
    - 0.5 * result.gravity * result.flightSeconds ** 2;
  expect(calculatedY).toBeCloseTo(result.landing.y, 9);
  expect(result.landing.y).toBe(input.groundY);
}

describe("ballistic arc solver", () => {
  it("never shortens range when pitch is raised before the range cap", () => {
    const pitches = [-0.15, 0, 0.2, 0.45, 0.8];
    const distances = pitches.map((pitch) => solveBallisticArc({
      ...baseInput,
      aimDirection: { x: Math.cos(pitch), y: Math.sin(pitch), z: 0 },
    }).horizontalDistanceGrid);

    for (let index = 1; index < distances.length; index += 1) {
      expect(distances[index]).toBeGreaterThanOrEqual(distances[index - 1] - 1e-10);
    }
    expect(distances.at(-1)).toBeGreaterThan(distances[0]);
  });

  it("clamps to max range and adjusts effective gravity without moving the ground endpoint", () => {
    const input = {
      ...baseInput,
      aimDirection: { x: 1, y: 3, z: 0 },
      maxRangeGrid: 3,
    } satisfies BallisticInput;
    const result = solveBallisticArc(input);

    expect(result.horizontalDistanceGrid).toBeCloseTo(3, 12);
    expect(result.landing).toMatchObject({ x: 8, y: 0, z: 5 });
    expect(result.initialVelocityY).toBeCloseTo(input.speed * 3, 10);
    expect(result.gravity).toBeGreaterThan(input.gravity);
    expectGroundEndpoint(input, result);
  });

  it("clamps along the horizontal ray at spatial bounds", () => {
    const input = {
      ...baseInput,
      sourceX: 9,
      sourceZ: 4,
      aimDirection: { x: 1, y: 2, z: 0.5 },
      bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
    } satisfies BallisticInput;
    const result = solveBallisticArc(input);

    expect(result.landing.x).toBeCloseTo(10, 12);
    expect(result.landing.z).toBeGreaterThan(4);
    expect(result.landing.z).toBeLessThanOrEqual(10);
    expect(result.horizontalDistanceGrid).toBeCloseTo(Math.hypot(1, 0.5), 12);
    expectGroundEndpoint(input, result);
  });

  it("keeps every valid unclamped arc on the requested ground plane", () => {
    const input = {
      ...baseInput,
      aimDirection: { x: -0.4, y: 0.35, z: 1 },
    } satisfies BallisticInput;
    const result = solveBallisticArc(input);

    expect(result.horizontalDistanceGrid).toBeGreaterThan(0);
    expect(Math.hypot(result.horizontalDirection.x, result.horizontalDirection.z)).toBeCloseTo(1, 12);
    expectGroundEndpoint(input, result);
  });

  it("returns a normalized, entirely finite fallback for hostile inputs", () => {
    const result = solveBallisticArc({
      sourceX: Number.NaN,
      sourceY: Number.POSITIVE_INFINITY,
      sourceZ: Number.NEGATIVE_INFINITY,
      aimDirection: { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: Number.NaN },
      maxRangeGrid: Number.POSITIVE_INFINITY,
      tileSize: 0,
      speed: Number.NaN,
      gravity: Number.NEGATIVE_INFINITY,
      groundY: Number.NaN,
      bounds: {
        minX: Number.NaN,
        maxX: Number.POSITIVE_INFINITY,
        minZ: Number.NEGATIVE_INFINITY,
        maxZ: Number.NaN,
      },
    });

    const values = [
      result.horizontalDirection.x,
      result.horizontalDirection.z,
      result.landing.x,
      result.landing.y,
      result.landing.z,
      result.horizontalDistanceGrid,
      result.flightSeconds,
      result.initialVelocityY,
      result.gravity,
    ];
    expect(values.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(result.horizontalDirection.x, result.horizontalDirection.z)).toBeCloseTo(1, 12);
    expect(result.horizontalDistanceGrid).toBeGreaterThanOrEqual(0);
    expect(result.flightSeconds).toBeGreaterThanOrEqual(0);
    expect(result.gravity).toBeGreaterThan(0);
  });

  it("allows a ground-level source to fire tangent to a spatial boundary", () => {
    const input = {
      ...baseInput,
      sourceX: 0,
      sourceY: 0,
      sourceZ: 2,
      groundY: 0,
      aimDirection: { x: 0, y: 0.45, z: 1 },
      bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
    } satisfies BallisticInput;
    const result = solveBallisticArc(input);

    expect(result.flightSeconds).toBeGreaterThan(0);
    expect(result.horizontalDistanceGrid).toBeGreaterThan(0);
    expect(result.landing.x).toBe(0);
    expect(result.landing.z).toBeGreaterThan(input.sourceZ);
    expectGroundEndpoint(input, result);
  });
});
