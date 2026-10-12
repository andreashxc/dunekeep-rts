import { FixedStepClock } from './runtime/FixedStepClock';
import { PerformanceMonitor } from './runtime/PerformanceMonitor';
import "./ui.css";
import { GameAudio } from "./audio/GameAudio";
import { BUILDABLE_KINDS, BUILDINGS, MISSION_LIST } from "./game/content";
import { GameSimulation } from "./game/simulation";
import { clearSavedSession, loadSavedSession, summarizeSavedSession, SessionWriter, type KeyValueStorage } from "./game/sessionStorage";
import type { BuildingKind, BuildingState, ControllableEntityKind } from "./game/types";
import { GameRenderer } from "./render/GameRenderer";
import { GameUI } from "./ui/GameUI";
import { finishPointerGesture, markMultiTouch, type PointerRecord } from "./input/PointerGesture";
import {
  combineUnitSelection,
  createControlledUnitMoveAction,
  createKeyboardState,
  createTacticalControlState,
  keyboardActionForCode,
  keyboardIntent,
  selectionDragRectangle,
  shouldTriggerDirectAttack,
  shouldRequestDirectDismount,
  shouldRequestDirectMount,
  shouldToggleDirectDance,
  transitionBetaControlState,
  updateKeyboardState,
  type BetaControlState,
  type BetaKeyboardState,
  type MovementAxes,
} from "./input/BetaUnitControls";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App mount point is missing");

const gameRoot = document.createElement("main");
gameRoot.className = "game-root";
app.append(gameRoot);

const clock = new FixedStepClock();
const performanceMonitor = new PerformanceMonitor(7200);
let droppedSimulationSeconds = 0;
const audio = new GameAudio();
const view = new GameRenderer(gameRoot);
const browserStorage: KeyValueStorage | null = (() => {
  try { return window.localStorage; } catch { return null; }
})();
const sessionWriter = new SessionWriter(browserStorage);
let savedSession = browserStorage ? loadSavedSession(browserStorage) : null;
let simulation: GameSimulation;
let selectedKind: BuildingKind | null = null;
let selectedBuilding: BuildingState | null = null;
let pendingPlacement: { gx: number; gz: number } | null = null;
let rallyMode = false;
let buildMenuPaused = false;
let wallLineMode = false;
let wallStart: {gx:number;gz:number} | null = null;
let wallEnd: {gx:number;gz:number} | null = null;
const wallPreview = document.createElement('div'); wallPreview.className = 'wall-line-preview'; gameRoot.append(wallPreview);
let armyOrderMode = false;
let armyOrderKind: "move" | "attack-move" = "move";
let betaControl: BetaControlState = createTacticalControlState();
let keyboardState: BetaKeyboardState = createKeyboardState();
let touchMovement: MovementAxes & { sprint: boolean } = { strafe: 0, forward: 0, magnitude: 0, sprint: false };
let lastEntityTap: { entityKind: ControllableEntityKind; entityId: number; at: number } | null = null;
let hadPointerLock = false;
const isTouchLayout = () => matchMedia("(max-width: 720px), (max-height: 480px) and (max-width: 960px), (hover: none) and (pointer: coarse)").matches;

function syncPlanningPause(): void {
  // Construction is one planning transaction: opening the mobile catalogue,
  // choosing a blueprint, positioning its contour, and confirming/cancelling it.
  // Keeping one shared pause flag makes simulation and every world animation stop together.
  simulation.setPlanningPaused(buildMenuPaused || selectedKind !== null);
}

