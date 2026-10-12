export interface BallisticDirection {
  x: number;
  y: number;
  z: number;
}

/** Grid-space rectangle containing both the source and the returned landing point. */
export interface BallisticBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface BallisticInput {
  /** Absolute grid-space launch position. */
  sourceX: number;
  sourceZ: number;
  /** World-space launch height. */
  sourceY: number;
  /** World-space aim direction; it does not need to be normalized. */
  aimDirection: Readonly<BallisticDirection>;
  /** Weapon range measured in grid cells. */
  maxRangeGrid: number;
  /** World units represented by one grid cell. */
  tileSize: number;
  /** Horizontal launch speed in world units per second. */
  speed: number;
  /** Positive downward acceleration in world units per second squared. */
  gravity: number;
  /** World-space landing height. */
  groundY: number;
  /** Absolute grid-space limits for the landing point. */
  bounds: Readonly<BallisticBounds>;
}

export interface BallisticSolution {
  horizontalDirection: { x: number; z: number };
  /** Absolute x/z grid coordinates and world-space y. */
  landing: { x: number; y: number; z: number };
  horizontalDistanceGrid: number;
  flightSeconds: number;
  initialVelocityY: number;
  /** Effective positive downward acceleration used by this solution. */
  gravity: number;
}

const DEFAULT_SPEED = 1;
const DEFAULT_GRAVITY = 9.81;
const MAX_COORDINATE = 1_000_000;
const MAX_RANGE_GRID = 1_000_000;
const MAX_TILE_SIZE = 1_000_000;
const MAX_SPEED = 1_000_000;
const MAX_GRAVITY = 1_000_000;
const MIN_POSITIVE = 0.000001;
const DIRECTION_EPSILON = 1e-12;
const DISTANCE_EPSILON = 1e-10;
const MAX_PITCH = Math.PI / 2 - 0.01;

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteCoordinate(value: number, fallback: number): number {
  return clamp(finiteOr(value, fallback), -MAX_COORDINATE, MAX_COORDINATE);
}

function positiveFinite(value: number, fallback: number, maximum: number): number {
  const candidate = finiteOr(value, fallback);
  return clamp(candidate > 0 ? candidate : fallback, MIN_POSITIVE, maximum);
}

function sanitizeAxis(minimum: number, maximum: number): { min: number; max: number } {
  const first = finiteCoordinate(minimum, -MAX_COORDINATE);
  const second = finiteCoordinate(maximum, MAX_COORDINATE);
  return { min: Math.min(first, second), max: Math.max(first, second) };
}

function horizontalAim(direction: Readonly<BallisticDirection>): {
  directionX: number;
  directionZ: number;
  pitch: number;
} {
  const x = finiteOr(direction.x, 0);
  const y = finiteOr(direction.y, 0);
  const z = finiteOr(direction.z, 0);
  const horizontalScale = Math.max(Math.abs(x), Math.abs(z));
  let directionX = 0;
  let directionZ = 1;

  if (horizontalScale > DIRECTION_EPSILON) {
    const scaledX = x / horizontalScale;
    const scaledZ = z / horizontalScale;
    const length = Math.hypot(scaledX, scaledZ);
    directionX = scaledX / length;
    directionZ = scaledZ / length;
  }

  const directionScale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  if (directionScale <= DIRECTION_EPSILON) return { directionX, directionZ, pitch: 0 };
  const scaledY = y / directionScale;
  const scaledHorizontal = Math.hypot(x / directionScale, z / directionScale);
  const pitch = clamp(Math.atan2(scaledY, scaledHorizontal), -MAX_PITCH, MAX_PITCH);
  return { directionX, directionZ, pitch };
}

function distanceToBoundary(
  source: number,
  direction: number,
  minimum: number,
  maximum: number,
): number {
  if (direction > DIRECTION_EPSILON) return Math.max(0, (maximum - source) / direction);
  if (direction < -DIRECTION_EPSILON) return Math.max(0, (minimum - source) / direction);
  return Number.POSITIVE_INFINITY;
}

