import { describe, expect, it } from "vitest";
import {
  applyThirdPersonLook,
  cameraRelativeMovement,
  classifyPointerControlGesture,
  classifySelectionGesture,
  combineUnitSelection,
  createControlledUnitAttackAction,
  createControlledUnitMoveAction,
  createFormationMoveAction,
  createKeyboardState,
  createTacticalControlState,
  deterministicFormationOffsets,
  horizontalAimTarget,
  keyboardActionForCode,
  keyboardIntent,
  normalizeMobileJoystick,
  resetKeyboardState,
  screenDragToLookDelta,
  selectionDragRectangle,
  shouldRequestDirectDismount,
  shouldRequestDirectMount,
  shouldToggleDirectDance,
  shouldTriggerDirectAttack,
  transitionBetaControlState,
  unitIdsInSelectionRectangle,
  updateKeyboardState,
  yawRelativeMovement,
  type BetaControlState,
} from "./BetaUnitControls";

const expectClose = (actual: number, expected: number): void => {
  expect(actual).toBeCloseTo(expected, 6);
};

const selectedState = (): BetaControlState => transitionBetaControlState(
  createTacticalControlState(),
  { type: "replace-selection", unitIds: [9, 3, 5], primaryUnitId: 5 },
).state;

const thirdPersonState = (): BetaControlState => transitionBetaControlState(
  selectedState(),
  { type: "enter-third-person", unitId: 5 },
).state;

describe("desktop keyboard mapping", () => {
  it("maps WASD, arrows, Shift, Space, Escape, and Enter to explicit actions", () => {
    expect(keyboardActionForCode("KeyW")).toBe("move-forward");
    expect(keyboardActionForCode("ArrowUp")).toBe("move-forward");
    expect(keyboardActionForCode("KeyA")).toBe("move-left");
    expect(keyboardActionForCode("ArrowRight")).toBe("move-right");
    expect(keyboardActionForCode("ShiftLeft")).toBe("sprint");
    expect(keyboardActionForCode("Space")).toBe("attack");
    expect(keyboardActionForCode("Escape")).toBe("cancel");
    expect(keyboardActionForCode("Enter")).toBe("confirm");
    expect(keyboardActionForCode("NumpadEnter")).toBe("confirm");
    expect(keyboardActionForCode("KeyQ")).toBeNull();
  });

  it("normalizes diagonal held movement and exposes combat buttons", () => {
    const state = createKeyboardState(["KeyW", "KeyD", "ShiftRight", "Space", "Enter", "Escape"]);
    const intent = keyboardIntent(state);
    expectClose(intent.strafe, Math.SQRT1_2);
    expectClose(intent.forward, Math.SQRT1_2);
    expect(intent.magnitude).toBe(1);
    expect(intent).toMatchObject({ sprint: true, attack: true, confirm: true, cancel: true });
  });

  it("tracks physical aliases independently when one key is released", () => {
    let state = createKeyboardState(["KeyW", "ArrowUp"]);
    state = updateKeyboardState(state, "KeyW", false);
    expect(keyboardIntent(state).forward).toBe(1);
    state = updateKeyboardState(state, "ArrowUp", false);
    expect(keyboardIntent(state).forward).toBe(0);
  });

  it("cancels opposing directions and resets all held inputs", () => {
    const opposed = keyboardIntent(createKeyboardState(["KeyW", "KeyS", "KeyA", "KeyD", "Space"]));
    expect(opposed).toMatchObject({ strafe: 0, forward: 0, magnitude: 0, attack: true });
    expect(keyboardIntent(resetKeyboardState())).toEqual({
      strafe: 0, forward: 0, magnitude: 0,
      sprint: false, attack: false, confirm: false, cancel: false,
    });
  });

  it("edge-triggers the dance, climb, and explicit dismount shortcuts", () => {
    expect(shouldToggleDirectDance("KeyV")).toBe(true);
    expect(shouldToggleDirectDance("KeyV", true)).toBe(false);
    expect(shouldToggleDirectDance("KeyX")).toBe(false);
    expect(shouldRequestDirectDismount("KeyX")).toBe(true);
    expect(shouldRequestDirectDismount("KeyX", true)).toBe(false);
    expect(shouldRequestDirectDismount("KeyV")).toBe(false);
    expect(shouldRequestDirectMount("KeyE")).toBe(true);
    expect(shouldRequestDirectMount("KeyE", true)).toBe(false);
    expect(shouldRequestDirectMount("KeyX")).toBe(false);
  });
});