const ui = new GameUI(gameRoot, {
  start: () => {
    audio.unlock();
    selectedKind = null;
    pendingPlacement = null;
    buildMenuPaused = false;
    resetBetaControl();
    ui.resetSessionUI(false);
    view.hidePlacement();
    simulation.start();
    persistSession();
    view.resetTransientWorld();
    view.element.focus();
  },
  continueSession: () => {
    if (!savedSession || !simulation.restoreSave(savedSession)) {
      if (browserStorage) clearSavedSession(browserStorage); sessionWriter.reset();
      savedSession = null;
      ui.setSavedSession(null);
      ui.toast("Сохранение повреждено. Начните новую игру.", "danger");
      return;
    }
    selectedKind = null;
    selectedBuilding = null;
    pendingPlacement = null;
    rallyMode = false;
    buildMenuPaused = false;
    resetBetaControl();
    view.resetTransientWorld();
    ui.resetSessionUI(false);
    ui.setRallyMode(false);
    view.selectBuilding(null);
    view.hidePlacement();
    view.resetCamera();
    ui.setTopViewState(false);
    view.element.focus();
    persistSession();
    ui.toast("Сохранённый город восстановлен.", "success");
  },
  continueAfterVictory: () => {
    if (!simulation.continueAfterVictory()) return;
    selectedKind = null;
    selectedBuilding = null;
    pendingPlacement = null;
    rallyMode = false;
    buildMenuPaused = false;
    simulation.exitDirectControl();
    resetBetaControl();
    ui.resetSessionUI(false);
    ui.setRallyMode(false);
    view.resetTransientWorld();
    view.selectBuilding(null);
    view.hidePlacement();
    persistSession();
    view.element.focus();
  },
  selectMission: (id) => {
    selectedKind = null;
    selectedBuilding = null;
    pendingPlacement = null;
    rallyMode = false;
    buildMenuPaused = false;
    resetBetaControl();
    simulation.selectMission(id);
    view.resetTransientWorld();
    ui.resetSessionUI(false);
    ui.setRallyMode(false);
    view.selectBuilding(null);
    view.hidePlacement();
    view.resetCamera();
    ui.setTopViewState(false);
  },
  selectDifficulty: (id) => {
    if (simulation.selectDifficulty(id)) {
      view.resetTransientWorld();
      selectedKind = null;
      selectedBuilding = null;
      pendingPlacement = null;
      buildMenuPaused = false;
      rallyMode = false;
      resetBetaControl();
      ui.resetSessionUI(false);
      ui.setRallyMode(false);
      view.hidePlacement();
      view.selectBuilding(null);
    }
  },
  callTutorialRaid: () => { simulation.callTutorialRaid(); persistSession(); },
  nextMission: () => {
    const next = MISSION_LIST[simulation.snapshot.missionOrder];
    if (!next) return;
    cancelBuild(); resetBetaControl(); selectedBuilding = null;
    simulation.selectMission(next.id); simulation.start(); ui.resetSessionUI(false);
    view.resetTransientWorld(); view.resetCamera(); persistSession();
  },
  beginPreparation: () => {
    if (selectedKind || buildMenuPaused) return;
    simulation.beginPreparation();
    view.element.focus();
  },
  restart: () => {
    selectedKind = null;
    selectedBuilding = null;
    pendingPlacement = null;
    rallyMode = false;
    buildMenuPaused = false;
    resetBetaControl();
    simulation.restart();
    persistSession();
    view.resetTransientWorld();
    ui.resetSessionUI(false);
    ui.setRallyMode(false);
    view.selectBuilding(null);
    view.hidePlacement();
    view.resetCamera();
    ui.setTopViewState(false);
    view.element.focus();
  },
  campaign: () => {
    persistSession();
    selectedKind = null;
    selectedBuilding = null;
    pendingPlacement = null;
    rallyMode = false;
    buildMenuPaused = false;
    resetBetaControl();
    simulation.returnToCampaign();
    view.resetTransientWorld();
    ui.resetSessionUI(false);
    ui.setRallyMode(false);
    view.selectBuilding(null);
    view.hidePlacement();
    view.resetCamera();
    ui.setTopViewState(false);
  },
  pause: () => simulation.togglePause(),
  selectBuild: (kind) => selectBlueprint(kind),
  demolish: (id) => {
    if (simulation.demolish(id)) {
      selectedBuilding = null;
      ui.setSelectedBuilding(null);
      view.selectBuilding(null);
      persistSession();
    }
  },
  repair: (id) => simulation.repair(id),
  upgradeTower: (id, upgrade) => simulation.upgradeTower(id, upgrade),
  train: (kind, id) => { if (simulation.enqueueUnit(kind, id)) persistSession(); },
  enqueueUnit: (kind, id) => { simulation.enqueueUnit(kind, id); persistSession(); },
  cancelTraining: (id, index) => { simulation.cancelTraining(id, index); persistSession(); },
  closeEnemySelection: () => view.selectBuilding(null),
  graphicsQuality: view.getGraphicsSettings().preset,
  setGraphicsQuality: quality => view.setGraphicsPreset(quality),
  audioVolumes: audio.volumes,
  setAudioVolume: (channel, value) => { audio.unlock(); audio.setVolume(channel, value); },
  holdArmy: () => simulation.holdSelectedArmy(),
  beginAttackMove: () => { armyOrderMode = true; armyOrderKind = 'attack-move'; ui.setArmyOrderMode(true); view.element.focus(); },
  trade: (id, resource, mode) => simulation.trade(id, resource, mode),
  setBuildingEnabled: (id, enabled) => simulation.setBuildingEnabled(id, enabled),
  setBuildingPriority: (id, priority) => simulation.setBuildingPriority(id, priority),
  setRallyMode: () => {
    rallyMode = !rallyMode;
    if (rallyMode) cancelBuild();
    ui.setRallyMode(rallyMode);
    view.element.focus();
  },
  setSpeed: (speed) => simulation.setTimeScale(speed),
  setTaxPolicy: (policy) => simulation.setTaxPolicy(policy),
  setRationPolicy: (policy) => simulation.setRationPolicy(policy),
  setBuildMenuOpen: (open) => {
    buildMenuPaused = open;
    syncPlanningPause();
  },
  confirmPlacement: () => {
    if (wallLineMode && wallStart && wallEnd) {
      if (simulation.placeWallLine(wallStart,wallEnd)) {cancelBuild(); persistSession();}
      return;
    }
    if (!selectedKind || !pendingPlacement) return;
    placeSelected(pendingPlacement.gx, pendingPlacement.gz);
  },
  cancelPlacement: () => cancelBuild(),
  pan: (x, z) => view.panDirection(x, z),
  zoom: (amount) => view.zoom(amount),
  rotate: (amount) => view.rotate(amount),
  toggleTopView: () => view.toggleTopView(),
  resetCamera: () => {
    view.resetCamera();
    ui.setTopViewState(false);
  },
  focusCastle: (target) => {
    const snapshot = simulation.snapshot;
    if (target === "all") {
      view.focusCell((snapshot.gridSize - 1) / 2, (snapshot.gridSize - 1) / 2, snapshot.gridSize > 18 ? 46 : 34);
      return;
    }
    const cell = target === "enemy"
      ? snapshot.duel?.enemyBuildings.find((building) => building.kind === "keep")
      : snapshot.keep;
    if (!cell) return;
    view.focusCell(cell.gx, cell.gz, target === "enemy" ? 23 : 21);
  },
  clearSelection: () => {
    selectedBuilding = null;
    view.selectBuilding(null);
    replaceArmySelection([]);
  },
  toggleSound: () => {
    audio.setEnabled(!audio.isEnabled);
    return audio.isEnabled;
  },
  clearArmySelection: () => replaceArmySelection([]),
  toggleArmyOrderMode: () => {
    armyOrderKind = "move";
    armyOrderMode = !armyOrderMode;
    ui.setArmyOrderMode(armyOrderMode);
    view.element.focus();
  },
  enterDirectControl: (entityKind, entityId) => enterDirectControl(entityKind, entityId),
  exitDirectControl: () => exitDirectControl(),
  directAttack: () => requestDirectAttack(),
  directDance: () => { simulation.toggleDirectControlDance(); },
  directMount: (buildingId) => { simulation.requestDirectControlMount(buildingId); },
  directDismount: () => { simulation.requestDirectControlDismount(); },
  setDirectMovement: (strafe, forward, sprint) => {
    const movement = Math.hypot(strafe, forward);
    touchMovement = {
      strafe: movement > 1 ? strafe / movement : strafe,
      forward: movement > 1 ? forward / movement : forward,
      magnitude: Math.min(1, movement),
      sprint,
    };
  },
});

