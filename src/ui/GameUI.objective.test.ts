import { describe, expect, it } from "vitest";
import { GameSimulation } from "../game/simulation";
import type { ArmyUnitKind, BuildingKind, BuildingProductionSnapshot, BuildingState, GameSnapshot } from "../game/types";
import { GameUI } from "./GameUI";

/** Only the DOM operations used by objective rendering; no browser dependency. */
class ObjectiveElement {
  textContent = "";
  innerHTML = "";
  hidden = false;
  inert = false;
  disabled = false;
  title = "";
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  private classes = new Set<string>();
  classList = {
    toggle: (name: string, enabled: boolean) => {
      if (enabled) this.classes.add(name);
      else this.classes.delete(name);
    },
    contains: (name: string) => this.classes.has(name),
  };
  style = { setProperty: (_name: string, _value: string) => undefined };
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
}

type ObjectiveUI = {
  objectiveCollapsed: boolean;
  selectedKind: BuildingKind | null;
  buildDockOpen: boolean;
  layoutMedia: { matches: boolean };
  setObjectiveCollapsed: (collapsed: boolean) => void;
  renderObjective: (snapshot: GameSnapshot) => void;
  template: () => string;
  objectiveConditions: (snapshot: GameSnapshot) => string[];
  productionFlow: (kind: BuildingKind, production: BuildingProductionSnapshot, paused: boolean) => { inputs: Record<string, number>; outputs: Record<string, number>; label: string; capacityKeys: string[] };
  enemyBuildingFacts: (building: BuildingState) => string;
  queueBlockReason: (snapshot: GameSnapshot, building: BuildingState, kind: ArmyUnitKind) => string | null;
  canCallTutorialRaid: (snapshot: GameSnapshot) => boolean;
  perMinute: (values: Record<string, number>) => Record<string, number>;
};

function objectiveFixture(): { ui: ObjectiveUI; node: (selector: string) => ObjectiveElement } {
  const nodes = new Map([
    ".objective-card", "[data-objective-toggle]", "[data-objective-details]",
    "[data-objective-title]", "[data-objective-text]", "[data-objective-progress]",
    "[data-objective-count]", "[data-ready]", "[data-clock-state]",
    "[data-active-effects]", "[data-objective-briefing]", "[data-tutorial-raid]",
  ].map(selector => [selector, new ObjectiveElement()]));
  const node = (selector: string): ObjectiveElement => {
    const element = nodes.get(selector);
    if (!element) throw new Error(`Objective fixture needs ${selector}`);
    return element;
  };
  const ui = Object.assign(Object.create(GameUI.prototype), {
    root: { querySelector: node },
    markupCache: new WeakMap(),
    actions: { callTutorialRaid: () => undefined },
    objectiveCollapsed: true,
    selectedKind: null,
    buildDockOpen: false,
    layoutMedia: { matches: true },
  }) as ObjectiveUI;
  return { ui, node };
}

