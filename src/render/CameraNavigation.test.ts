import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GRID_SIZE, TILE_SIZE } from "../game/content";
import {
  cameraViewSpan, clampCameraTarget, screenPanToGround, TOP_VIEW_PITCH,
  type CameraNavigationView, type GroundPoint,
} from "./CameraNavigation";

const viewports = [
  { width: 390, height: 640 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1280, height: 720 },
];
const distances = [15, 24, 38];
const pitches = [0.42, 0.64, 1.25, TOP_VIEW_PITCH];
const yaws = [0, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 1.5, -0.6];
const half = GRID_SIZE * TILE_SIZE / 2;

function makeView(viewport = viewports[0]): CameraNavigationView {
  return { ...viewport, distance: 24, yaw: Math.PI / 4, pitch: 0.64 };
}

/** Use Three's real view/projection matrices, independently of the pan equations. */
function project(point: GroundPoint, target: GroundPoint, view: CameraNavigationView) {
  const span = cameraViewSpan(view.distance);
  const aspect = view.width / view.height;
  const camera = new THREE.OrthographicCamera(-span * aspect / 2, span * aspect / 2, span / 2, -span / 2, 0.1, 180);
  const horizontal = 48 * Math.cos(view.pitch);
  camera.position.set(target.x + Math.sin(view.yaw) * horizontal, 48 * Math.sin(view.pitch), target.z + Math.cos(view.yaw) * horizontal);
  camera.lookAt(target.x, 0, target.z);
  camera.updateMatrixWorld(true);
  const projected = new THREE.Vector3(point.x, 0, point.z).project(camera);
  return { x: (projected.x + 1) * view.width / 2, y: (1 - projected.y) * view.height / 2 };
}