simulation = new GameSimulation({
  onToast: (message, tone) => ui.toast(message, tone),
  onSound: (sound) => { audio.play(sound); if (sound === "build") queueMicrotask(() => persistSession()); },
  onProjectile: (event) => view.addProjectile(event),
  onStatus: (status) => {
    if (!browserStorage) return;
    if (status === "defeat") {
      clearSavedSession(browserStorage); sessionWriter.reset();
      savedSession = null;
      ui.setSavedSession(null);
      return;
    }
    queueMicrotask(() => persistSession());
  },
});
ui.setSavedSession(savedSession ? summarizeSavedSession(savedSession) : null);

const saveNotice = document.createElement('div');
saveNotice.className = 'save-notice'; saveNotice.setAttribute('role','status'); saveNotice.hidden = true;
gameRoot.append(saveNotice);
function persistSession(savedAt = Date.now()): void {
  if (!browserStorage) { saveNotice.hidden = false; saveNotice.textContent = 'Сохранение недоступно в этом браузере'; return; }
  const save = simulation.exportSave(savedAt);
  if (!save) return;
  const result = sessionWriter.write(save);
  if (result === "unchanged") return;
  if (result === "failed") {
    saveNotice.hidden = false; saveNotice.textContent = 'Не удалось сохранить прогресс — освободите место в браузере'; return;
  }
  saveNotice.hidden = true;
  savedSession = save;
  ui.setSavedSession(summarizeSavedSession(save));
}
window.addEventListener('pagehide', () => { audio.updateAmbience(false); persistSession(); clock.reset(); });
document.addEventListener('visibilitychange', () => {
  clock.reset();
  if (document.visibilityState === 'hidden') { audio.updateAmbience(false); persistSession(); }
});

const graphicsNotice = document.createElement("div");
graphicsNotice.hidden = true;
graphicsNotice.setAttribute("role", "alert");
graphicsNotice.className = "graphics-notice";
graphicsNotice.textContent = "Восстанавливаем графику. Мир остановлен, прогресс сохранён в этой вкладке.";
gameRoot.append(graphicsNotice);
view.element.addEventListener("webglcontextlost", () => {
  clock.reset();
  if (simulation.snapshot.status === "playing") simulation.togglePause();
  graphicsNotice.hidden = false;
});
view.element.addEventListener("webglcontextrestored", () => {
  clock.reset();
  graphicsNotice.hidden = true;
  if (simulation.snapshot.status === "playing") simulation.togglePause();
  ui.toast("Графика восстановлена. Продолжите игру, когда будете готовы.", "info");
});

interface GamePointerRecord extends PointerRecord {
  pointerType: string;
  shiftKey: boolean;
  selectionDrag: boolean;
  directLook: boolean;
}

const pointers = new Map<number, GamePointerRecord>();
let pinchDistance = 0;

view.element.addEventListener("pointerdown", (event) => {
  audio.unlock();
  view.element.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, {
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
    button: event.button,
    rotate: event.pointerType !== "touch" && (event.button === 1 || event.button === 2 || event.altKey),
    moved: false,
    pointerType: event.pointerType,
    shiftKey: event.shiftKey,
    selectionDrag: betaControl.mode !== "third-person"
      && event.pointerType !== "touch"
      && event.button === 0
      && !event.altKey
      && selectedKind === null
      && !rallyMode,
    directLook: betaControl.mode === "third-person",
  });
  if (pointers.size === 2) {
    pinchDistance = pointerDistance();
    markMultiTouch(pointers.values());
  }
});