describe("mobile joystick math", () => {
  it("suppresses movement inside the radial dead-zone", () => {
    expect(normalizeMobileJoystick({ x: 5, y: -5 }, { radius: 50, deadZone: 0.2 })).toEqual({
      strafe: 0, forward: 0, magnitude: 0,
    });
  });

  it("normalizes a diagonal at the rim and flips screen Y into forward", () => {
    const input = normalizeMobileJoystick({ x: 30, y: -40 }, { radius: 50, deadZone: 0 });
    expectClose(input.strafe, 0.6);
    expectClose(input.forward, 0.8);
    expect(input.magnitude).toBe(1);
  });

  it("radially remaps strength outside the dead-zone and saturates past the rim", () => {
    const half = normalizeMobileJoystick({ x: 30, y: 0 }, { radius: 60, deadZone: 0.2 });
    expectClose(half.magnitude, 0.375);
    expectClose(half.strafe, 0.375);
    const saturated = normalizeMobileJoystick({ x: 0, y: 200 }, { radius: 50, deadZone: 0.15 });
    expect(saturated).toEqual({ strafe: 0, forward: -1, magnitude: 1 });
  });

  it("uses a documented linear response after the dead-zone by default", () => {
    const half = normalizeMobileJoystick({ x: 60, y: 0 }, { radius: 100, deadZone: 0.2 });
    expectClose(half.magnitude, 0.5);
    expectClose(half.strafe, 0.5);
    expectClose(half.forward, 0);
  });

  it("supports an explicit response exponent without changing direction", () => {
    const curved = normalizeMobileJoystick(
      { x: 60, y: 0 },
      { radius: 100, deadZone: 0.2, responseExponent: 2 },
    );
    expectClose(curved.magnitude, 0.25);
    expectClose(curved.strafe, 0.25);
    expectClose(curved.forward, 0);
  });

  it.each([
    ["top", { x: 0, y: -50 }, { strafe: 0, forward: 1 }],
    ["right", { x: 50, y: 0 }, { strafe: 1, forward: 0 }],
    ["bottom", { x: 0, y: 50 }, { strafe: 0, forward: -1 }],
    ["left", { x: -50, y: 0 }, { strafe: -1, forward: 0 }],
  ] as const)("maps joystick %s to the expected local axes", (_label, delta, expected) => {
    const axes = normalizeMobileJoystick(delta, { radius: 50, deadZone: 0 });
    expectClose(axes.strafe, expected.strafe);
    expectClose(axes.forward, expected.forward);
    expectClose(axes.magnitude, 1);
  });
});

