import type { ArmyUnitKind } from "../game/types";

const EPSILON = 1e-6;

export type BetaKeyboardAction =
  | "move-forward"
  | "move-backward"
  | "move-left"
  | "move-right"
  | "sprint"
  | "attack"
  | "confirm"
  | "cancel";

const KEYBOARD_ACTION_BY_CODE: Readonly<Record<string, BetaKeyboardAction>> = Object.freeze({
  KeyW: "move-forward",
  ArrowUp: "move-forward",
  KeyS: "move-backward",
  ArrowDown: "move-backward",
  KeyA: "move-left",
  ArrowLeft: "move-left",
  KeyD: "move-right",
  ArrowRight: "move-right",
  ShiftLeft: "sprint",
  ShiftRight: "sprint",
  Space: "attack",
  Enter: "confirm",
  NumpadEnter: "confirm",
  Escape: "cancel",
});

export interface BetaKeyboardState {
  readonly pressedCodes: ReadonlySet<string>;
}

export interface MovementAxes {
  /** Positive values strafe to the controlled unit's right. */
  readonly strafe: number;
  /** Positive values move in the controlled unit/camera forward direction. */
  readonly forward: number;
  /** Radial strength in the inclusive range 0..1. */
  readonly magnitude: number;
}

export interface BetaKeyboardIntent extends MovementAxes {
  readonly sprint: boolean;
  readonly attack: boolean;
  readonly confirm: boolean;
  readonly cancel: boolean;
}

export function keyboardActionForCode(code: string): BetaKeyboardAction | null {
  return KEYBOARD_ACTION_BY_CODE[code] ?? null;
}

/** Edge-triggered direct-control emote shortcut; held-key repeats never toggle twice. */
export function shouldToggleDirectDance(code: string, repeat = false): boolean {
  return code === "KeyV" && !repeat;
}

/** Explicit descent shortcut; movement keys never silently remove a wall garrison. */
export function shouldRequestDirectDismount(code: string, repeat = false): boolean {
  return code === "KeyX" && !repeat;
}

/** Contextual climb shortcut; the simulation still validates unit type, range, and capacity. */
export function shouldRequestDirectMount(code: string, repeat = false): boolean {
  return code === "KeyE" && !repeat;
}

export function createKeyboardState(initialCodes: Iterable<string> = []): BetaKeyboardState {
  const pressedCodes = new Set<string>();
  for (const code of initialCodes) {
    if (keyboardActionForCode(code)) pressedCodes.add(code);
  }
  return { pressedCodes };
}

/**
 * Immutable key update. Keeping physical codes, instead of action booleans,
 * means releasing W does not cancel ArrowUp when both are held.
 */
export function updateKeyboardState(state: BetaKeyboardState, code: string, pressed: boolean): BetaKeyboardState {
  if (!keyboardActionForCode(code) || state.pressedCodes.has(code) === pressed) return state;
  const pressedCodes = new Set(state.pressedCodes);
  if (pressed) pressedCodes.add(code);
  else pressedCodes.delete(code);
  return { pressedCodes };
}

export function resetKeyboardState(): BetaKeyboardState {
  return createKeyboardState();
}

export function isKeyboardActionPressed(state: BetaKeyboardState, action: BetaKeyboardAction): boolean {
  for (const code of state.pressedCodes) {
    if (keyboardActionForCode(code) === action) return true;
  }
  return false;
}

export function normalizeMovementAxes(strafe: number, forward: number): MovementAxes {
  const safeStrafe = finiteOrZero(strafe);
  const safeForward = finiteOrZero(forward);
  const rawMagnitude = Math.hypot(safeStrafe, safeForward);
  if (rawMagnitude <= EPSILON) return ZERO_MOVEMENT;
  const magnitude = Math.min(1, rawMagnitude);
  return {
    strafe: safeStrafe / rawMagnitude * magnitude,
    forward: safeForward / rawMagnitude * magnitude,
    magnitude,
  };
}

