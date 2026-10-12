import * as THREE from "three";

export interface ThirdPersonUnitPose {
  /** World-space feet position. Characters in this project are Y-up. */
  position: Readonly<{ x: number; y: number; z: number }>;
  /** World-space heading in radians. Zero faces +Z, matching CharacterFactory. */
  heading: number;
}

export type GroundHeightProvider = (x: number, z: number) => number;

export interface ThirdPersonRigOptions {
  aspect?: number;
  fov?: number;
  near?: number;
  far?: number;
  backOffset?: number;
  shoulderOffset?: number;
  cameraHeight?: number;
  followSharpness?: number;
  minimumGroundClearance?: number;
  defaultYaw?: number;
  /** @deprecated Horizontal look is unbounded; retained for source compatibility and ignored. */
  minimumYaw?: number;
  /** @deprecated Horizontal look is unbounded; retained for source compatibility and ignored. */
  maximumYaw?: number;
  defaultPitch?: number;
  minimumPitch?: number;
  maximumPitch?: number;
  maximumAimRange?: number;
  groundHeightAt?: GroundHeightProvider;
}

export interface ThirdPersonAimResult {
  point: THREE.Vector3;
  direction: THREE.Vector3;
  distance: number;
  hitGround: boolean;
}

export interface ThirdPersonRigDiagnostics {
  active: boolean;
  projection: "perspective";
  fov: number;
  aspect: number;
  near: number;
  far: number;
  target: { x: number; y: number; z: number; heading: number } | null;
  camera: { x: number; y: number; z: number };
  look: { yaw: number; pitch: number; worldYaw: number };
  ground: { height: number; clearance: number };
  aim: {
    x: number;
    y: number;
    z: number;
    directionX: number;
    directionY: number;
    directionZ: number;
    distance: number;
    hitGround: boolean;
  };
}

const DEFAULT_FOV = 55;
const DEFAULT_NEAR = 0.08;
const DEFAULT_FAR = 220;
const DEFAULT_BACK_OFFSET = 3.2;
const DEFAULT_SHOULDER_OFFSET = 0.58;
const DEFAULT_CAMERA_HEIGHT = 2.08;
const DEFAULT_FOLLOW_SHARPNESS = 11;
const DEFAULT_GROUND_CLEARANCE = 0.32;
const DEFAULT_YAW = 0;
const DEFAULT_PITCH = -0.14;
const DEFAULT_MINIMUM_PITCH = -0.9;
const DEFAULT_MAXIMUM_PITCH = 0.55;
const DEFAULT_AIM_RANGE = 26;
const MAX_WORLD_COORDINATE = 1_000_000;
const TWO_PI = Math.PI * 2;
const HEADING_ECHO_EPSILON = 1e-5;

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: number | undefined, fallback: number): number {
  const candidate = finiteOr(value, fallback);
  return candidate > 0 ? candidate : fallback;
}

function finiteWorld(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return THREE.MathUtils.clamp(value, -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE);
}

function normalizedAngle(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= -Math.PI && value < Math.PI) return value;
  const wrapped = (value + Math.PI) % TWO_PI;
  return (wrapped < 0 ? wrapped + TWO_PI : wrapped) - Math.PI;
}

function angularDistance(a: number, b: number): number {
  return Math.abs(normalizedAngle(a - b));
}

function safeDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(value, 1_000_000);
}

/**
 * Camera-only third-person follow rig. The caller owns unit/simulation state and
 * supplies an immutable world pose on every update; this class owns view state only.
 */
export class ThirdPersonRig {
  readonly camera: THREE.PerspectiveCamera;

  private readonly backOffset: number;
  private readonly shoulderOffset: number;
  private readonly cameraHeight: number;
  private readonly followSharpness: number;
  private readonly minimumGroundClearance: number;
  private readonly defaultYaw: number;
  private readonly defaultPitch: number;
  private readonly minimumPitch: number;
  private readonly maximumPitch: number;
  private readonly maximumAimRange: number;
  private readonly groundHeightAt: GroundHeightProvider;

  private readonly followedPosition = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly scratchDirection = new THREE.Vector3();
  private readonly scratchLookAt = new THREE.Vector3();
  private followedHeading = 0;
  private publishedWorldYaw = 0;
  private lookYaw = 0;
  private lookPitch = DEFAULT_PITCH;
  private isActive = false;