describe("camera-relative movement contract", () => {
  it.each([
    ["0°", 0, { x: 0, z: 1 }, { x: -1, z: 0 }],
    ["90°", Math.PI / 2, { x: 1, z: 0 }, { x: 0, z: 1 }],
    ["180°", Math.PI, { x: 0, z: -1 }, { x: 1, z: 0 }],
    ["-90°", -Math.PI / 2, { x: -1, z: 0 }, { x: 0, z: -1 }],
  ] as const)("keeps forward and camera-right correct at yaw %s", (_label, yaw, expectedForward, expectedRight) => {
    const forward = cameraRelativeMovement({ strafe: 0, forward: 1 }, yaw);
    expectClose(forward.x, expectedForward.x);
    expectClose(forward.z, expectedForward.z);
    expectClose(forward.magnitude, 1);

    const right = cameraRelativeMovement({ strafe: 1, forward: 0 }, yaw);
    expectClose(right.x, expectedRight.x);
    expectClose(right.z, expectedRight.z);
    expectClose(right.magnitude, 1);
  });

  it.each([0, Math.PI / 2, Math.PI, -Math.PI / 2])(
    "produces identical world movement for keyboard and joystick at yaw %s",
    (yaw) => {
      const keyboardForward = keyboardIntent(createKeyboardState(["KeyW"]));
      const joystickForward = normalizeMobileJoystick({ x: 0, y: -48 }, { radius: 48, deadZone: 0 });
      const keyboardRight = keyboardIntent(createKeyboardState(["KeyD"]));
      const joystickRight = normalizeMobileJoystick({ x: 48, y: 0 }, { radius: 48, deadZone: 0 });
      const worldKeyboardForward = cameraRelativeMovement(keyboardForward, yaw);
      const worldJoystickForward = cameraRelativeMovement(joystickForward, yaw);
      const worldKeyboardRight = cameraRelativeMovement(keyboardRight, yaw);
      const worldJoystickRight = cameraRelativeMovement(joystickRight, yaw);
      expectClose(worldKeyboardForward.x, worldJoystickForward.x);
      expectClose(worldKeyboardForward.z, worldJoystickForward.z);
      expectClose(worldKeyboardRight.x, worldJoystickRight.x);
      expectClose(worldKeyboardRight.z, worldJoystickRight.z);
    },
  );

  it("keeps the legacy export on the same +Z heading contract", () => {
    expect(yawRelativeMovement({ strafe: 0, forward: 1 }, 0)).toEqual({ x: 0, z: 1, magnitude: 1 });
  });

  it("normalizes a diagonal instead of making it faster", () => {
    const movement = cameraRelativeMovement({ strafe: 1, forward: 1 }, 0);
    expectClose(Math.hypot(movement.x, movement.z), 1);
    expect(movement.magnitude).toBe(1);
  });
});

describe("horizontal direct-combat aim", () => {
  it.each([
    ["0°", 0, 4, 17],
    ["90°", Math.PI / 2, 16, 5],
    ["180°", Math.PI, 4, -7],
    ["-90°", -Math.PI / 2, -8, 5],
  ])("keeps aim on camera yaw at %s without pitch or terrain", (_label, yaw, expectedX, expectedZ) => {
    const target = horizontalAimTarget({ x: 4, z: 5 }, yaw, 12);
    expectClose(target.x, expectedX);
    expectClose(target.z, expectedZ);
  });
});