view.element.addEventListener("pointermove", (event) => {
  const pointer = pointers.get(event.pointerId);
  if (!pointer) {
    // Touch/coarse layouts use an explicit two-step placement flow. Once the player
    // has tapped a cell, keep that cell locked while they move toward Confirm.
    if (!pendingPlacement || !isTouchLayout()) updatePlacementPreview(event.clientX, event.clientY);
    return;
  }
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 5) pointer.moved = true;

  if (betaControl.mode === "third-person") {
    if (pointer.moved && document.pointerLockElement !== view.element) view.lookDirect(dx, dy);
  } else if (pointers.size === 2) {
    const distance = pointerDistance();
    if (pinchDistance > 0) view.zoom((pinchDistance - distance) * 0.055);
    pinchDistance = distance;
  } else if (pointer.moved) {
    if (pointer.selectionDrag) {
      const rect = selectionDragRectangle(
        { x: pointer.startX, y: pointer.startY },
        { x: event.clientX, y: event.clientY },
      );
      ui.setSelectionMarquee({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      return;
    }
    if (pointer.rotate) {
      view.orbit(dx, dy);
      ui.setTopViewState(view.isTopView());
    } else view.pan(dx, dy);
    if (!isTouchLayout() || !pendingPlacement) view.hidePlacement();
  }
});

view.element.addEventListener("pointerup", (event) => {
  const pointer = pointers.get(event.pointerId);
  pointers.delete(event.pointerId);
  if (!pointer) return;
  ui.setSelectionMarquee(null);
  if (pointer.directLook || betaControl.mode === "third-person") {
    if (!pointer.moved && pointer.pointerType === "mouse" && shouldTriggerDirectAttack({
      source: "canvas-pointer",
      pressed: true,
      button: pointer.button,
      pointerLocked: document.pointerLockElement === view.element,
    })) requestDirectAttack();
    return;
  }
  if (pointer.selectionDrag && pointer.moved) {
    const rect = selectionDragRectangle(
      { x: pointer.startX, y: pointer.startY },
      { x: event.clientX, y: event.clientY },
    );
    const hits = view.armyUnitsInScreenRect(rect.left, rect.top, rect.right, rect.bottom);
    const current = simulation.snapshot.selectedArmyUnitIds;
    replaceArmySelection(combineUnitSelection(current, hits, pointer.shiftKey ? "add" : "replace"));
    return;
  }
  const commandBuildingId = view.pickBuilding(event.clientX, event.clientY);
  const enemyBuildingId = view.pickEnemyBuilding(event.clientX, event.clientY);
  const commandGrid = view.pickGrid(event.clientX, event.clientY);
  if (pointer.button === 2 && !pointer.moved && selectedKind === null && simulation.snapshot.selectedArmyUnitIds.length > 0) {
    if (enemyBuildingId !== null) {
      issueArmyAttackBuildingOrder(enemyBuildingId, event.clientX, event.clientY);
    } else if (commandBuildingId !== null && simulation.isGarrisonTarget(commandBuildingId)) {
      issueArmyGarrisonOrder(commandBuildingId, event.clientX, event.clientY);
    } else if (commandGrid) {
      issueArmyOrder(commandGrid.gx, commandGrid.gz, event.shiftKey ? "attack-move" : "move", event.clientX, event.clientY);
    }
    return;
  }
  const gesture = finishPointerGesture(pointer, event.clientX, event.clientY);
  if (gesture === "cancel-build") {
    rallyMode = false;
    ui.setRallyMode(false);
    return cancelBuild();
  }
  if (gesture === "camera") return;
  const grid = commandGrid;
  if (simulation.snapshot.status !== "playing" || (!grid && commandBuildingId === null && enemyBuildingId === null)) return;

  if (rallyMode) {
    if (!grid) return;
    if (simulation.setRallyPoint(grid.gx, grid.gz)) {
      rallyMode = false;
      ui.setRallyMode(false);
    }
    return;
  }

  if (selectedKind) {
    if (!grid) return;
    if (wallLineMode && selectedKind === 'wall') {
      if (!wallStart) wallStart = grid;
      wallEnd = grid;
      const plan = simulation.previewWallLine(wallStart, wallEnd);
      const next = plan.cells.length === 1 ? ' · Подтвердите секцию или выберите конец стены' : '';
      ui.showBuildLinePreview(`Секции: ${plan.cells.length} · Камень: ${plan.cost}${plan.reason ? ' · ' + plan.reason : next}`, plan.valid);
      return;
    }
    if (isTouchLayout()) {
      pendingPlacement = grid;
      const placement = simulation.canPlace(selectedKind, grid.gx, grid.gz);
      view.showPlacement(selectedKind, grid.gx, grid.gz, placement.valid);
      ui.setPlacementPreview(
        selectedKind,
        grid.gx,
        grid.gz,
        placement.valid,
        simulation.getPlacementEfficiency(selectedKind, grid.gx, grid.gz),
        placement.reason,
      );
    } else placeSelected(grid.gx, grid.gz);
    return;
  }

  if (armyOrderMode && simulation.snapshot.selectedArmyUnitIds.length > 0) {
    if (enemyBuildingId !== null) {
      issueArmyAttackBuildingOrder(enemyBuildingId, event.clientX, event.clientY);
    } else if (commandBuildingId !== null && simulation.isGarrisonTarget(commandBuildingId)) {
      issueArmyGarrisonOrder(commandBuildingId, event.clientX, event.clientY);
    } else if (grid) {
      issueArmyOrder(grid.gx, grid.gz, armyOrderKind, event.clientX, event.clientY);
    }
    return;
  }

  const pickedArmyUnitId = view.pickArmyUnit(event.clientX, event.clientY);
  if (pickedArmyUnitId !== null) {
    const current = simulation.snapshot.selectedArmyUnitIds;
    const next = pointer.shiftKey
      ? combineUnitSelection(current, [pickedArmyUnitId], "toggle")
      : [pickedArmyUnitId];
    replaceArmySelection(next, pickedArmyUnitId);
    const now = performance.now();
    const isDoubleTap = lastEntityTap?.entityKind === "army" && lastEntityTap.entityId === pickedArmyUnitId && now - lastEntityTap.at < 360;
    lastEntityTap = { entityKind: "army", entityId: pickedArmyUnitId, at: now };
    if (isDoubleTap) enterDirectControl("army", pickedArmyUnitId);
    return;
  }

  const pickedCivilianId = view.pickCivilian(event.clientX, event.clientY);
  if (pickedCivilianId !== null) {
    selectCivilian(pickedCivilianId);
    const now = performance.now();
    const isDoubleTap = lastEntityTap?.entityKind === "civilian" && lastEntityTap.entityId === pickedCivilianId && now - lastEntityTap.at < 360;
    lastEntityTap = { entityKind: "civilian", entityId: pickedCivilianId, at: now };
    if (isDoubleTap) enterDirectControl("civilian", pickedCivilianId);
    return;
  }

  if (enemyBuildingId !== null) {
    replaceArmySelection([]);
    selectedBuilding = null;
    view.selectBuilding(null);
    ui.setSelectedBuilding(null);
    const enemyBuilding = simulation.snapshot.duel?.enemyBuildings.find(building => building.id === enemyBuildingId) ?? null;
    ui.setSelectedEnemyBuilding(enemyBuilding);
    view.selectEnemyBuilding(enemyBuilding);
    return;
  }

  const pickedBuildingId = commandBuildingId;
  replaceArmySelection([]);
  selectedBuilding = pickedBuildingId === null
    ? grid ? simulation.snapshot.buildings.find((building) => building.gx === grid.gx && building.gz === grid.gz) ?? null : null
    : simulation.snapshot.buildings.find((building) => building.id === pickedBuildingId) ?? null;
  ui.setSelectedBuilding(selectedBuilding);
  view.selectBuilding(selectedBuilding);
});

view.element.addEventListener("pointercancel", (event) => {
  pointers.delete(event.pointerId);
  ui.setSelectionMarquee(null);
});
view.element.addEventListener("pointerleave", () => {
  if (pointers.size === 0 && (!isTouchLayout() || !pendingPlacement)) view.hidePlacement();
});
view.element.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (betaControl.mode === "third-person") return;
  view.zoom(event.deltaY * 0.018);
}, { passive: false });
view.element.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  // WebKit fires contextmenu on mouse-down. Decide click versus orbit on pointer-up.
});

