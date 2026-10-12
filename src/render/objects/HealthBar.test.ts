import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { addHealthBar, updateHealthBar } from "./HealthBar";
import { disposeEntity } from "./EntityDisposal";

function fixture(alwaysVisible = false) {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), new THREE.MeshBasicMaterial()));
  addHealthBar(group, alwaysVisible);
  return {
    group,
    bar: group.userData.healthBar as THREE.Group,
    fill: group.userData.healthFill as THREE.Sprite,
    background: group.getObjectByName("health-background") as THREE.Sprite,
    width: group.userData.healthWidth as number,
  };
}

/** Match Three.js' sprite vertex shader, including center and inherited scale. */
function projectSprite(sprite: THREE.Sprite, camera: THREE.Camera, u: number, v: number): THREE.Vector3 {
  const worldScale = new THREE.Vector3().setFromMatrixScale(sprite.matrixWorld);
  const point = new THREE.Vector3().setFromMatrixPosition(sprite.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
  point.x += (u - sprite.center.x) * worldScale.x;
  point.y += (v - sprite.center.y) * worldScale.y;
  return point.applyMatrix4(camera.projectionMatrix);
}

describe("billboard health bars", () => {
  it.each([0.01, 0.25, 0.65, 1])("keeps a %s fill inside its track at every orbit and entity heading", (ratio) => {
    const { group, fill, background, width } = fixture();
    group.position.set(2, 0, -1);
    group.scale.setScalar(0.84);
    const camera = new THREE.OrthographicCamera(-9, 9, 6, -6, 0.1, 100);
    for (const heading of [0, Math.PI / 3, Math.PI, Math.PI * 1.5]) {
      group.rotation.set(0, heading, 0.02);
      updateHealthBar(group, ratio, true);
      group.updateMatrixWorld(true);
      expect(fill.getWorldPosition(new THREE.Vector3()).distanceTo(background.getWorldPosition(new THREE.Vector3()))).toBe(0);
      for (const yaw of [-2.2, 0, 0.8, 2.5]) for (const pitch of [0.3, 0.64, 1.545]) {
        camera.position.set(Math.cos(yaw) * Math.cos(pitch) * 30, Math.sin(pitch) * 30, Math.sin(yaw) * Math.cos(pitch) * 30);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);
        const left = projectSprite(fill, camera, 0, 0.5);
        const right = projectSprite(fill, camera, 1, 0.5);
        const trackLeft = projectSprite(background, camera, 0.04 / (width + 0.08), 0.5);
        const trackRight = projectSprite(background, camera, (0.04 + width) / (width + 0.08), 0.5);
        expect(left.x).toBeCloseTo(trackLeft.x, 10);
        expect(left.y).toBeCloseTo(trackLeft.y, 10);
        expect(right.y).toBeCloseTo(trackRight.y, 10);
        expect(right.x).toBeCloseTo(trackLeft.x + (trackRight.x - trackLeft.x) * ratio, 10);
        expect(right.x).toBeLessThanOrEqual(trackRight.x + 1e-10);
      }
    }
    disposeEntity(group);
  });

  it("hides a full undamaged bar and obeys wall-cluster visibility overrides", () => {
    const { group, bar } = fixture();
    updateHealthBar(group, 1);
    expect(bar.visible).toBe(false);
    updateHealthBar(group, 0.8);
    expect(bar.visible).toBe(true);
    updateHealthBar(group, 0.3, false);
    expect(bar.visible).toBe(false);
    updateHealthBar(group, 1, true);
    expect(bar.visible).toBe(true);
    disposeEntity(group);
  });

  it.each([0, -1, Number.NaN])("does not draw an invalid/empty %s fill or generate non-finite anchors", (ratio) => {
    const { group, bar, fill } = fixture(true);
    updateHealthBar(group, ratio);
    expect(bar.visible).toBe(true);
    expect(fill.visible).toBe(false);
    expect(Number.isFinite(fill.center.x)).toBe(true);
    disposeEntity(group);
  });

  it("clamps over-healing without overflowing the background", () => {
    const { group, fill, width } = fixture(true);
    updateHealthBar(group, 4);
    expect(fill.scale.x).toBe(width);
    expect(fill.center.x).toBe(0.5);
    disposeEntity(group);
  });

  it.each([
    [undefined, 0.8, "#70c66b"], [undefined, 0.5, "#e8b84f"], [undefined, 0.2, "#df5548"],
    ["ally", 0.8, "#62c6bd"], ["enemy", 0.8, "#df6a52"],
  ] as const)("preserves %s health-color semantics at %s", (tone, ratio, color) => {
    const { group, fill } = fixture();
    group.userData.healthTone = tone;
    updateHealthBar(group, ratio);
    expect(fill.material.color.equals(new THREE.Color(color))).toBe(true);
    disposeEntity(group);
  });
});
