import {
  ARMY_UNITS,
  ECONOMY_TICK_SECONDS,
  BUILDABLE_KINDS,
  BUILDINGS,
  BUILD_CATEGORIES,
  DIFFICULTIES,
  DIFFICULTY_LIST,
  MISSION_LIST,
  MISSIONS,
  RATION_POLICIES,
  TAX_POLICIES,
  TRADE_RATES,
} from "../game/content";
import { garrisonCapacity, isGarrisonBuildingKind } from "../game/fortifications";
import { TOWER_UPGRADES } from "../game/duel";
import type {
  ArmyUnitKind,
  ArmyUnitState,
  BuildingCategory,
  BuildingProductionSnapshot,
  BuildingKind,
  BuildingState,
  CivilianState,
  ControllableEntityKind,
  DifficultyId,
  GameSnapshot,
  MissionId,
  RationPolicy,
  ResourceKey,
  StockpiledResourceKey,
  TaxPolicy,
  TowerUpgradeKind,
  WorkPriority,
} from "../game/types";
import { buildingPortrait, buildingPurpose, icon, type UIIcon } from "./Artwork";
import { campaignLandmark, journeyMap } from "./CampaignArtwork";
import { normalizeMobileJoystick } from "../input/BetaUnitControls";
import type { SavedSessionSummary } from "../game/sessionStorage";

export interface UIActions {
  closeEnemySelection?: () => void;
  audioVolumes?: { effects: number; ambient: number };
  setAudioVolume?: (channel: "effects" | "ambient", value: number) => void;
  callTutorialRaid?: () => void;
  nextMission?: () => void;
  holdArmy?: () => void;
  beginAttackMove?: () => void;
  graphicsQuality?: "auto" | "low" | "medium" | "high";
  setGraphicsQuality?: (quality: "auto" | "low" | "medium" | "high") => void;
  enqueueUnit?: (kind: ArmyUnitKind, buildingId: number) => void;
  cancelTraining?: (buildingId: number, index: number) => void;
  start: () => void;
  continueSession: () => void;
  continueAfterVictory: () => void;
  restart: () => void;
  campaign: () => void;
  selectMission: (id: MissionId) => void;
  selectDifficulty: (id: DifficultyId) => void;
  beginPreparation: () => void;
  pause: () => void;
  selectBuild: (kind: BuildingKind | null) => void;
  demolish: (id: number) => void;
  repair: (id: number) => void;
  upgradeTower: (id: number, upgrade: Exclude<TowerUpgradeKind, "none">) => void;
  train: (kind: ArmyUnitKind, buildingId: number) => void;
  trade: (buildingId: number, resource: StockpiledResourceKey, mode: "buy" | "sell") => void;
  setBuildingEnabled: (id: number, enabled: boolean) => void;
  setBuildingPriority: (id: number, priority: WorkPriority) => void;
  setRallyMode: () => void;
  setSpeed: (speed: 1 | 2) => void;
  setTaxPolicy: (policy: TaxPolicy) => void;
  setRationPolicy: (policy: RationPolicy) => void;
  setBuildMenuOpen: (open: boolean) => void;
  confirmPlacement: () => void;
  cancelPlacement: () => void;
  pan: (x: number, z: number) => void;
  zoom: (amount: number) => void;
  rotate: (amount: number) => void;
  toggleTopView: () => boolean;
  resetCamera: () => void;
  focusCastle: (side: "player" | "enemy" | "all") => void;
  clearSelection: () => void;
  toggleSound: () => boolean;
  clearArmySelection: () => void;
  toggleArmyOrderMode: () => void;
  enterDirectControl: (entityKind: ControllableEntityKind, entityId: number) => void;
  exitDirectControl: () => void;
  directAttack: () => void;
  directDance: () => void;
  directMount: (buildingId?: number) => void;
  directDismount: () => void;
  setDirectMovement: (x: number, z: number, sprint: boolean) => void;
}

const resourceMeta: Array<{ key: ResourceKey | "population"; label: string }> = [
  { key: "wood", label: "дерево" },
  { key: "stone", label: "камень" },
  { key: "food", label: "еда" },
  { key: "gold", label: "золото" },
  { key: "population", label: "люди" },
];

const stockKeys: StockpiledResourceKey[] = ["wood", "stone", "food", "grain", "iron", "weapons"];
const resourceNames: Record<ResourceKey, string> = {
  wood: "дерево", stone: "камень", food: "еда", gold: "золото", grain: "зерно", iron: "железо", weapons: "оружие",
};
const resourceQuantityNames: Record<ResourceKey, string> = {
  wood: "дерева", stone: "камня", food: "еды", gold: "золота", grain: "зерна", iron: "железа", weapons: "оружия",
};
const armyIcons: Record<ArmyUnitKind, UIIcon> = { spearman: "spear", archer: "bow", swordsman: "shield", knight: "horse", catapult: "catapult", batteringRam: "ram" };

function civilianRole(civilian: CivilianState): { name: string; assignment: string } {
  const roleByJob: Partial<Record<BuildingKind, string>> = {
    lumber: "Лесоруб",
    quarry: "Каменщик",
    farm: "Фермер",
    wheatFarm: "Земледелец",
    mill: "Мельник",
    bakery: "Пекарь",
    ironMine: "Шахтёр",
    blacksmith: "Кузнец",
    well: "Водовоз",
    granary: "Носильщик",
    market: "Торговец",
    tower: "Дозорный",
  };
  if (civilian.jobKind) {
    return {
      name: roleByJob[civilian.jobKind] ?? "Житель",
      assignment: `Работает: ${BUILDINGS[civilian.jobKind].shortName.toLowerCase()}`,
    };
  }
  return { name: "Свободный житель", assignment: "Ждёт нового назначения" };
}

export class GameUI {
  private root: HTMLElement;
  private actions: UIActions;
  private selectedKind: BuildingKind | null = null;
  private selectedId: number | null = null;
  private selectedEnemyId: number | null = null;
  private buildDockOpen = false;
  private economyOpen = false;
  private cameraToolsOpen = false;
  private objectiveCollapsed = true;
  private duelMission = false;
  private commandMarkerTimer = 0;
  private joystickPointerId: number | null = null;
  private directJoystickAxes = { strafe: 0, forward: 0, magnitude: 0 };
  private directSprintHeld = false;
  private directSprintPointerId: number | null = null;
  private lastStatus = "title";
  private lastToast = "";
  private lastToastAt = 0;
  private markupCache = new WeakMap<HTMLElement, string>();
  private layoutMedia = matchMedia("(max-width: 720px), (max-height: 480px) and (max-width: 960px), (hover: none) and (pointer: coarse)");

  constructor(container: HTMLElement, actions: UIActions) {
    this.actions = actions;
    this.root = document.createElement("div");
    this.root.className = "game-ui is-overlay-open";
    this.root.innerHTML = this.template();
    container.append(this.root);
    this.bindEvents();
    this.layoutMedia.addEventListener("change", (event) => {
      if (this.selectedKind) this.actions.cancelPlacement();
      if (event.matches) {
        this.setEconomyOpen(false);
        this.setCameraToolsOpen(false);
        this.setBuildDockOpen(false);
      }
      this.actions.setBuildMenuOpen(this.buildDockOpen && event.matches);
      this.syncMobileSurfaceState();
    });
    this.applyBuildCategory("all");
    this.setSurfaceVisible(this.query<HTMLElement>("[data-build-dock]"), false);
    this.setSurfaceVisible(this.query<HTMLElement>("[data-placement-bar]"), false);
    this.setSurfaceVisible(this.query<HTMLElement>("[data-economy-body]"), false);
    this.setSurfaceVisible(this.query<HTMLElement>("[data-camera-tools]"), false);
    this.setObjectiveCollapsed(this.objectiveCollapsed);
    this.setSurfaceVisible(this.query<HTMLElement>("[data-army-command-panel]"), false);
    this.setSurfaceVisible(this.query<HTMLElement>("[data-direct-control-hud]"), false);
    this.setTutorialCopy(false);
  }

  render(snapshot: GameSnapshot): void {
    const duel = snapshot.duel;
    const incomingAssault = duel
      ? snapshot.raiders.some((raider) => raider.hp > 0 && raider.stance === "assault")
      : snapshot.enemiesAlive > 0;
    this.duelMission = duel !== null;
    this.root.dataset.gameStatus = snapshot.status;
    this.root.classList.toggle("is-duel", duel !== null);
    this.root.classList.toggle("is-preparing", !snapshot.preparationStarted);
    this.root.classList.toggle("is-time-paused", snapshot.timePaused);
    this.root.classList.toggle("is-under-attack", incomingAssault);
    this.root.classList.toggle("is-food-critical", snapshot.resources.food < 15);
    this.root.classList.toggle("is-population-full", snapshot.population >= snapshot.populationCap);
    for (const item of resourceMeta) {
      const chip = this.query<HTMLElement>(`[data-resource="${item.key}"]`);
      const value = chip.querySelector<HTMLElement>(".resource-chip__value")!;
      const amount = item.key === "population"
        ? `${snapshot.population}/${snapshot.populationCap}`
        : Math.floor(snapshot.resources[item.key]).toString();
      value.textContent = amount;
      const detail = chip.querySelector<HTMLElement>(".resource-chip__delta");
      if (detail) {
        if (item.key === "wood" || item.key === "stone" || item.key === "food") {
          detail.textContent = `/${Math.floor(snapshot.economy.storageCapacity[item.key])}`;
          chip.title = `${item.label}: ${Math.floor(snapshot.resources[item.key])} из ${Math.floor(snapshot.economy.storageCapacity[item.key])}`;
        } else if (item.key === "gold") {
          detail.textContent = `+${this.formatNumber(snapshot.economy.taxIncomePerTick * 60 / ECONOMY_TICK_SECONDS)}/мин`;
          chip.title = `${item.label}: налоговый доход +${this.formatNumber(snapshot.economy.taxIncomePerTick * 60 / ECONOMY_TICK_SECONDS)} в минуту`;
        } else {
          detail.textContent = `${Math.round(snapshot.hope)}%`;
          chip.title = `${item.label}: ${snapshot.population}/${snapshot.populationCap}, доверие ${Math.round(snapshot.hope)}%`;
        }
      }
      const low = item.key === "population"
        ? snapshot.population >= snapshot.populationCap
        : snapshot.resources[item.key] < 15;
      chip.classList.toggle("is-low", low);
      chip.setAttribute("aria-label", `${item.label}: ${amount}`);
    }

    this.query<HTMLElement>("[data-mission-badge]").textContent = `Карта ${snapshot.missionOrder} · ${snapshot.missionName}`;
    this.query<HTMLElement>("[data-army-badge]").textContent = `Армия ${snapshot.armyCount}/24`;
    this.query<HTMLElement>("[data-hope]").textContent = `${Math.round(snapshot.hope)}%`;
    this.query<HTMLElement>("[data-wave-label]").textContent = duel ? duel.friendly ? "Союзник" : "Соперник" : "Угроза";
    this.query<HTMLElement>("[data-wave-badge]").textContent = duel
      ? duel.friendly
        ? `дружественный город · ${duel.enemyDevelopment} построек`
        : `цитадель ${Math.round(duel.enemyKeepHp / Math.max(1, duel.enemyKeepMaxHp) * 100)}% · отрядов ${duel.enemyArmyCount}`
      : snapshot.enemiesAlive > 0
        ? `Бой · врагов ${snapshot.enemiesAlive}`
        : `Волна ${snapshot.wave}/${snapshot.waveCount}`;
    const workforce = this.query<HTMLElement>("[data-workforce]");
    workforce.textContent = snapshot.jobs > snapshot.civilians
      ? `Рабочие ${snapshot.civilians}/${snapshot.jobs} · нехватка`
      : `Рабочие ${snapshot.jobs}/${snapshot.civilians} · свободно ${snapshot.freeWorkers}`;
    workforce.dataset.tone = snapshot.jobs > snapshot.civilians ? "danger" : "info";
    workforce.closest<HTMLElement>(".status-chip")!.dataset.tone = workforce.dataset.tone;
    const speed = this.query<HTMLButtonElement>("[data-speed]");
    speed.textContent = `×${snapshot.timeScale}`;
    speed.setAttribute("aria-label", `Скорость игры ${snapshot.timeScale}`);

    this.renderObjective(snapshot);
    this.renderDuelStatus(snapshot);
    this.renderEconomy(snapshot);
    this.renderCampaign(snapshot);
    for (const kind of BUILDABLE_KINDS) {
      const button = this.query<HTMLButtonElement>(`[data-build="${kind}"]`);
      const missionLocked = kind === "siegeWorkshop" && duel === null;
      const affordable = (Object.entries(BUILDINGS[kind].cost) as Array<[ResourceKey, number]>).every(
        ([key, cost]) => snapshot.resources[key] >= cost,
      );
      button.classList.toggle("is-unavailable", !affordable || missionLocked);
      button.classList.toggle("is-active", kind === this.selectedKind);
      button.setAttribute("aria-pressed", String(kind === this.selectedKind));
      button.setAttribute("aria-disabled", String(!affordable || missionLocked));
      button.disabled = !affordable || missionLocked;
      if (kind === "siegeWorkshop") this.syncBuildCardVisibility(button);
      const missing = (Object.entries(BUILDINGS[kind].cost) as Array<[ResourceKey, number]>)
        .filter(([key, cost]) => snapshot.resources[key] < cost)
        .map(([key, cost]) => `${resourceNames[key]}: ещё ${Math.ceil(cost - snapshot.resources[key])}`);
      button.title = `${BUILDINGS[kind].description}${missing.length ? ` Не хватает: ${missing.join(", ")}.` : ""}`;
    }

    const selected = snapshot.buildings.find((building) => building.id === this.selectedId) ?? null;
    if (!selected && this.selectedId !== null) this.setSelectedBuilding(null);
    this.renderSelected(selected, snapshot);
    this.renderEnemySelection(snapshot);
    this.renderArmyControl(snapshot);
    this.updateOverlays(snapshot);
    this.updateMissionCards(snapshot.missionId);
    this.lastStatus = snapshot.status;
  }

  setWallLineMode(enabled: boolean): void {
    this.root.classList.toggle("is-wall-line", enabled);
  }

  showBuildLinePreview(text: string, valid: boolean): void {
    const bar = this.query<HTMLElement>("[data-placement-bar]");
    this.setSurfaceVisible(bar, true);
    this.root.classList.add("is-placement-pending");
    bar.dataset.tone = valid ? "success" : "danger";
    this.query<HTMLElement>("[data-placement-text]").textContent = text;
    this.query<HTMLButtonElement>("[data-placement-confirm]").disabled = !valid;
    this.syncMobileSurfaceState();
  }

  setBuildSelection(kind: BuildingKind | null): void {
    this.selectedKind = kind;
    this.root.classList.toggle("is-construction", kind !== null);
    this.root.classList.remove("is-placement-pending");
    this.setSurfaceVisible(this.query<HTMLElement>("[data-placement-bar]"), false);
    if (kind) {
      this.applyBuildCategory(BUILDINGS[kind].category);
      if (!this.isMobileLayout()) this.setBuildDockOpen(true);
      else {
        this.setEconomyOpen(false);
        this.setCameraToolsOpen(false);
        this.setBuildDockOpen(false);
        this.setSelectedBuilding(null);
        const bar = this.query<HTMLElement>("[data-placement-bar]");
        this.setSurfaceVisible(bar, true);
        bar.dataset.tone = "info";
        this.query<HTMLElement>("[data-placement-text]").textContent = `${BUILDINGS[kind].name}: коснитесь свободной клетки.`;
        this.query<HTMLButtonElement>("[data-placement-confirm]").disabled = true;
      }
      this.query<HTMLElement>("[data-tutorial-text]").textContent = kind === "wall"
        ? "Выберите начало и конец стены, затем подтвердите. Для одной секции достаточно выбрать одну клетку."
        : this.isMobileLayout()
          ? "Коснитесь клетки: появится предварительный просмотр и кнопка подтверждения."
          : "Выберите свободную клетку. Esc или правая кнопка — отмена.";
      this.showHint();
    } else {
      this.setTutorialCopy(false);
      if (this.isMobileLayout()) this.query<HTMLElement>("[data-tutorial]").classList.remove("is-visible");
    }
    this.syncMobileSurfaceState();
  }