window.addEventListener("keydown", (event) => {
  if (betaControl.mode === "third-person") {
    const buttonTarget = event.target instanceof HTMLElement && Boolean(event.target.closest("button"));
    if (buttonTarget && (event.code === "Space" || event.code === "Enter" || event.code === "NumpadEnter")) return;
    const action = keyboardActionForCode(event.code);
    if (action) {
      event.preventDefault();
      keyboardState = updateKeyboardState(keyboardState, event.code, true);
    }
    if (shouldToggleDirectDance(event.code, event.repeat)) {
      event.preventDefault();
      simulation.toggleDirectControlDance();
    }
    if (shouldRequestDirectDismount(event.code, event.repeat)) {
      event.preventDefault();
      simulation.requestDirectControlDismount();
    }
    if (shouldRequestDirectMount(event.code, event.repeat)) {
      event.preventDefault();
      simulation.requestDirectControlMount();
    }
    if (event.code === "Space" && shouldTriggerDirectAttack({
      source: "keyboard",
      pressed: true,
      repeat: event.repeat,
    })) requestDirectAttack();
    if (event.code === "Escape" && !event.repeat) exitDirectControl();
    return;
  }
  if (event.repeat && !["w", "a", "s", "d"].includes(event.key.toLowerCase())) return;
  const key = event.key.toLowerCase();
  const interactiveTarget = event.target instanceof HTMLElement
    && Boolean(event.target.closest("input, select, textarea, [contenteditable='true']"));
  if (interactiveTarget && key !== "escape") return;
  const buttonTarget = event.target instanceof HTMLElement && Boolean(event.target.closest("button"));
  if (buttonTarget && (key === " " || key === "enter" || key.startsWith("arrow"))) return;
  if (key === "escape") {
    if (armyOrderMode) {
      armyOrderMode = false;
      ui.setArmyOrderMode(false);
    } else if (betaControl.mode === "unit-selected") {
      replaceArmySelection([]);
    } else if (rallyMode) {
      rallyMode = false;
      ui.setRallyMode(false);
    } else if (simulation.snapshot.status === "playing" && selectedKind) cancelBuild();
    else simulation.togglePause();
    return;
  }
  if (key === " " || key === "p") {
    event.preventDefault();
    simulation.togglePause();
  }
  if (simulation.snapshot.status !== "playing") return;
  if (key === "enter" && betaControl.mode === "unit-selected") {
    const civilianId = simulation.snapshot.selectedCivilianId;
    enterDirectControl(civilianId === null ? "army" : "civilian", civilianId ?? betaControl.primaryUnitId);
    return;
  }
  if (key === "w" || key === "arrowup") view.panDirection(0, -1);
  if (key === "s" || key === "arrowdown") view.panDirection(0, 1);
  if (key === "a" || key === "arrowleft") view.panDirection(-1, 0);
  if (key === "d" || key === "arrowright") view.panDirection(1, 0);
  if (key === "q") view.rotate(-Math.PI / 4);
  if (key === "e") view.rotate(Math.PI / 4);
  if (key === "t") ui.setTopViewState(view.toggleTopView());
  if (key === "b") ui.toggleBuildMenu();
  if (key === "f") {
    rallyMode = !rallyMode;
    if (rallyMode) cancelBuild();
    ui.setRallyMode(rallyMode);
  }
  if (key === "r") {
    view.resetCamera();
    ui.setTopViewState(false);
  }
  const chosen = BUILDABLE_KINDS.find((kind) => BUILDINGS[kind].hotkey === key);
  if (chosen) {
    ui.setBuildSelection(chosen);
    selectBlueprint(chosen);
  }
});

