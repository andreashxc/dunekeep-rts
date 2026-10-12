import * as THREE from "three";

/** Camera-facing health bars must align in billboard space, not along world X. */
export function addHealthBar(group: THREE.Group, alwaysVisible: boolean): void {
  group.updateMatrixWorld(true);
  // Measure in the entity's local space so a scaled actor does not scale its bar twice.
  const bounds = new THREE.Box3().setFromObject(group).applyMatrix4(group.matrixWorld.clone().invert());
  const width = alwaysVisible ? 0.82 : 0.92;
  const y = Math.max(alwaysVisible ? 1.14 : 0.88, bounds.max.y + (alwaysVisible ? 0.24 : 0.3));
  const bar = new THREE.Group();
  bar.name = "health-bar";
  bar.position.y = y;
  bar.userData.alwaysVisible = alwaysVisible;

  const background = new THREE.Sprite(
    new THREE.SpriteMaterial({ color: "#261e1b", transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }),
  );
  background.name = "health-background";
  background.scale.set(width + 0.08, 0.13, 1);
  background.renderOrder = 20;
  bar.add(background);

  const fill = new THREE.Sprite(
    new THREE.SpriteMaterial({ color: "#70c66b", transparent: true, opacity: 0.98, depthTest: false, depthWrite: false }),
  );
  fill.name = "health-fill";
  // Both sprites share the exact same origin. World-space offsets rotate with the
  // entity and camera, separating the fill from its track in an isometric view.
  fill.scale.set(width, 0.075, 1);
  fill.renderOrder = 21;
  bar.add(fill);
  group.userData.healthBar = bar;
  group.userData.healthFill = fill;
  group.userData.healthWidth = width;
  group.add(bar);
}

export function updateHealthBar(group: THREE.Group, ratio: number, visibilityOverride?: boolean): void {
  const bar = group.userData.healthBar as THREE.Group | undefined;
  const fill = group.userData.healthFill as THREE.Sprite | undefined;
  const width = group.userData.healthWidth as number | undefined;
  if (!bar || !fill || !width) return;
  const clamped = Number.isFinite(ratio) ? THREE.MathUtils.clamp(ratio, 0, 1) : 0;
  bar.visible = visibilityOverride ?? (Boolean(bar.userData.alwaysVisible) || clamped < 0.995);
  fill.visible = clamped > 0;
  fill.scale.x = Math.max(0.001, width * clamped);
  // Sprite.center is applied after billboard alignment. This keeps the left edge
  // fixed at -width/2 for every fill ratio, camera pitch and entity rotation.
  fill.center.set(width / (2 * fill.scale.x), 0.5);
  const tone = group.userData.healthTone as "ally" | "enemy" | undefined;
  fill.material.color.set(tone === "enemy"
    ? clamped > 0.3 ? "#df6a52" : "#ffad62"
    : tone === "ally"
      ? clamped > 0.3 ? "#62c6bd" : "#e8b84f"
      : clamped > 0.6 ? "#70c66b" : clamped > 0.3 ? "#e8b84f" : "#df5548");
}