function landingTime(height: number, initialVelocityY: number, gravity: number): number {
  const discriminant = initialVelocityY * initialVelocityY + 2 * gravity * height;
  if (!Number.isFinite(discriminant) || discriminant < 0) return 0;
  const time = (initialVelocityY + Math.sqrt(discriminant)) / gravity;
  return Number.isFinite(time) && time > 0 ? time : 0;
}

/**
 * Solves a deterministic ground-impact arc without any rendering dependency.
 *
 * `speed` is deliberately the horizontal speed. Consequently
 * `initialVelocityY = speed * tan(pitch)`, making range non-decreasing as the
 * player raises the aim. If range or map bounds shorten the natural arc, the
 * solver keeps that vertical launch velocity and increases effective gravity
 * so the shortened endpoint still lies exactly on `groundY`.
 */
export function solveBallisticArc(input: Readonly<BallisticInput>): BallisticSolution {
  const xAxis = sanitizeAxis(input.bounds?.minX, input.bounds?.maxX);
  const zAxis = sanitizeAxis(input.bounds?.minZ, input.bounds?.maxZ);
  const sourceX = clamp(finiteCoordinate(input.sourceX, 0), xAxis.min, xAxis.max);
  const sourceZ = clamp(finiteCoordinate(input.sourceZ, 0), zAxis.min, zAxis.max);
  const groundY = finiteCoordinate(input.groundY, 0);
  const sourceY = finiteCoordinate(input.sourceY, groundY);
  const tileSize = positiveFinite(input.tileSize, 1, MAX_TILE_SIZE);
  const speed = positiveFinite(input.speed, DEFAULT_SPEED, MAX_SPEED);
  const gravity = positiveFinite(input.gravity, DEFAULT_GRAVITY, MAX_GRAVITY);
  const maxRangeGrid = clamp(finiteOr(input.maxRangeGrid, 0), 0, MAX_RANGE_GRID);
  const aim = horizontalAim(input.aimDirection ?? { x: 0, y: 0, z: 1 });
  const initialVelocityY = speed * Math.tan(aim.pitch);
  const height = sourceY - groundY;
  const naturalFlightSeconds = landingTime(height, initialVelocityY, gravity);
  const naturalDistanceGrid = naturalFlightSeconds * speed / tileSize;

  const boundaryDistanceGrid = Math.min(
    distanceToBoundary(sourceX, aim.directionX, xAxis.min, xAxis.max),
    distanceToBoundary(sourceZ, aim.directionZ, zAxis.min, zAxis.max),
  );
  const distanceLimitGrid = Math.min(maxRangeGrid, boundaryDistanceGrid);
  const horizontalDistanceGrid = Math.max(0, Math.min(naturalDistanceGrid, distanceLimitGrid));

  let flightSeconds = naturalFlightSeconds;
  let effectiveInitialVelocityY = initialVelocityY;
  let effectiveGravity = gravity;
  const rangeWasClamped = horizontalDistanceGrid + DISTANCE_EPSILON < naturalDistanceGrid;

  if (rangeWasClamped && horizontalDistanceGrid > DISTANCE_EPSILON) {
    flightSeconds = horizontalDistanceGrid * tileSize / speed;
    const requiredGravity = 2 * (height + initialVelocityY * flightSeconds) / (flightSeconds * flightSeconds);
    if (Number.isFinite(requiredGravity) && requiredGravity > 0) {
      effectiveGravity = requiredGravity;
    } else {
      // Invalid/below-ground inputs may make positive gravity impossible while
      // preserving pitch. Retain nominal gravity and change vertical velocity
      // by the minimum amount required to keep the endpoint on the ground.
      effectiveInitialVelocityY = (0.5 * gravity * flightSeconds * flightSeconds - height) / flightSeconds;
    }
  }

  const landingX = clamp(sourceX + aim.directionX * horizontalDistanceGrid, xAxis.min, xAxis.max);
  const landingZ = clamp(sourceZ + aim.directionZ * horizontalDistanceGrid, zAxis.min, zAxis.max);

  return {
    horizontalDirection: { x: aim.directionX, z: aim.directionZ },
    landing: { x: landingX, y: groundY, z: landingZ },
    horizontalDistanceGrid,
    flightSeconds,
    initialVelocityY: effectiveInitialVelocityY,
    gravity: effectiveGravity,
  };
}