window.addEventListener("keyup", (event) => {
  keyboardState = updateKeyboardState(keyboardState, event.code, false);
});
window.addEventListener("blur", () => {
  keyboardState = createKeyboardState();
  touchMovement = { strafe: 0, forward: 0, magnitude: 0, sprint: false };
  if (simulation.snapshot.directControl) updateDirectControlInput();
});
document.addEventListener("mousemove", (event) => {
  if (betaControl.mode === "third-person" && document.pointerLockElement === view.element) {
    view.lookDirect(event.movementX, event.movementY);
  }
});
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === view.element) {
    hadPointerLock = true;
    return;
  }
  if (hadPointerLock) {
    hadPointerLock = false;
    if (betaControl.mode === "third-person") exitDirectControl();
  }
});

window.addEventListener("resize", () => view.resize());
document.addEventListener("visibilitychange", () => {
  if (document.hidden && simulation.snapshot.status === "playing") simulation.togglePause();
});

function updatePlacementPreview(clientX: number, clientY: number): void {
  if (wallLineMode) return view.hidePlacement();
  if (!selectedKind || simulation.snapshot.status !== "playing") return view.hidePlacement();
  const grid = view.pickGrid(clientX, clientY);
  if (!grid) return view.hidePlacement();
  const placement = simulation.canPlace(selectedKind, grid.gx, grid.gz);
  view.showPlacement(selectedKind, grid.gx, grid.gz, placement.valid);
  if (!isTouchLayout()) {
    ui.setPlacementPreview(
      selectedKind,
      grid.gx,
      grid.gz,
      placement.valid,
      simulation.getPlacementEfficiency(selectedKind, grid.gx, grid.gz),
      placement.reason,
    );
  }
}

function selectBlueprint(kind: BuildingKind | null): void {
  wallLineMode = kind === 'wall';
  wallStart = null;
  wallEnd = null;
  wallPreview.replaceChildren();
  ui.setWallLineMode(wallLineMode);
  // Mouse buttons and hotkeys must enter exactly the same interaction mode.
  rallyMode = false;
  ui.setRallyMode(false);
  selectedKind = kind;
  pendingPlacement = null;
  selectedBuilding = null;
  view.hidePlacement();
  view.selectBuilding(null);
  ui.setSelectedBuilding(null);
  syncPlanningPause();
  if (wallLineMode) ui.showBuildLinePreview("Выберите начало стены", false);
}

function cancelBuild(): void {
  wallLineMode = false; wallStart = null; wallEnd = null; wallPreview.replaceChildren(); ui.setWallLineMode(false);
  selectedKind = null;
  pendingPlacement = null;
  syncPlanningPause();
  ui.setBuildSelection(null);
  view.hidePlacement();
}

function placeSelected(gx: number, gz: number): void {
  if (!selectedKind) return;
  const kind = selectedKind;
  if (!simulation.place(kind, gx, gz)) return;
  pendingPlacement = null;
  view.hidePlacement();
  if (kind === "wall") {
    ui.setBuildSelection("wall");
    ui.toast("Стена остаётся выбранной — продолжайте линию или нажмите «Отмена».", "info");
  } else cancelBuild();
}

function pointerDistance(): number {
  const values = [...pointers.values()];
  if (values.length < 2) return 0;
  return Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
}

function replaceArmySelection(unitIds: readonly number[], primaryUnitId?: number): void {
  if (betaControl.mode === "third-person") return;
  const accepted = [...simulation.selectArmyUnits(unitIds)];
  const transition = transitionBetaControlState(betaControl, { type: "replace-selection", unitIds: accepted, primaryUnitId });
  betaControl = transition.state;
  view.setArmySelection(accepted);
  view.setCivilianSelection(null);
  armyOrderMode = false;
  ui.setArmyOrderMode(false);
  if (accepted.length > 0) {
    selectedBuilding = null;
    ui.setSelectedBuilding(null);
    view.selectBuilding(null);
  }
}

function selectCivilian(civilianId: number): void {
  if (betaControl.mode === "third-person" || !simulation.selectCivilian(civilianId)) return;
  const transition = transitionBetaControlState(betaControl, {
    type: "replace-selection",
    unitIds: [civilianId],
    primaryUnitId: civilianId,
  });
  betaControl = transition.state;
  view.setArmySelection([]);
  view.setCivilianSelection(civilianId);
  armyOrderMode = false;
  ui.setArmyOrderMode(false);
  selectedBuilding = null;
  ui.setSelectedBuilding(null);
  view.selectBuilding(null);
}

function enterDirectControl(entityKind: ControllableEntityKind, entityId: number): void {
  if (simulation.snapshot.timePaused) {
    ui.toast("Прямое управление доступно, когда время идёт.", "info");
    return;
  }
  if (betaControl.mode !== "unit-selected" || !betaControl.selectedUnitIds.includes(entityId)) {
    if (entityKind === "civilian") selectCivilian(entityId);
    else replaceArmySelection([entityId], entityId);
  }
  if (betaControl.mode !== "unit-selected" || !simulation.enterDirectControlEntity(entityKind, entityId)) return;
  const transition = transitionBetaControlState(betaControl, { type: "enter-third-person", unitId: entityId });
  if (!transition.accepted) {
    simulation.exitDirectControl();
    return;
  }
  betaControl = transition.state;
  armyOrderMode = false;
  ui.setArmyOrderMode(false);
  keyboardState = createKeyboardState();
  touchMovement = { strafe: 0, forward: 0, magnitude: 0, sprint: false };
  view.element.focus();
  if (!isTouchLayout() && typeof view.element.requestPointerLock === "function") {
    Promise.resolve(view.element.requestPointerLock()).catch(() => undefined);
  }
}

function exitDirectControl(): void {
  if (betaControl.mode !== "third-person") return;
  simulation.exitDirectControl();
  betaControl = transitionBetaControlState(betaControl, { type: "exit-third-person" }).state;
  keyboardState = createKeyboardState();
  touchMovement = { strafe: 0, forward: 0, magnitude: 0, sprint: false };
  if (document.pointerLockElement === view.element) document.exitPointerLock();
  view.element.focus();
}