export function keyboardIntent(state: BetaKeyboardState): BetaKeyboardIntent {
  const strafe = Number(isKeyboardActionPressed(state, "move-right")) - Number(isKeyboardActionPressed(state, "move-left"));
  const forward = Number(isKeyboardActionPressed(state, "move-forward")) - Number(isKeyboardActionPressed(state, "move-backward"));
  const movement = normalizeMovementAxes(strafe, forward);
  return {
    ...movement,
    sprint: isKeyboardActionPressed(state, "sprint"),
    attack: isKeyboardActionPressed(state, "attack"),
    confirm: isKeyboardActionPressed(state, "confirm"),
    cancel: isKeyboardActionPressed(state, "cancel"),
  };
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface MobileJoystickOptions {
  /** Joystick radius in CSS pixels. */
  readonly radius?: number;
  /** Radial dead-zone as a fraction of radius. */
  readonly deadZone?: number;
  /**
   * Exponent applied after removing the dead-zone. `1` is linear, values
   * above `1` offer finer control near the centre, and values below `1`
   * accelerate the response. The shipped default is deliberately linear.
   */
  readonly responseExponent?: number;
}

export const DEFAULT_MOBILE_JOYSTICK = Object.freeze({
  radius: 48,
  deadZone: 0.16,
  responseExponent: 1,
}) satisfies Required<MobileJoystickOptions>;

/**
 * Converts a screen-space joystick delta into normalized movement axes.
 * Screen Y grows downward, so an upward drag becomes positive `forward`.
 */
export function normalizeMobileJoystick(delta: ScreenPoint, options: MobileJoystickOptions = {}): MovementAxes {
  const radius = positiveFiniteOr(options.radius, DEFAULT_MOBILE_JOYSTICK.radius);
  const deadZone = clamp(finiteOr(options.deadZone, DEFAULT_MOBILE_JOYSTICK.deadZone), 0, 0.95);
  const responseExponent = positiveFiniteOr(options.responseExponent, DEFAULT_MOBILE_JOYSTICK.responseExponent);
  const dx = finiteOrZero(delta.x);
  const dy = finiteOrZero(delta.y);
  const pixelMagnitude = Math.hypot(dx, dy);
  if (pixelMagnitude <= EPSILON) return ZERO_MOVEMENT;

  const radialMagnitude = Math.min(1, pixelMagnitude / radius);
  if (radialMagnitude <= deadZone) return ZERO_MOVEMENT;
  const linearMagnitude = (radialMagnitude - deadZone) / (1 - deadZone);
  const remappedMagnitude = Math.pow(linearMagnitude, responseExponent);
  return normalizeMovementAxes(
    dx / pixelMagnitude * remappedMagnitude,
    -dy / pixelMagnitude * remappedMagnitude,
  );
}

export interface WorldMovement {
  readonly x: number;
  readonly z: number;
  readonly magnitude: number;
}

export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * Stable 2D combat aim from the controlled entity and horizontal camera course.
 * Camera pitch, shoulder offset and terrain cannot change this direction.
 */
export function horizontalAimTarget(origin: GroundPoint, cameraYaw: number, distance = 12): GroundPoint {
  const safeDistance = positiveFiniteOr(distance, 12);
  const yaw = finiteOrZero(cameraYaw);
  return {
    x: finiteOrZero(origin.x) + Math.sin(yaw) * safeDistance,
    z: finiteOrZero(origin.z) + Math.cos(yaw) * safeDistance,
  };
}

/**
 * The single third-person movement contract used by keyboard and touch.
 *
 * Camera/character heading follows the project's CharacterFactory convention:
 * yaw `0` faces world `+Z`, and yaw `+PI/2` faces world `+X`. Positive strafe
 * always means camera-right. Consequently:
 *
 * - yaw 0: forward +Z, right -X
 * - yaw +PI/2: forward +X, right +Z
 * - yaw PI: forward -Z, right +X
 * - yaw -PI/2: forward -X, right -Z
 *
 * In Three's right-handed X/Z plane a character facing +Z has their physical
 * right toward -X. This is also what players see on screen.
 */
export function cameraRelativeMovement(input: Pick<MovementAxes, "strafe" | "forward">, cameraYaw: number): WorldMovement {
  const movement = normalizeMovementAxes(input.strafe, input.forward);
  if (movement.magnitude <= EPSILON) return ZERO_WORLD_MOVEMENT;
  const safeYaw = finiteOrZero(cameraYaw);
  const cosYaw = Math.cos(safeYaw);
  const sinYaw = Math.sin(safeYaw);
  return {
    x: -cosYaw * movement.strafe + sinYaw * movement.forward,
    z: sinYaw * movement.strafe + cosYaw * movement.forward,
    magnitude: movement.magnitude,
  };
}

/** @deprecated Use `cameraRelativeMovement`; retained for source compatibility. */
export function yawRelativeMovement(input: Pick<MovementAxes, "strafe" | "forward">, cameraYaw: number): WorldMovement {
  return cameraRelativeMovement(input, cameraYaw);
}

export interface ThirdPersonLookState {
  readonly yaw: number;
  /** Camera elevation in radians; positive values look upward. */
  readonly pitch: number;
}

export interface ThirdPersonLookOptions {
  readonly sensitivityX?: number;
  readonly sensitivityY?: number;
  readonly maxDeltaPixels?: number;
  readonly minPitch?: number;
  readonly maxPitch?: number;
  readonly invertY?: boolean;
}

export interface ThirdPersonLookResult extends ThirdPersonLookState {
  readonly appliedDeltaX: number;
  readonly appliedDeltaY: number;
}

export interface ThirdPersonLookDelta {
  /** Internal rig yaw. Screen-right is negative in the project's +Z heading convention. */
  readonly yawDelta: number;
  /** Positive pitch looks upward. */
  readonly pitchDelta: number;
  readonly appliedDeltaX: number;
  readonly appliedDeltaY: number;
}

export const DEFAULT_THIRD_PERSON_LOOK = Object.freeze({
  sensitivityX: 0.0038,
  sensitivityY: 0.0032,
  maxDeltaPixels: 96,
  minPitch: -0.3,
  maxPitch: 1.15,
  invertY: false,
}) satisfies Required<ThirdPersonLookOptions>;

/**
 * Converts mouse or touch screen deltas to the same view-space contract.
 * A rightward drag turns the visible view right; an upward drag looks up. The
 * internal yaw sign is negative because +Z toward +X is a visible left turn.
 * Callers must pass raw
 * screen deltas (`current - previous`) and must not apply platform-specific
 * sign flips before calling this function.
 */
export function screenDragToLookDelta(
  screenDelta: ScreenPoint,
  options: ThirdPersonLookOptions = {},
): ThirdPersonLookDelta {
  const sensitivityX = nonNegativeFiniteOr(options.sensitivityX, DEFAULT_THIRD_PERSON_LOOK.sensitivityX);
  const sensitivityY = nonNegativeFiniteOr(options.sensitivityY, DEFAULT_THIRD_PERSON_LOOK.sensitivityY);
  const maxDeltaPixels = nonNegativeFiniteOr(options.maxDeltaPixels, DEFAULT_THIRD_PERSON_LOOK.maxDeltaPixels);
  const appliedDeltaX = clamp(finiteOrZero(screenDelta.x), -maxDeltaPixels, maxDeltaPixels);
  const appliedDeltaY = clamp(finiteOrZero(screenDelta.y), -maxDeltaPixels, maxDeltaPixels);
  const pitchDirection = (options.invertY ?? DEFAULT_THIRD_PERSON_LOOK.invertY) ? 1 : -1;
  return {
    yawDelta: appliedDeltaX === 0 ? 0 : -appliedDeltaX * sensitivityX,
    pitchDelta: appliedDeltaY === 0 ? 0 : appliedDeltaY * sensitivityY * pitchDirection,
    appliedDeltaX,
    appliedDeltaY,
  };
}

/** Applies the shared mouse/touch look delta and bounds the resulting view. */
export function applyThirdPersonLook(
  state: ThirdPersonLookState,
  screenDelta: ScreenPoint,
  options: ThirdPersonLookOptions = {},
): ThirdPersonLookResult {
  const configuredMinPitch = finiteOr(options.minPitch, DEFAULT_THIRD_PERSON_LOOK.minPitch);
  const configuredMaxPitch = finiteOr(options.maxPitch, DEFAULT_THIRD_PERSON_LOOK.maxPitch);
  const minPitch = Math.min(configuredMinPitch, configuredMaxPitch);
  const maxPitch = Math.max(configuredMinPitch, configuredMaxPitch);
  const lookDelta = screenDragToLookDelta(screenDelta, options);

  return {
    yaw: wrapRadians(finiteOrZero(state.yaw) + lookDelta.yawDelta),
    pitch: clamp(finiteOrZero(state.pitch) + lookDelta.pitchDelta, minPitch, maxPitch),
    appliedDeltaX: lookDelta.appliedDeltaX,
    appliedDeltaY: lookDelta.appliedDeltaY,
  };
}

export type DirectAttackInputSource = "keyboard" | "attack-button" | "canvas-pointer";

export interface DirectAttackInput {
  readonly source: DirectAttackInputSource;
  /** True only on the press edge, never continuously while held. */
  readonly pressed: boolean;
  readonly repeat?: boolean;
  readonly button?: number;
  readonly pointerLocked?: boolean;
}

/**
 * Keeps firing deterministic: keyboard and the dedicated touch button fire on
 * a non-repeated press edge; a canvas click fires only while pointer-lock is
 * active. An unlocked canvas tap/short drag is reserved for looking and cannot
 * accidentally release an arrow.
 */
export function shouldTriggerDirectAttack(input: DirectAttackInput): boolean {
  if (!input.pressed || input.repeat) return false;
  if (input.source === "keyboard" || input.source === "attack-button") return true;
  return input.pointerLocked === true && (input.button ?? 0) === 0;
}

export interface ScreenRectangle {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export type SelectionGestureKind = "click" | "drag";

export type PointerControlGestureKind = "click" | "box-select" | "look-drag";

export interface PointerControlGestureOptions {
  readonly controlMode: BetaControlState["mode"];
  readonly pointerType?: "mouse" | "touch" | "pen";
  readonly button?: number;
  readonly pointerCount?: number;
  readonly lookModifier?: boolean;
  /** `selection` is useful for a mobile long-press selection gesture. */
  readonly dragPurpose?: "auto" | "selection" | "look";
  readonly dragThreshold?: number;
}

export interface ScreenSelectableUnit extends ScreenPoint {
  readonly unitId: number;
  readonly screenRadius?: number;
  readonly selectable?: boolean;
}

export type SelectionCombineMode = "replace" | "add" | "toggle";

export function selectionDragRectangle(start: ScreenPoint, current: ScreenPoint): ScreenRectangle {
  const startX = finiteOrZero(start.x);
  const startY = finiteOrZero(start.y);
  const currentX = finiteOrZero(current.x);
  const currentY = finiteOrZero(current.y);
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const right = Math.max(startX, currentX);
  const bottom = Math.max(startY, currentY);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function classifySelectionGesture(start: ScreenPoint, current: ScreenPoint, dragThreshold = 8): SelectionGestureKind {
  const threshold = nonNegativeFiniteOr(dragThreshold, 8);
  return Math.hypot(finiteOrZero(current.x) - finiteOrZero(start.x), finiteOrZero(current.y) - finiteOrZero(start.y)) > threshold
    ? "drag"
    : "click";
}

/**
 * Routes a completed gesture without relying on PointerEvent or TouchEvent.
 * Tactical mouse primary-drag boxes units; touch and alternate-button drags
 * look/pan by default. Third-person drags always look.
 */
export function classifyPointerControlGesture(
  start: ScreenPoint,
  current: ScreenPoint,
  options: PointerControlGestureOptions,
): PointerControlGestureKind {
  if (classifySelectionGesture(start, current, options.dragThreshold) === "click") return "click";
  const dragPurpose = options.dragPurpose ?? "auto";
  if (dragPurpose === "look" || options.controlMode === "third-person") return "look-drag";
  if (dragPurpose === "selection") return "box-select";
  if (
    options.lookModifier
    || (options.button ?? 0) !== 0
    || (options.pointerCount ?? 1) > 1
    || options.pointerType === "touch"
  ) {
    return "look-drag";
  }
  return "box-select";
}

export function unitIdsInSelectionRectangle(
  candidates: readonly ScreenSelectableUnit[],
  rectangle: ScreenRectangle,
): number[] {
  const ids: number[] = [];
  for (const candidate of candidates) {
    if (candidate.selectable === false || !Number.isSafeInteger(candidate.unitId)) continue;
    const radius = nonNegativeFiniteOr(candidate.screenRadius, 0);
    if (
      finiteOrZero(candidate.x) + radius >= rectangle.left
      && finiteOrZero(candidate.x) - radius <= rectangle.right
      && finiteOrZero(candidate.y) + radius >= rectangle.top
      && finiteOrZero(candidate.y) - radius <= rectangle.bottom
    ) {
      ids.push(candidate.unitId);
    }
  }
  return canonicalUnitIds(ids);
}

export function combineUnitSelection(
  currentUnitIds: readonly number[],
  incomingUnitIds: readonly number[],
  mode: SelectionCombineMode,
): number[] {
  const current = canonicalUnitIds(currentUnitIds);
  const incoming = canonicalUnitIds(incomingUnitIds);
  if (mode === "replace") return incoming;
  const result = new Set(current);
  for (const id of incoming) {
    if (mode === "toggle" && result.has(id)) result.delete(id);
    else result.add(id);
  }
  return [...result].sort(compareNumbers);
}

export interface FormationOffset {
  readonly unitId: number;
  readonly x: number;
  readonly z: number;
}

export interface FormationOptions {
  readonly spacing?: number;
  readonly maxColumns?: number;
  readonly facingYaw?: number;
}

/** Stable, centered formation slots keyed by sorted unique unit IDs. */
export function deterministicFormationOffsets(
  selectedUnitIds: readonly number[],
  options: FormationOptions = {},
): FormationOffset[] {
  const unitIds = canonicalUnitIds(selectedUnitIds);
  if (unitIds.length === 0) return [];
  const spacing = positiveFiniteOr(options.spacing, 1.25);
  const defaultColumns = Math.ceil(Math.sqrt(unitIds.length));
  const maxColumns = Math.max(1, Math.min(unitIds.length, Math.floor(positiveFiniteOr(options.maxColumns, defaultColumns))));
  const rows = Math.ceil(unitIds.length / maxColumns);
  const local = unitIds.map((unitId, index) => {
    const row = Math.floor(index / maxColumns);
    const rowStart = row * maxColumns;
    const rowCount = Math.min(maxColumns, unitIds.length - rowStart);
    const column = index - rowStart;
    return {
      unitId,
      x: (column - (rowCount - 1) / 2) * spacing,
      z: (row - (rows - 1) / 2) * spacing,
    };
  });

  // Uneven final rows are re-centered so the destination is the true centroid.
  const meanX = local.reduce((sum, offset) => sum + offset.x, 0) / local.length;
  const meanZ = local.reduce((sum, offset) => sum + offset.z, 0) / local.length;
  const yaw = finiteOr(options.facingYaw, 0);
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  return local.map((offset) => {
    const localX = offset.x - meanX;
    const localZ = offset.z - meanZ;
    return {
      unitId: offset.unitId,
      x: localX * cosYaw - localZ * sinYaw,
      z: localX * sinYaw + localZ * cosYaw,
    };
  });
}

export interface TacticalControlState {
  readonly mode: "tactical";
  readonly selectedUnitIds: readonly number[];
}

export interface UnitSelectedControlState {
  readonly mode: "unit-selected";
  readonly selectedUnitIds: readonly number[];
  readonly primaryUnitId: number;
}

export interface ThirdPersonControlState {
  readonly mode: "third-person";
  readonly selectedUnitIds: readonly number[];
  readonly primaryUnitId: number;
  readonly controlledUnitId: number;
}

export type BetaControlState = TacticalControlState | UnitSelectedControlState | ThirdPersonControlState;

export type BetaControlEvent =
  | { readonly type: "replace-selection"; readonly unitIds: readonly number[]; readonly primaryUnitId?: number }
  | { readonly type: "enter-third-person"; readonly unitId?: number }
  | { readonly type: "exit-third-person" }
  | { readonly type: "cancel" }
  | { readonly type: "unit-unavailable"; readonly unitId: number }
  | { readonly type: "reset" };

export type BetaControlEffect =
  | { readonly type: "selection-changed"; readonly unitIds: readonly number[]; readonly primaryUnitId: number | null }
  | { readonly type: "third-person-entered"; readonly unitId: number }
  | { readonly type: "third-person-exited"; readonly unitId: number };

export type BetaControlTransitionReason =
  | "ok"
  | "unchanged"
  | "selection-locked"
  | "requires-unit-selection"
  | "unit-not-selected"
  | "not-in-third-person"
  | "unit-not-present";

export interface BetaControlTransition {
  readonly state: BetaControlState;
  readonly accepted: boolean;
  readonly reason: BetaControlTransitionReason;
  readonly effects: readonly BetaControlEffect[];
}

export function createTacticalControlState(): TacticalControlState {
  return { mode: "tactical", selectedUnitIds: [] };
}

/** Pure tactical -> selected -> third-person state machine. */
export function transitionBetaControlState(state: BetaControlState, event: BetaControlEvent): BetaControlTransition {
  if (event.type === "reset") return resetControlTransition(state);

  if (event.type === "replace-selection") {
    if (state.mode === "third-person") return rejected(state, "selection-locked");
    const unitIds = canonicalUnitIds(event.unitIds);
    if (unitIds.length === 0) {
      if (state.mode === "tactical") return rejected(state, "unchanged");
      return accepted(createTacticalControlState(), [{ type: "selection-changed", unitIds: [], primaryUnitId: null }]);
    }
    const primaryUnitId = unitIds.includes(event.primaryUnitId ?? Number.NaN) ? event.primaryUnitId as number : unitIds[0];
    if (state.mode === "unit-selected" && state.primaryUnitId === primaryUnitId && sameIds(state.selectedUnitIds, unitIds)) {
      return rejected(state, "unchanged");
    }
    const next: UnitSelectedControlState = { mode: "unit-selected", selectedUnitIds: unitIds, primaryUnitId };
    return accepted(next, [{ type: "selection-changed", unitIds, primaryUnitId }]);
  }

  if (event.type === "enter-third-person") {
    if (state.mode !== "unit-selected") return rejected(state, "requires-unit-selection");
    const unitId = event.unitId ?? state.primaryUnitId;
    if (!state.selectedUnitIds.includes(unitId)) return rejected(state, "unit-not-selected");
    const next: ThirdPersonControlState = {
      mode: "third-person",
      selectedUnitIds: [...state.selectedUnitIds],
      primaryUnitId: unitId,
      controlledUnitId: unitId,
    };
    return accepted(next, [{ type: "third-person-entered", unitId }]);
  }

  if (event.type === "exit-third-person") {
    if (state.mode !== "third-person") return rejected(state, "not-in-third-person");
    const next: UnitSelectedControlState = {
      mode: "unit-selected",
      selectedUnitIds: [...state.selectedUnitIds],
      primaryUnitId: state.controlledUnitId,
    };
    return accepted(next, [{ type: "third-person-exited", unitId: state.controlledUnitId }]);
  }

  if (event.type === "cancel") {
    if (state.mode === "third-person") return transitionBetaControlState(state, { type: "exit-third-person" });
    if (state.mode === "unit-selected") {
      return accepted(createTacticalControlState(), [{ type: "selection-changed", unitIds: [], primaryUnitId: null }]);
    }
    return rejected(state, "unchanged");
  }

  if (state.mode === "tactical") return rejected(state, "unit-not-present");
  if (!state.selectedUnitIds.includes(event.unitId)) return rejected(state, "unit-not-present");
  const remainingUnitIds = state.selectedUnitIds.filter((unitId) => unitId !== event.unitId);
  if (remainingUnitIds.length === 0) {
    const effects: BetaControlEffect[] = [];
    if (state.mode === "third-person") effects.push({ type: "third-person-exited", unitId: state.controlledUnitId });
    effects.push({ type: "selection-changed", unitIds: [], primaryUnitId: null });
    return accepted(createTacticalControlState(), effects);
  }
  if (state.mode === "third-person") {
    if (event.unitId === state.controlledUnitId) {
      const next: UnitSelectedControlState = {
        mode: "unit-selected",
        selectedUnitIds: remainingUnitIds,
        primaryUnitId: remainingUnitIds[0],
      };
      return accepted(next, [
        { type: "third-person-exited", unitId: state.controlledUnitId },
        { type: "selection-changed", unitIds: remainingUnitIds, primaryUnitId: remainingUnitIds[0] },
      ]);
    }
    const next: ThirdPersonControlState = { ...state, selectedUnitIds: remainingUnitIds };
    return accepted(next, [{ type: "selection-changed", unitIds: remainingUnitIds, primaryUnitId: state.controlledUnitId }]);
  }
  const primaryUnitId = state.primaryUnitId === event.unitId ? remainingUnitIds[0] : state.primaryUnitId;
  const next: UnitSelectedControlState = { mode: "unit-selected", selectedUnitIds: remainingUnitIds, primaryUnitId };
  return accepted(next, [{ type: "selection-changed", unitIds: remainingUnitIds, primaryUnitId }]);
}

export type UnitWeapon = "bow" | "spear" | "sword" | "lance" | "siege";

export const UNIT_WEAPON_BY_KIND: Readonly<Record<ArmyUnitKind, UnitWeapon>> = Object.freeze({
  archer: "bow",
  spearman: "spear",
  swordsman: "sword",
  knight: "lance",
  catapult: "siege",
  batteringRam: "siege",
});

export interface FormationMoveAction {
  readonly type: "move-selected-units";
  readonly unitIds: readonly number[];
  readonly target: { readonly x: number; readonly z: number };
  readonly formation: readonly FormationOffset[];
}

export interface ControlledUnitMoveAction {
  readonly type: "move-controlled-unit";
  readonly unitId: number;
  readonly direction: WorldMovement;
  readonly sprint: boolean;
}

export interface ControlledUnitAttackAction {
  readonly type: "attack-controlled-unit";
  readonly unitId: number;
  readonly weapon: UnitWeapon;
}

export type BetaUnitAction = FormationMoveAction | ControlledUnitMoveAction | ControlledUnitAttackAction;

export function createFormationMoveAction(
  state: BetaControlState,
  target: { readonly x: number; readonly z: number },
  options: FormationOptions = {},
): FormationMoveAction | null {
  if (state.mode !== "unit-selected") return null;
  const unitIds = canonicalUnitIds(state.selectedUnitIds);
  return {
    type: "move-selected-units",
    unitIds,
    target: { x: finiteOrZero(target.x), z: finiteOrZero(target.z) },
    formation: deterministicFormationOffsets(unitIds, options),
  };
}

export function createControlledUnitMoveAction(
  state: BetaControlState,
  input: Pick<MovementAxes, "strafe" | "forward">,
  movementYaw: number,
  sprint: boolean,
): ControlledUnitMoveAction | null {
  if (state.mode !== "third-person") return null;
  const direction = cameraRelativeMovement(input, movementYaw);
  if (direction.magnitude <= EPSILON) return null;
  return { type: "move-controlled-unit", unitId: state.controlledUnitId, direction, sprint };
}

export function createControlledUnitAttackAction(
  state: BetaControlState,
  unitKind: ArmyUnitKind,
): ControlledUnitAttackAction | null {
  if (state.mode !== "third-person") return null;
  return {
    type: "attack-controlled-unit",
    unitId: state.controlledUnitId,
    weapon: UNIT_WEAPON_BY_KIND[unitKind],
  };
}

function resetControlTransition(state: BetaControlState): BetaControlTransition {
  if (state.mode === "tactical") return rejected(state, "unchanged");
  const effects: BetaControlEffect[] = [];
  if (state.mode === "third-person") effects.push({ type: "third-person-exited", unitId: state.controlledUnitId });
  effects.push({ type: "selection-changed", unitIds: [], primaryUnitId: null });
  return accepted(createTacticalControlState(), effects);
}

function accepted(state: BetaControlState, effects: readonly BetaControlEffect[]): BetaControlTransition {
  return { state, accepted: true, reason: "ok", effects };
}

function rejected(state: BetaControlState, reason: Exclude<BetaControlTransitionReason, "ok">): BetaControlTransition {
  return { state, accepted: false, reason, effects: [] };
}

function canonicalUnitIds(unitIds: readonly number[]): number[] {
  return [...new Set(unitIds.filter(Number.isSafeInteger))].sort(compareNumbers);
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function wrapRadians(value: number): number {
  const fullTurn = Math.PI * 2;
  return ((value + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function positiveFiniteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > EPSILON ? value : fallback;
}

function nonNegativeFiniteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

const ZERO_MOVEMENT: MovementAxes = Object.freeze({ strafe: 0, forward: 0, magnitude: 0 });
const ZERO_WORLD_MOVEMENT: WorldMovement = Object.freeze({ x: 0, z: 0, magnitude: 0 });