  constructor(options: ThirdPersonRigOptions = {}) {
    const near = THREE.MathUtils.clamp(positiveOr(options.near, DEFAULT_NEAR), 0.001, 10);
    const far = Math.max(near + 1, THREE.MathUtils.clamp(positiveOr(options.far, DEFAULT_FAR), 2, 10_000));
    const aspect = THREE.MathUtils.clamp(positiveOr(options.aspect, 16 / 9), 0.1, 10);
    const fov = THREE.MathUtils.clamp(positiveOr(options.fov, DEFAULT_FOV), 20, 100);
    this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.camera.name = "third-person-camera";

    this.backOffset = THREE.MathUtils.clamp(positiveOr(options.backOffset, DEFAULT_BACK_OFFSET), 0.1, 100);
    this.shoulderOffset = THREE.MathUtils.clamp(
      finiteOr(options.shoulderOffset, DEFAULT_SHOULDER_OFFSET),
      -4,
      4,
    );
    this.cameraHeight = THREE.MathUtils.clamp(positiveOr(options.cameraHeight, DEFAULT_CAMERA_HEIGHT), 0.1, 100);
    this.followSharpness = THREE.MathUtils.clamp(positiveOr(options.followSharpness, DEFAULT_FOLLOW_SHARPNESS), 0.01, 1_000);
    this.minimumGroundClearance = THREE.MathUtils.clamp(
      finiteOr(options.minimumGroundClearance, DEFAULT_GROUND_CLEARANCE),
      0,
      100,
    );

    this.defaultYaw = normalizedAngle(finiteOr(options.defaultYaw, DEFAULT_YAW));

    const minimumPitch = THREE.MathUtils.clamp(finiteOr(options.minimumPitch, DEFAULT_MINIMUM_PITCH), -1.45, 1.45);
    const maximumPitch = THREE.MathUtils.clamp(finiteOr(options.maximumPitch, DEFAULT_MAXIMUM_PITCH), -1.45, 1.45);
    this.minimumPitch = Math.min(minimumPitch, maximumPitch - 0.001);
    this.maximumPitch = Math.max(maximumPitch, minimumPitch + 0.001);
    this.defaultPitch = THREE.MathUtils.clamp(
      finiteOr(options.defaultPitch, DEFAULT_PITCH),
      this.minimumPitch,
      this.maximumPitch,
    );
    this.maximumAimRange = THREE.MathUtils.clamp(positiveOr(options.maximumAimRange, DEFAULT_AIM_RANGE), 0.1, 100_000);
    this.groundHeightAt = options.groundHeightAt ?? (() => 0);

    this.resetLook();
  }

  get active(): boolean {
    return this.isActive;
  }

  /** Enter direct control and snap behind the supplied world-space unit pose. */
  enter(pose: ThirdPersonUnitPose): void {
    const heading = this.sanitizePose(pose);
    this.isActive = true;
    this.followedPosition.copy(this.desiredPosition);
    this.followedHeading = heading;
    this.resetLook();
  }

  /** Leave direct control. The caller may now render with the existing map camera. */
  exit(): void {
    this.isActive = false;
    this.followedPosition.set(0, 0, 0);
    this.followedHeading = 0;
    this.resetLook();
  }

  /** Reset the over-shoulder look without leaving direct-control mode. */
  resetLook(): void {
    this.lookYaw = this.defaultYaw;
    this.lookPitch = this.defaultPitch;
    this.applyCameraPose();
  }