  resetSessionUI(openDesktopBuildDock: boolean): void {
    this.selectedEnemyId = null;
    this.setSurfaceVisible(this.query<HTMLElement>("[data-enemy-panel]"), false);
    this.selectedKind = null;
    this.selectedId = null;
    this.applyBuildCategory("all");
    this.setEconomyOpen(false);
    this.setCameraToolsOpen(false);
    this.setBuildDockOpen(openDesktopBuildDock && !this.isMobileLayout());

    const placement = this.query<HTMLElement>("[data-placement-bar]");
    this.setSurfaceVisible(placement, false);
    this.root.classList.remove("is-construction", "is-placement-pending", "has-selected-panel");
    placement.dataset.tone = "info";
    this.query<HTMLElement>("[data-placement-text]").textContent = "Выберите клетку";
    this.query<HTMLButtonElement>("[data-placement-confirm]").disabled = true;
    this.query<HTMLElement>("[data-tutorial]").classList.remove("is-visible");
    this.query<HTMLElement>("[data-selected-panel]").classList.remove("is-damaged");
    this.setSurfaceVisible(this.query<HTMLElement>("[data-selected-panel]"), false);
    this.query<HTMLElement>("[data-toasts]").replaceChildren();
    this.lastToast = "";
    this.lastToastAt = 0;

    this.root.classList.remove("has-army-selection", "has-civilian-selection", "is-army-ordering", "is-direct-control", "is-civilian-control", "is-direct-dancing", "is-garrison-control");
    this.setSurfaceVisible(this.query<HTMLElement>("[data-army-command-panel]"), false);
    this.setSurfaceVisible(this.query<HTMLElement>("[data-direct-control-hud]"), false);
    this.setSelectionMarquee(null);
    this.joystickPointerId = null;
    this.directSprintPointerId = null;
    this.directSprintHeld = false;
    this.directJoystickAxes = { strafe: 0, forward: 0, magnitude: 0 };
    const joystick = this.query<HTMLElement>("[data-direct-joystick]");
    joystick.dataset.direction = "idle";
    this.query<HTMLElement>("[data-direct-joystick-knob]").style.transform = "translate(0, 0)";
    const sprint = this.query<HTMLButtonElement>("[data-direct-sprint]");
    sprint.setAttribute("aria-pressed", "false");
    sprint.classList.remove("is-active");
    for (const dance of this.root.querySelectorAll<HTMLButtonElement>("[data-direct-dance]")) {
      dance.setAttribute("aria-pressed", "false");
      dance.classList.remove("is-active");
    }
    this.actions.setDirectMovement(0, 0, false);

    this.setObjectiveCollapsed(true);
    this.syncMobileSurfaceState();
  }

  toggleBuildMenu(): void {
    this.setBuildDockOpen(!this.buildDockOpen);
  }

  setPlacementPreview(
    kind: BuildingKind,
    gx: number,
    gz: number,
    valid: boolean,
    efficiency: number,
    reason?: string,
  ): void {
    const bar = this.query<HTMLElement>("[data-placement-bar]");
    this.setSurfaceVisible(bar, true);
    this.root.classList.add("is-placement-pending");
    this.query<HTMLElement>("[data-tutorial]").classList.remove("is-visible");
    bar.dataset.tone = valid ? "success" : "danger";
    const efficiencyDetail = ["lumber", "quarry", "ironMine", "farm", "wheatFarm"].includes(kind)
      ? ` · отдача ${Math.round(efficiency * 100)}%` : "";
    const compactReason = reason === "Ресурсный выход нельзя застроить — разместите двор рядом"
      ? "Ресурсная клетка: стройте рядом"
      : reason;
    const invalidDetail = !valid && compactReason ? ` · ${compactReason}` : "";
    const text = this.query<HTMLElement>("[data-placement-text]");
    text.textContent = `${BUILDINGS[kind].shortName} · клетка ${gx + 1}:${gz + 1}${efficiencyDetail}${invalidDetail}`;
    text.title = reason ?? "";
    this.query<HTMLButtonElement>("[data-placement-confirm]").disabled = !valid;
    this.syncMobileSurfaceState();
  }