function resetBetaControl(): void {
  wallLineMode = false; wallStart = null; wallEnd = null;
  wallPreview.replaceChildren(); ui.setWallLineMode(false);
  if (simulation) {
    simulation.exitDirectControl();
    simulation.clearArmySelection();
    simulation.clearCivilianSelection();
  }
  betaControl = transitionBetaControlState(betaControl, { type: "reset" }).state;
  armyOrderMode = false;
  keyboardState = createKeyboardState();
  touchMovement = { strafe: 0, forward: 0, magnitude: 0, sprint: false };
  lastEntityTap = null;
  view.setArmySelection([]);
  view.setCivilianSelection(null);
  ui.setArmyOrderMode(false);
  ui.setSelectionMarquee(null);
  if (document.pointerLockElement === view.element) document.exitPointerLock();
}

function issueArmyOrder(gx: number, gz: number, kind: "move" | "attack-move", clientX: number, clientY: number): void {
  if (!simulation.issueArmyOrder(kind, { x: gx, z: gz })) return;
  armyOrderMode = false;
  ui.setArmyOrderMode(false);
  ui.showArmyCommandMarker(clientX, clientY, kind === "attack-move");
}

function issueArmyGarrisonOrder(buildingId: number, clientX: number, clientY: number): void {
  if (!simulation.issueArmyGarrisonOrder(buildingId)) return;
  armyOrderMode = false;
  ui.setArmyOrderMode(false);
  ui.showArmyCommandMarker(clientX, clientY, false);
}

function issueArmyAttackBuildingOrder(buildingId: number, clientX: number, clientY: number): void {
  if (!simulation.issueArmyAttackBuildingOrder(buildingId)) return;
  armyOrderMode = false;
  ui.setArmyOrderMode(false);
  ui.showArmyCommandMarker(clientX, clientY, true);
}

function requestDirectAttack(): void {
  const controlView = view.directControlView();
  if (!controlView) return;
  simulation.requestDirectControlAttack({ x: controlView.aimX, z: controlView.aimZ, pitch: controlView.aimPitch });
}

function updateDirectControlInput(): void {
  if (betaControl.mode !== "third-person" || !simulation.snapshot.directControl) return;
  const controlView = view.directControlView();
  if (!controlView) return;
  const keyboard = keyboardIntent(keyboardState);
  const input = touchMovement.magnitude > 0 ? touchMovement : keyboard;
  const action = createControlledUnitMoveAction(
    betaControl,
    input,
    controlView.heading,
    touchMovement.magnitude > 0 ? touchMovement.sprint : keyboard.sprint,
  );
  const direction = action?.direction ?? { x: 0, z: 0, magnitude: 0 };
  simulation.setDirectControlInput({
    moveX: direction.x,
    moveZ: direction.z,
    heading: controlView.heading,
    sprint: action?.sprint ?? false,
    aimX: controlView.aimX,
    aimZ: controlView.aimZ,
    aimPitch: controlView.aimPitch,
  });
}

function syncBetaControl(snapshot: ReturnType<typeof getSnapshot>): void {
  view.setArmySelection(snapshot.selectedArmyUnitIds);
  view.setCivilianSelection(snapshot.selectedCivilianId);
  if (betaControl.mode === "third-person" && snapshot.directControl === null) {
    const unitId = betaControl.controlledUnitId;
    betaControl = transitionBetaControlState(betaControl, { type: "unit-unavailable", unitId }).state;
    keyboardState = createKeyboardState();
    touchMovement = { strafe: 0, forward: 0, magnitude: 0, sprint: false };
    if (document.pointerLockElement === view.element) document.exitPointerLock();
    if (snapshot.lastDirectControlExit?.reason === "unit-dead") ui.toast("Боец пал. Камера возвращена к карте.", "danger");
    if (snapshot.lastDirectControlExit?.reason === "civilian-dead") ui.toast("Житель погиб. Камера возвращена к карте.", "danger");
    if (snapshot.lastDirectControlExit?.reason === "civilian-departed") ui.toast("Житель покинул поселение. Камера возвращена к карте.", "info");
  } else if (betaControl.mode !== "third-person") {
    const current = betaControl.selectedUnitIds;
    const next = snapshot.selectedCivilianId === null ? snapshot.selectedArmyUnitIds : [snapshot.selectedCivilianId];
    if (current.length !== next.length || current.some((id, index) => id !== next[index])) {
      betaControl = transitionBetaControlState(betaControl, { type: "replace-selection", unitIds: next }).state;
    }
  }
}

