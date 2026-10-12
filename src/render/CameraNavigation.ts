/** Camera-only navigation; this never changes the playable/buildable map bounds. */
export interface CameraNavigationView {
  width: number;
  height: number;
  distance: number;
  yaw: number;
  pitch: number;
}

export interface GroundPoint {
  x: number;
  z: number;
}

export const TOP_VIEW_PITCH = 1.545;

export function cameraViewSpan(distance: number): number {
  return distance * 0.74;
}

/** Keep ground under the pointer at any zoom, viewport size and orbit angle. */
export function screenPanToGround(screenX: number, screenY: number, view: CameraNavigationView): GroundPoint {
  const unitsPerPixel = cameraViewSpan(view.distance) / Math.max(1, view.height);
  const horizontal = -screenX * unitsPerPixel;
  const forward = screenY * unitsPerPixel / Math.max(0.01, Math.sin(view.pitch));
  const sin = Math.sin(view.yaw);
  const cos = Math.cos(view.yaw);
  return { x: cos * horizontal - sin * forward, z: -sin * horizontal - cos * forward };
}

/**
 * Every edge cell can reach the centre, with a little extra room to clear the HUD.
 * Overscan is bounded in screen space: the nearest board point
 * stays in the central half of the short viewport dimension, even after a turn,
 * zoom or portrait resize. Unlike an expanded square, this cannot lose the board
 * at a diagonal corner on a narrow phone.
 */
export function clampCameraTarget(
  target: GroundPoint,
  view: CameraNavigationView,
  gridSize: number,
  tileSize: number,
): GroundPoint {
  const half = gridSize * tileSize / 2;
  if (Math.abs(target.x) <= half && Math.abs(target.z) <= half) return { x: target.x, z: target.z };

  const sin = Math.sin(view.yaw);
  const cos = Math.cos(view.yaw);
  const sinPitch = Math.max(0.01, Math.sin(view.pitch));
  const projected = (x: number, z: number) => ({ x: cos * x - sin * z, y: sinPitch * (sin * x + cos * z) });
  const corners = [{ x: -half, z: -half }, { x: half, z: -half }, { x: half, z: half }, { x: -half, z: half }];
  let nearest = corners[0];
  let projectedLength = Number.POSITIVE_INFINITY;
  // Ground-space component clamping is not nearest in the tilted view. Find the
  // nearest point on the projected board's four edges instead, so panning at an
  // oblique corner does not stop early or unexpectedly slide sideways.
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const edge = projected(b.x - a.x, b.z - a.z);
    const relative = projected(target.x - a.x, target.z - a.z);
    const along = Math.max(0, Math.min(1, (relative.x * edge.x + relative.y * edge.y) / (edge.x * edge.x + edge.y * edge.y)));
    const candidate = { x: a.x + (b.x - a.x) * along, z: a.z + (b.z - a.z) * along };
    const distance = Math.hypot(relative.x - edge.x * along, relative.y - edge.y * along);
    if (distance < projectedLength) {
      nearest = candidate;
      projectedLength = distance;
    }
  }
  const span = cameraViewSpan(view.distance);
  const shortSpan = span * Math.min(1, Math.max(1, view.width) / Math.max(1, view.height));
  if (projectedLength <= shortSpan * 0.25) return { x: target.x, z: target.z };
  const factor = Math.min(1, shortSpan * 0.25 / projectedLength);
  return { x: nearest.x + (target.x - nearest.x) * factor, z: nearest.z + (target.z - nearest.z) * factor };
}