describe("bounded third-person look", () => {
  it.each([
    ["right", { x: 20, y: 0 }, { yawSign: -1, pitchSign: 0 }],
    ["left", { x: -20, y: 0 }, { yawSign: 1, pitchSign: 0 }],
    ["up", { x: 0, y: -20 }, { yawSign: 0, pitchSign: 1 }],
    ["down", { x: 0, y: 20 }, { yawSign: 0, pitchSign: -1 }],
  ] as const)("maps a %s screen drag to non-inverted view movement", (_label, delta, expected) => {
    const look = screenDragToLookDelta(delta, { sensitivityX: 0.01, sensitivityY: 0.01 });
    expect(Math.sign(look.yawDelta)).toBe(expected.yawSign);
    expect(Math.sign(look.pitchDelta)).toBe(expected.pitchSign);
  });

  it("uses exactly the same signs and scale for mouse and touch raw deltas", () => {
    const mouseRawDelta = { x: 18, y: -11 };
    const touchRawDelta = { x: 18, y: -11 };
    expect(screenDragToLookDelta(mouseRawDelta)).toEqual(screenDragToLookDelta(touchRawDelta));
  });

  it("turns right for positive X and looks down for positive screen Y", () => {
    const look = applyThirdPersonLook(
      { yaw: 0, pitch: 0.4 },
      { x: 100, y: 20 },
      { sensitivityX: 0.01, sensitivityY: 0.01, maxDeltaPixels: 40 },
    );
    expectClose(look.yaw, -0.4);
    expectClose(look.pitch, 0.2);
    expect(look.appliedDeltaX).toBe(40);
    expect(look.appliedDeltaY).toBe(20);
  });

  it("supports Y inversion and clamps pitch", () => {
    const inverted = applyThirdPersonLook(
      { yaw: 0, pitch: 0.9 },
      { x: 0, y: 100 },
      { sensitivityY: 0.01, maxDeltaPixels: 100, minPitch: -0.2, maxPitch: 1, invertY: true },
    );
    expect(inverted.pitch).toBe(1);
    const normal = applyThirdPersonLook(
      { yaw: 0, pitch: -0.1 },
      { x: 0, y: 100 },
      { sensitivityY: 0.01, maxDeltaPixels: 100, minPitch: -0.25, maxPitch: 1 },
    );
    expect(normal.pitch).toBe(-0.25);
  });

  it("wraps yaw into a stable signed turn", () => {
    const look = applyThirdPersonLook(
      { yaw: Math.PI - 0.05, pitch: 0 },
      { x: -10, y: 0 },
      { sensitivityX: 0.02, maxDeltaPixels: 20 },
    );
    expect(look.yaw).toBeLessThan(-Math.PI + 0.2);
  });
});

describe("intentional direct attack trigger", () => {
  it("fires once for non-repeated keyboard and dedicated attack-button presses", () => {
    expect(shouldTriggerDirectAttack({ source: "keyboard", pressed: true })).toBe(true);
    expect(shouldTriggerDirectAttack({ source: "keyboard", pressed: true, repeat: true })).toBe(false);
    expect(shouldTriggerDirectAttack({ source: "attack-button", pressed: true })).toBe(true);
    expect(shouldTriggerDirectAttack({ source: "attack-button", pressed: false })).toBe(false);
  });

  it("allows primary fire in pointer-lock but never an unlocked canvas tap or look gesture", () => {
    expect(shouldTriggerDirectAttack({
      source: "canvas-pointer", pressed: true, button: 0, pointerLocked: true,
    })).toBe(true);
    expect(shouldTriggerDirectAttack({
      source: "canvas-pointer", pressed: true, button: 0, pointerLocked: false,
    })).toBe(false);
    expect(shouldTriggerDirectAttack({
      source: "canvas-pointer", pressed: true, button: 2, pointerLocked: true,
    })).toBe(false);
  });
});