  setRallyMode(active: boolean): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-rally]")) {
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      this.setMarkup(button, `${icon("flag")}<span>${active ? "Укажите точку…" : "Точка сбора"}</span>`);
    }
    if (active) this.toast("Команда армии: выберите клетку на карте.", "info");
  }

  setTopViewState(active: boolean): void {
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-top-view]")) {
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  setArmyOrderMode(active: boolean): void {
    this.root.classList.toggle("is-army-ordering", active);
    const button = this.query<HTMLButtonElement>("[data-army-order]");
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    this.setMarkup(button, `${icon("flag")}<span>${active ? "Укажите точку" : "Отдать приказ"}</span>`);
  }

  setSelectionMarquee(rect: { left: number; top: number; width: number; height: number } | null): void {
    const marquee = this.query<HTMLElement>("[data-selection-marquee]");
    marquee.hidden = rect === null;
    if (!rect) return;
    marquee.style.left = `${rect.left}px`;
    marquee.style.top = `${rect.top}px`;
    marquee.style.width = `${Math.max(0, rect.width)}px`;
    marquee.style.height = `${Math.max(0, rect.height)}px`;
  }

  showArmyCommandMarker(clientX: number, clientY: number, attackMove: boolean): void {
    const marker = this.query<HTMLElement>("[data-army-command-marker]");
    marker.hidden = false;
    marker.dataset.kind = attackMove ? "attack" : "move";
    marker.style.left = `${clientX}px`;
    marker.style.top = `${clientY}px`;
    marker.classList.remove("is-pulsing");
    void marker.offsetWidth;
    marker.classList.add("is-pulsing");
    window.clearTimeout(this.commandMarkerTimer);
    this.commandMarkerTimer = window.setTimeout(() => { marker.hidden = true; }, 720);
  }

  setSelectedEnemyBuilding(building: BuildingState | null): void {
    this.setSelectedBuilding(null);
    if (building) {
      this.setBuildDockOpen(false);
      this.setEconomyOpen(false);
      this.setCameraToolsOpen(false);
      if (this.isMobileLayout()) this.setObjectiveCollapsed(true);
    }
    this.selectedEnemyId = building?.id ?? null;
    this.root.classList.toggle("has-selected-panel", !!building);
    this.syncMobileSurfaceState();
  }

  setSelectedBuilding(building: BuildingState | null): void {
    this.selectedEnemyId = null;
    this.setSurfaceVisible(this.query<HTMLElement>("[data-enemy-panel]"), false);
    const changed = this.selectedId !== (building?.id ?? null);
    this.selectedId = building?.id ?? null;
    if (building && changed) {
      this.setBuildDockOpen(false);
      this.setEconomyOpen(false);
      this.setCameraToolsOpen(false);
      if (this.isMobileLayout()) this.setObjectiveCollapsed(true);
    }
    if (!building) this.setSurfaceVisible(this.query<HTMLElement>("[data-selected-panel]"), false);
    this.root.classList.toggle("has-selected-panel", building !== null);
    this.syncMobileSurfaceState();
  }

  setSavedSession(summary: SavedSessionSummary | null): void {
    const button = this.query<HTMLButtonElement>("[data-continue-session]");
    button.hidden = summary === null;
    if (!summary) return;
    const mode = summary.missionCompleted ? "свободная игра" : this.formatTime(summary.elapsed);
    this.query<HTMLElement>("[data-continue-summary]").textContent = `${summary.missionName} · ${mode}`;
    button.title = `Последнее сохранение · ${summary.difficultyName}`;
  }

  toast(message: string, tone: "info" | "danger" | "success" = "info"): void {
    const now = performance.now();
    if (message === this.lastToast && now - this.lastToastAt < 1200) return;
    this.lastToast = message;
    this.lastToastAt = now;
    const stack = this.query<HTMLElement>("[data-toasts]");
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.dataset.tone = tone;
    toast.setAttribute("role", "status");
    toast.textContent = message;
    stack.prepend(toast);
    while (stack.children.length > 4) stack.lastElementChild?.remove();
    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 190);
    }, 3200);
  }

  private perMinute(values: Partial<Record<ResourceKey, number>>): Partial<Record<ResourceKey, number>> {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value * 60 / ECONOMY_TICK_SECONDS]));
  }

  private objectiveConditions(snapshot: GameSnapshot): string[] {
    const duel = snapshot.duel;
    const objective = MISSIONS[snapshot.missionId].duel?.objective;
    if (duel && objective) {
      if (duel.objectiveKind === "hold-crossing") return [
        `Походы ${Math.min(duel.assaultsDefeated, objective.primaryTarget)}/${objective.primaryTarget}`,
        `Бойцы ${Math.min(snapshot.armyCount, objective.supportTarget ?? 0)}/${objective.supportTarget}`,
      ];
      if (duel.objectiveKind === "break-fortress") return [
        `Укрепления ${Math.min(duel.fortificationsDestroyed, objective.primaryTarget)}/${objective.primaryTarget}`,
        `Оружие ${Math.min(Math.floor(snapshot.resources.weapons), objective.supportTarget ?? 0)}/${objective.supportTarget}`,
      ];
      return [`Цитадель ${Math.max(0, Math.round(duel.enemyKeepHp / Math.max(1, duel.enemyKeepMaxHp) * 100))}% HP`];
    }
    if (snapshot.goalKind === "tutorial") {
      const foods = snapshot.buildings.filter(building => ["farm", "wheatFarm", "bakery"].includes(building.kind)).length;
      return [
        `${foods >= 2 ? "✓" : "○"} Новая ферма`,
        `${snapshot.buildings.some(building => building.kind === "tower") ? "✓" : "○"} Башня`,
        `Бойцы ${Math.min(snapshot.armyCount, 2)}/2`,
        `${snapshot.wave >= snapshot.waveCount && snapshot.wave > 0 && snapshot.enemiesAlive === 0 ? "✓" : "○"} Набег`,
      ];
    }
    return [`${Math.min(snapshot.goalProgress, snapshot.goalTarget)}/${snapshot.goalTarget}`];
  }

  private canCallTutorialRaid(snapshot: GameSnapshot): boolean {
    if (snapshot.canCallTutorialRaid !== undefined) return snapshot.canCallTutorialRaid;
    const foods = snapshot.buildings.filter(building => building.hp > 0 && ["farm", "wheatFarm", "bakery"].includes(building.kind)).length;
    const armedTower = snapshot.buildings.some(building => building.kind === "tower" && building.hp > 0 && building.enabled && (building.towerUpgrade ?? "none") !== "none");
    return snapshot.missionId === "oasis" && snapshot.wave === 0 && snapshot.status === "playing" && snapshot.preparationStarted && !snapshot.timePaused
      && foods >= 2 && armedTower && snapshot.armyCount >= 2;
  }

  private renderObjective(snapshot: GameSnapshot): void {
    const tutorialRaid = this.query<HTMLButtonElement>("[data-tutorial-raid]");
    tutorialRaid.hidden = !this.actions?.callTutorialRaid || snapshot.missionId !== "oasis" || snapshot.wave !== 0 || snapshot.status !== "playing" || !snapshot.preparationStarted || snapshot.timePaused;
    tutorialRaid.disabled = !this.canCallTutorialRaid(snapshot);
    tutorialRaid.title = tutorialRaid.disabled ? "Подготовьте второй источник еды, башню с включённым модулем и двух бойцов" : "Начать учебный набег сейчас";
    const card = this.query<HTMLElement>(".objective-card");
    const title = this.query<HTMLElement>("[data-objective-title]");
    const text = this.query<HTMLElement>("[data-objective-text]");
    const progress = this.query<HTMLElement>("[data-objective-progress]");
    const count = this.query<HTMLElement>("[data-objective-count]");
    const ready = this.query<HTMLButtonElement>("[data-ready]");
    const duel = snapshot.duel;
    const incomingAssault = duel
      ? snapshot.raiders.some((raider) => raider.hp > 0 && raider.stance === "assault")
      : snapshot.enemiesAlive > 0;
    ready.hidden = snapshot.preparationStarted;
    ready.disabled = this.selectedKind !== null || (this.buildDockOpen && this.isMobileLayout()) || snapshot.status !== "playing";
    ready.title = this.selectedKind !== null ? "Сначала подтвердите или отмените размещение постройки"
      : this.buildDockOpen && this.isMobileLayout() ? "Сначала закройте каталог строительства"
        : duel ? "Запустить одновременное развитие двух замков" : "Запустить экономику, движение жителей и отсчёт набегов";
    this.query<HTMLElement>("[data-clock-state]").textContent = !snapshot.preparationStarted
      ? "Подготовка · время стоит"
      : snapshot.timePaused ? `${snapshot.status === "paused" ? "Пауза" : "Планирование"} · время стоит` : `${snapshot.difficultyName} · ${this.formatTime(snapshot.elapsed)}`;
    const effects = this.query<HTMLElement>("[data-active-effects]");
    effects.hidden = snapshot.activeEffects.length === 0;
    effects.textContent = snapshot.activeEffects.map(effect => `${effect.title} · ${this.formatTime(effect.remainingSeconds)}`).join(" / ");
    card.dataset.tone = incomingAssault ? "danger" : snapshot.nextWaveIn !== null && snapshot.nextWaveIn <= 30 ? "warning" : "briefing";
    if (snapshot.missionCompleted) {
      title.textContent = "Свободная игра";
      text.textContent = "Задание выполнено. Продолжайте строить, развивать город и управлять жителями.";
      count.textContent = "ГОТОВО";
    } else if (!snapshot.preparationStarted) {
      title.textContent = duel ? "Подготовьте свой замок" : "Подготовьте крепость";
      text.textContent = duel
        ? "Ваши земли — слева. Центральная полоса нейтральна: там нельзя строить. После старта оба замка будут развиваться."
        : "Постройте за начальные запасы. Экономика и события ждут команды «Начать игру».";
      count.textContent = "Без спешки";
    } else if (duel) {
      const keepPercent = Math.round(duel.enemyKeepHp / Math.max(1, duel.enemyKeepMaxHp) * 100);
      const objective = MISSIONS[snapshot.missionId].duel!.objective;
      if (duel.objectiveKind === "hold-crossing") {
        title.textContent = incomingAssault ? "Защитите переправу" : "Удержите долину";
        text.textContent = `${duel.phaseLabel}. Отбито походов ${Math.min(duel.assaultsDefeated, objective.primaryTarget)}/${objective.primaryTarget}, ваших бойцов ${snapshot.armyCount}/${objective.supportTarget}.`;
        count.textContent = this.objectiveConditions(snapshot).join(" · ");
      } else if (duel.objectiveKind === "break-fortress") {
        title.textContent = incomingAssault ? "Берегите свой замок" : "Сломайте опорные укрепления";
        text.textContent = `${duel.phaseLabel}. Разрушено укреплений ${duel.fortificationsDestroyed}/${objective.primaryTarget}, оружия в запасе ${Math.floor(snapshot.resources.weapons)}/${objective.supportTarget}.`;
        count.textContent = this.objectiveConditions(snapshot).join(" · ");
      } else {
        title.textContent = incomingAssault ? "Соперник идёт к вашему замку" : `Финальная цитадель · ${keepPercent}%`;
        text.textContent = `${duel.phaseLabel}. У соперника ${duel.enemyDevelopment} построек и ${duel.enemyArmyCount} отрядов. Пробейте стены и разрушьте цитадель.`;
        count.textContent = `замок ${keepPercent}%`;
      }
    } else if (snapshot.enemiesAlive > 0) {
      title.textContent = `Волна ${snapshot.wave}/${snapshot.waveCount} · врагов ${snapshot.enemiesAlive}`;
      text.textContent = "Бойцы сражаются автоматически. Перенесите точку сбора к опасному участку.";
      count.textContent = `${snapshot.enemiesAlive} врагов`;
    } else if (snapshot.nextWaveIn !== null) {
      title.textContent = `До набега ${this.formatTime(snapshot.nextWaveIn)}`;
      text.textContent = `Удар: ${snapshot.nextRaidDirection}. Цель: ${snapshot.goalLabel} (${Math.min(snapshot.goalProgress, snapshot.goalTarget)}/${snapshot.goalTarget}).`;
      count.textContent = `${snapshot.wave}/${snapshot.waveCount}`;
    } else if (snapshot.goalProgress < snapshot.goalTarget) {
      title.textContent = "Враг разбит — завершите цель";
      text.textContent = `${snapshot.goalLabel}: ${snapshot.goalProgress}/${snapshot.goalTarget}. Экономика продолжает работать.`;
      count.textContent = `${snapshot.goalProgress}/${snapshot.goalTarget}`;
    } else {
      title.textContent = "Последняя задача";
      text.textContent = "Добейте остатки орды, чтобы завершить миссию.";
      count.textContent = "ФИНАЛ";
    }
    if (snapshot.goalKind === "tutorial" && !snapshot.missionCompleted) count.textContent = this.objectiveConditions(snapshot).join(" · ");
    const mission = MISSIONS[snapshot.missionId];
    const total = mission.waves.at(-1)?.at ?? 1;
    const raidProgress = Math.min(100, (snapshot.raidClock / total) * 100);
    const goalProgress = Math.min(100, (snapshot.goalProgress / Math.max(1, snapshot.goalTarget)) * 100);
    progress.style.setProperty("--progress", `${duel ? goalProgress : Math.min(100, raidProgress * 0.78 + goalProgress * 0.22)}%`);
    const briefing = this.query<HTMLElement>("[data-objective-briefing]");
    const nextEvent = snapshot.nextEvent;
    const chronicle = snapshot.chronicle.slice(-3).reverse();
    const duelSummary = duel
      ? `<p class="objective-duel-summary"><span><b>${duel.friendly ? "Дружественный город" : this.escape(duel.enemyName)}</b><small>${duel.enemyDevelopment} построек · ${duel.friendly ? "мир" : `${duel.enemyArmyCount} отрядов`}</small></span><span><b>${Math.ceil(duel.enemyKeepHp)}/${duel.enemyKeepMaxHp}</b><small>${duel.friendly ? "союзная цитадель" : "цитадель"}</small></span></p>`
      : "";
    this.setMarkup(briefing, `
      <p class="objective-goal"><b>${snapshot.missionCompleted ? "Выполнено" : "Цель"}:</b> ${this.escape(snapshot.goalLabel)} <strong>${this.objectiveConditions(snapshot).join(" · ")}</strong></p>
      ${duelSummary}
      ${nextEvent ? `<p class="scenario-event"><span>Следующее событие · ${this.formatTime(nextEvent.inSeconds)}</span><b>${this.escape(nextEvent.title)}</b><small>${this.escape(nextEvent.description)}</small></p>` : ""}
      ${chronicle.length ? `<ol class="chronicle">${chronicle.map(event => `<li data-tone="${event.tone}"><time>${this.formatTime(event.at)}</time><span><b>${this.escape(event.title)}</b><small>${this.escape(event.description)}</small></span></li>`).join("")}</ol>` : ""}
    `);
  }

  private renderDuelStatus(snapshot: GameSnapshot): void {
    const panel = this.query<HTMLElement>("[data-duel-status]");
    const duel = snapshot.duel;
    this.setSurfaceVisible(panel, duel !== null && snapshot.status !== "title");
    for (const control of this.root.querySelectorAll<HTMLElement>("[data-duel-control]")) control.hidden = duel === null;
    if (!duel) return;
    const keepPercent = Math.max(0, Math.min(100, duel.enemyKeepHp / Math.max(1, duel.enemyKeepMaxHp) * 100));
    panel.classList.toggle("is-friendly", duel.friendly);
    panel.setAttribute("aria-label", duel.friendly ? "Состояние дружественного замка" : "Состояние замка соперника");
    this.query<HTMLElement>("[data-duel-name]").textContent = duel.friendly ? `${duel.enemyName} · союзник` : duel.enemyName;
    this.query<HTMLElement>("[data-duel-phase]").textContent = duel.phaseLabel;
    this.query<HTMLElement>("[data-duel-compact]").textContent = duel.friendly ? "мир · союзник"
      : duel.objectiveKind === "destroy-keep" ? `${Math.round(keepPercent)}% · ${duel.enemyArmyCount} отр.`
        : `${duel.objectiveProgress}/${duel.objectiveTarget} · ${duel.enemyArmyCount} отр.`;
    this.query<HTMLElement>("[data-duel-keep]").textContent = `${Math.ceil(duel.enemyKeepHp)}/${duel.enemyKeepMaxHp}`;
    this.query<HTMLElement>("[data-duel-keep-bar]").style.setProperty("--enemy-health", `${keepPercent}%`);
    this.query<HTMLElement>("[data-duel-army]").textContent = duel.friendly ? "дружественный город" : `${duel.enemyArmyCount} отрядов`;
    this.query<HTMLElement>("[data-duel-buildings]").textContent = `${duel.enemyDevelopment} построек`;
    this.query<HTMLElement>("[data-duel-assault]").textContent = duel.friendly ? "бирюзовые флаги подняты"
      : duel.assaultsLaunched > 0
      ? `следующий поход не раньше ${this.formatTime(duel.nextAssaultIn)}`
      : "первый поход ещё не начат";
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-focus-castle="enemy"]')) {
      const label = duel.friendly ? "Показать дружественный замок" : "Показать замок соперника";
      button.setAttribute("aria-label", label);
      button.title = label;
      const text = button.querySelector("span");
      if (text) text.textContent = duel.friendly ? "Союзник" : "Соперник";
    }
  }

  private renderEconomy(snapshot: GameSnapshot): void {
    const economy = snapshot.economy;
    this.query<HTMLElement>("[data-economy-phase]").textContent = snapshot.timePaused ? "Прогноз · время остановлено" : "Запасы и производство · за минуту";
    this.query<HTMLElement>("[data-economy-hope]").textContent = `Доверие ${Math.round(snapshot.hope)}%`;
    this.query<HTMLElement>("[data-economy-hope-compact]").textContent = `${Math.round(snapshot.hope)}%`;
    const trend = this.query<HTMLElement>("[data-economy-trend]");
    trend.textContent = `${this.formatSigned(economy.popularityTrendPerTick * 60 / ECONOMY_TICK_SECONDS)} / мин`;
    trend.dataset.tone = economy.popularityTrendPerTick > 0 ? "positive" : economy.popularityTrendPerTick < 0 ? "negative" : "neutral";
    const factors = economy.popularityFactors;
    trend.title = `Налоги ${this.formatSigned(factors.taxes)} · пайки ${this.formatSigned(factors.rations)} · жильё ${this.formatSigned(factors.housing)} · еда ${this.formatSigned(factors.food)} · колодцы ${this.formatSigned(factors.water)}`;
    this.query<HTMLElement>("[data-popularity-factors]").textContent =
      `Настроение: налог ${this.formatSigned(factors.taxes)} · паёк ${this.formatSigned(factors.rations)} · жильё ${this.formatSigned(factors.housing)} · еда ${this.formatSigned(factors.food)} · колодцы ${this.formatSigned(factors.water)}`;
    this.query<HTMLElement>("[data-tax-readout]").textContent = `+${this.formatNumber(economy.taxIncomePerTick * 60 / ECONOMY_TICK_SECONDS)} золота / мин`;
    this.query<HTMLElement>("[data-ration-readout]").textContent = `−${this.formatNumber(economy.foodUsePerTick * 60 / ECONOMY_TICK_SECONDS)} еды / мин`;
    this.query<HTMLElement>("[data-food-reserve]").textContent = economy.foodNetPerTick >= 0 ? "Еда: запас растёт" : `Еды на ${this.formatTime(economy.foodReserveSeconds)}`;
    this.query<HTMLElement>("[data-staffing]").textContent = `Рабочих ${Math.round(economy.staffedRatio * 100)}%`;

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-tax-policy]")) {
      const active = button.dataset.taxPolicy === economy.taxPolicy;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-ration-policy]")) {
      const active = button.dataset.rationPolicy === economy.rationPolicy;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const key of stockKeys) {
      const capacity = economy.storageCapacity[key];
      const used = snapshot.resources[key];
      const meter = this.query<HTMLElement>(`[data-storage="${key}"]`);
      meter.style.setProperty("--storage-fill", `${Math.min(100, (used / Math.max(1, capacity)) * 100)}%`);
      meter.classList.toggle("is-near-full", economy.storageRemaining[key] <= capacity * 0.15);
      meter.querySelector<HTMLElement>("b")!.textContent = `${Math.floor(used)}/${Math.floor(capacity)}`;
      const net = economy.netPerTick[key];
      const rate = meter.querySelector<HTMLElement>("em")!;
      rate.textContent = economy.storageRemaining[key] <= 0.01 ? "Склад полон" : `${this.formatSigned(net * 60 / ECONOMY_TICK_SECONDS)} / мин`;
      rate.dataset.tone = net < 0 ? "negative" : net > 0 ? "positive" : "neutral";
    }
    const warnings = this.query<HTMLElement>("[data-economy-warnings]");
    warnings.hidden = economy.warnings.length === 0;
    this.setMarkup(warnings, economy.warnings.slice(0, 3).map(warning => `<li>${this.escape(warning)}</li>`).join(""));
    if (this.economyOpen && !this.isMobileLayout()) {
      const ledgerTop = Math.ceil(this.query<HTMLElement>("[data-economy-toggle]").getBoundingClientRect().bottom + 6);
      this.root.style.setProperty("--ui-economy-top", `${ledgerTop}px`);
    }
  }

  private setEconomyOpen(open: boolean): void {
    if (open) {
      this.setBuildDockOpen(false);
      this.setObjectiveCollapsed(true);
      this.setSelectedBuilding(null);
      this.actions.clearSelection();
    }
    if (open && this.isMobileLayout()) {
      if (this.selectedKind) this.actions.cancelPlacement();
      this.setCameraToolsOpen(false);
    }
    this.economyOpen = open;
    const card = this.query<HTMLElement>("[data-economy-card]");
    const toggle = this.query<HTMLButtonElement>("[data-economy-toggle]");
    card.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.querySelector<HTMLElement>("[data-economy-chevron]")!.classList.toggle("is-up", open);
    if (open && !this.isMobileLayout()) {
      const ledgerTop = Math.ceil(toggle.getBoundingClientRect().bottom + 6);
      this.root.style.setProperty("--ui-economy-top", `${ledgerTop}px`);
    }
    this.setSurfaceVisible(this.query<HTMLElement>("[data-economy-body]"), open);
    this.root.classList.toggle("is-economy-open", open);
    this.syncMobileSurfaceState();
  }

  private renderCampaign(snapshot: GameSnapshot): void {
    if (snapshot.status !== "title") return;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-difficulty]")) {
      const active = button.dataset.difficulty === snapshot.difficultyId;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    }
    const difficulty = DIFFICULTIES[snapshot.difficultyId];
    this.query<HTMLElement>("[data-difficulty-description]").textContent = difficulty.description;
    const mission = MISSIONS[snapshot.missionId];
    this.query<HTMLElement>("[data-difficulty-modifiers]").textContent = mission.duel
      ? `Ваши запасы ×${this.formatMultiplier(difficulty.startingResourceMultiplier)} · темп этого соперника ×${this.formatMultiplier(mission.duel.aiPace)} · прочность его отрядов ×${this.formatMultiplier(difficulty.enemyHpMultiplier)} · сила ×${this.formatMultiplier(difficulty.enemyDamageMultiplier)}`
      : `Запасы ×${this.formatMultiplier(difficulty.startingResourceMultiplier)} · время до набегов ×${this.formatMultiplier(difficulty.waveTimeMultiplier)} · врагов ×${this.formatMultiplier(difficulty.enemyCountMultiplier)} · здоровье ×${this.formatMultiplier(difficulty.enemyHpMultiplier)} · урон ×${this.formatMultiplier(difficulty.enemyDamageMultiplier)}`;
    this.query<HTMLElement>("[data-campaign-order]").textContent = `Этап ${mission.order} из ${MISSION_LIST.length}`;
    this.query<HTMLElement>("[data-briefing-name]").textContent = mission.name;
    this.query<HTMLElement>("[data-briefing-text]").textContent = mission.briefing;
    this.query<HTMLElement>("[data-briefing-hint]").textContent = mission.strategyHint;
    this.query<HTMLElement>("[data-briefing-goal]").textContent = mission.goalKind === "duel"
      ? `${mission.goalLabel} · два замка развиваются одновременно`
      : mission.goalKind === "survive" ? mission.goalLabel : `${mission.goalLabel} · ${this.waveLabel(mission.waves.length)}`;
    this.setMarkup(this.query<HTMLElement>("[data-briefing-stock]"), this.costMarkup(snapshot.resources));
  }

  private updateOverlays(snapshot: GameSnapshot): void {
    const start = this.query<HTMLElement>("[data-overlay-start]");
    const pause = this.query<HTMLElement>("[data-overlay-pause]");
    const end = this.query<HTMLElement>("[data-overlay-end]");
    this.setSurfaceVisible(start, snapshot.status === "title");
    this.setSurfaceVisible(pause, snapshot.status === "paused");
    const ended = snapshot.status === "victory" || snapshot.status === "defeat";
    this.setSurfaceVisible(end, ended);
    this.root.classList.toggle("is-overlay-open", snapshot.status === "title" || ended);
    const modalOpen = snapshot.status === "title" || snapshot.status === "paused" || ended;
    this.query<HTMLElement>(".hud").inert = modalOpen;
    this.query<HTMLElement>(".mobile-controls").inert = modalOpen || (this.isMobileLayout() && this.selectedKind !== null);
    this.query<HTMLElement>("[data-army-command-panel]").inert = modalOpen || this.query<HTMLElement>("[data-army-command-panel]").hidden;
    this.query<HTMLElement>("[data-direct-control-hud]").inert = modalOpen || this.query<HTMLElement>("[data-direct-control-hud]").hidden;
    this.query<HTMLElement>("[data-placement-bar]").inert = modalOpen || this.query<HTMLElement>("[data-placement-bar]").hidden;
    if (this.lastStatus !== snapshot.status && modalOpen) {
      const hasSavedSession = !this.query<HTMLButtonElement>("[data-continue-session]").hidden;
      const focusTarget = snapshot.status === "title" ? hasSavedSession ? "[data-continue-session]" : "[data-start]"
        : snapshot.status === "paused" ? "[data-resume]" : snapshot.status === "victory" ? "[data-continue-after-victory]" : "[data-restart]";
      const activeOverlay = snapshot.status === "title" ? start : snapshot.status === "paused" ? pause : end;
      activeOverlay.querySelector<HTMLButtonElement>(focusTarget)?.focus({ preventScroll: true });
    }

    if (ended && this.lastStatus !== snapshot.status) {
      end.dataset.result = snapshot.status;
      this.query<HTMLElement>("[data-end-kicker]").textContent = snapshot.status === "victory" ? snapshot.missionName : "Стены пали";
      this.query<HTMLElement>("[data-end-title]").textContent = snapshot.status === "victory" ? "Миссия выполнена" : "Поражение";
      this.query<HTMLElement>("[data-end-subtitle]").textContent = snapshot.status === "victory"
        ? snapshot.duel ? `${snapshot.goalLabel}. Можно продолжить игру и достроить свой замок.` : `${snapshot.goalLabel}. Караванный путь снова под защитой.`
        : "Противники добрались до цитадели. Укрепите город и попробуйте снова.";
      this.query<HTMLElement>("[data-summary-time]").textContent = this.formatTime(snapshot.elapsed);
      this.query<HTMLElement>("[data-summary-pop]").textContent = String(snapshot.population);
      this.query<HTMLElement>("[data-summary-army]").textContent = String(snapshot.armyCount);
    }
    this.query<HTMLButtonElement>("[data-continue-after-victory]").hidden = snapshot.status !== "victory";
    this.query<HTMLButtonElement>("[data-next-mission]").hidden = !this.actions.nextMission || snapshot.status !== "victory" || MISSIONS[snapshot.missionId].order >= MISSION_LIST.length;
  }

  private productionFlow(kind: BuildingKind, production: BuildingProductionSnapshot, paused: boolean) {
    const recipe = BUILDINGS[kind].production;
    const nominal = !!recipe && !Object.values(production.outputs).some(value => (value ?? 0) > 0);
    const inputs = nominal ? recipe?.inputs ?? {} : production.inputs;
    const outputs = nominal ? recipe?.outputs ?? {} : production.outputs;
    return {
      inputs: this.perMinute(inputs), outputs: this.perMinute(outputs),
      label: nominal ? "Базовый рецепт за минуту · выпуск сейчас 0"
        : paused ? "Прогноз за минуту · время стоит, выпуск сейчас 0" : "Производство за минуту",
      capacityKeys: Object.keys(recipe?.outputs ?? production.outputs).filter(key => key !== "gold") as StockpiledResourceKey[],
    };
  }

  private enemyBuildingFacts(building: BuildingState): string {
    const upgrade = building.towerUpgrade ?? "none";
    if (building.kind === "tower" && upgrade !== "none") {
      const module = TOWER_UPGRADES[upgrade];
      return `${module.name} · дальность ${this.formatNumber(module.range)} клетки · ${module.damage} урона · перезарядка ${module.cooldown.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} с. Цели — ${module.targets === "personnel" ? "бойцы" : "осадные машины"}.${building.enabled ? "" : " Модуль отключён."}`;
    }
    return building.kind === "tower" ? "Без модуля — автономного огня нет." : BUILDINGS[building.kind].description;
  }

  private renderEnemySelection(snapshot: GameSnapshot): void {
    const building = snapshot.duel?.enemyBuildings.find(item => item.id === this.selectedEnemyId && item.hp > 0);
    const panel = this.query<HTMLElement>("[data-enemy-panel]");
    this.setSurfaceVisible(panel, !!building);
    if (!building) {
      if (this.selectedEnemyId !== null) {
        this.selectedEnemyId = null;
        this.root.classList.toggle("has-selected-panel", this.selectedId !== null);
      }
      return;
    }
    this.setMarkup(this.query<HTMLElement>("[data-enemy-facts]"), `<strong>${this.escape(BUILDINGS[building.kind].name)} · ${snapshot.duel?.friendly ? "союзник" : "соперник"}</strong><p>Прочность ${Math.ceil(building.hp)}/${building.maxHp}</p><p>${this.escape(this.enemyBuildingFacts(building))}</p>${snapshot.missionId === "river" && !snapshot.duel?.friendly ? `<p>Северная переправа под огнём башни. Обходите через южную переправу и держитесь её внешнего южного края. Для победы достаточно отбить два похода и сохранить шесть бойцов.</p>` : ""}`);
  }

  private queueBlockReason(snapshot: GameSnapshot, building: BuildingState, kind: ArmyUnitKind): string | null {
    const unit = ARMY_UNITS[kind];
    const orders = snapshot.buildings.flatMap(item => item.trainingQueue ?? []);
    const reservedCrew = orders.reduce((sum, order) => sum + (ARMY_UNITS[order.kind].populationCost ?? 1), 0);
    if (!["playing", "paused"].includes(snapshot.status)) return "Обучение недоступно";
    if ((building.trainingQueue?.length ?? 0) >= 5) return "Очередь заполнена";
    if (snapshot.armyCount + orders.length >= 24) return "Лимит 24 бойца с учётом очередей";
    if (snapshot.freeWorkers - reservedCrew < (unit.populationCost ?? 1)) return `Нужно свободных жителей: ${unit.populationCost ?? 1} · в очередях ${reservedCrew}`;
    if (!this.canAfford(snapshot, unit.cost)) return "Не хватает запасов";
    return null;
  }

  private renderSelected(building: BuildingState | null, snapshot: GameSnapshot): void {
    const panel = this.query<HTMLElement>("[data-selected-panel]");
    this.setSurfaceVisible(panel, Boolean(building));
    if (!building) {
      delete panel.dataset.kind;
      delete panel.dataset.category;
      panel.classList.remove("is-damaged");
      return;
    }
    const definition = BUILDINGS[building.kind];
    // Initial preparation freezes clocks, not the player's finite-supply orders.
    // A manual pause or a later construction transaction still gates actions.
    const actionPaused = snapshot.status !== "playing" || (snapshot.timePaused && snapshot.preparationStarted);
    panel.dataset.kind = building.kind;
    panel.dataset.category = definition.category;
    panel.classList.toggle("is-damaged", building.hp / building.maxHp < 0.6);
    this.setMarkup(this.query<HTMLElement>("[data-selected-icon]"), buildingPortrait(building.kind));
    this.query<HTMLElement>("[data-selected-name]").textContent = definition.name;
    this.query<HTMLElement>("[data-selected-type]").textContent = this.categoryLabel(definition.category);
    const stationed = snapshot.army.filter((unit) => unit.garrison?.buildingId === building.id).length;
    const enemyBlocksBuildingAction = snapshot.raiders.some((raider) => raider.hp > 0
      && Math.hypot(raider.x - building.gx, raider.z - building.gz) <= 5);
    const garrisonDetail = isGarrisonBuildingKind(building.kind)
      ? ` Гарнизон ${stationed}/${garrisonCapacity(building.kind)} · только лучники и копейщики.`
      : "";
    this.query<HTMLElement>("[data-selected-description]").textContent = `${definition.description}${garrisonDetail}`;
    this.query<HTMLElement>("[data-selected-health]").style.setProperty("--health", `${Math.max(0, building.hp / building.maxHp) * 100}%`);
    this.query<HTMLElement>("[data-selected-hp]").textContent = `${Math.max(0, Math.ceil(building.hp))}/${building.maxHp}`;
    this.query<HTMLElement>("[data-selected-cell]").textContent = `${building.gx + 1}:${building.gz + 1}`;
    this.query<HTMLElement>("[data-selected-efficiency]").textContent = ["lumber", "quarry", "ironMine", "farm", "wheatFarm"].includes(building.kind)
      ? `${Math.round(building.efficiency * 100)}%`
      : building.kind === "granary" ? "+25% фермам" : "—";
    this.query<HTMLElement>("[data-selected-efficiency]").closest<HTMLElement>(".selected-stat")!.hidden = !["lumber", "quarry", "ironMine", "farm", "wheatFarm", "granary"].includes(building.kind);
    const production = snapshot.economy.production.find(item => item.buildingId === building.id);
    const productionPanel = this.query<HTMLElement>("[data-production]");
    const relevantProduction = production && (production.workersNeeded > 0 || Object.keys(production.inputs).length > 0 || Object.keys(production.outputs).length > 0);
    productionPanel.hidden = !relevantProduction;
    productionPanel.inert = !relevantProduction;
    if (production && relevantProduction) {
      productionPanel.dataset.status = production.status;
      this.query<HTMLElement>("[data-production-status]").textContent = production.statusLabel;
      const flow = this.productionFlow(building.kind, production, snapshot.timePaused || !snapshot.preparationStarted);
      this.query<HTMLElement>("[data-production-rate]").textContent = flow.label;
      this.query<HTMLElement>("[data-production-workers]").textContent = `Рабочие ${this.formatNumber(production.workersAssigned)}/${production.workersNeeded}`;
      this.setMarkup(this.query<HTMLElement>("[data-production-input]"), Object.keys(flow.inputs).length
        ? this.costMarkup(flow.inputs) : '<span class="production-flow__note">Без сырья</span>');
      this.setMarkup(this.query<HTMLElement>("[data-production-output]"), Object.keys(flow.outputs).length
        ? this.costMarkup(flow.outputs) : `<span class="production-flow__note">${building.kind === "tower" ? "Защита города" : building.kind === "mill" ? "Помол для пекарен" : building.kind === "market" ? "Караванный обмен" : "Поддержка поселения"}</span>`);
      this.query<HTMLElement>("[data-production-bonus]").textContent = production.bonusLabel;
      const capacity = flow.capacityKeys;
      this.query<HTMLElement>("[data-production-capacity]").textContent = capacity.length
        ? `На складе: ${capacity.map(key => `${resourceNames[key]} ${Math.floor(snapshot.resources[key])}/${snapshot.economy.storageCapacity[key]}${snapshot.economy.storageRemaining[key] <= 0.01 ? " · склад полон" : ""}`).join(" · ")}` : "";
      const enable = this.query<HTMLButtonElement>("[data-production-toggle]");
      enable.dataset.selectedId = String(building.id);
      enable.dataset.enabled = String(production.enabled);
      enable.textContent = production.enabled ? "Приостановить" : "Запустить";
      enable.setAttribute("aria-label", production.enabled ? "Приостановить производство" : "Запустить производство");
      const priority = this.query<HTMLButtonElement>("[data-production-priority]");
      priority.dataset.selectedId = String(building.id);
      priority.dataset.priority = production.priority;
      priority.textContent = `Приоритет: ${{ low: "низкий", normal: "обычный", high: "высокий" }[production.priority]}`;
    }
    const towerPanel = this.query<HTMLElement>("[data-tower-upgrades]");
    const towerPanelVisible = building.kind === "tower";
    towerPanel.hidden = !towerPanelVisible;
    towerPanel.inert = !towerPanelVisible;
    if (towerPanelVisible) {
      const currentUpgrade = building.towerUpgrade ?? "none";
      const stationedArchers = snapshot.army.filter((unit) => unit.kind === "archer" && unit.garrison?.buildingId === building.id).length;
      const status = this.query<HTMLElement>("[data-tower-upgrade-status]");
      status.textContent = currentUpgrade === "none"
        ? stationedArchers > 0 ? `Без модуля · лучников ${stationedArchers}` : "Без модуля · башня не стреляет"
        : `${TOWER_UPGRADES[currentUpgrade].name} · ${!building.enabled ? "модуль отключён" : snapshot.timePaused ? "время стоит" : building.cooldown > 0 ? `перезарядка ${Math.ceil(building.cooldown)} с` : "готова к стрельбе"}`;
      status.dataset.tone = currentUpgrade === "none" && stationedArchers === 0 ? "waiting" : "ready";
      for (const button of towerPanel.querySelectorAll<HTMLButtonElement>("[data-tower-upgrade]")) {
        const upgrade = button.dataset.towerUpgrade as Exclude<TowerUpgradeKind, "none">;
        const definition = TOWER_UPGRADES[upgrade];
        const installed = currentUpgrade === upgrade;
        const affordable = this.canAfford(snapshot, definition.cost);
        const choiceMade = currentUpgrade !== "none";
        const blocked = actionPaused || enemyBlocksBuildingAction || !affordable || choiceMade;
        button.dataset.selectedId = String(building.id);
        button.classList.toggle("is-installed", installed);
        button.disabled = blocked;
        button.setAttribute("aria-pressed", String(installed));
        const targetLabel = definition.targets === "personnel" ? "только по бойцам" : "только по осадным машинам";
        const actionLabel = installed ? "Установлено" : choiceMade ? "Выбор сделан" : "Установить";
        this.setMarkup(button, `<span>${icon(upgrade === "light" ? "bow" : "catapult")}<b>${this.escape(definition.name)}</b></span><small>${this.escape(targetLabel)} · дальность ${this.formatNumber(definition.range)}</small><span class="cost-list">${this.costMarkup(definition.cost)}</span><em>${actionLabel}</em>`);
        button.title = choiceMade && !installed ? "На этой башне модуль уже выбран"
          : enemyBlocksBuildingAction ? "Противник находится в пределах 5 клеток"
          : actionPaused ? "Сначала завершите планирование или снимите паузу"
            : !affordable ? "Не хватает запасов" : `${definition.description} ${actionLabel}.`;
      }
    }
    const demolish = this.query<HTMLButtonElement>("[data-demolish]");
    demolish.hidden = building.kind === "keep";
    demolish.disabled = building.kind === "keep" || actionPaused || stationed > 0;
    demolish.title = stationed > 0
      ? "Сначала спустите гарнизон"
      : actionPaused ? "Сначала завершите планирование или снимите паузу" : "Вернуть часть начальных ресурсов";
    demolish.dataset.selectedId = String(building.id);
    const repair = this.query<HTMLButtonElement>("[data-repair]");
    const repairing = (building.repairRemaining ?? 0) > 0;
    repair.disabled = repairing || building.hp >= building.maxHp || actionPaused || enemyBlocksBuildingAction;
    repair.textContent = repairing ? `Ремонт · ${Math.round(building.hp / building.maxHp * 100)}%` : "Ремонт";
    repair.setAttribute("aria-label", repairing ? `Ремонт, прочность ${Math.round(building.hp / building.maxHp * 100)} процентов, осталось восстановить ${Math.ceil(building.repairRemaining!)} здоровья` : "Ремонт");
    repair.title = enemyBlocksBuildingAction ? "Противник находится в пределах 5 клеток"
      : actionPaused ? "Сначала завершите планирование или снимите паузу" : repairing ? `Ремонт продолжается · осталось ${Math.ceil(building.repairRemaining!)} здоровья` : "";
    repair.dataset.selectedId = String(building.id);

    const military = this.query<HTMLElement>("[data-military-actions]");
    const units = Object.values(ARMY_UNITS).filter((candidate) => candidate.trainedAt === building.kind);
    military.hidden = units.length === 0;
    military.inert = units.length === 0;
    const queue = building.trainingQueue ?? [];
    this.setMarkup(this.query<HTMLElement>("[data-training-queue]"), queue.length ? `<b>Очередь ${queue.length}/5${snapshot.timePaused ? " · время стоит" : ""}</b>${queue.map((entry, index) => `<div><span>${ARMY_UNITS[entry.kind].name} · ${Math.ceil(entry.remaining)} с</span><button type="button" data-cancel-training="${index}" data-building-id="${building.id}" aria-label="Отменить ${ARMY_UNITS[entry.kind].name}" ${this.actions.cancelTraining ? "" : "disabled"}>Отмена</button></div>`).join("")}` : "");
    for (const button of military.querySelectorAll<HTMLButtonElement>("[data-train]")) {
      const unit = ARMY_UNITS[button.dataset.unitKind as ArmyUnitKind];
      button.hidden = unit.trainedAt !== building.kind;
      button.dataset.selectedId = String(building.id);
      const cooldown = Math.ceil(building.cooldown);
      const crew = unit.populationCost ?? 1;
      const queueBlock = this.queueBlockReason(snapshot, building, unit.kind);
      const reason = this.actions.enqueueUnit ? (queueBlock ?? "В очередь · ресурсы резервируются") : actionPaused ? "Планирование: время стоит" : cooldown > 0 ? `${snapshot.preparationStarted ? "готовность" : "после старта"} ${cooldown} с` : snapshot.freeWorkers < crew ? `Нужно свободных жителей: ${crew}` : snapshot.armyCount >= 24 ? "Гарнизон укомплектован" : !this.canAfford(snapshot, unit.cost) ? "Не хватает запасов" : `${unit.unitClass === "siege" ? "Собрать" : "Обучить"} · ${crew === 1 ? "1 житель" : `экипаж ${crew}`}`;
      this.setMarkup(button, `<span class="unit-train-button__identity">${icon(armyIcons[unit.kind])}<b>${unit.name}</b></span><small class="cost-list">${this.costMarkup(unit.cost)}</small>${unit.unitClass === "siege" ? `<small class="unit-train-button__role">Осадная машина · экипаж ${crew}</small>` : ""}<em>${reason}</em>`);
      button.disabled = this.actions.enqueueUnit ? queueBlock !== null : actionPaused || cooldown > 0 || snapshot.freeWorkers < crew || !this.canAfford(snapshot, unit.cost) || snapshot.armyCount >= 24;
      button.title = `${unit.description}. ${reason}`;
    }

    const market = this.query<HTMLElement>("[data-market-actions]");
    market.hidden = building.kind !== "market";
    market.inert = building.kind !== "market";
    const marketStatus = this.query<HTMLElement>("[data-market-status]");
    marketStatus.textContent = building.cooldown > 0 ? `караван: ${Math.ceil(building.cooldown)} с` : "караван готов";
    marketStatus.dataset.tone = building.cooldown > 0 ? "waiting" : "ready";
    for (const button of market.querySelectorAll<HTMLButtonElement>("[data-trade]")) {
      button.dataset.selectedId = String(building.id);
      const key = button.dataset.resource as StockpiledResourceKey;
      const rate = TRADE_RATES[key];
      const buying = button.dataset.trade === "buy";
      const permitted = buying
        ? snapshot.resources.gold >= rate.buy && snapshot.economy.storageRemaining[key] >= rate.lot
        : snapshot.resources[key] >= rate.lot;
      button.disabled = actionPaused || building.cooldown > 0 || !permitted;
      button.title = actionPaused
        ? "Сначала завершите планирование или снимите паузу"
        : building.cooldown > 0 ? `Караван вернётся через ${Math.ceil(building.cooldown)} сек.` : !permitted ? "Не хватает запасов или места на складе" : "";
    }
  }

  private renderArmyControl(snapshot: GameSnapshot): void {
    const selected = snapshot.selectedArmyUnitIds
      .map((id) => snapshot.army.find((unit) => unit.id === id))
      .filter((unit): unit is ArmyUnitState => Boolean(unit));
    const selectedCivilian = snapshot.selectedCivilianId === null
      ? null
      : snapshot.civilianEntities.find((civilian) => civilian.id === snapshot.selectedCivilianId) ?? null;
    const controlledArmy = snapshot.directControl?.entityKind === "army"
      ? snapshot.army.find((unit) => unit.id === snapshot.directControl?.entityId) ?? null
      : null;
    const controlledCivilian = snapshot.directControl?.entityKind === "civilian"
      ? snapshot.civilianEntities.find((civilian) => civilian.id === snapshot.directControl?.entityId) ?? null
      : null;
    const direct = controlledArmy !== null || controlledCivilian !== null;
    const hasSelection = selected.length > 0 || selectedCivilian !== null;
    const wasDirect = this.root.classList.contains("is-direct-control");
    this.query<HTMLElement>("[data-army-hold]").hidden = !selected.length || !this.actions.holdArmy;
    this.query<HTMLElement>("[data-army-attack-move]").hidden = !selected.length || !this.actions.beginAttackMove;
    this.root.classList.toggle("has-army-selection", hasSelection && !direct);
    this.root.classList.toggle("has-civilian-selection", selectedCivilian !== null && !direct);
    this.root.classList.toggle("is-direct-control", direct);
    this.root.classList.toggle("is-civilian-control", controlledCivilian !== null);
    this.setSurfaceVisible(this.query<HTMLElement>("[data-army-command-panel]"), hasSelection && !direct);
    this.setSurfaceVisible(this.query<HTMLElement>("[data-direct-control-hud]"), direct);
    if (direct) {
      this.setObjectiveCollapsed(true);
      if (!wasDirect) this.query<HTMLElement>("[data-toasts]").replaceChildren();
    }
    else if (wasDirect) {
      this.joystickPointerId = null;
      this.directSprintPointerId = null;
      this.directSprintHeld = false;
      this.directJoystickAxes = { strafe: 0, forward: 0, magnitude: 0 };
      const joystick = this.query<HTMLElement>("[data-direct-joystick]");
      joystick.dataset.direction = "idle";
      this.query<HTMLElement>("[data-direct-joystick-knob]").style.transform = "translate(0, 0)";
      const sprint = this.query<HTMLButtonElement>("[data-direct-sprint]");
      sprint.setAttribute("aria-pressed", "false");
      sprint.classList.remove("is-active");
      this.actions.setDirectMovement(0, 0, false);
    }

    if (selected.length > 0 && !direct) {
      const primary = selected[0];
      const definition = ARMY_UNITS[primary.kind];
      const totalHp = selected.reduce((sum, unit) => sum + Math.max(0, unit.hp), 0);
      const totalMaxHp = selected.reduce((sum, unit) => sum + unit.maxHp, 0);
      const kinds = new Set(selected.map((unit) => unit.kind));
      const garrisoned = selected.filter((unit) => unit.garrison);
      this.setMarkup(this.query<HTMLElement>("[data-army-command-icon]"), icon(kinds.size === 1 ? armyIcons[primary.kind] : "shield"));
      this.query<HTMLElement>("[data-army-command-name]").textContent = selected.length === 1 ? definition.name : `Отряд · ${selected.length}`;
      const primaryPosition = primary.garrison
        ? primary.garrison.status === "stationed"
          ? primary.garrison.buildingKind === "tower" ? "В башне" : "На стене"
          : primary.garrison.status === "approaching" ? "Идёт к укреплению"
            : primary.garrison.status === "mounting" ? "Поднимается"
              : "Спускается"
        : null;
      this.query<HTMLElement>("[data-army-command-type]").textContent = selected.length === 1 && primaryPosition
        ? `${primaryPosition} · ${definition.description}`
        : garrisoned.length > 0
          ? `На укреплениях ${garrisoned.length}/${selected.length} · ${kinds.size} типа бойцов`
          : kinds.size === 1 ? definition.description : `${kinds.size} типа бойцов · строй сохраняется`;
      this.query<HTMLElement>("[data-army-command-health]").style.setProperty("--health", `${totalMaxHp > 0 ? totalHp / totalMaxHp * 100 : 0}%`);
      this.query<HTMLElement>("[data-army-command-hp]").textContent = `${Math.ceil(totalHp)}/${totalMaxHp}`;
      const directButton = this.query<HTMLButtonElement>("[data-army-direct]");
      const siegeSelected = definition.unitClass === "siege";
      directButton.dataset.entityKind = "army";
      directButton.dataset.entityId = String(primary.id);
      directButton.hidden = siegeSelected;
      directButton.disabled = siegeSelected || snapshot.timePaused || snapshot.status !== "playing";
      directButton.title = siegeSelected ? "Осадные машины управляются только приказами на карте"
        : snapshot.timePaused ? "Сначала запустите время или снимите паузу" : `Камера за спиной: ${definition.name.toLowerCase()}`;
      const orderButton = this.query<HTMLButtonElement>("[data-army-order]");
      orderButton.hidden = false;
      orderButton.disabled = snapshot.status !== "playing" && snapshot.status !== "paused";
      this.query<HTMLElement>("[data-army-command-hint]").textContent = siegeSelected
        ? this.isMobileLayout() ? "«Отдать приказ» → выберите вражескую постройку" : "ПКМ по вражеской постройке — осада · вид за спиной недоступен"
        : this.isMobileLayout()
          ? "Приказ → клетка, стена или башня · конница остаётся внизу"
          : "ПКМ — идти или занять стену/башню · Shift+ПКМ — бой по пути · Enter — за спину";
    } else if (selectedCivilian && !direct) {
      const role = civilianRole(selectedCivilian);
      this.setMarkup(this.query<HTMLElement>("[data-army-command-icon]"), icon("population"));
      this.query<HTMLElement>("[data-army-command-name]").textContent = role.name;
      this.query<HTMLElement>("[data-army-command-type]").textContent = `${role.assignment} · после управления продолжит работу`;
      this.query<HTMLElement>("[data-army-command-health]").style.setProperty("--health", `${Math.max(0, selectedCivilian.hp / selectedCivilian.maxHp) * 100}%`);
      this.query<HTMLElement>("[data-army-command-hp]").textContent = `${Math.ceil(Math.max(0, selectedCivilian.hp))}/${selectedCivilian.maxHp}`;
      const directButton = this.query<HTMLButtonElement>("[data-army-direct]");
      directButton.hidden = false;
      directButton.dataset.entityKind = "civilian";
      directButton.dataset.entityId = String(selectedCivilian.id);
      directButton.disabled = snapshot.timePaused || snapshot.status !== "playing";
      directButton.title = snapshot.timePaused ? "Сначала запустите время или снимите паузу" : `Управлять: ${role.name.toLowerCase()}`;
      const orderButton = this.query<HTMLButtonElement>("[data-army-order]");
      orderButton.hidden = true;
      orderButton.disabled = true;
      this.query<HTMLElement>("[data-army-command-hint]").textContent = "Двойное нажатие тоже включает вид за спиной. После выхода работа возобновится.";
    }

    if (!direct) {
      this.root.classList.remove("is-direct-dancing", "is-garrison-control");
      return;
    }
    const weaponLabel: Record<ArmyUnitKind, string> = {
      archer: "Лук · дальний выстрел",
      spearman: "Копьё · колющий удар",
      swordsman: "Меч · рубящий удар",
      knight: "Конная пика · натиск",
      catapult: "Камни · только тактическое управление",
      batteringRam: "Таран · только тактическое управление",
    };
    const attack = this.query<HTMLButtonElement>("[data-direct-attack]");
    const danceButtons = [...this.root.querySelectorAll<HTMLButtonElement>("[data-direct-dance]")];
    const mountButtons = [...this.root.querySelectorAll<HTMLButtonElement>("[data-direct-mount]")];
    const dismountButtons = [...this.root.querySelectorAll<HTMLButtonElement>("[data-direct-dismount]")];
    const sprint = this.query<HTMLButtonElement>("[data-direct-sprint]");
    const joystick = this.query<HTMLElement>("[data-direct-joystick]");
    const crosshair = this.query<HTMLElement>(".direct-crosshair");
    const dancing = Boolean(snapshot.directControl?.dancing);
    const onFortification = Boolean(controlledArmy?.garrison);
    const changingFortification = Boolean(controlledArmy?.garrison && controlledArmy.garrison.status !== "stationed");
    const mountTarget = snapshot.directControl?.mountTarget ?? null;
    this.root.classList.toggle("is-direct-dancing", dancing);
    this.root.classList.toggle("is-garrison-control", onFortification);
    for (const dance of danceButtons) {
      dance.hidden = Boolean(mountTarget) && dance.classList.contains("direct-emote");
      dance.disabled = snapshot.timePaused || changingFortification;
      dance.classList.toggle("is-active", dancing);
      dance.setAttribute("aria-pressed", String(dancing));
      this.setMarkup(dance, `${icon("dance")}<span>${dancing ? "Стоп" : "Танец"}${dance.classList.contains("desktop-copy") ? " · V" : ""}</span>`);
    }
    for (const mount of mountButtons) {
      const targetLabel = mountTarget?.buildingKind === "tower" ? "На башню" : "На стену";
      const wasFocused = document.activeElement === mount;
      mount.hidden = mountTarget === null;
      mount.disabled = snapshot.timePaused || mountTarget === null;
      mount.dataset.buildingId = mountTarget ? String(mountTarget.buildingId) : "";
      mount.setAttribute("aria-label", mountTarget?.buildingKind === "tower"
        ? "Подняться на ближайшую башню"
        : "Подняться на ближайшую стену");
      this.setMarkup(mount, `${icon("up")}<span>${mount.classList.contains("desktop-copy") ? `${targetLabel} · E` : targetLabel.toUpperCase()}</span>`);
      if (mount.hidden && wasFocused) this.query<HTMLButtonElement>("[data-direct-exit]").focus({ preventScroll: true });
    }
    for (const dismount of dismountButtons) {
      dismount.hidden = !onFortification;
      dismount.disabled = snapshot.timePaused || controlledArmy?.garrison?.status === "approaching" || controlledArmy?.garrison?.status === "dismounting";
    }
    sprint.hidden = onFortification;
    sprint.disabled = onFortification;
    joystick.classList.toggle("is-locked", changingFortification);
    joystick.setAttribute("aria-disabled", String(changingFortification));
    if (controlledCivilian) {
      const role = civilianRole(controlledCivilian);
      this.setMarkup(this.query<HTMLElement>("[data-direct-icon]"), icon("population"));
      this.query<HTMLElement>("[data-direct-name]").textContent = role.name;
      this.query<HTMLElement>("[data-direct-weapon]").textContent = dancing ? "Танец · маршрут сохранён" : `${role.assignment} · маршрут сохранён`;
      this.query<HTMLElement>("[data-direct-health]").style.setProperty("--health", `${Math.max(0, controlledCivilian.hp / controlledCivilian.maxHp) * 100}%`);
      this.query<HTMLElement>("[data-direct-hp]").textContent = `${Math.ceil(Math.max(0, controlledCivilian.hp))}/${controlledCivilian.maxHp}`;
      attack.hidden = true;
      attack.disabled = true;
      crosshair.hidden = true;
      this.query<HTMLElement>("[data-direct-desktop-hint]").textContent = "WASD — движение · Shift — бег · V — танец · мышь — обзор · Esc — к карте · после выхода работа продолжится";
      return;
    }

    if (!controlledArmy) return;
    const definition = ARMY_UNITS[controlledArmy.kind];
    this.setMarkup(this.query<HTMLElement>("[data-direct-icon]"), icon(armyIcons[controlledArmy.kind]));
    this.query<HTMLElement>("[data-direct-name]").textContent = definition.name;
    const ready = Boolean(snapshot.directControl?.attackReady);
    const cooldown = Math.max(0, controlledArmy.cooldown);
    const positionLabel = controlledArmy.garrison?.status === "stationed"
      ? controlledArmy.garrison.buildingKind === "tower" ? "в башне" : "на стене"
      : controlledArmy.garrison?.status === "mounting" ? "поднимается"
        : controlledArmy.garrison?.status === "dismounting" ? "спускается" : null;
    this.query<HTMLElement>("[data-direct-weapon]").textContent = dancing
      ? `Крепостной танец${positionLabel ? ` · ${positionLabel}` : ""}`
      : controlledArmy.kind === "archer"
        ? `Лук · ${ready ? "выстрел готов" : `натяжение ${cooldown.toFixed(1)} с`}${positionLabel ? ` · ${positionLabel}` : ""}`
        : `${weaponLabel[controlledArmy.kind]} · ${ready ? "готов" : `${cooldown.toFixed(1)} с`}${positionLabel ? ` · ${positionLabel}` : ""}`;
    this.query<HTMLElement>("[data-direct-health]").style.setProperty("--health", `${Math.max(0, controlledArmy.hp / controlledArmy.maxHp) * 100}%`);
    this.query<HTMLElement>("[data-direct-hp]").textContent = `${Math.ceil(Math.max(0, controlledArmy.hp))}/${controlledArmy.maxHp}`;
    this.setMarkup(attack, `${icon(armyIcons[controlledArmy.kind])}<span>${controlledArmy.kind === "archer" ? ready ? "Выстрел" : cooldown.toFixed(1) : ready ? "Удар" : cooldown.toFixed(1)}</span>`);
    attack.hidden = false;
    attack.disabled = snapshot.timePaused || !ready;
    attack.dataset.weapon = controlledArmy.kind;
    attack.setAttribute("aria-label", controlledArmy.kind === "archer" ? "Выстрелить из лука" : "Атаковать");
    crosshair.hidden = false;
    crosshair.dataset.ready = String(ready);
    this.query<HTMLElement>("[data-direct-desktop-hint]").textContent = onFortification
      ? "WASD — по стене · мышь — обзор · ЛКМ/Space — атака · X — спуститься · Esc — к карте"
      : mountTarget
        ? "E — подняться · WASD — движение · мышь — обзор · Space — атака · Esc — к карте"
        : controlledArmy.kind === "archer" || controlledArmy.kind === "spearman"
          ? "WASD — движение · E — подняться у стены/башни · Space — атака · V — танец · Esc — к карте"
          : "WASD — движение · Shift — бег · мышь — обзор · ЛКМ/Space — атака · V — танец · Esc — к карте";
  }

  private bindEvents(): void {
    // WebKit can begin native text selection or a callout before it dispatches
    // the synthetic click. Keeping the HUD non-selectable preserves normal tap
    // activation without moving all accessible button handlers to pointerdown.
    this.root.addEventListener("selectstart", (event) => event.preventDefault());
    this.root.addEventListener("dragstart", (event) => {
      if (event.target instanceof Element && event.target.closest("button")) event.preventDefault();
    });
    this.root.addEventListener("load", event => {
      if (event.target instanceof HTMLImageElement && event.target.matches("[data-building-image]")) event.target.parentElement?.classList.add("has-image");
    }, true);
    this.root.addEventListener("error", event => {
      if (event.target instanceof HTMLImageElement && event.target.matches("[data-building-image]")) event.target.hidden = true;
    }, true);
    this.query<HTMLButtonElement>("[data-start]").addEventListener("click", this.actions.start);
    this.query<HTMLButtonElement>("[data-continue-session]").addEventListener("click", this.actions.continueSession);
    this.query<HTMLButtonElement>("[data-next-mission]").addEventListener("click", () => this.actions.nextMission?.());
    this.query<HTMLButtonElement>("[data-tutorial-raid]").addEventListener("click", () => this.actions.callTutorialRaid?.());
    this.query<HTMLButtonElement>("[data-continue-after-victory]").addEventListener("click", this.actions.continueAfterVictory);
    this.query<HTMLButtonElement>("[data-ready]").addEventListener("click", this.actions.beginPreparation);
    this.query<HTMLButtonElement>("[data-resume]").addEventListener("click", this.actions.pause);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-restart]")) button.addEventListener("click", this.actions.restart);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-campaign]")) button.addEventListener("click", this.actions.campaign);
    this.query<HTMLButtonElement>("[data-pause]").addEventListener("click", this.actions.pause);
    this.query<HTMLButtonElement>("[data-speed]").addEventListener("click", (event) => {
      const next = (event.currentTarget as HTMLButtonElement).textContent === "×1" ? 2 : 1;
      this.actions.setSpeed(next);
    });
    this.query<HTMLButtonElement>("[data-sound]").addEventListener("click", (event) => {
      const enabled = this.actions.toggleSound();
      this.setMarkup(event.currentTarget as HTMLButtonElement, icon(enabled ? "sound" : "muted"));
      (event.currentTarget as HTMLButtonElement).setAttribute("aria-label", enabled ? "Выключить звук" : "Включить звук");
    });
    this.query<HTMLButtonElement>("[data-camera-reset]").addEventListener("click", this.actions.resetCamera);
    this.query<HTMLButtonElement>("[data-mobile-camera-reset]").addEventListener("click", this.actions.resetCamera);
    this.query<HTMLButtonElement>("[data-objective-toggle]").addEventListener("click", () => {
      const collapsed = !this.objectiveCollapsed;
      if (!collapsed && this.isMobileLayout()) {
        this.setEconomyOpen(false);
        this.setBuildDockOpen(false);
        this.setSelectedBuilding(null);
        this.actions.clearSelection();
        this.setCameraToolsOpen(false);
      }
      this.setObjectiveCollapsed(collapsed);
    });
    this.query<HTMLButtonElement>("[data-economy-toggle]").addEventListener("click", () => {
      this.setEconomyOpen(!this.economyOpen);
    });
    this.query<HTMLButtonElement>("[data-economy-close]").addEventListener("click", () => this.setEconomyOpen(false));
    this.query<HTMLButtonElement>("[data-settings-toggle]").addEventListener("click", () => this.setCameraToolsOpen(!this.cameraToolsOpen));
    this.query<HTMLButtonElement>("[data-camera-toggle]").addEventListener("click", () => this.setCameraToolsOpen(!this.cameraToolsOpen));
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-tax-policy]")) {
      button.addEventListener("click", () => this.actions.setTaxPolicy(button.dataset.taxPolicy as TaxPolicy));
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-ration-policy]")) {
      button.addEventListener("click", () => this.actions.setRationPolicy(button.dataset.rationPolicy as RationPolicy));
    }
    this.query<HTMLButtonElement>("[data-hint-dismiss]").addEventListener("click", () => {
      this.query<HTMLElement>("[data-tutorial]").classList.remove("is-visible");
    });
    this.query<HTMLButtonElement>("[data-enemy-close]").addEventListener("click", () => { this.setSelectedEnemyBuilding(null); this.actions.closeEnemySelection?.(); });
    this.query<HTMLButtonElement>("[data-selected-close]").addEventListener("click", () => {
      this.setSelectedBuilding(null);
      this.actions.clearSelection();
    });
    this.query<HTMLButtonElement>("[data-army-hold]").addEventListener("click", () => this.actions.holdArmy?.());
    this.query<HTMLButtonElement>("[data-army-attack-move]").addEventListener("click", () => this.actions.beginAttackMove?.());
    this.query<HTMLElement>("[data-audio-controls]").hidden = !this.actions.setAudioVolume;
    for (const channel of ["effects", "ambient"] as const) {
      const slider = this.query<HTMLInputElement>(`[data-audio-volume="${channel}"]`);
      const value = this.actions.audioVolumes?.[channel] ?? (channel === "effects" ? 0.7 : 0.25);
      const syncLabel = (volume: number) => {
        this.query<HTMLOutputElement>(`[data-audio-readout="${channel}"]`).textContent = `${Math.round(volume * 100)}%`;
        slider.setAttribute("aria-valuetext", `${Math.round(volume * 100)} процентов`);
      };
      slider.value = String(Math.max(0, Math.min(1, value)));
      syncLabel(Number(slider.value));
      slider.addEventListener("input", () => {
        const volume = Number(slider.value);
        if (!Number.isFinite(volume)) return;
        const bounded = Math.max(0, Math.min(1, volume));
        syncLabel(bounded);
        this.actions.setAudioVolume?.(channel, bounded);
      });
    }
    const graphics = this.query<HTMLSelectElement>("[data-graphics-quality]");
    this.query<HTMLElement>("[data-graphics-control]").hidden = !this.actions.setGraphicsQuality;
    graphics.value = this.actions.graphicsQuality ?? "auto";
    graphics.addEventListener("change", () => {
      const quality = graphics.value;
      if (quality === "auto" || quality === "low" || quality === "medium" || quality === "high") this.actions.setGraphicsQuality?.(quality);
    });
    this.query<HTMLElement>("[data-training-queue]").addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-cancel-training]");
      if (button) this.actions.cancelTraining?.(Number(button.dataset.buildingId), Number(button.dataset.cancelTraining));
    });
    this.query<HTMLButtonElement>("[data-army-command-close]").addEventListener("click", () => {
      this.setArmyOrderMode(false);
      this.actions.clearArmySelection();
    });
    this.query<HTMLButtonElement>("[data-army-order]").addEventListener("click", () => {
      this.actions.toggleArmyOrderMode();
    });
    this.query<HTMLButtonElement>("[data-army-direct]").addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const entityId = Number(button.dataset.entityId);
      const entityKind = button.dataset.entityKind as ControllableEntityKind;
      if ((entityKind === "army" || entityKind === "civilian") && Number.isSafeInteger(entityId)) {
        this.actions.enterDirectControl(entityKind, entityId);
      }
    });
    this.query<HTMLButtonElement>("[data-direct-exit]").addEventListener("click", this.actions.exitDirectControl);
    this.query<HTMLButtonElement>("[data-direct-attack]").addEventListener("click", this.actions.directAttack);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-direct-dance]")) button.addEventListener("click", this.actions.directDance);
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-direct-mount]")) {
      button.addEventListener("click", () => {
        const buildingId = Number(button.dataset.buildingId);
        this.actions.directMount(Number.isSafeInteger(buildingId) && buildingId > 0 ? buildingId : undefined);
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-direct-dismount]")) button.addEventListener("click", this.actions.directDismount);
    const joystick = this.query<HTMLElement>("[data-direct-joystick]");
    const updateJoystick = (event: PointerEvent): void => {
      if (event.pointerId !== this.joystickPointerId) return;
      const rect = joystick.getBoundingClientRect();
      const delta = { x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height / 2) };
      const axes = normalizeMobileJoystick(delta, {
        radius: Math.max(24, rect.width * 0.38),
        deadZone: 0.16,
        responseExponent: 1.18,
      });
      this.directJoystickAxes = axes;
      const knob = this.query<HTMLElement>("[data-direct-joystick-knob]");
      knob.style.transform = `translate(${axes.strafe * rect.width * 0.25}px, ${-axes.forward * rect.height * 0.25}px)`;
      joystick.dataset.direction = Math.abs(axes.forward) >= Math.abs(axes.strafe)
        ? axes.forward > 0 ? "forward" : axes.forward < 0 ? "back" : "idle"
        : axes.strafe > 0 ? "right" : "left";
      this.actions.setDirectMovement(axes.strafe, axes.forward, this.directSprintHeld);
    };
    const releaseJoystick = (event: PointerEvent): void => {
      if (event.pointerId !== this.joystickPointerId) return;
      this.joystickPointerId = null;
      this.directJoystickAxes = { strafe: 0, forward: 0, magnitude: 0 };
      joystick.dataset.direction = "idle";
      this.query<HTMLElement>("[data-direct-joystick-knob]").style.transform = "translate(0, 0)";
      this.actions.setDirectMovement(0, 0, this.directSprintHeld);
    };
    joystick.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.joystickPointerId = event.pointerId;
      joystick.setPointerCapture(event.pointerId);
      updateJoystick(event);
    });
    joystick.addEventListener("pointermove", updateJoystick);
    joystick.addEventListener("pointerup", releaseJoystick);
    joystick.addEventListener("pointercancel", releaseJoystick);
    const sprint = this.query<HTMLButtonElement>("[data-direct-sprint]");
    const setSprint = (pressed: boolean): void => {
      this.directSprintHeld = pressed;
      sprint.setAttribute("aria-pressed", String(pressed));
      sprint.classList.toggle("is-active", pressed);
      this.actions.setDirectMovement(this.directJoystickAxes.strafe, this.directJoystickAxes.forward, pressed);
    };
    sprint.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.directSprintPointerId = event.pointerId;
      sprint.setPointerCapture(event.pointerId);
      setSprint(true);
    });
    const releaseSprint = (event: PointerEvent): void => {
      if (event.pointerId !== this.directSprintPointerId) return;
      this.directSprintPointerId = null;
      setSprint(false);
    };
    sprint.addEventListener("pointerup", releaseSprint);
    sprint.addEventListener("pointercancel", releaseSprint);
    sprint.addEventListener("click", (event) => {
      // Pointer input uses press-and-hold. Keyboard and assistive activation
      // dispatch an untrusted/detail=0 click, which toggles an equivalent mode.
      if (event.detail === 0) setSprint(!this.directSprintHeld);
    });
    this.query<HTMLButtonElement>("[data-demolish]").addEventListener("click", (event) => {
      const id = Number((event.currentTarget as HTMLButtonElement).dataset.selectedId);
      if (Number.isFinite(id)) this.actions.demolish(id);
    });
    this.query<HTMLButtonElement>("[data-repair]").addEventListener("click", (event) => {
      const id = Number((event.currentTarget as HTMLButtonElement).dataset.selectedId);
      if (Number.isFinite(id)) this.actions.repair(id);
    });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-tower-upgrade]")) {
      button.addEventListener("click", () => {
        const id = Number(button.dataset.selectedId);
        const upgrade = button.dataset.towerUpgrade as Exclude<TowerUpgradeKind, "none">;
        if (Number.isFinite(id) && (upgrade === "light" || upgrade === "heavy")) this.actions.upgradeTower(id, upgrade);
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-train]")) {
      button.addEventListener("click", () => {
        (this.actions.enqueueUnit ?? this.actions.train)(button.dataset.unitKind as ArmyUnitKind, Number(button.dataset.selectedId));
      });
    }
    this.query<HTMLButtonElement>("[data-production-toggle]").addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      this.actions.setBuildingEnabled(Number(button.dataset.selectedId), button.dataset.enabled !== "true");
    });
    this.query<HTMLButtonElement>("[data-production-priority]").addEventListener("click", (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      const next: Record<WorkPriority, WorkPriority> = { low: "normal", normal: "high", high: "low" };
      this.actions.setBuildingPriority(Number(button.dataset.selectedId), next[button.dataset.priority as WorkPriority]);
    });
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-trade]")) {
      button.addEventListener("click", () => this.actions.trade(
        Number(button.dataset.selectedId),
        button.dataset.resource as StockpiledResourceKey,
        button.dataset.trade as "buy" | "sell",
      ));
    }

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-mission]")) {
      button.addEventListener("click", () => this.actions.selectMission(button.dataset.mission as MissionId));
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-difficulty]")) {
      button.addEventListener("click", () => this.actions.selectDifficulty(button.dataset.difficulty as DifficultyId));
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-build-category]")) {
      button.addEventListener("click", () => this.applyBuildCategory(button.dataset.buildCategory as "all" | BuildingCategory));
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-build]")) {
      button.addEventListener("click", () => {
        const kind = button.dataset.build as BuildingKind;
        const next = this.selectedKind === kind ? null : kind;
        this.setBuildSelection(next);
        this.actions.selectBuild(next);
        if (next && this.isMobileLayout()) this.setBuildDockOpen(false);
      });
    }

    this.query<HTMLButtonElement>("[data-mobile-build]").addEventListener("click", () => this.toggleBuildMenu());
    this.query<HTMLButtonElement>("[data-desktop-build-toggle]").addEventListener("click", () => this.toggleBuildMenu());
    this.query<HTMLButtonElement>("[data-build-close]").addEventListener("click", () => this.setBuildDockOpen(false));
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-build-scroll]")) {
      button.addEventListener("click", () => this.query<HTMLElement>(".build-dock__items").scrollBy({ left: Number(button.dataset.buildScroll) * 300, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
    }
    this.query<HTMLButtonElement>("[data-placement-confirm]").addEventListener("click", this.actions.confirmPlacement);
    this.query<HTMLButtonElement>("[data-placement-cancel]").addEventListener("click", this.actions.cancelPlacement);

    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-pan-x]")) {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.actions.pan(Number(button.dataset.panX), Number(button.dataset.panZ));
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-rotate-left]")) {
      button.addEventListener("click", () => this.actions.rotate(-Math.PI / 4));
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-rotate-right]")) {
      button.addEventListener("click", () => this.actions.rotate(Math.PI / 4));
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-top-view]")) {
      button.addEventListener("click", () => {
        const active = this.actions.toggleTopView();
        this.setTopViewState(active);
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-focus-castle]")) {
      button.addEventListener("click", () => {
        const side = button.dataset.focusCastle as "player" | "enemy" | "all";
        if (side === "player" || side === "enemy" || side === "all") this.actions.focusCastle(side);
      });
    }
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-rally]")) {
      button.addEventListener("click", this.actions.setRallyMode);
    }
    this.query<HTMLButtonElement>("[data-zoom-in]").addEventListener("click", () => this.actions.zoom(-3));
    this.query<HTMLButtonElement>("[data-zoom-out]").addEventListener("click", () => this.actions.zoom(3));
    for (const overlay of this.root.querySelectorAll<HTMLElement>(".game-overlay")) {
      overlay.addEventListener("keydown", (event) => {
        if (event.key !== "Tab") return;
        const buttons = [...overlay.querySelectorAll<HTMLElement>("button:not(:disabled), summary, [tabindex='0']")]
          .filter(button => !button.hidden && !button.closest("[inert]") && button.getClientRects().length > 0);
        const first = buttons[0];
        const last = buttons.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      });
    }
  }

  private showHint(): void {
    this.query<HTMLElement>("[data-tutorial]").classList.add("is-visible");
  }

  private setBuildDockOpen(open: boolean): void {
    if (open) {
      this.setEconomyOpen(false);
      this.setSelectedBuilding(null);
      this.actions.clearSelection();
    }
    if (open && this.isMobileLayout()) {
      if (this.selectedKind) this.actions.cancelPlacement();
      this.setObjectiveCollapsed(true);
      this.setCameraToolsOpen(false);
    }
    this.buildDockOpen = open;
    this.setSurfaceVisible(this.query<HTMLElement>("[data-build-dock]"), open);
    this.query<HTMLElement>("[data-mobile-build]").classList.toggle("is-active", open);
    const desktopToggle = this.query<HTMLButtonElement>("[data-desktop-build-toggle]");
    desktopToggle.classList.toggle("is-active", open);
    this.setMarkup(desktopToggle, open ? `${icon("chevron")}<span>Скрыть панель</span>` : `${icon("build")}<span>Строительство</span><kbd>B</kbd>`);
    desktopToggle.setAttribute("aria-expanded", String(open));
    this.query<HTMLButtonElement>("[data-mobile-build]").setAttribute("aria-expanded", String(open));
    this.root.classList.toggle("is-menu-open", open);
    this.actions.setBuildMenuOpen(open && this.isMobileLayout());
    this.syncMobileSurfaceState();
  }

  private setCameraToolsOpen(open: boolean): void {
    if (open && this.isMobileLayout()) {
      this.setBuildDockOpen(false);
      this.setEconomyOpen(false);
      this.setSelectedBuilding(null);
      this.actions.clearSelection();
      this.setObjectiveCollapsed(true);
    }
    this.cameraToolsOpen = open;
    this.query<HTMLButtonElement>("[data-settings-toggle]").setAttribute("aria-expanded", String(open));
    this.setSurfaceVisible(this.query<HTMLElement>("[data-camera-tools]"), open);
    this.query<HTMLButtonElement>("[data-camera-toggle]").setAttribute("aria-expanded", String(open));
    this.query<HTMLButtonElement>("[data-camera-toggle]").classList.toggle("is-active", open);
  }

  private syncMobileSurfaceState(): void {
    const controls = this.query<HTMLElement>(".mobile-controls");
    const hideControls = this.isMobileLayout() && this.selectedKind !== null;
    controls.classList.toggle("is-hidden", hideControls);
    controls.inert = hideControls;
  }

  private setObjectiveCollapsed(collapsed: boolean): void {
    this.objectiveCollapsed = collapsed;
    this.query<HTMLElement>(".objective-card").classList.toggle("is-collapsed", collapsed);
    const toggle = this.query<HTMLButtonElement>("[data-objective-toggle]");
    this.setMarkup(toggle, `${icon("chevron")}<span class="objective-card__toggle-label">${collapsed ? "Задача" : "Свернуть"}</span>`);
    toggle.classList.toggle("is-up", !collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Развернуть задачу" : "Свернуть задачу");
    const details = this.query<HTMLElement>("[data-objective-details]");
    details.hidden = collapsed;
    details.inert = collapsed;
  }

  private setSurfaceVisible(surface: HTMLElement, visible: boolean): void {
    surface.hidden = !visible;
    surface.inert = !visible;
    surface.classList.toggle("is-open", visible);
  }

  private applyBuildCategory(category: "all" | BuildingCategory): void {
    this.query<HTMLElement>("[data-build-dock]").dataset.category = category;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>("[data-build-category]")) {
      const active = button.dataset.buildCategory === category;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    }
    for (const card of this.root.querySelectorAll<HTMLElement>("[data-build]")) {
      this.syncBuildCardVisibility(card, category);
    }
    const label = BUILD_CATEGORIES.find((item) => item.id === category)?.label ?? "Все";
    this.query<HTMLElement>("[data-build-title]").textContent = category === "all" ? "Постройки" : label;
    this.query<HTMLElement>(".build-dock__items").scrollLeft = 0;
  }

  private syncBuildCardVisibility(card: HTMLElement, category?: "all" | BuildingCategory): void {
    const activeCategory = category ?? (this.query<HTMLElement>("[data-build-dock]").dataset.category as "all" | BuildingCategory | undefined) ?? "all";
    const outsideCategory = activeCategory !== "all" && card.dataset.category !== activeCategory;
    const missionLocked = card.dataset.build === "siegeWorkshop" && !this.duelMission;
    card.hidden = outsideCategory || missionLocked;
  }

  private setTutorialCopy(building: boolean): void {
    const key = this.query<HTMLElement>("[data-tutorial-key]");
    const text = this.query<HTMLElement>("[data-tutorial-text]");
    if (this.isMobileLayout()) {
      key.textContent = "TOUCH";
      text.textContent = building
        ? "Коснитесь клетки, затем подтвердите стройку. Щипок — масштаб."
        : "Тяните карту, щипком меняйте масштаб, кнопками вращайте и включайте вид сверху.";
    } else {
      key.textContent = "WASD";
      text.textContent = building
        ? "Выберите клетку. Esc отменяет стройку."
        : "ЛКМ — карта, ПКМ/средняя — вращение, Q/E, T — вид сверху, B — стройка.";
    }
  }

  private updateMissionCards(id: MissionId): void {
    for (const card of this.root.querySelectorAll<HTMLButtonElement>("[data-mission]")) {
      const selected = card.dataset.mission === id;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    }
  }

  private canAfford(snapshot: GameSnapshot, cost: Partial<Record<ResourceKey, number>>): boolean {
    return (Object.entries(cost) as Array<[ResourceKey, number]>).every(([key, value]) => snapshot.resources[key] >= value);
  }

  private categoryLabel(category: BuildingCategory): string {
    return ({ economy: "Хозяйство", fortress: "Укрепления", military: "Армия" } as const)[category];
  }

  private costMarkup(cost: Partial<Record<ResourceKey, number>>): string {
    return (Object.entries(cost) as Array<[ResourceKey, number]>).filter(([, value]) => value > 0)
      .map(([key, value]) => `<span class="resource-cost" title="${this.formatNumber(value)} ${resourceQuantityNames[key]}">${icon(key)}<b>${this.formatNumber(value)}</b><span class="ui-sr-only"> ${resourceQuantityNames[key]}</span></span>`).join("") || '<span class="cost-free">Без затрат</span>';
  }

  private waveLabel(count: number): string {
    const ending = count % 100 >= 11 && count % 100 <= 14 ? "волн" : count % 10 === 1 ? "волна" : count % 10 >= 2 && count % 10 <= 4 ? "волны" : "волн";
    return `${count} ${ending}`;
  }

  private formatTime(seconds: number): string {
    if (!Number.isFinite(seconds)) return "∞";
    const safe = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
  }

  private formatNumber(value: number): string {
    if (Number.isInteger(value)) return String(value);
    return (Math.abs(value) < 0.1 ? value.toFixed(2) : value.toFixed(1)).replace(".", ",");
  }

  private formatMultiplier(value: number): string {
    return value.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
  }

  private formatSigned(value: number): string {
    if (Math.abs(value) < 0.005) return "±0";
    return `${value > 0 ? "+" : "−"}${this.formatNumber(Math.abs(value))}`;
  }

  private isMobileLayout(): boolean {
    return this.layoutMedia.matches;
  }

  private escape(text: string): string {
    return text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  }

  private setMarkup(element: HTMLElement, markup: string): void {
    // SVG DOM serialization differs from its source. Cache the source to avoid
    // replacing portraits and icon subtrees on every 90ms HUD update.
    if (this.markupCache.get(element) === markup) return;
    element.innerHTML = markup;
    this.markupCache.set(element, markup);
  }

  private template(): string {
    const resources = resourceMeta.map((item) => `
      <div class="resource-chip" data-resource="${item.key}" title="${item.label}">
        <span class="resource-chip__icon">${icon(item.key)}</span>
        <span class="resource-chip__value">0</span>
        <span class="resource-chip__label">${item.label}</span>
        <span class="resource-chip__delta"></span>
      </div>`).join("");
    const buildCards = BUILDABLE_KINDS.map((kind) => {
      const item = BUILDINGS[kind];
      return `<button class="build-card" type="button" data-build="${kind}" data-category="${item.category}" aria-pressed="false" title="${item.description}">
        ${buildingPortrait(kind, "build-card__icon")}
        <span class="build-card__name">${item.shortName}</span>
        <span class="build-card__cost cost-list">${this.costMarkup(item.cost)}</span>
        <span class="build-card__description">${buildingPurpose[kind]}</span>
        ${item.hotkey ? `<kbd class="build-card__hotkey">${item.hotkey}</kbd>` : ""}
      </button>`;
    }).join("");
    const categoryIcons: Record<string, UIIcon> = { all: "build", economy: "grain", fortress: "castle", military: "shield" };
    const categories = BUILD_CATEGORIES.map((category) => `<button class="build-category${category.id === "all" ? " is-active" : ""}" type="button" role="tab" data-build-category="${category.id}" aria-selected="${category.id === "all"}">${icon(categoryIcons[category.id])}<span>${category.label}</span></button>`).join("");
    const missions = MISSION_LIST.map((mission, index) => `<button class="journey-stop${mission.id === "oasis" ? " is-selected" : ""}${index === 5 ? " journey-stop--final" : ""}" type="button" data-mission="${mission.id}" aria-pressed="${mission.id === "oasis"}" style="--column:${index < 3 ? index : 5 - index};--row:${index < 3 ? 0 : 1}">
      <span class="journey-stop__art">${campaignLandmark(mission.theme)}</span>
      <span class="journey-stop__number">${String(mission.order).padStart(2, "0")}</span>
      <strong>${mission.name}</strong><small>${index === 0 ? "Первый оазис" : index === 1 ? "Караванный путь" : index === 2 ? "Город под осадой" : index === 3 ? "Битва за переправы" : index === 4 ? "Забытое царство" : "Последняя осада"}</small>
    </button>`).join("");
    const difficulties = DIFFICULTY_LIST.map(difficulty => `<button class="difficulty-button" type="button" data-difficulty="${difficulty.id}" aria-pressed="${difficulty.id === "standard"}">${icon(difficulty.id === "relaxed" ? "leaf" : difficulty.id === "standard" ? "flag" : "shield")}<span>${difficulty.label}</span></button>`).join("");
    const storage = stockKeys.map(key => `<span class="storage-meter" data-storage="${key}"><i></i><small>${icon(key)}<span>${resourceNames[key]}</span></small><b>0/0</b><em data-tone="neutral">±0 / мин</em></span>`).join("");
    const units = Object.values(ARMY_UNITS).map(unit => `<button class="unit-train-button" type="button" data-train data-unit-kind="${unit.kind}"><span>${icon(armyIcons[unit.kind])} ${unit.name}</span></button>`).join("");
    const towerUpgradeButtons = Object.values(TOWER_UPGRADES).map(upgrade => `<button class="tower-upgrade-button" type="button" data-tower-upgrade="${upgrade.kind}" aria-pressed="false"><span>${icon(upgrade.kind === "light" ? "bow" : "catapult")}<b>${upgrade.name}</b></span><small>${upgrade.description}</small><span class="cost-list">${this.costMarkup(upgrade.cost)}</span></button>`).join("");
    const trades = stockKeys.map(key => {
      const rate = TRADE_RATES[key];
      return `<div class="market-row"><span>${icon(key)}<span>${resourceNames[key]}<small>партия ${rate.lot}</small></span></span><button type="button" data-trade="sell" data-resource="${key}" aria-label="Продать ${rate.lot} ${resourceNames[key]} за ${rate.sell} золота">+${rate.sell}${icon("gold")}</button><button type="button" data-trade="buy" data-resource="${key}" aria-label="Купить ${rate.lot} ${resourceNames[key]} за ${rate.buy} золота">−${rate.buy}${icon("gold")}</button></div>`;
    }).join("");
    const taxLabels: Record<TaxPolicy, string> = { none: "Нет", standard: "Обычный", high: "Повышенный" };
    const rationLabels: Record<RationPolicy, string> = { half: "½ пайка", normal: "Обычный", double: "Двойной" };
    const taxButtons = Object.values(TAX_POLICIES).map((policy) =>
      `<button class="policy-button" type="button" data-tax-policy="${policy.id}" aria-pressed="false" title="${policy.description}">${taxLabels[policy.id]}</button>`,
    ).join("");
    const rationButtons = Object.values(RATION_POLICIES).map((policy) =>
      `<button class="policy-button" type="button" data-ration-policy="${policy.id}" aria-pressed="false" title="${policy.description}">${rationLabels[policy.id]}</button>`,
    ).join("");

    return `
      <div class="hud" aria-label="Управление крепостью">
        <div class="hud__top">
          <div class="hud__resources" aria-label="Запасы крепости">
            <span class="resource-ledger__crest" aria-hidden="true">${icon("castle")}</span>
            ${resources}
          </div>
            <div class="hud__actions">
            <div class="hud-status-rail" aria-label="Состояние города">
              <span class="status-chip mission-badge"><small>Этап</small><strong data-mission-badge>Карта 1</strong></span>
              <span class="status-chip workforce-badge"><small>Поселение</small><strong data-workforce>Рабочие 0/0</strong></span>
              <span class="status-chip army-badge"><small>Гарнизон</small><strong data-army-badge>Армия 0/24</strong></span>
              <span class="status-chip wave-badge"><small data-wave-label>Угроза</small><strong data-wave-badge>Ожидание</strong></span>
            </div>
            <div class="hud-tool-rail" aria-label="Системные команды">
              <button class="hud-button desktop-settings-toggle" type="button" data-settings-toggle aria-controls="camera-tools" aria-expanded="false" aria-label="Настройки графики и звука">Настройки</button>
              <button class="hud-button" type="button" data-speed title="Скорость игры" aria-label="Скорость игры 1">×1</button>
              <button class="hud-button" type="button" data-camera-reset title="Вернуть камеру к цитадели" aria-label="Вернуть камеру к цитадели">${icon("camera")}</button>
              <button class="hud-button" type="button" data-sound title="Звук" aria-label="Включить звук">${icon("sound")}</button>
              <button class="hud-button hud-button--essential" type="button" data-pause title="Пауза" aria-label="Пауза">${icon("pause")}</button>
            </div>
          </div>
        </div>

        <div class="hud__left">
          <section class="objective-card is-collapsed">
            <div class="objective-card__head"><span class="objective-card__eyebrow">${icon("flag")} Задача</span><span class="objective-card__count" data-objective-count>0/0</span></div>
            <h2 class="objective-card__title" data-objective-title>Подготовьте крепость</h2>
            <span class="objective-card__clock" id="objective-clock" data-clock-state>Подготовка · время стоит</span>
            <span class="objective-card__effect" data-active-effects hidden></span>
            <div class="objective-card__details" id="objective-details" data-objective-details hidden inert>
              <p class="objective-card__text" data-objective-text>Выберите миссию и начните игру.</p>
              <div class="objective-card__briefing" data-objective-briefing></div>
              <button class="hud-button tutorial-raid-button" type="button" data-tutorial-raid hidden disabled>Вызвать учебный набег</button>
            </div>
            <div class="objective-card__progress"><div class="objective-card__progress-bar" data-objective-progress></div></div>
            <button class="ready-button" type="button" data-ready aria-describedby="objective-clock">${icon("flag")}<span>Начать игру</span>${icon("arrow")}</button>
            <button class="icon-button objective-card__toggle" type="button" data-objective-toggle aria-label="Развернуть задачу" aria-expanded="false" aria-controls="objective-details">${icon("chevron")}<span class="objective-card__toggle-label">Задача</span></button>
          </section>
          <section class="duel-status-card" data-duel-status hidden inert aria-label="Состояние замка соперника">
            <div class="duel-status-card__head"><span>${icon("castle")}<span><strong data-duel-name>Соперник</strong><small data-duel-phase>Развивает замок</small><small class="duel-status-card__compact" data-duel-compact aria-hidden="true">100% · 0 отр.</small></span></span><button type="button" data-focus-castle="enemy" aria-label="Показать замок соперника">${icon("arrow")}</button></div>
            <div class="duel-status-card__health" data-duel-keep-bar><i></i><b data-duel-keep>0/0</b></div>
            <div class="duel-status-card__facts"><span data-duel-buildings>0 построек</span><span data-duel-army>0 отрядов</span><small data-duel-assault></small></div>
          </section>
          <section class="economy-card" data-economy-card>
            <button class="economy-card__toggle" type="button" data-economy-toggle aria-expanded="false" aria-controls="economy-body">
              <span class="economy-card__seal">${icon("sun")}</span>
              <span><small><span class="economy-card__label-full">Запасы и совет</span><span class="economy-card__label-compact" aria-hidden="true">Совет</span></small><strong data-economy-hope>Доверие 70%</strong><strong class="economy-card__hope-compact" data-economy-hope-compact aria-hidden="true">70%</strong></span>
              <em data-economy-trend data-tone="neutral">±0 / мин</em>
              <i data-economy-chevron>${icon("chevron")}</i>
            </button>
            <div class="economy-card__body" id="economy-body" data-economy-body hidden inert>
              <div class="drawer-heading"><div><small data-economy-phase>Запасы и производство</small><h2>Совет управляющего</h2></div><button class="icon-button" type="button" data-economy-close aria-label="Закрыть экономику">${icon("close")}</button></div>
              <div class="storage-ledger" aria-label="Запасы, вместимость и изменение за минуту">${storage}</div>
              <div class="economy-policy">
                <div class="economy-policy__head"><span>Налоги</span><small data-tax-readout>+0 золота / мин</small></div>
                <div class="policy-segments" role="group" aria-label="Уровень налогов">${taxButtons}</div>
              </div>
              <div class="economy-policy">
                <div class="economy-policy__head"><span>Пайки</span><small data-ration-readout>−0 еды / мин</small></div>
                <div class="policy-segments" role="group" aria-label="Размер пайка">${rationButtons}</div>
              </div>
              <p class="economy-card__factors" data-popularity-factors></p>
              <ul class="economy-warnings" data-economy-warnings hidden></ul>
              <div class="economy-card__foot"><span data-food-reserve>Еды на 0:00</span><span data-staffing>Рабочих 100%</span></div>
            </div>
          </section>
        </div>

        <div class="hud__right">
          <section class="selected-panel enemy-panel" data-enemy-panel hidden inert aria-label="Постройка соперника"><button class="icon-button" type="button" data-enemy-close aria-label="Закрыть сведения о сопернике">${icon("close")}</button><div data-enemy-facts></div></section>
          <section class="selected-panel" data-selected-panel hidden>
            <span class="selected-panel__rivet selected-panel__rivet--left" aria-hidden="true"></span><span class="selected-panel__rivet selected-panel__rivet--right" aria-hidden="true"></span>
            <div class="selected-panel__header">
              <span class="selected-panel__portrait" data-selected-icon>${buildingPortrait("keep")}</span>
              <div><h2 class="selected-panel__name" data-selected-name>Здание</h2><span class="selected-panel__type" data-selected-type>Постройка</span></div>
              <button class="icon-button" type="button" data-selected-close aria-label="Закрыть">${icon("close")}</button>
            </div>
            <div class="selected-panel__health" data-selected-health><div class="selected-panel__health-bar"></div></div>
            <div class="selected-panel__stats">
              <div class="selected-stat"><span class="selected-stat__label">Прочность</span><span class="selected-stat__value" data-selected-hp>0/0</span></div>
              <div class="selected-stat"><span class="selected-stat__label">Клетка</span><span class="selected-stat__value" data-selected-cell>0:0</span></div>
              <div class="selected-stat"><span class="selected-stat__label">Эффект</span><span class="selected-stat__value" data-selected-efficiency>—</span></div>
              <div class="selected-stat selected-stat--global"><span class="selected-stat__label">Доверие</span><span class="selected-stat__value" data-hope>72%</span></div>
            </div>
            <p class="selected-panel__description" data-selected-description></p>
            <div class="production-card" data-production hidden>
              <div class="production-card__head"><b data-production-status>Производство</b><span data-production-workers>Рабочие 0/0</span></div>
              <div class="production-flow"><span data-production-input>Без сырья</span>${icon("arrow")}<strong data-production-output>—</strong></div>
              <small class="production-rate" data-production-rate>Производство за минуту</small>
              <p data-production-bonus></p><small data-production-capacity></small>
              <div class="production-actions"><button class="hud-button" type="button" data-production-toggle>Приостановить</button><button class="hud-button" type="button" data-production-priority>Приоритет: обычный</button></div>
            </div>
            <div class="tower-upgrades" data-tower-upgrades hidden inert>
              <div class="tower-upgrades__head"><b>Модуль башни</b><small data-tower-upgrade-status>Без модуля</small></div>
              <p>Пустая башня не стреляет. Лучник или один из модулей делает её активной.</p>
              <div class="tower-upgrades__options">${towerUpgradeButtons}</div>
            </div>
            <div class="military-actions" data-military-actions hidden>${units}<div class="training-queue" data-training-queue aria-live="polite"></div></div>
            <div class="market-actions" data-market-actions hidden>
              <span><b>Караванный обмен</b><small data-market-status>караван готов</small></span>
              <div class="market-column-labels"><span>Товар</span><span>Продать</span><span>Купить</span></div>${trades}
            </div>
            <div class="selected-panel__actions"><button class="hud-button" type="button" data-repair>Ремонт</button><button class="hud-button" type="button" data-demolish>Разобрать</button></div>
          </section>
        </div>

        <div class="hud__bottom">
          <div class="desktop-camera-controls">
            <span class="command-rail__label">Команды</span>
            <button class="hud-button" type="button" data-rotate-left title="Повернуть камеру влево" aria-label="Повернуть камеру влево">${icon("rotateLeft")}</button>
            <button class="hud-button hud-button--wide" type="button" data-duel-control data-focus-castle="player" title="Показать ваш замок" hidden>${icon("castle")}<span>Мой</span></button>
            <button class="hud-button hud-button--wide" type="button" data-duel-control data-focus-castle="enemy" title="Показать замок соперника" hidden>${icon("arrow")}<span>Соперник</span></button>
            <button class="hud-button" type="button" data-duel-control data-focus-castle="all" title="Показать оба замка" aria-label="Показать оба замка" hidden>${icon("top")}</button>
            <button class="hud-button hud-button--wide" type="button" data-top-view title="Вид строго сверху" aria-pressed="false">${icon("top")}<span>Сверху</span></button>
            <button class="hud-button hud-button--wide" type="button" data-rally aria-pressed="false">${icon("flag")}<span>Точка сбора</span></button>
            <button class="hud-button" type="button" data-rotate-right title="Повернуть камеру вправо" aria-label="Повернуть камеру вправо">${icon("rotateRight")}</button>
          </div>
          <div class="placement-bar" data-placement-bar data-tone="info" hidden inert>
            <span class="placement-bar__text" data-placement-text>Выберите клетку</span>
            <button class="placement-bar__button placement-bar__button--confirm" type="button" data-placement-confirm disabled>Построить</button>
            <button class="placement-bar__button" type="button" data-placement-cancel>Отмена</button>
          </div>
          <section class="build-dock" id="build-dock" data-build-dock hidden inert>
            <div class="build-dock__head"><div class="build-dock__identity"><span class="build-dock__crest">${icon("build")}</span><div><small>Книга мастера</small><h2 class="build-dock__title" data-build-title>Постройки</h2></div></div><span class="build-dock__categories" role="tablist" aria-label="Разделы строительства">${categories}</span><span class="build-dock__navigation"><button class="icon-button" type="button" data-build-scroll="-1" aria-label="Предыдущие постройки">${icon("left")}</button><button class="icon-button" type="button" data-build-scroll="1" aria-label="Следующие постройки">${icon("right")}</button></span><button class="icon-button build-dock__close" type="button" data-build-close aria-label="Закрыть строительство">${icon("close")}</button></div>
            <div class="build-dock__items">${buildCards}</div>
          </section>
          <button class="desktop-build-toggle" type="button" data-desktop-build-toggle aria-controls="build-dock" aria-expanded="false">${icon("build")}<span>Строительство</span><kbd>B</kbd></button>
        </div>
      </div>

      <section class="army-command-panel" data-army-command-panel hidden inert aria-label="Выбранный отряд или житель">
        <div class="army-command-panel__identity">
          <span class="army-command-panel__icon" data-army-command-icon>${icon("shield")}</span>
          <span><strong data-army-command-name>Отряд</strong><small data-army-command-type>Ваши бойцы</small></span>
          <button class="icon-button" type="button" data-army-command-close aria-label="Снять выделение">${icon("close")}</button>
        </div>
        <div class="army-command-panel__health" data-army-command-health><i></i><span data-army-command-hp>0/0</span></div>
        <div class="army-command-panel__actions">
          <button class="army-command-button" type="button" data-army-order aria-pressed="false">${icon("flag")}<span>Отдать приказ</span></button>
          <button class="army-command-button" type="button" data-army-hold hidden>Удерживать</button><button class="army-command-button" type="button" data-army-attack-move hidden>Атаковать по пути</button>
          <button class="army-command-button army-command-button--direct" type="button" data-army-direct>${icon("camera")}<span>Управлять</span></button>
        </div>
        <small class="army-command-panel__hint" data-army-command-hint><span class="desktop-copy">ПКМ — идти · Shift+ПКМ — атаковать по пути · Enter — за спину</span><span class="mobile-copy">«Отдать приказ» → клетка · «Управлять» → вид за спиной</span></small>
      </section>

      <div class="selection-marquee" data-selection-marquee hidden aria-hidden="true"></div>
      <div class="army-command-marker" data-army-command-marker hidden aria-hidden="true"><i></i><b></b></div>

      <section class="direct-control-hud" data-direct-control-hud hidden inert aria-label="Прямое управление персонажем">
        <div class="direct-control-hud__beta">BETA · ПРЯМОЕ УПРАВЛЕНИЕ</div>
        <div class="direct-control-hud__status">
          <span class="direct-control-hud__icon" data-direct-icon>${icon("spear")}</span>
          <span><strong data-direct-name>Копейщик</strong><small data-direct-weapon>Копьё</small></span>
          <button class="direct-control-hud__exit" type="button" data-direct-exit aria-label="Вернуться к тактической карте">${icon("close")}<span>К карте</span></button>
          <div class="direct-control-hud__health" data-direct-health><i></i><b data-direct-hp>0/0</b></div>
        </div>
        <div class="direct-crosshair" aria-hidden="true"><b></b></div>
        <div class="direct-control-hud__desktop desktop-copy" data-direct-desktop-hint>WASD — движение · Shift — бег · мышь — обзор · ЛКМ/Space — атака · Esc — к карте</div>
        <div class="direct-control-hud__desktop-actions desktop-copy">
          <button class="direct-control-hud__utility desktop-copy" type="button" data-direct-dance aria-label="Танцевать" aria-pressed="false">${icon("dance")}<span>Танец · V</span></button>
          <button class="direct-control-hud__utility direct-control-hud__utility--mount desktop-copy" type="button" data-direct-mount aria-label="Подняться на укрепление" hidden>${icon("up")}<span>Подняться · E</span></button>
          <button class="direct-control-hud__utility direct-control-hud__utility--dismount desktop-copy" type="button" data-direct-dismount aria-label="Спуститься с укрепления" hidden>${icon("down")}<span>Спуститься · X</span></button>
        </div>
        <div class="direct-touch-controls mobile-copy">
          <div class="direct-joystick" data-direct-joystick data-direction="idle" aria-label="Джойстик: вверх вперёд, вправо шаг вправо" role="application"><i></i><span class="direct-joystick__arrow direct-joystick__arrow--up">↑</span><span class="direct-joystick__arrow direct-joystick__arrow--right">→</span><span class="direct-joystick__arrow direct-joystick__arrow--down">↓</span><span class="direct-joystick__arrow direct-joystick__arrow--left">←</span><b data-direct-joystick-knob></b></div>
          <span class="direct-touch-controls__look">Обзор<br>тяните по экрану</span>
          <div class="direct-touch-controls__actions">
            <div class="direct-touch-controls__utility">
              <button class="direct-sprint" type="button" data-direct-sprint aria-label="Бежать, удерживать" aria-pressed="false">БЕГ</button>
              <button class="direct-emote" type="button" data-direct-dance aria-label="Танцевать" aria-pressed="false">${icon("dance")}<span>ТАНЕЦ</span></button>
              <button class="direct-mount" type="button" data-direct-mount aria-label="Подняться на укрепление" hidden>${icon("up")}<span>ПОДНЯТЬСЯ</span></button>
              <button class="direct-dismount" type="button" data-direct-dismount aria-label="Спуститься с укрепления" hidden>${icon("down")}<span>СПУСТИТЬСЯ</span></button>
            </div>
            <button class="direct-attack" type="button" data-direct-attack>${icon("spear")}<span>Удар</span></button>
          </div>
        </div>
      </section>

      <div class="tutorial-hint" data-tutorial role="status">
        <span class="tutorial-hint__key" data-tutorial-key>WASD</span><span data-tutorial-text>ПКМ/средняя — вращение · T — вид сверху · B — стройка.</span>
        <button class="tutorial-hint__dismiss" type="button" data-hint-dismiss aria-label="Закрыть подсказку">${icon("close")}</button>
      </div>
      <div class="toast-stack" data-toasts aria-live="polite"></div>

      <div class="mobile-controls">
        <div class="camera-tools" id="camera-tools" data-camera-tools hidden inert>
          <label class="graphics-quality" data-graphics-control hidden>Графика <select data-graphics-quality aria-label="Качество графики"><option value="auto">Авто</option><option value="low">Низкое</option><option value="medium">Среднее</option><option value="high">Высокое</option></select></label>
          <fieldset class="audio-controls" data-audio-controls hidden><legend>Громкость</legend><label>Эффекты <input type="range" min="0" max="1" step="0.05" data-audio-volume="effects" aria-label="Громкость эффектов"><output data-audio-readout="effects">70%</output></label><label>Ветер <input type="range" min="0" max="1" step="0.05" data-audio-volume="ambient" aria-label="Громкость ветра"><output data-audio-readout="ambient">25%</output></label></fieldset>
          <div class="camera-tools__row" aria-label="Камера">
            <button class="mobile-control-button" type="button" data-rotate-left aria-label="Повернуть камеру влево">${icon("rotateLeft")}</button>
            <button class="mobile-control-button" type="button" data-zoom-out aria-label="Отдалить камеру">${icon("minus")}</button>
            <button class="mobile-control-button" type="button" data-top-view aria-label="Вид сверху" aria-pressed="false">${icon("top")}</button>
            <button class="mobile-control-button" type="button" data-zoom-in aria-label="Приблизить камеру">${icon("plus")}</button>
            <button class="mobile-control-button" type="button" data-rotate-right aria-label="Повернуть камеру вправо">${icon("rotateRight")}</button>
          </div>
          <div class="camera-pad" aria-label="Перемещение камеры">
            <button class="camera-pad__button" type="button" data-pan-x="-1" data-pan-z="0" aria-label="Карта влево">${icon("left")}</button>
            <button class="camera-pad__button" type="button" data-pan-x="0" data-pan-z="-1" aria-label="Карта вверх">${icon("up")}</button>
            <button class="camera-pad__button" type="button" data-pan-x="0" data-pan-z="1" aria-label="Карта вниз">${icon("down")}</button>
            <button class="camera-pad__button" type="button" data-pan-x="1" data-pan-z="0" aria-label="Карта вправо">${icon("right")}</button>
          </div>
          <div class="camera-tools__castles" data-duel-control hidden aria-label="Быстрый переход между замками"><button type="button" data-focus-castle="player">${icon("castle")}<span>Мой замок</span></button><button type="button" data-focus-castle="all">${icon("top")}<span>Оба</span></button><button type="button" data-focus-castle="enemy">${icon("arrow")}<span>Соперник</span></button></div>
          <button class="camera-tools__reset" type="button" data-mobile-camera-reset aria-label="Сбросить вид камеры">${icon("camera")}<span>Сбросить вид</span></button>
        </div>
        <div class="mobile-actions">
          <button class="mobile-camera-toggle" type="button" data-camera-toggle aria-expanded="false" aria-controls="camera-tools">${icon("camera")}<span>Камера</span></button>
          <button class="mobile-rally-toggle" type="button" data-rally aria-pressed="false">${icon("flag")}<span>Точка сбора</span></button>
          <button class="mobile-build-toggle" type="button" data-mobile-build aria-controls="build-dock" aria-expanded="false">${icon("build")}<span>Строить</span></button>
        </div>
      </div>

      <section class="game-overlay game-overlay--start is-open" data-overlay-start role="dialog" aria-modal="true" aria-labelledby="campaign-title">
        <div class="campaign-shell">
          <header class="journey-header">
            <div class="journey-brand"><span class="journey-seal">${icon("castle")}</span><div><p>Пески помнят каждую крепость</p><h1 id="campaign-title">Dunekeep</h1></div></div>
            <p class="journey-header__intro">Шесть глав одного похода.<br>От первого оазиса до последней осады.</p>
          </header>
          <section class="journey-panel" aria-label="Карта похода">
            <div class="journey-map-heading"><span>КАРТА ПОХОДА</span><span>Выберите свою главу</span></div>
            <nav class="journey-map" aria-label="Шесть глав кампании">${journeyMap()}${missions}</nav>
            <p class="journey-legend">${icon("flag")} Каждый замок начинается с первого камня</p>
          </section>
          <div class="campaign-setup">
            <section class="campaign-brief" aria-label="Задание выбранной миссии">
              <span class="campaign-brief__order" data-campaign-order>Этап 1 из 6</span>
              <h3 data-briefing-name></h3>
              <p class="campaign-brief__goal" data-briefing-goal></p>
              <details class="campaign-details"><summary>О главе ${icon("chevron")}</summary><p data-briefing-text></p><p data-briefing-hint></p><div class="campaign-stock"><span>Запасы каравана</span><div class="cost-list" data-briefing-stock></div></div></details>
            </section>
            <section class="campaign-level" aria-label="Уровень сложности">
              <h3>Сложность</h3><div class="difficulty-options" role="group" aria-label="Выберите сложность">${difficulties}</div>
              <details class="campaign-details"><summary>Об этом режиме ${icon("chevron")}</summary><p data-difficulty-description></p><small data-difficulty-modifiers></small></details>
            </section>
            <div class="campaign-launch">
              <button class="menu-button menu-button--primary" type="button" data-start>Начать новую игру ${icon("arrow")}</button>
              <button class="menu-button campaign-resume" type="button" data-continue-session hidden>${icon("play")}<span><b>Продолжить игру</b><small data-continue-summary></small></span></button>
              <p>Сначала — строительство. Время запустите сами.</p>
            </div>
            <details class="campaign-details campaign-controls"><summary>Управление ${icon("chevron")}</summary><p class="desktop-copy">ЛКМ — карта · ПКМ — вращение · T — вид сверху</p><p class="mobile-copy">Палец — карта · щипок — масштаб · кнопка «Камера» — поворот и вид сверху</p></details>
          </div>
        </div>
      </section>

      <section class="game-overlay game-overlay--pause" data-overlay-pause hidden inert role="dialog" aria-modal="true" aria-label="Пауза">
        <div class="game-overlay__card"><span class="overlay-medallion">${icon("pause")}</span><p class="game-overlay__kicker">Перерыв</p><h2 class="game-overlay__title">Пауза</h2><p class="game-overlay__subtitle">Город замер. Осмотрите карту и возвращайтесь, когда будете готовы.</p><div class="game-overlay__actions pause-actions"><button class="menu-button menu-button--primary" type="button" data-resume>${icon("play")} Вернуться</button><button class="menu-button menu-button--ghost" type="button" data-restart>${icon("restart")} Начать заново</button><button class="menu-button menu-button--ghost" type="button" data-campaign>${icon("book")} К миссиям</button></div></div>
      </section>

      <section class="game-overlay game-overlay--end" data-overlay-end hidden inert role="dialog" aria-modal="true" aria-label="Итог миссии">
        <div class="game-overlay__card">
          <span class="overlay-medallion overlay-medallion--result">${icon("trophy")}</span>
          <p class="game-overlay__kicker" data-end-kicker>Задача выполнена</p><h2 class="game-overlay__title" data-end-title>Победа</h2><p class="game-overlay__subtitle" data-end-subtitle></p>
          <div class="game-overlay__summary">
            <div class="summary-stat"><span class="summary-stat__value" data-summary-time>0:00</span><span class="summary-stat__label">время</span></div>
            <div class="summary-stat"><span class="summary-stat__value" data-summary-pop>0</span><span class="summary-stat__label">людей</span></div>
            <div class="summary-stat"><span class="summary-stat__value" data-summary-army>0</span><span class="summary-stat__label">бойцов</span></div>
          </div>
          <div class="game-overlay__actions"><button class="menu-button menu-button--primary" type="button" data-next-mission hidden>Следующая миссия</button><button class="menu-button menu-button--ghost" type="button" data-continue-after-victory>Продолжить строить</button><button class="menu-button menu-button--ghost" type="button" data-restart>Переиграть</button><button class="menu-button menu-button--ghost" type="button" data-campaign>Выбрать миссию</button></div>
        </div>
      </section>`;
  }

  private query<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`UI element not found: ${selector}`);
    return element;
  }
}