  /** Positive yaw rotates +Z toward +X without a turn limit; positive pitch looks up and remains bounded. */
  look(deltaYaw: number, deltaPitch: number): void {
    const yaw = Number.isFinite(deltaYaw) ? deltaYaw : 0;
    const pitch = Number.isFinite(deltaPitch) ? deltaPitch : 0;
    this.lookYaw = normalizedAngle(this.lookYaw + yaw);
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + pitch, this.minimumPitch, this.maximumPitch);
    if (this.isActive) this.applyCameraPose();
  }

  /**
   * Deterministic exponential follow. A zero/invalid delta updates look and
   * collision constraints without advancing the smoothed target. If a bridge
   * writes this rig's published world yaw back to the unit pose, that heading
   * is treated as an acknowledgement rather than a fresh base rotation. This
   * prevents the relative look yaw from being added again on every frame.
   */
  update(deltaSeconds: number, pose: ThirdPersonUnitPose): void {
    if (!this.isActive) return;
    const heading = this.sanitizePose(pose);
    const delta = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    const alpha = delta === 0 ? 0 : 1 - Math.exp(-this.followSharpness * delta);
    this.followedPosition.lerp(this.desiredPosition, alpha);
    if (angularDistance(heading, this.publishedWorldYaw) <= HEADING_ECHO_EPSILON) {
      this.followedHeading = normalizedAngle(heading - this.lookYaw);
    } else {
      const headingDelta = normalizedAngle(heading - this.followedHeading);
      this.followedHeading = normalizedAngle(this.followedHeading + headingDelta * alpha);
    }
    this.applyCameraPose();
  }

  resize(width: number, height: number): void {
    const nextAspect = THREE.MathUtils.clamp(safeDimension(width) / safeDimension(height), 0.1, 10);
    this.camera.aspect = nextAspect;
    this.camera.updateProjectionMatrix();
  }

  getCameraDirection(target = new THREE.Vector3()): THREE.Vector3 {
    return this.getAimDirection(target);
  }

  getAimDirection(target = new THREE.Vector3()): THREE.Vector3 {
    const yaw = this.worldYaw();
    const horizontal = Math.cos(this.lookPitch);
    target.set(
      Math.sin(yaw) * horizontal,
      Math.sin(this.lookPitch),
      Math.cos(yaw) * horizontal,
    );
    return target.normalize();
  }

  /**
   * Aim along the camera ray. A small deterministic height-field raycast finds
   * terrain; upward or unobstructed rays fall back to the configured max range.
   */
  getAimPoint(maxRange = this.maximumAimRange): ThirdPersonAimResult {
    const range = THREE.MathUtils.clamp(positiveOr(maxRange, this.maximumAimRange), 0.1, 100_000);
    const origin = this.camera.position;
    const direction = this.getAimDirection();
    const point = origin.clone();
    const samples = 48;
    let previousDistance = 0;
    let previousClearance = origin.y - this.safeGroundHeight(origin.x, origin.z);

    for (let index = 1; index <= samples; index += 1) {
      const distance = range * index / samples;
      point.copy(origin).addScaledVector(direction, distance);
      const clearance = point.y - this.safeGroundHeight(point.x, point.z);
      if (previousClearance > 0 && clearance <= 0) {
        let low = previousDistance;
        let high = distance;
        for (let iteration = 0; iteration < 14; iteration += 1) {
          const middle = (low + high) * 0.5;
          point.copy(origin).addScaledVector(direction, middle);
          const middleClearance = point.y - this.safeGroundHeight(point.x, point.z);
          if (middleClearance > 0) low = middle;
          else high = middle;
        }
        point.copy(origin).addScaledVector(direction, high);
        point.y = this.safeGroundHeight(point.x, point.z);
        return { point, direction, distance: origin.distanceTo(point), hitGround: true };
      }
      previousDistance = distance;
      previousClearance = clearance;
    }

    point.copy(origin).addScaledVector(direction, range);
    return { point, direction, distance: range, hitGround: false };
  }

  diagnostics(): ThirdPersonRigDiagnostics {
    const groundHeight = this.safeGroundHeight(this.camera.position.x, this.camera.position.z);
    const aim = this.getAimPoint();
    return {
      active: this.isActive,
      projection: "perspective",
      fov: this.camera.fov,
      aspect: this.camera.aspect,
      near: this.camera.near,
      far: this.camera.far,
      target: this.isActive ? {
        x: this.followedPosition.x,
        y: this.followedPosition.y,
        z: this.followedPosition.z,
        heading: this.followedHeading,
      } : null,
      camera: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      look: { yaw: this.lookYaw, pitch: this.lookPitch, worldYaw: this.worldYaw() },
      ground: { height: groundHeight, clearance: this.camera.position.y - groundHeight },
      aim: {
        x: aim.point.x,
        y: aim.point.y,
        z: aim.point.z,
        directionX: aim.direction.x,
        directionY: aim.direction.y,
        directionZ: aim.direction.z,
        distance: aim.distance,
        hitGround: aim.hitGround,
      },
    };
  }

  /** PerspectiveCamera owns no GPU resource; disposal clears rig state only. */
  dispose(): void {
    this.exit();
  }

  private sanitizePose(pose: ThirdPersonUnitPose): number {
    this.desiredPosition.set(
      finiteWorld(pose.position.x),
      finiteWorld(pose.position.y),
      finiteWorld(pose.position.z),
    );
    return normalizedAngle(pose.heading);
  }

  private worldYaw(): number {
    return normalizedAngle(this.followedHeading + this.lookYaw);
  }

  private safeGroundHeight(x: number, z: number): number {
    const height = this.groundHeightAt(x, z);
    return Number.isFinite(height) ? finiteWorld(height) : 0;
  }

  private applyCameraPose(): void {
    const yaw = this.worldYaw();
    this.publishedWorldYaw = yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const x = this.followedPosition.x - sin * this.backOffset + cos * this.shoulderOffset;
    const z = this.followedPosition.z - cos * this.backOffset - sin * this.shoulderOffset;
    const groundFloor = this.safeGroundHeight(x, z) + this.minimumGroundClearance;
    const y = Math.max(this.followedPosition.y + this.cameraHeight, groundFloor);
    this.camera.position.set(x, y, z);
    const aim = this.getAimDirection(this.scratchDirection);
    this.camera.lookAt(this.scratchLookAt.copy(this.camera.position).add(aim));
    this.camera.updateMatrixWorld(true);
  }
}
