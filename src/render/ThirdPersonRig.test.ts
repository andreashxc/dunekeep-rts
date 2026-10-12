import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ThirdPersonRig, type ThirdPersonUnitPose } from "./ThirdPersonRig";

const originPose: ThirdPersonUnitPose = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  heading: 0,
});

function expectFiniteVector(vector: THREE.Vector3): void {
  expect(vector.toArray().every(Number.isFinite)).toBe(true);
}

function expectFiniteMatrix(matrix: THREE.Matrix4): void {
  expect(matrix.elements.every(Number.isFinite)).toBe(true);
}

function normalizedAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function signedAngularDelta(from: number, to: number): number {
  return normalizedAngle(to - from);
}

describe("third-person camera rig", () => {
  it("enters in a perspective over-shoulder pose behind a +Z-facing unit", () => {
    const rig = new ThirdPersonRig({ aspect: 16 / 9 });
    rig.enter({ position: { x: 4, y: 0.2, z: 8 }, heading: 0 });

    expect(rig.camera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(rig.camera.fov).toBe(55);
    expect(rig.camera.position.x).toBeGreaterThan(4);
    expect(rig.camera.position.y).toBeGreaterThan(2);
    expect(rig.camera.position.z).toBeLessThan(8);
    expect(rig.getAimDirection().z).toBeGreaterThan(0.9);
    expect(rig.diagnostics()).toMatchObject({
      active: true,
      projection: "perspective",
      target: { x: 4, y: 0.2, z: 8, heading: 0 },
    });
  });

  it("uses the CharacterFactory heading convention when following a turned unit", () => {
    const rig = new ThirdPersonRig();
    rig.enter({ position: { x: 5, y: 0, z: -3 }, heading: Math.PI / 2 });

    expect(rig.camera.position.x).toBeLessThan(5);
    expect(rig.camera.position.z).toBeLessThan(-3);
    const direction = rig.getCameraDirection();
    expect(direction.x).toBeGreaterThan(0.9);
    expect(Math.abs(direction.z)).toBeLessThan(1e-10);
    expect(new THREE.Vector3().set(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).x).toBeCloseTo(1, 10);
  });

  it("wraps yaw without limiting turns, clamps pitch and keeps camera direction synchronized", () => {
    const rig = new ThirdPersonRig({
      defaultYaw: Math.PI * 4 + 0.2,
      minimumYaw: -0.1,
      maximumYaw: 0.1,
      minimumPitch: -0.7,
      maximumPitch: 0.4,
    });
    rig.enter(originPose);
    rig.look(100, 100);
    rig.update(0, originPose);
    expect(rig.diagnostics().look.yaw).toBeCloseTo(normalizedAngle(0.2 + 100), 12);
    expect(rig.diagnostics().look.pitch).toBe(0.4);
    expect(rig.diagnostics().look.worldYaw).toBeCloseTo(normalizedAngle(0.2 + 100), 12);
    expect(rig.camera.getWorldDirection(new THREE.Vector3()).angleTo(rig.getAimDirection())).toBeLessThan(1e-7);

    rig.look(-200, -200);
    rig.update(0, originPose);
    expect(rig.diagnostics().look.yaw).toBeCloseTo(normalizedAngle(0.2 - 100), 12);
    expect(rig.diagnostics().look.pitch).toBe(-0.7);
    expect(rig.diagnostics().look.worldYaw).toBeCloseTo(normalizedAngle(0.2 - 100), 12);
  });

  it.each([
    ["right", 0.125],
    ["left", -0.125],
  ])("supports repeated full turns to the %s without a heading jump", (_direction, yawStep) => {
    const baseHeading = 0.37;
    const turns = 240;
    const rig = new ThirdPersonRig({ followSharpness: 12 });
    const position = { x: 3, y: 0, z: -2 };
    rig.enter({ position, heading: baseHeading });
    let previousWorldYaw = rig.diagnostics().look.worldYaw;
    let wrapCount = 0;

    for (let step = 0; step < turns; step += 1) {
      rig.look(yawStep, 0);
      const worldYaw = rig.diagnostics().look.worldYaw;
      expect(signedAngularDelta(previousWorldYaw, worldYaw)).toBeCloseTo(yawStep, 10);
      if (Math.abs(worldYaw - previousWorldYaw) > Math.PI) wrapCount += 1;

      // This mirrors the integration bridge publishing the camera yaw as unit heading.
      rig.update(1 / 60, { position, heading: worldYaw });
      expect(rig.diagnostics().target!.heading).toBeCloseTo(baseHeading, 10);
      expect(signedAngularDelta(worldYaw, rig.diagnostics().look.worldYaw)).toBeCloseTo(0, 10);
      previousWorldYaw = rig.diagnostics().look.worldYaw;
    }

    expect(wrapCount).toBeGreaterThanOrEqual(4);
    const expectedWorldYaw = normalizedAngle(baseHeading + turns * yawStep);
    expect(signedAngularDelta(expectedWorldYaw, rig.diagnostics().look.worldYaw)).toBeCloseTo(0, 10);
    expect(rig.diagnostics().look.yaw).toBeGreaterThanOrEqual(-Math.PI);
    expect(rig.diagnostics().look.yaw).toBeLessThan(Math.PI);
    expect(rig.camera.getWorldDirection(new THREE.Vector3()).angleTo(rig.getAimDirection())).toBeLessThan(1e-7);
  });

  it("does not accumulate look yaw when the bridge echoes world yaw into unit heading", () => {
    const rig = new ThirdPersonRig({ followSharpness: 12 });
    rig.enter({ position: { x: 3, y: 0, z: -2 }, heading: -0.4 });
    rig.look(0.76, 0.08);
    const expectedYaw = rig.diagnostics().look.worldYaw;
    const expectedPosition = rig.camera.position.clone();

    for (let frame = 0; frame < 120; frame += 1) {
      const echoedHeading = rig.diagnostics().look.worldYaw;
      rig.update(1 / 60, {
        position: { x: 3, y: 0, z: -2 },
        heading: echoedHeading,
      });
      expect(rig.diagnostics().look.worldYaw).toBeCloseTo(expectedYaw, 10);
    }

    expect(rig.camera.position.distanceTo(expectedPosition)).toBeLessThan(1e-9);
    expect(rig.diagnostics().target!.heading).toBeCloseTo(-0.4, 10);
  });

  it("smoothly and deterministically follows world position and shortest-path heading", () => {
    const options = { followSharpness: 2, shoulderOffset: 0 };
    const oneStep = new ThirdPersonRig(options);
    const twoSteps = new ThirdPersonRig(options);
    const next = { position: { x: 10, y: 1, z: -6 }, heading: Math.PI / 2 };
    oneStep.enter(originPose);
    twoSteps.enter(originPose);

    oneStep.update(0.1, next);
    twoSteps.update(0.05, next);
    twoSteps.update(0.05, next);
    const followed = oneStep.diagnostics().target!;
    expect(followed.x).toBeGreaterThan(0);
    expect(followed.x).toBeLessThan(10);
    expect(followed.y).toBeGreaterThan(0);
    expect(followed.z).toBeGreaterThan(-6);
    expect(followed.heading).toBeGreaterThan(0);
    expect(followed.heading).toBeLessThan(Math.PI / 2);
    const splitFollowed = twoSteps.diagnostics().target!;
    expect(splitFollowed.x).toBeCloseTo(followed.x, 12);
    expect(splitFollowed.y).toBeCloseTo(followed.y, 12);
    expect(splitFollowed.z).toBeCloseTo(followed.z, 12);
    expect(splitFollowed.heading).toBeCloseTo(followed.heading, 12);

    const before = followed.x;
    oneStep.update(0.1, next);
    expect(oneStep.diagnostics().target!.x).toBeGreaterThan(before);
  });

  it("updates a bounded perspective aspect for portrait, landscape and invalid resize inputs", () => {
    const rig = new ThirdPersonRig();
    const before = rig.camera.projectionMatrix.clone();
    rig.resize(390, 844);
    expect(rig.camera.aspect).toBeCloseTo(390 / 844, 12);
    expect(rig.camera.projectionMatrix.equals(before)).toBe(false);
    rig.resize(1280, 720);
    expect(rig.camera.aspect).toBeCloseTo(16 / 9, 12);
    rig.resize(Number.POSITIVE_INFINITY, 0);
    expect(rig.camera.aspect).toBe(1);
    expectFiniteMatrix(rig.camera.projectionMatrix);
  });

  it("keeps the camera above a collision-aware terrain floor", () => {
    const rig = new ThirdPersonRig({
      cameraHeight: 1,
      minimumGroundClearance: 0.45,
      groundHeightAt: (x, z) => 4 + x * 0.02 - z * 0.01,
    });
    rig.enter(originPose);
    const diagnostics = rig.diagnostics();
    expect(diagnostics.camera.y).toBeCloseTo(diagnostics.ground.height + 0.45, 10);
    expect(diagnostics.ground.clearance).toBeGreaterThanOrEqual(0.45 - 1e-10);
  });

  it("intersects a downward aim ray with the height field", () => {
    const rig = new ThirdPersonRig({
      defaultPitch: -0.4,
      maximumAimRange: 20,
      groundHeightAt: () => 0,
    });
    rig.enter(originPose);
    const aim = rig.getAimPoint();

    expect(aim.hitGround).toBe(true);
    expect(aim.point.y).toBe(0);
    expect(aim.distance).toBeGreaterThan(0);
    expect(aim.distance).toBeLessThan(20);
    expect(aim.direction.y).toBeLessThan(0);
    expect(rig.diagnostics().aim.hitGround).toBe(true);
  });

  it("falls back to max range when an upward aim ray never reaches terrain", () => {
    const rig = new ThirdPersonRig({ maximumPitch: 0.6, maximumAimRange: 12 });
    rig.enter(originPose);
    rig.look(0, 100);
    rig.update(0, originPose);
    const aim = rig.getAimPoint();
    const expected = rig.camera.position.clone().addScaledVector(aim.direction, 12);

    expect(aim.hitGround).toBe(false);
    expect(aim.distance).toBe(12);
    expect(aim.point.distanceTo(expected)).toBeLessThan(1e-10);
    expect(aim.direction.y).toBeGreaterThan(0);
  });

  it("stays finite after extreme poses, look input, delta and resize values", () => {
    const rig = new ThirdPersonRig({ groundHeightAt: () => Number.NaN });
    rig.enter({
      position: { x: Number.NaN, y: Number.POSITIVE_INFINITY, z: Number.NEGATIVE_INFINITY },
      heading: Number.POSITIVE_INFINITY,
    });
    rig.look(Number.POSITIVE_INFINITY, Number.NaN);
    rig.resize(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);
    rig.update(Number.MAX_VALUE, {
      position: { x: Number.MAX_VALUE, y: -Number.MAX_VALUE, z: Number.MAX_VALUE },
      heading: Number.MAX_VALUE,
    });
    rig.camera.updateMatrixWorld(true);

    expectFiniteVector(rig.camera.position);
    expectFiniteVector(rig.getAimDirection());
    expectFiniteVector(rig.getAimPoint(Number.POSITIVE_INFINITY).point);
    expectFiniteMatrix(rig.camera.matrixWorld);
    expectFiniteMatrix(rig.camera.matrixWorldInverse);
    expectFiniteMatrix(rig.camera.projectionMatrix);
    expect(Object.values(rig.diagnostics().camera).every(Number.isFinite)).toBe(true);

    const hostileOptions = new ThirdPersonRig({
      aspect: Number.MAX_VALUE,
      fov: Number.MAX_VALUE,
      near: Number.MAX_VALUE,
      far: Number.MAX_VALUE,
      backOffset: Number.MAX_VALUE,
      cameraHeight: Number.MAX_VALUE,
      followSharpness: Number.MAX_VALUE,
      minimumGroundClearance: Number.MAX_VALUE,
      maximumAimRange: Number.MAX_VALUE,
      groundHeightAt: () => Number.MAX_VALUE,
    });
    hostileOptions.enter({ position: { x: Number.MAX_VALUE, y: Number.MAX_VALUE, z: Number.MAX_VALUE }, heading: Number.MAX_VALUE });
    expectFiniteVector(hostileOptions.camera.position);
    expectFiniteVector(hostileOptions.getAimPoint(Number.MAX_VALUE).point);
    expectFiniteMatrix(hostileOptions.camera.projectionMatrix);
  });

  it("resets look explicitly and clears followed state on exit or dispose", () => {
    const rig = new ThirdPersonRig({ defaultYaw: 0.2, defaultPitch: -0.2 });
    rig.enter({ position: { x: 7, y: 2, z: -4 }, heading: 1 });
    rig.look(0.7, 0.5);
    rig.update(0, { position: { x: 7, y: 2, z: -4 }, heading: 1 });
    rig.resetLook();
    expect(rig.diagnostics().look).toMatchObject({ yaw: 0.2, pitch: -0.2 });
    expect(rig.active).toBe(true);

    rig.exit();
    expect(rig.diagnostics().active).toBe(false);
    expect(rig.diagnostics().target).toBeNull();
    expect(rig.diagnostics().look.yaw).toBe(0.2);
    expect(rig.diagnostics().look.pitch).toBe(-0.2);
    expect(rig.diagnostics().look.worldYaw).toBeCloseTo(0.2, 12);
    expectFiniteVector(rig.camera.position);

    rig.enter(originPose);
    rig.dispose();
    expect(rig.active).toBe(false);
    expect(rig.diagnostics().target).toBeNull();
  });
});