describe("click, box-selection, and look-drag routing", () => {
  const start = { x: 100, y: 100 };

  it("uses an eight-pixel click threshold and direction-independent rectangles", () => {
    expect(classifySelectionGesture(start, { x: 106, y: 104 }, 8)).toBe("click");
    expect(classifySelectionGesture(start, { x: 109, y: 100 }, 8)).toBe("drag");
    expect(selectionDragRectangle(start, { x: 40, y: 180 })).toEqual({
      left: 40, top: 100, right: 100, bottom: 180, width: 60, height: 80,
    });
  });

  it("routes tactical primary mouse drag to a box and camera-style drags to look", () => {
    const end = { x: 130, y: 120 };
    expect(classifyPointerControlGesture(start, end, { controlMode: "tactical", pointerType: "mouse", button: 0 })).toBe("box-select");
    expect(classifyPointerControlGesture(start, end, { controlMode: "unit-selected", pointerType: "mouse", button: 2 })).toBe("look-drag");
    expect(classifyPointerControlGesture(start, end, { controlMode: "tactical", pointerType: "mouse", lookModifier: true })).toBe("look-drag");
    expect(classifyPointerControlGesture(start, end, { controlMode: "third-person", pointerType: "mouse" })).toBe("look-drag");
  });

  it("defaults touch drags to look but allows an explicit long-press box selection", () => {
    const end = { x: 130, y: 120 };
    expect(classifyPointerControlGesture(start, end, { controlMode: "tactical", pointerType: "touch" })).toBe("look-drag");
    expect(classifyPointerControlGesture(start, end, {
      controlMode: "tactical", pointerType: "touch", dragPurpose: "selection",
    })).toBe("box-select");
    expect(classifyPointerControlGesture(start, { x: 103, y: 101 }, {
      controlMode: "third-person", pointerType: "touch",
    })).toBe("click");
  });

  it("returns every selectable projected unit inside an inclusive drag rectangle", () => {
    const rectangle = selectionDragRectangle({ x: 10, y: 10 }, { x: 50, y: 50 });
    const ids = unitIdsInSelectionRectangle([
      { unitId: 8, x: 20, y: 20 },
      { unitId: 3, x: 55, y: 30, screenRadius: 5 },
      { unitId: 4, x: 30, y: 30, selectable: false },
      { unitId: 2, x: 80, y: 80 },
      { unitId: 8, x: 25, y: 25 },
    ], rectangle);
    expect(ids).toEqual([3, 8]);
  });

  it("combines multi-selection deterministically", () => {
    expect(combineUnitSelection([5, 2], [7, 5], "replace")).toEqual([5, 7]);
    expect(combineUnitSelection([5, 2], [7, 5], "add")).toEqual([2, 5, 7]);
    expect(combineUnitSelection([5, 2], [7, 5], "toggle")).toEqual([2, 7]);
  });
});

describe("deterministic formations", () => {
  it("deduplicates and sorts IDs so selection order cannot reshuffle slots", () => {
    const first = deterministicFormationOffsets([9, 2, 5, 2], { spacing: 2, maxColumns: 2 });
    const second = deterministicFormationOffsets([5, 9, 2], { spacing: 2, maxColumns: 2 });
    expect(first).toEqual(second);
    expect(first.map((slot) => slot.unitId)).toEqual([2, 5, 9]);
  });

  it("centers uneven rows exactly on the issued destination", () => {
    const formation = deterministicFormationOffsets([1, 2, 3, 4, 5], { spacing: 1.4, maxColumns: 3 });
    expectClose(formation.reduce((sum, slot) => sum + slot.x, 0), 0);
    expectClose(formation.reduce((sum, slot) => sum + slot.z, 0), 0);
  });

  it("rotates slots deterministically with formation yaw", () => {
    const base = deterministicFormationOffsets([1, 2], { spacing: 2, maxColumns: 2, facingYaw: 0 });
    const rotated = deterministicFormationOffsets([1, 2], { spacing: 2, maxColumns: 2, facingYaw: Math.PI / 2 });
    expectClose(rotated[0].x, -base[0].z);
    expectClose(rotated[0].z, base[0].x);
  });
});