describe("objective disclosure", () => {
  it("expands and folds the complete details with matching accessible state", () => {
    const { ui, node } = objectiveFixture();
    for (const collapsed of [true, false, true]) {
      ui.setObjectiveCollapsed(collapsed);
      expect(ui.objectiveCollapsed).toBe(collapsed);
      expect(node(".objective-card").classList.contains("is-collapsed")).toBe(collapsed);
      expect(node("[data-objective-details]").hidden).toBe(collapsed);
      expect(node("[data-objective-details]").inert).toBe(collapsed);
      expect(node("[data-objective-toggle]").attributes.get("aria-expanded")).toBe(String(!collapsed));
      expect(node("[data-objective-toggle]").attributes.get("aria-label"))
        .toBe(collapsed ? "Развернуть задачу" : "Свернуть задачу");
      expect(node("[data-objective-toggle]").innerHTML).toContain(collapsed ? "Задача" : "Свернуть");
    }
  });

  it.each([true, false])("render updates preserve collapsed=%s across layout modes and campaign start", (collapsed) => {
    const { ui, node } = objectiveFixture();
    const simulation = new GameSimulation();
    simulation.start();
    ui.setObjectiveCollapsed(collapsed);
    for (const mobile of [true, false, true]) {
      ui.layoutMedia.matches = mobile;
      for (let frame = 0; frame < 5; frame += 1) {
        ui.renderObjective(simulation.snapshot);
        expect(ui.objectiveCollapsed).toBe(collapsed);
        expect(node(".objective-card").classList.contains("is-collapsed")).toBe(collapsed);
        expect(node("[data-ready]").hidden).toBe(false);
        expect(node("[data-ready]").disabled).toBe(false);
      }
    }
    simulation.beginPreparation();
    ui.renderObjective(simulation.snapshot);
    expect(node("[data-ready]").hidden).toBe(true);
    expect(ui.objectiveCollapsed).toBe(collapsed);
    expect(node("[data-objective-details]").inert).toBe(collapsed);
  });

  it("retains the one preparation command while gating unfinished placement", () => {
    const { ui, node } = objectiveFixture();
    const simulation = new GameSimulation();
    simulation.start();
    ui.setObjectiveCollapsed(true);
    ui.selectedKind = "wall";
    ui.renderObjective(simulation.snapshot);
    expect(node("[data-ready]").hidden).toBe(false);
    expect(node("[data-ready]").disabled).toBe(true);
    ui.selectedKind = null;
    ui.renderObjective(simulation.snapshot);
    expect(node("[data-ready]").disabled).toBe(false);
    expect(ui.objectiveCollapsed).toBe(true);
  });

  it("describes the final duel without inventing a zero-wave objective", () => {
    const { ui, node } = objectiveFixture();
    const simulation = new GameSimulation();
    expect(simulation.selectMission("siege")).toBe(true);
    simulation.start();
    ui.renderObjective(simulation.snapshot);
    expect(node("[data-objective-title]").textContent).toBe("Подготовьте свой замок");
    expect(node("[data-objective-text]").textContent).toContain("Центральная полоса нейтральна");
    expect(node("[data-objective-title]").textContent).not.toContain("Волна 0");
    expect(node("[data-objective-briefing]").innerHTML).toContain("Цель");
    expect(node("[data-objective-briefing]").innerHTML).toContain("цитадель");
  });

  it("explains the river confrontation as defended marches and surviving fighters", () => {
    const { ui, node } = objectiveFixture();
    const simulation = new GameSimulation();
    expect(simulation.selectMission("river")).toBe(true);
    simulation.start();
    simulation.beginPreparation();
    ui.renderObjective(simulation.snapshot);
    expect(node("[data-objective-title]").textContent).toBe("Удержите долину");
    expect(node("[data-objective-text]").textContent).toContain("Отбито походов 0/2");
    expect(node("[data-objective-text]").textContent).toContain("ваших бойцов 0/6");
  });

  it("keeps river conditions separate and clamps excess completed assaults", () => {
    const { ui, node } = objectiveFixture();
    const simulation = new GameSimulation();
    simulation.selectMission("river"); simulation.start(); simulation.beginPreparation();
    const snapshot = simulation.snapshot;
    snapshot.duel!.assaultsDefeated = 9;
    ui.renderObjective(snapshot);
    expect(node("[data-objective-count]").textContent).toBe("Походы 2/2 · Бойцы 0/6");
    expect(node("[data-objective-text]").textContent).toContain("Отбито походов 2/2");
    expect(node("[data-objective-briefing]").innerHTML).not.toContain("/8</strong>");
  });

  it("shows every tutorial requirement before the clock starts", () => {
    const { ui, node } = objectiveFixture();
    const simulation = new GameSimulation(); simulation.start();
    ui.renderObjective(simulation.snapshot);
    const briefing = node("[data-objective-briefing]").innerHTML;
    for (const condition of ["○ Новая ферма", "○ Башня", "Бойцы 0/2", "○ Набег"]) expect(briefing).toContain(condition);
    expect(briefing).not.toContain("0/4</strong>");
  });

  it("shows ruins reserves separately from destroyed fortifications", () => {
    const { ui } = objectiveFixture();
    const simulation = new GameSimulation(); simulation.selectMission("ruins"); simulation.start();
    expect(ui.objectiveConditions(simulation.snapshot)).toEqual(["Укрепления 0/5", "Оружие 0/8"]);
  });

  it("converts production quantities to one minute without changing source values", () => {
    const { ui } = objectiveFixture();
    const inputs = { wood: 2, grain: 0.5 };
    expect(ui.perMinute(inputs)).toEqual({ wood: 60, grain: 15 });
    expect(inputs).toEqual({ wood: 2, grain: 0.5 });
  });

  it("uses authoritative tutorial readiness and hides the command after the raid", () => {
    const { ui, node } = objectiveFixture();
    const simulation = new GameSimulation(); simulation.start();
    ui.renderObjective(simulation.snapshot);
    expect(node("[data-tutorial-raid]").hidden).toBe(true);
    simulation.beginPreparation();
    const snapshot = simulation.snapshot;
    snapshot.canCallTutorialRaid = false;
    ui.renderObjective(snapshot);
    expect(node("[data-tutorial-raid]").hidden).toBe(false);
    expect(node("[data-tutorial-raid]").disabled).toBe(true);
    snapshot.canCallTutorialRaid = true;
    ui.renderObjective(snapshot);
    expect(node("[data-tutorial-raid]").disabled).toBe(false);
    snapshot.canCallTutorialRaid = false;
    snapshot.wave = 1;
    ui.renderObjective(snapshot);
    expect(node("[data-tutorial-raid]").hidden).toBe(true);
  });

  it("accounts for workers and army slots reserved by queues in other buildings", () => {
    const { ui } = objectiveFixture();
    const simulation = new GameSimulation(); simulation.selectMission("siege"); simulation.start();
    const snapshot = simulation.snapshot;
    const barracks = snapshot.buildings.find(building => building.kind === "barracks")!;
    expect(ui.queueBlockReason(snapshot, barracks, "spearman")).toBeNull();
    snapshot.buildings[0].trainingQueue = [{kind: "spearman", duration: 5, remaining: 5, cost: {food:16, gold:14}}];
    snapshot.armyCount = 23;
    expect(ui.queueBlockReason(snapshot, barracks, "spearman")).toContain("Лимит 24");
    snapshot.armyCount = 0;
    snapshot.freeWorkers = 1;
    expect(ui.queueBlockReason(snapshot, barracks, "spearman")).toContain("в очередях 1");
    snapshot.buildings[0].trainingQueue = [];
    expect(ui.queueBlockReason(snapshot, barracks, "spearman")).toBeNull();
    snapshot.status = "paused";
    expect(ui.queueBlockReason(snapshot, barracks, "spearman")).toBeNull();
  });

  it("keeps line confirmation explicit and enables it only for valid plans", () => {
    const nodes = new Map<string, ObjectiveElement>();
    const node = (selector: string) => {
      if (!nodes.has(selector)) nodes.set(selector, new ObjectiveElement());
      return nodes.get(selector)!;
    };
    const rootState = new ObjectiveElement();
    const ui = Object.assign(Object.create(GameUI.prototype), {
      root: { querySelector: node, classList: { ...rootState.classList, add: (name: string) => rootState.classList.toggle(name, true) } },
      syncMobileSurfaceState: () => undefined,
    }) as { setWallLineMode: (enabled: boolean) => void; showBuildLinePreview: (text: string, valid: boolean) => void };
    ui.setWallLineMode(true);
    expect(nodes.has("[data-wall-line]")).toBe(false);
    ui.showBuildLinePreview("Выберите начало стены", false);
    expect(rootState.classList.contains("is-wall-line")).toBe(true);
    expect(node("[data-placement-bar]").hidden).toBe(false);
    expect(node("[data-placement-bar]").inert).toBe(false);
    expect(node("[data-placement-confirm]").disabled).toBe(true);
    ui.showBuildLinePreview("Стена: 1 секция · 14 камня", true);
    expect(node("[data-placement-confirm]").disabled).toBe(false);
    ui.showBuildLinePreview("Стена: 3 секции · 42 камня", true);
    expect(node("[data-placement-confirm]").disabled).toBe(false);
    expect(node("[data-placement-text]").textContent).toContain("3 секции");
    ui.setWallLineMode(false);
    expect(rootState.classList.contains("is-wall-line")).toBe(false);
  });

  it("reports enemy tower facts from its current module definition", () => {
    const { ui } = objectiveFixture();
    const simulation = new GameSimulation(); simulation.selectMission("river"); simulation.start();
    const tower = simulation.snapshot.duel!.enemyBuildings.find(building => building.kind === "tower")!;
    expect(ui.enemyBuildingFacts(tower)).toContain("Лёгкая баллиста");
    expect(ui.enemyBuildingFacts(tower)).toContain("7,2");
    expect(ui.enemyBuildingFacts(tower)).toContain("Цели — бойцы");
    expect(ui.enemyBuildingFacts({...tower, towerUpgrade: "heavy"})).toContain("8,2");
    expect(ui.enemyBuildingFacts({...tower, towerUpgrade: "none"})).toContain("автономного огня нет");
  });

  it("keeps the bakery recipe visible when storage is full and distinguishes it from actual output", () => {
    const { ui } = objectiveFixture();
    const simulation = new GameSimulation(); simulation.start();
    const base = simulation.snapshot.economy.production[0];
    const stopped: BuildingProductionSnapshot = { ...base, kind: "bakery", status: "storage-full", statusLabel: "Склад заполнен — производство ждёт", inputs: {}, outputs: {} };
    const flow = ui.productionFlow("bakery", stopped, false);
    expect(flow.inputs).toEqual({grain: 60, wood: 15});
    expect(flow.outputs).toEqual({food: 420});
    expect(flow.label).toBe("Базовый рецепт за минуту · выпуск сейчас 0");
    expect(flow.capacityKeys).toEqual(["food"]);
    expect(stopped.statusLabel).toBe("Склад заполнен — производство ждёт");
    const working = { ...stopped, status: "working" as const, inputs: {grain: 1, wood: 0.25}, outputs: {food: 7} };
    expect(ui.productionFlow("bakery", working, false).outputs).toEqual({food: 210});
    expect(ui.productionFlow("bakery", working, true).label).toContain("Прогноз");
    expect(ui.productionFlow("bakery", working, true).label).toContain("выпуск сейчас 0");
  });

  it("uses one Start button and an explicitly controlled details region", () => {
    const { ui } = objectiveFixture();
    const markup = ui.template();
    expect(markup.match(/<button\b[^>]*\bdata-ready(?:\s|>)/g)).toHaveLength(1);
    expect(markup).toContain('id="objective-details" data-objective-details hidden inert');
    expect(markup).toContain('aria-controls="objective-details"');
    expect(markup).toContain('aria-describedby="objective-clock"');
    expect(markup).toContain("data-duel-compact");
    expect(markup).toContain("data-economy-hope-compact");
  });
});