function distanceToBoardOnScreen(target: GroundPoint, view: CameraNavigationView): number {
  if (Math.abs(target.x) <= half && Math.abs(target.z) <= half) return 0;
  const corners = [{ x: -half, z: -half }, { x: half, z: -half }, { x: half, z: half }, { x: -half, z: half }]
    .map((point) => project(point, target, view));
  return Math.min(...corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const along = Math.max(0, Math.min(1, ((view.width / 2 - a.x) * dx + (view.height / 2 - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(a.x + dx * along - view.width / 2, a.y + dy * along - view.height / 2);
  }));
}

describe("orthographic camera navigation", () => {
  it.each(viewports)("keeps a ground point under a CSS-pixel drag in $width x $height", (viewport) => {
    for (const distance of distances) for (const pitch of pitches) for (const yaw of yaws) {
      const view = { ...viewport, distance, pitch, yaw };
      const target = { x: 1.2, z: -0.8 };
      const point = { x: 0.4, z: 1.6 };
      const before = project(point, target, view);
      for (const [dx, dy] of [[120, 0], [0, 90], [-80, -60]]) {
        const offset = screenPanToGround(dx, dy, view);
        const after = project(point, { x: target.x + offset.x, z: target.z + offset.z }, view);
        expect(after.x - before.x).toBeCloseTo(dx, 8);
        expect(after.y - before.y).toBeCloseTo(dy, 8);
      }
    }
  });

  it("can centre every playable cell, including the four formerly unreachable corners", () => {
    const view = makeView();
    for (let gx = 0; gx < GRID_SIZE; gx++) for (let gz = 0; gz < GRID_SIZE; gz++) {
      const point = { x: (gx - (GRID_SIZE - 1) / 2) * TILE_SIZE, z: (gz - (GRID_SIZE - 1) / 2) * TILE_SIZE };
      const target = clampCameraTarget(point, view, GRID_SIZE, TILE_SIZE);
      expect(target).toEqual(point);
      const pixel = project(point, target, view);
      expect(pixel.x).toBeCloseTo(view.width / 2, 8);
      expect(pixel.y).toBeCloseTo(view.height / 2, 8);
    }
  });

  it("centres every corner of the enlarged duel map without classic-map clamping", () => {
    const duelGridSize = 30;
    const duelEdge = (duelGridSize - 1) * TILE_SIZE / 2;
    const view = { ...makeView(viewports[4]), distance: 42 };
    for (const x of [-duelEdge, duelEdge]) for (const z of [-duelEdge, duelEdge]) {
      expect(clampCameraTarget({ x, z }, view, duelGridSize, TILE_SIZE)).toEqual({ x, z });
    }
  });

  it.each(viewports)("leaves part of the board in the central viewport after any pan at $width x $height", (viewport) => {
    for (const distance of distances) for (const pitch of pitches) for (const yaw of yaws) {
      const view = { ...viewport, distance, pitch, yaw };
      for (const desired of [
        { x: -1000, z: -1000 }, { x: 1000, z: -1000 }, { x: 1000, z: 1000 }, { x: -1000, z: 1000 },
        { x: 0, z: -1000 }, { x: 1000, z: 0 }, { x: 0, z: 1000 }, { x: -1000, z: 0 },
      ]) {
        const target = clampCameraTarget(desired, view, GRID_SIZE, TILE_SIZE);
        const radius = distanceToBoardOnScreen(target, view);
        expect(radius).toBeLessThanOrEqual(Math.min(view.width, view.height) * 0.25 + 1e-8);
        expect(Number.isFinite(target.x) && Number.isFinite(target.z)).toBe(true);
        const clampedAgain = clampCameraTarget(target, view, GRID_SIZE, TILE_SIZE);
        expect(clampedAgain.x).toBeCloseTo(target.x, 10);
        expect(clampedAgain.z).toBeCloseTo(target.z, 10);
      }
    }
  });

  it.each(viewports.slice(0, 3))("can move each corner clear of the top or bottom HUD at $width x $height", (viewport) => {
    for (const distance of distances) for (const pitch of pitches) for (const yaw of yaws) {
      const view = { ...viewport, distance, pitch, yaw };
      const edge = (GRID_SIZE - 1) * TILE_SIZE / 2;
      for (const direction of [-1, 1]) {
        const offset = screenPanToGround(0, direction * view.height * 0.1, view);
        for (const x of [-edge, edge]) for (const z of [-edge, edge]) {
          const target = clampCameraTarget({ x: x + offset.x, z: z + offset.z }, view, GRID_SIZE, TILE_SIZE);
          const point = project({ x, z }, target, view);
          expect(point.x).toBeCloseTo(view.width / 2, 8);
          expect(point.y).toBeCloseTo(view.height * (0.5 + direction * 0.1), 8);
        }
      }
    }
  });

  it("reclamps overscan after a zoom, rotation or narrow portrait resize without losing the board", () => {
    const from = { ...makeView(viewports[4]), distance: 38, pitch: 0.42 };
    const original = clampCameraTarget({ x: 1000, z: 1000 }, from, GRID_SIZE, TILE_SIZE);
    for (const yaw of yaws) for (const pitch of pitches) {
      const view = { ...makeView(viewports[1]), distance: 15, pitch, yaw };
      const target = clampCameraTarget(original, view, GRID_SIZE, TILE_SIZE);
      expect(distanceToBoardOnScreen(target, view)).toBeLessThanOrEqual(90 + 1e-8);
    }
  });

  it("allows smooth reverse motion away from the boundary", () => {
    const view = makeView();
    const target = clampCameraTarget({ x: -1000, z: -1000 }, view, GRID_SIZE, TILE_SIZE);
    const offset = screenPanToGround(0, -20, view);
    const next = clampCameraTarget({ x: target.x + offset.x, z: target.z + offset.z }, view, GRID_SIZE, TILE_SIZE);
    const before = project({ x: -half, z: -half }, target, view);
    const after = project({ x: -half, z: -half }, next, view);
    expect(after.y - before.y).toBeCloseTo(-20, 8);
    expect(after.x).toBeCloseTo(before.x, 8);
  });

  it("does not mutate targets or camera parameters", () => {
    const target = Object.freeze({ x: 100, z: -100 });
    const view = Object.freeze(makeView());
    screenPanToGround(10, -20, view);
    expect(clampCameraTarget(target, view, GRID_SIZE, TILE_SIZE)).not.toEqual(target);
    expect(target).toEqual({ x: 100, z: -100 });
    expect(view).toEqual(makeView());
  });
});