let previousUIRender = 0;
let localQAPilot: import('./qa/CampaignPilot').CampaignPilot | null = null;
let previousUIStatus = '';
let previousAutosave = 0;
function frame(now: number): void {
  const active = view.isAvailable && !document.hidden && simulation.isRunning;
  audio.updateAmbience(active);
  let pilotMs: number | undefined;
  if (active && localQAPilot) { const started = performance.now(); localQAPilot.update(); pilotMs = performance.now() - started; }
  const simulationStart = performance.now();
  const timing = clock.advance(now, active, dt => { updateDirectControlInput(); simulation.tick(dt); });
  droppedSimulationSeconds += timing.droppedSeconds;
  const snapshotStart = performance.now();
  const snapshot = simulation.snapshot;
  const snapshotMs = performance.now() - snapshotStart;
  syncBetaControl(snapshot);
  if (selectedBuilding) {
    selectedBuilding = snapshot.buildings.find(building => building.id === selectedBuilding?.id) ?? null;
    if (!selectedBuilding) { ui.setSelectedBuilding(null); view.selectBuilding(null); }
  }
  let uiMs: number | undefined;
  let autosaveMs: number | undefined;
  if (now - previousUIRender >= 90 || previousUIStatus !== snapshot.status) {
    const started = performance.now(); ui.render(snapshot); uiMs = performance.now() - started;
    previousUIRender = now; previousUIStatus = snapshot.status;
  }
  if (now - previousAutosave >= 10_000) {
    const started = performance.now(); persistSession(); autosaveMs = performance.now() - started; previousAutosave = now;
  }
  const renderStart = performance.now();
  if (!document.hidden) view.render(snapshot, Math.min(.2, timing.frameMs / 1000));
  const renderMs = performance.now() - renderStart;
  if (wallLineMode && wallStart) {
    const plan = simulation.previewWallLine(wallStart, wallEnd ?? wallStart);
    while(wallPreview.children.length > plan.cells.length) wallPreview.lastChild!.remove();
    plan.cells.forEach((cell,index)=>{
      let marker = wallPreview.children[index] as HTMLElement | undefined;
      if (!marker) {marker=document.createElement('span'); wallPreview.append(marker);}
      const point=view.projectCell(cell.gx,cell.gz);marker.style.left=`${point.x}px`;marker.style.top=`${point.y}px`;
      marker.style.borderColor=plan.valid?'#237f80':'#b04b37';
    });
  }
  if (active && timing.frameMs > 0) {
    view.recordFrameTime(timing.frameMs);
    performanceMonitor.record({frameMs: timing.frameMs, simulationMs: snapshotStart-simulationStart, snapshotMs, uiMs, autosaveMs, renderMs, pilotMs});
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

declare global {
  interface Window {
    __DUNEKEEP__?: {
      performance: () => unknown;
      resetPerformance: () => void;
      simulation: GameSimulation;
      spawnWave: () => void;
      snapshot: () => ReturnType<typeof getSnapshot>;
      renderStats: () => ReturnType<GameRenderer["diagnostics"]>;
      projectCell: (gx: number, gz: number) => { x: number; y: number };
    };
  }
}

const getSnapshot = () => simulation.snapshot;
window.__DUNEKEEP__ = {
  performance: () => ({...performanceMonitor.summary(), droppedSimulationSeconds, graphics: view.getGraphicsSettings(), renderer: view.performanceCounters(), viewport: {width: innerWidth,height: innerHeight,devicePixelRatio}}),
  resetPerformance: () => {performanceMonitor.reset(); droppedSimulationSeconds = 0;},
  simulation,
  spawnWave: () => simulation.debugSpawnWave(),
  snapshot: getSnapshot,
  renderStats: () => view.diagnostics(),
  projectCell: (gx, gz) => view.projectCell(gx, gz),
};

// Opt-in local QA controls make measurements inspectable through browser UI.
// They never advance time or grant resources and are absent from normal play.
if (['localhost', '127.0.0.1', '::1'].includes(location.hostname)
  && new URLSearchParams(location.search).get('diagnostics') === '1') {
  const panel = document.createElement('details');
  panel.dataset.performancePanel = '';
  panel.style.cssText = 'position:fixed;bottom:8px;left:35%;max-width:46vw;z-index:100;background:#fff8e8;color:#253c38;padding:6px;border:1px solid #607e73;border-radius:6px;font:11px monospace';
  const title = document.createElement('summary'); title.textContent = 'QA performance';
  const report = document.createElement('button'); report.textContent = 'Capture performance';
  const reset = document.createElement('button'); reset.textContent = 'Reset measurements';
  const pilotButton = document.createElement('button'); pilotButton.textContent = 'Start QA pilot';
  pilotButton.addEventListener('click', async () => {
    if (localQAPilot) { localQAPilot = null; pilotButton.textContent = 'Start QA pilot'; return; }
    const { CampaignPilot } = await import('./qa/CampaignPilot');
    localQAPilot = new CampaignPilot(simulation);
    pilotButton.textContent = 'Stop QA pilot';
  });
  const contextTest = document.createElement('button'); contextTest.textContent = 'Test graphics recovery';
  contextTest.addEventListener('click', () => {
    const extension = view.element.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!extension) { output.textContent = 'Context loss extension unavailable'; return; }
    extension.loseContext();
    window.setTimeout(() => extension.restoreContext(), 1500);
  });
  const output = document.createElement('pre'); output.dataset.performanceReport = '';
  output.style.cssText = 'max-height:200px;overflow:auto;max-width:42vw;white-space:pre-wrap';
  report.addEventListener('click', () => {
    const snapshot = simulation.snapshot;
    output.textContent = JSON.stringify({ ...performanceMonitor.summary(),
      droppedSimulationSeconds, graphics: view.getGraphicsSettings(), renderer: view.performanceCounters(),
      viewport: {width:innerWidth,height:innerHeight,devicePixelRatio},
      scenario: {mission:snapshot.missionId, elapsed:snapshot.elapsed, buildings:snapshot.buildings.length,
        army:snapshot.army.length, enemies:snapshot.raiders.length,
        enemyBuildings:snapshot.duel?.enemyBuildings.length ?? 0, status:snapshot.status},
      pilot: localQAPilot?.diagnostics() ?? null,
      capturedAt: new Date().toISOString(),
    }, null, 2);
  });
  reset.addEventListener('click', () => {performanceMonitor.reset(); droppedSimulationSeconds = 0; output.textContent = 'Measurements reset';});
  panel.append(title, report, reset, contextTest, pilotButton, output); gameRoot.append(panel);
}