describe("control mode state machine", () => {
  it("accepts only tactical -> selected -> third-person", () => {
    const tactical = createTacticalControlState();
    const invalid = transitionBetaControlState(tactical, { type: "enter-third-person" });
    expect(invalid).toMatchObject({ accepted: false, reason: "requires-unit-selection", state: tactical });

    const selection = transitionBetaControlState(tactical, {
      type: "replace-selection", unitIds: [9, 3, 5], primaryUnitId: 5,
    });
    expect(selection.state).toEqual({ mode: "unit-selected", selectedUnitIds: [3, 5, 9], primaryUnitId: 5 });
    expect(selection.effects).toEqual([{ type: "selection-changed", unitIds: [3, 5, 9], primaryUnitId: 5 }]);

    const entered = transitionBetaControlState(selection.state, { type: "enter-third-person" });
    expect(entered.state).toEqual({
      mode: "third-person", selectedUnitIds: [3, 5, 9], primaryUnitId: 5, controlledUnitId: 5,
    });
    expect(entered.effects).toEqual([{ type: "third-person-entered", unitId: 5 }]);
  });

  it("cancels one layer at a time and locks selection while controlling a unit", () => {
    const thirdPerson = thirdPersonState();
    expect(transitionBetaControlState(thirdPerson, {
      type: "replace-selection", unitIds: [3],
    })).toMatchObject({ accepted: false, reason: "selection-locked" });

    const selected = transitionBetaControlState(thirdPerson, { type: "cancel" });
    expect(selected.state).toEqual({ mode: "unit-selected", selectedUnitIds: [3, 5, 9], primaryUnitId: 5 });
    const tactical = transitionBetaControlState(selected.state, { type: "cancel" });
    expect(tactical.state).toEqual(createTacticalControlState());
  });

  it("falls back safely if the controlled unit becomes unavailable", () => {
    const transition = transitionBetaControlState(thirdPersonState(), { type: "unit-unavailable", unitId: 5 });
    expect(transition.state).toEqual({ mode: "unit-selected", selectedUnitIds: [3, 9], primaryUnitId: 3 });
    expect(transition.effects).toEqual([
      { type: "third-person-exited", unitId: 5 },
      { type: "selection-changed", unitIds: [3, 9], primaryUnitId: 3 },
    ]);
  });

  it("reset returns any active mode to a clean tactical state", () => {
    const reset = transitionBetaControlState(thirdPersonState(), { type: "reset" });
    expect(reset.state).toEqual(createTacticalControlState());
    expect(reset.effects).toEqual([
      { type: "third-person-exited", unitId: 5 },
      { type: "selection-changed", unitIds: [], primaryUnitId: null },
    ]);
    expect(transitionBetaControlState(reset.state, { type: "reset" })).toMatchObject({
      accepted: false, reason: "unchanged",
    });
  });
});

describe("typed integration actions", () => {
  it("creates a centered move formation only in unit-selected mode", () => {
    const action = createFormationMoveAction(selectedState(), { x: 12, z: -4 }, { spacing: 1.5 });
    expect(action).not.toBeNull();
    expect(action).toMatchObject({ type: "move-selected-units", unitIds: [3, 5, 9], target: { x: 12, z: -4 } });
    expect(action?.formation.map((slot) => slot.unitId)).toEqual([3, 5, 9]);
    expect(createFormationMoveAction(createTacticalControlState(), { x: 1, z: 1 })).toBeNull();
  });

  it("creates yaw-relative held movement only for the controlled unit", () => {
    const action = createControlledUnitMoveAction(thirdPersonState(), { strafe: 0, forward: 1 }, Math.PI / 2, true);
    expect(action).not.toBeNull();
    expect(action).toMatchObject({ type: "move-controlled-unit", unitId: 5, sprint: true });
    expectClose(action?.direction.x ?? 0, 1);
    expectClose(action?.direction.z ?? 1, 0);
    expect(createControlledUnitMoveAction(selectedState(), { strafe: 0, forward: 1 }, 0, false)).toBeNull();
    expect(createControlledUnitMoveAction(thirdPersonState(), { strafe: 0, forward: 0 }, 0, false)).toBeNull();
  });

  it("types attacks by army unit weapon", () => {
    expect(createControlledUnitAttackAction(thirdPersonState(), "archer")).toEqual({
      type: "attack-controlled-unit", unitId: 5, weapon: "bow",
    });
    expect(createControlledUnitAttackAction(thirdPersonState(), "spearman")?.weapon).toBe("spear");
    expect(createControlledUnitAttackAction(thirdPersonState(), "swordsman")?.weapon).toBe("sword");
    expect(createControlledUnitAttackAction(thirdPersonState(), "knight")?.weapon).toBe("lance");
    expect(createControlledUnitAttackAction(selectedState(), "archer")).toBeNull();
  });
});
