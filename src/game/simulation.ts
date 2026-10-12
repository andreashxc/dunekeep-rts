import { HUMAN_RELEASE_HEIGHT, HUMAN_TARGET_HEIGHT } from "./worldScale";
import { wallLine } from './wallLine';
import { terrainFor, terrainAt, terrainPassable, terrainBuildable } from './terrain';
import {
  ARMY_UNITS,
  BASE_STORAGE_CAPACITY,
  BUILDINGS,
  DIFFICULTIES,
  ECONOMY_TICK_SECONDS,
  GRANARY_GRAIN_BONUS,
  GRANARY_STORAGE_BONUS,
  GRID_SIZE,
  TILE_SIZE,
  MARKET_STORAGE_BONUS,
  MISSIONS,
  RATION_POLICIES,
  RESOURCE_KEYS,
  STOCKPILE_KEYS,
  TAX_POLICIES,
  TRADE_RATES,
} from "./content";
import type {
  ArmyCommandPoint,
  ArmyOrderKind,
  ArmyUnitOrderState,
  ArmyUnitKind,
  ArmyUnitState,
  BuildingKind,
  BuildingProductionSnapshot,
  BuildingState,
  CivilianState,
  ControllableEntityKind,
  DifficultyId,
  DuelCastleState,
  DuelSnapshot,
  DirectControlExitReason,
  DirectControlExitSnapshot,
  DirectControlInput,
  DirectControlSnapshot,
  EconomySnapshot,
  EnemyUnitKind,
  GameSnapshot,
  GameSaveDataV1,
  GameStatus,
  GarrisonBuildingKind,
  GridPoint,
  MissionDefinition,
  MissionId,
  MissionEventDefinition,
  MissionEventRecord,
  MissionWave,
  PopularityFactors,
  RaiderState,
  RationPolicy,
  ResourceKey,
  Resources,
  SimulationEvents,
  StockpiledResourceKey,
  StorageCapacity,
  TaxPolicy,
  TowerUpgradeKind,
  WorkPriority,
} from "./types";
import {
  enumerateConnectedFortificationSlots,
  garrisonCapacity,
  garrisonDeckHeight,
  garrisonSlotPosition,
  isGarrisonBuildingKind,
} from "./fortifications";
import { solveBallisticArc } from "./ballistics";
import {
  DUEL_DIFFICULTY_TUNING,
  TOWER_UPGRADES,
  canAfford as canEnemyAfford,
  chooseEnemyBuilding,
  chooseEnemyUnit,
  enemyBuildCandidates,
  enemyUnitStats,
  isSiegeKind,
  spendResources as spendEnemyResources,
} from "./duel";
import type { DuelDifficultyTuning } from "./duel";

interface PathPoint { x: number; z: number }
type HostileTarget = RaiderState | BuildingState;
interface CachedPath { revision: number; expires: number; points: PathPoint[]; targetId?: number }
interface CachedArmyPath extends CachedPath { targetX: number; targetZ: number }
interface DirectControlRuntime {
  entityKind: ControllableEntityKind;
  entityId: number;
  moveX: number;
  moveZ: number;
  heading: number;
  sprint: boolean;
  aimX: number;
  aimZ: number;
  aimPitch: number | null;
  attackQueued: boolean;
  dancing: boolean;
}
interface CivilianRouteRuntime {
  target: "home" | "work";
  points: PathPoint[];
  pointIndex: number;
  waitRemaining: number;
  navigationRevision: number;
  jobBuildingId: number | null;
}

const emptyResources = (): Resources => ({ wood: 0, stone: 0, food: 0, gold: 0, grain: 0, iron: 0, weapons: 0 });
const PRIORITY_ORDER: Record<WorkPriority, number> = { high: 0, normal: 1, low: 2 };
const FORMATION_SPACING = 0.72;
// Sprint is deliberately much faster than a normal third-person stride. The
// movement solver still applies collision and map clamps every tick, so this
// remains controllable around gates while making the run button worthwhile.
const DIRECT_SPRINT_MULTIPLIER = 2.2;
const UNIT_MAP_MARGIN = 0.16;
const ATTACK_POSE_SECONDS = 0.18;
const CIVILIAN_SPEED = 0.68;
const CIVILIAN_MAX_HP = 55;
const CIVILIAN_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const GARRISON_TRANSITION_SECONDS = 0.38;
const DIRECT_GARRISON_APPROACH_RADIUS = 0.48;
export const ENEMY_BUILDING_EXCLUSION_RADIUS = 5;
export const WELL_RECOVERY_RADIUS = 4;
export const WELL_SAFE_RADIUS = 6;
export const WELL_RECOVERY_MAX_HP_PER_SECOND = 0.04;
const DIRECT_ARCHER_SPEED = 9.5;
const DIRECT_ARCHER_GRAVITY = 9.81;
const DIRECT_ARCHER_GROUND_Y = 0.08;
const DIRECT_ARCHER_IMPACT_RADIUS = 0.52;

function stableUnitFraction(seed: number, salt: number): number {
  let value = (Math.trunc(seed) ^ salt) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

export class GameSimulation {
  private events: SimulationEvents;
  private economyRevision = 0;
  private productionCache: {key: string; value: {production: BuildingProductionSnapshot[]; resources: Resources; net: Resources}} | null = null;
  get isRunning(): boolean { return this.status === 'playing' && !this.planningPaused && this.preparationStarted; }

  private selectedMission: MissionId = "oasis";
  private selectedDifficulty: DifficultyId = "standard";
  private nextId = 1;
  private incomeClock = 0;
  private growthClock = 0;
  private status: GameStatus = "title";
  private elapsed = 0;
  private raidClock = 0;
  private preparationStarted = false;
  private timeScale: 1 | 2 = 1;
  private planningPaused = false;
  private resources: Resources = emptyResources();
  private taxPolicy: TaxPolicy = "standard";
  private rationPolicy: RationPolicy = "normal";
  private population = 0;
  private populationCap = 0;
  private hope = 0;
  private wave = 0;
  private buildings: BuildingState[] = [];
  private raiders: RaiderState[] = [];
  private army: ArmyUnitState[] = [];
  private civilianEntities: CivilianState[] = [];
  private rallyPoint: GridPoint = { gx: 8, gz: 8 };
  private navigationRevision = 0;
  private mapRulesVersion: 1 | 2 = 2;
  private productionAccess = new Map<"player" | "enemy", { revision: number; sources: string; connected: Set<number> }>();
  private paths = new Map<number, CachedPath>();
  private armyPaths = new Map<number, CachedArmyPath>();
  private selectedArmyUnitIds: number[] = [];
  private selectedCivilianId: number | null = null;
  private directControl: DirectControlRuntime | null = null;
  private lastDirectControlExit: DirectControlExitSnapshot | null = null;
  private armyAttackTimers = new Map<number, number>();
  private civilianRoutes = new Map<number, CivilianRouteRuntime>();
  private chronicle: MissionEventRecord[] = [];
  private triggeredEvents = new Set<string>();
  private scenarioEffects: Array<{ id: string; title: string; endsAt: number; foodProductionMultiplier: number }> = [];
  private missionCompleted = false;
  private duelCastle: DuelCastleState | null = null;

  constructor(events: SimulationEvents = {}) {
    this.events = events;
    this.resetState();
  }

  private get mission(): MissionDefinition {
    return MISSIONS[this.selectedMission];
  }

  private get gridSize(): number {
    return this.mission.gridSize ?? GRID_SIZE;
  }

  get snapshot(): GameSnapshot {
    const jobs = this.getJobCount();
    const currentWave = this.mission.waves[this.wave];
    const nextWave = this.preparationStarted && currentWave
      ? Math.max(0, this.scaledScenarioTime(currentWave.at) - this.raidClock)
      : null;
    const totalPopulation = this.population + this.getArmyPopulation();
    const nextEvent = this.mission.events.find((event) => !this.triggeredEvents.has(event.id));
    const controlledEntity = this.getDirectControlledEntity();
    const controlledArmyUnit = this.directControl?.entityKind === "army"
      ? this.army.find((unit) => unit.id === this.directControl!.entityId && unit.hp > 0)
      : undefined;
    const controlledArmyCanAct = Boolean(controlledArmyUnit
      && (!controlledArmyUnit.garrison || controlledArmyUnit.garrison.status === "stationed"));
    const directMountCandidate = controlledArmyUnit
      ? this.findDirectControlGarrisonCandidate(controlledArmyUnit)
      : null;
    const directControl: DirectControlSnapshot | null = this.directControl && controlledEntity ? {
      entityKind: this.directControl.entityKind,
      entityId: this.directControl.entityId,
      unitId: this.directControl.entityId,
      moveX: this.directControl.moveX,
      moveZ: this.directControl.moveZ,
      heading: this.directControl.heading,
      sprint: this.directControl.sprint,
      aimX: this.directControl.aimX,
      aimZ: this.directControl.aimZ,
      aimPitch: this.directControl.aimPitch,
      canAttack: controlledArmyCanAct,
      attackReady: Boolean(controlledArmyCanAct && controlledArmyUnit && controlledArmyUnit.cooldown <= 0),
      dancing: this.directControl.dancing,
      mountTarget: directMountCandidate ? {
        buildingId: directMountCandidate.building.id,
        buildingKind: directMountCandidate.building.kind,
      } : null,
    } : null;
    const duel = this.getDuelSnapshot();
    return {
      status: this.status,
      canCallTutorialRaid: this.canCallTutorialRaid,
      mapRulesVersion: this.mapRulesVersion,
      layoutRevision: this.navigationRevision,
      missionId: this.mission.id,
      missionName: this.mission.name,
      missionSubtitle: this.mission.subtitle,
      missionOrder: this.mission.order,
      difficultyId: this.selectedDifficulty,
      difficultyName: DIFFICULTIES[this.selectedDifficulty].label,
      mapTheme: this.mission.theme,
      gridSize: this.gridSize,
      keep: { ...this.mission.keep },
      resourceZones: this.mission.resourceZones,
      goalKind: this.mission.goalKind,
      goalLabel: this.mission.goalLabel,
      goalProgress: this.getGoalProgress(),
      goalTarget: this.mission.goalTarget,
      missionCompleted: this.missionCompleted,
      elapsed: this.elapsed,
      raidClock: this.raidClock,
      preparationStarted: this.preparationStarted,
      resources: { ...this.resources },
      economy: this.getEconomySnapshot(),
      population: totalPopulation,
      civilians: this.population,
      armyCount: this.army.length,
      populationCap: this.populationCap,
      hope: this.hope,
      wave: this.wave,
      waveCount: this.mission.waves.length,
      nextWaveIn: nextWave,
      enemiesAlive: this.raiders.length,
      jobs,
      freeWorkers: Math.max(0, this.population - jobs),
      timeScale: this.timeScale,
      timePaused: this.status !== "playing" || this.planningPaused || !this.preparationStarted,
      nextRaidDirection: currentWave?.direction ?? null,
      rallyPoint: { ...this.rallyPoint },
      selectedArmyUnitIds: [...this.selectedArmyUnitIds],
      selectedCivilianId: this.selectedCivilianId,
      directControl,
      lastDirectControlExit: this.lastDirectControlExit ? { ...this.lastDirectControlExit } : null,
      buildings: this.buildings,
      raiders: this.raiders,
      army: this.army,
      civilianEntities: this.civilianEntities,
      chronicle: this.chronicle,
      nextEvent: nextEvent ? {
        id: nextEvent.id, title: nextEvent.title, description: nextEvent.description,
        inSeconds: Math.max(0, nextEvent.at - this.raidClock),
      } : null,
      activeEffects: this.scenarioEffects.map((effect) => ({
        id: effect.id, title: effect.title,
        remainingSeconds: Math.max(0, effect.endsAt - this.raidClock),
        foodProductionMultiplier: effect.foodProductionMultiplier,
      })),
      duel,
    };
  }

  selectMission(id: MissionId): boolean {
    if (!Object.prototype.hasOwnProperty.call(MISSIONS, id) || this.status === "playing" || this.status === "paused") return false;
    this.selectedMission = id;
    this.resetState();
    this.setStatus("title");
    return true;
  }

  selectDifficulty(id: DifficultyId): boolean {
    if (!Object.prototype.hasOwnProperty.call(DIFFICULTIES, id) || this.status === "playing" || this.status === "paused") return false;
    this.selectedDifficulty = id;
    this.resetState();
    this.setStatus("title");
    return true;
  }

  returnToCampaign(): void {
    this.resetState();
    this.setStatus("title");
  }

  start(): void {
    if (this.status === "title" || this.status === "victory" || this.status === "defeat") this.resetState();
    this.setStatus("playing");
    this.events.onToast?.("Время остановлено. Разместите первые постройки, затем нажмите «Начать игру».", "info");
  }

  continueAfterVictory(): boolean {
    if (this.status !== "victory" || !this.missionCompleted) return false;
    if (this.duelCastle) this.raiders = [];
    this.setStatus("playing");
    this.events.onToast?.("Задание выполнено. Теперь можно свободно строить и развивать город.", "success");
    return true;
  }

  exportSave(savedAt = Date.now()): GameSaveDataV1 | null {
    if (this.status === "title" || this.status === "defeat") return null;
    return {
      version: 1,
      savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
      missionId: this.selectedMission,
      difficultyId: this.selectedDifficulty,
      status: this.status,
      state: {
        mapRulesVersion: this.mapRulesVersion,
        nextId: this.nextId,
        incomeClock: this.incomeClock,
        growthClock: this.growthClock,
        elapsed: this.elapsed,
        raidClock: this.raidClock,
        preparationStarted: this.preparationStarted,
        timeScale: this.timeScale,
        resources: { ...this.resources },
        taxPolicy: this.taxPolicy,
        rationPolicy: this.rationPolicy,
        population: this.population,
        populationCap: this.populationCap,
        hope: this.hope,
        wave: this.wave,
        buildings: this.buildings.map((building) => ({ ...building, trainingQueue: building.trainingQueue?.map(order => ({...order, cost: {...order.cost}})) })),
        raiders: this.raiders.map((raider) => ({ ...raider })),
        army: this.army.map((unit) => ({
          ...unit,
          order: unit.order ? { ...unit.order } : null,
          garrison: unit.garrison ? {
            ...unit.garrison,
            queuedGroundOrder: unit.garrison.queuedGroundOrder ? { ...unit.garrison.queuedGroundOrder } : null,
          } : null,
        })),
        civilianEntities: this.civilianEntities.map((civilian) => ({ ...civilian })),
        rallyPoint: { ...this.rallyPoint },
        selectedArmyUnitIds: [...this.selectedArmyUnitIds],
        selectedCivilianId: this.selectedCivilianId,
        chronicle: this.chronicle.map((entry) => ({ ...entry })),
        triggeredEvents: [...this.triggeredEvents],
        scenarioEffects: this.scenarioEffects.map((effect) => ({ ...effect })),
        missionCompleted: this.missionCompleted,
        duel: this.duelCastle ? {
          ...this.duelCastle,
          resources: { ...this.duelCastle.resources },
          buildings: this.duelCastle.buildings.map((building) => ({ ...building, trainingQueue: building.trainingQueue?.map(order => ({...order, cost: {...order.cost}})) })),
        } : null,
      },
    };
  }

  restoreSave(save: GameSaveDataV1): boolean {
    if (!this.isValidSave(save)) return false;
    const state = save.state;
    this.mapRulesVersion = state.mapRulesVersion ?? 1;
    this.selectedMission = save.missionId;
    this.selectedDifficulty = save.difficultyId;
    const savedDuelBuildings = state.duel?.buildings ?? [];
    this.nextId = Math.max(state.nextId, ...state.buildings.map(({ id }) => id + 1), ...savedDuelBuildings.map(({ id }) => id + 1), ...state.raiders.map(({ id }) => id + 1), ...state.army.map(({ id }) => id + 1), ...state.civilianEntities.map(({ id }) => id + 1));
    this.incomeClock = state.incomeClock;
    this.growthClock = state.growthClock;
    this.elapsed = state.elapsed;
    this.raidClock = state.raidClock;
    this.preparationStarted = state.preparationStarted;
    this.timeScale = state.timeScale;
    this.planningPaused = false;
    this.resources = { ...state.resources };
    this.taxPolicy = state.taxPolicy;
    this.rationPolicy = state.rationPolicy;
    this.population = state.population;
    this.populationCap = state.populationCap;
    this.hope = state.hope;
    this.wave = Math.min(state.wave, this.mission.waves.length);
    this.buildings = state.buildings.map((building) => ({ ...building, trainingQueue: building.trainingQueue?.map(order => ({...order, cost: {...order.cost}})), towerUpgrade: building.kind === "tower" ? building.towerUpgrade ?? "none" : undefined }));
    this.raiders = state.raiders.map((raider) => ({ ...raider, kind: raider.kind ?? "raider", stance: raider.stance ?? "assault" }));
    this.army = state.army.map((unit) => ({
      ...unit,
      order: unit.order ? { ...unit.order } : null,
      garrison: unit.garrison ? {
        ...unit.garrison,
        queuedGroundOrder: unit.garrison.queuedGroundOrder ? { ...unit.garrison.queuedGroundOrder } : null,
      } : null,
    }));
    this.civilianEntities = state.civilianEntities.map((civilian) => ({ ...civilian }));
    this.rallyPoint = { ...state.rallyPoint };
    this.selectedArmyUnitIds = [];
    this.selectedCivilianId = null;
    this.directControl = null;
    this.lastDirectControlExit = null;
    this.chronicle = state.chronicle.map((entry) => ({ ...entry }));
    this.triggeredEvents = new Set(state.triggeredEvents);
    this.scenarioEffects = state.scenarioEffects.map((effect) => ({ ...effect }));
    this.missionCompleted = state.missionCompleted || save.status === "victory";
    this.duelCastle = this.mission.duel
      ? state.duel ? {
        ...state.duel,
        assaultsDefeated: state.duel.assaultsDefeated ?? 0,
        fortificationsDestroyed: state.duel.fortificationsDestroyed ?? 0,
        resources: { ...state.duel.resources },
        buildings: state.duel.buildings.map((building) => ({
          ...building,
          towerUpgrade: building.kind === "tower" ? building.towerUpgrade ?? "none" : undefined,
        })),
      } : this.createDuelCastle()
      : null;
    if (this.missionCompleted && this.duelCastle) {
      const keep = this.duelCastle.buildings.find((building) => building.kind === "keep");
      if (keep) keep.hp = keep.maxHp;
      this.raiders = [];
      for (const unit of this.army) {
        unit.targetId = null;
        if (unit.order?.targetBuildingId !== undefined) unit.order = null;
        if (unit.garrison?.queuedGroundOrder?.targetBuildingId !== undefined) unit.garrison.queuedGroundOrder = null;
      }
    }
    this.navigationRevision += 1;
    this.paths.clear();
    this.armyPaths.clear();
    this.armyAttackTimers.clear();
    this.civilianRoutes.clear();
    this.setStatus(save.status);
    return true;
  }

  beginPreparation(): boolean {
    if (this.status !== "playing" || this.preparationStarted) return false;
    this.preparationStarted = true;
    const first = this.mission.waves[0];
    this.events.onToast?.(this.mission.duel
      ? `Дуэль началась. ${this.mission.duel.enemyName} уже добывает ресурсы и строит свой замок.`
      : `Игра началась. Первая опасность: ${first.direction}, через ${this.formatTime(this.scaledScenarioTime(first.at))}.`, "info");
    return true;
  }

  restart(): void {
    this.resetState();
    this.setStatus("playing");
    this.events.onToast?.("Караван пополнен. Подготовьте крепость и нажмите «Начать игру».", "info");
  }

  togglePause(): void {
    if (this.status === "playing") {
      if (this.directControl) this.directControl.attackQueued = false;
      this.setStatus("paused");
    }
    else if (this.status === "paused") this.setStatus("playing");
  }

  setTimeScale(value: 1 | 2): void {
    this.timeScale = value;
  }

  setPlanningPaused(value: boolean): void {
    this.planningPaused = value;
    if (value && this.directControl) this.directControl.attackQueued = false;
  }

  setTaxPolicy(policy: TaxPolicy): boolean {
    if (this.status !== "playing" || !Object.prototype.hasOwnProperty.call(TAX_POLICIES, policy)) return false;
    this.taxPolicy = policy;
    this.events.onToast?.(`Налоги: ${TAX_POLICIES[policy].label}.`, "info");
    return true;
  }

  setRationPolicy(policy: RationPolicy): boolean {
    if (this.status !== "playing" || !Object.prototype.hasOwnProperty.call(RATION_POLICIES, policy)) return false;
    this.rationPolicy = policy;
    this.events.onToast?.(`Рационы: ${RATION_POLICIES[policy].label}.`, "info");
    return true;
  }

  setBuildingEnabled(id: number, enabled: boolean): boolean {
    if (this.status !== "playing") return false;
    const building = this.buildings.find((item) => item.id === id);
    if (!building || !(BUILDINGS[building.kind].workers ?? 0)) return false;
    building.enabled = enabled;
    this.economyRevision++;
    this.reconcileCivilianJobs();
    this.events.onToast?.(`${BUILDINGS[building.kind].shortName}: ${enabled ? "работа возобновлена" : "работники освобождены"}.`, "info");
    return true;
  }

  setBuildingPriority(id: number, priority: WorkPriority): boolean {
    if (this.status !== "playing" || !Object.prototype.hasOwnProperty.call(PRIORITY_ORDER, priority)) return false;
    const building = this.buildings.find((item) => item.id === id);
    if (!building || !(BUILDINGS[building.kind].workers ?? 0)) return false;
    building.priority = priority;
    this.economyRevision++;
    this.reconcileCivilianJobs();
    return true;
  }

  previewWallLine(start: GridPoint, end: GridPoint) {
    const cells = wallLine(start,end);
    const cost = cells.length * (BUILDINGS.wall.cost.stone ?? 0);
    const invalid = cells.map(p=>this.canPlace('wall',p.gx,p.gz)).find(p=>!p.valid);
    const reason = !cells.length ? 'Выберите клетки стены' : invalid?.reason ?? (this.resources.stone < cost ? 'Не хватает камня на всю линию' : undefined);
    return {cells,cost,valid:!reason,reason};
  }
  placeWallLine(start: GridPoint,end: GridPoint): boolean {
    const plan = this.previewWallLine(start,end);
    if (!plan.valid) return this.reject(plan.reason ?? 'Нельзя построить линию');
    // Entire line is checked before any resource is spent. No asynchronous work in this transaction.
    for (const p of plan.cells) this.place('wall',p.gx,p.gz);
    return true;
  }
  get canCallTutorialRaid(): boolean {
    const foods = this.buildings.filter(b=>b.hp>0 && ['farm','wheatFarm','bakery'].includes(b.kind)).length;
    const armed = this.buildings.some(b=>b.hp>0 && b.kind==='tower' && b.enabled && ((b.towerUpgrade ?? 'none')!=='none'
      || this.army.some(u=>u.kind==='archer'&&u.garrison?.buildingId===b.id&&u.garrison.status==='stationed')));
    return this.isRunning && this.selectedMission==='oasis' && this.wave===0 && foods>=2 && armed && this.army.length>=2;
  }
  callTutorialRaid(): boolean {
    if (!this.canCallTutorialRaid) return this.reject('Подготовьте еду, действующую башню и двух бойцов.');
    this.spawnWave(this.mission.waves[0],1); this.wave=1;
    this.events.onToast?.('Учебный набег начался — защитите поселение.', 'danger');
    return true;
  }

  canAfford(kind: BuildingKind): boolean {
    return this.canAffordCost(BUILDINGS[kind].cost);
  }

  canPlace(kind: BuildingKind, gx: number, gz: number): { valid: boolean; reason?: string } {
    if (this.status !== "playing") return { valid: false, reason: "Игра приостановлена" };
    if (kind === "keep") return { valid: false, reason: "Цитадель уже построена" };
    if (gx < 0 || gz < 0 || gx >= this.gridSize || gz >= this.gridSize) return { valid: false, reason: "За границей владений" };
    if (!Number.isInteger(gx) || !Number.isInteger(gz)) return { valid: false, reason: "Выберите целую клетку" };
    const terrain = terrainAt(terrainFor(this.selectedMission, this.mapRulesVersion), gx, gz);
    if (!terrainBuildable(terrain)) return { valid: false, reason: terrain === 'water' ? 'Вода — стройте на берегу' : terrain === 'crossing' ? 'Оставьте переправу свободной' : 'Скалы — выберите ровную землю' };
    const duel = this.mission.duel;
    if (duel && (gx < duel.playerBuildArea.minGx || gx > duel.playerBuildArea.maxGx
      || gz < duel.playerBuildArea.minGz || gz > duel.playerBuildArea.maxGz)) {
      return { valid: false, reason: "Здесь нельзя строить: центральная полоса и земли соперника должны оставаться свободными" };
    }
    if (!duel && kind === "siegeWorkshop") return { valid: false, reason: "Осадный двор доступен в финальной дуэли" };
    const protectedZones = [this.mission.resourceZones.lumber, this.mission.resourceZones.quarry, this.mission.resourceZones.iron,
      ...(duel ? [duel.enemyResourceZones.lumber, duel.enemyResourceZones.quarry, duel.enemyResourceZones.iron] : [])];
    if (protectedZones.some((zone) => zone.gx === gx && zone.gz === gz)) {
      return { valid: false, reason: "Ресурсный выход нельзя застроить — разместите двор рядом" };
    }
    if (kind === "ironMine" && Math.hypot(gx - this.mission.resourceZones.iron.gx, gz - this.mission.resourceZones.iron.gz) > 4) {
      return { valid: false, reason: "Рудник должен стоять в пределах 4 клеток от железной жилы" };
    }
    if (this.buildings.some((building) => building.gx === gx && building.gz === gz)
      || this.duelCastle?.buildings.some((building) => building.gx === gx && building.gz === gz)) return { valid: false, reason: "Клетка занята" };
    if (this.hasEnemyWithinBuildingDistance(gx, gz)) {
      return { valid: false, reason: "Слишком близко к противнику — отойдите дальше чем на 5 клеток" };
    }
    if (!this.canAfford(kind)) return { valid: false, reason: "Не хватает ресурсов" };
    return { valid: true };
  }

  getPlacementEfficiency(kind: BuildingKind, gx: number, gz: number): number {
    if (kind === "farm" || kind === "wheatFarm") {
      const zone = this.mission.resourceZones.fertile;
      const distance = Math.hypot(gx - zone.gx, gz - zone.gz);
      const aridity = this.mission.id === "salt" ? 0.88 : 1;
      return this.round(Math.max(0.65, Math.min(1.25, 1.3 - distance * 0.055)) * aridity);
    }
    if (kind !== "lumber" && kind !== "quarry" && kind !== "ironMine") return 1;
    const zone = this.mission.resourceZones[kind === "ironMine" ? "iron" : kind];
    const distance = Math.hypot(gx - zone.gx, gz - zone.gz);
    return Math.round(Math.max(0.35, Math.min(1.4, 1.52 - distance * 0.12)) * 100) / 100;
  }

  place(kind: BuildingKind, gx: number, gz: number): boolean {
    const check = this.canPlace(kind, gx, gz);
    if (!check.valid) {
      this.events.onToast?.(check.reason ?? "Здесь нельзя строить", "danger");
      this.events.onSound?.("error");
      return false;
    }
    const definition = BUILDINGS[kind];
    this.spend(definition.cost);
    const building = this.addBuilding(kind, gx, gz);
    if (kind === "house") {
      this.populationCap += 4;
      this.hope = Math.min(100, this.hope + 3);
    }
    if ((kind === "lumber" || kind === "quarry" || kind === "ironMine") && building.efficiency >= 1.15) {
      this.events.onToast?.(`${definition.shortName}: богатое место, эффективность ${Math.round(building.efficiency * 100)}%.`, "success");
    } else {
      this.events.onToast?.(`${definition.name}: строительство завершено.`, "success");
    }
    this.navigationRevision += 1;
    this.paths.clear();
    this.reconcileCivilianJobs();
    this.events.onSound?.("build");
    return true;
  }

  demolish(id: number): boolean {
    if (this.status !== "playing" || this.planningPaused) return this.reject("Снос недоступен, пока время остановлено.");
    const building = this.buildings.find((item) => item.id === id);
    if (!building || building.kind === "keep") return false;
    if (this.army.some((unit) => unit.garrison?.buildingId === building.id)) {
      return this.reject("Сначала спустите гарнизон с этого укрепления.");
    }
    for (const order of building.trainingQueue ?? []) {
      for (const key of Object.keys(order.cost) as ResourceKey[]) this.resources[key] += order.cost[key] ?? 0;
    }
    this.removeBuilding(building);
    const refund = BUILDINGS[building.kind].cost;
    for (const key of Object.keys(refund) as ResourceKey[]) this.resources[key] += Math.floor((refund[key] ?? 0) * 0.4);
    this.clampResourcesToCapacity();
    this.events.onToast?.("Здание разобрано. Возвращено 40% материалов.", "info");
    return true;
  }

  repair(id: number): boolean {
    if (this.status !== "playing" || this.planningPaused) return this.reject("Ремонт недоступен, пока время остановлено.");
    const building = this.buildings.find((item) => item.id === id);
    if (!building || building.hp >= building.maxHp || (building.repairRemaining ?? 0) > 0) return false;
    if (this.hasEnemyWithinBuildingDistance(building.gx, building.gz)) {
      return this.reject("Ремонт невозможен: противник находится в пределах 5 клеток.");
    }
    const missingRatio = (building.maxHp - building.hp) / building.maxHp;
    const baseStone = building.kind === "keep" ? 65 : Math.max(10, BUILDINGS[building.kind].cost.stone ?? 12);
    const stoneCost = Math.max(4, Math.ceil(baseStone * missingRatio * 0.55));
    const woodCost = building.kind === "wall" ? 0 : Math.max(0, Math.ceil(12 * missingRatio));
    if (this.resources.stone < stoneCost || this.resources.wood < woodCost) {
      this.events.onToast?.(`Для ремонта нужно Д ${woodCost} · К ${stoneCost}.`, "danger");
      this.events.onSound?.("error");
      return false;
    }
    this.resources.stone -= stoneCost;
    this.resources.wood -= woodCost;
    building.repairRemaining = building.maxHp - building.hp;
    this.events.onToast?.(`Ремонт начат: Д ${woodCost} · К ${stoneCost}.`, "success");
    this.events.onSound?.("build");
    return true;
  }

  upgradeTower(id: number, upgrade: Exclude<TowerUpgradeKind, "none">): boolean {
    if (this.status !== "playing" || this.planningPaused) return this.reject("Улучшение недоступно, пока время остановлено.");
    const building = this.buildings.find((item) => item.id === id && item.kind === "tower" && item.hp > 0);
    const definition = TOWER_UPGRADES[upgrade];
    if (!building || !definition) return false;
    if ((building.towerUpgrade ?? "none") !== "none") {
      return this.reject("Оружие башни уже выбрано. Для смены модуля потребуется построить новую башню.");
    }
    if (this.hasEnemyWithinBuildingDistance(building.gx, building.gz)) {
      return this.reject("Улучшение невозможно: противник находится в пределах 5 клеток.");
    }
    if (!this.canAffordCost(definition.cost)) return this.reject("Не хватает запасов для модуля башни.");
    this.spend(definition.cost);
    building.towerUpgrade = upgrade;
    this.economyRevision++;
    building.cooldown = Math.max(building.cooldown, 0.6);
    this.events.onToast?.(`${definition.name} установлена на башне.`, "success");
    this.events.onSound?.("build");
    return true;
  }

  /** UI recruitment reserves supplies immediately; only simulation time completes orders. */
  enqueueUnit(kind: ArmyUnitKind, buildingId: number): boolean {
    if (!['playing', 'paused'].includes(this.status)) return false;
    const definition = ARMY_UNITS[kind];
    const building = this.buildings.find(item => item.id === buildingId && item.hp > 0);
    if (!definition || !building || building.kind !== definition.trainedAt) return false;
    const allOrders = this.buildings.flatMap(item => item.trainingQueue ?? []);
    const reservedCrew = allOrders.reduce((sum, order) => sum + (ARMY_UNITS[order.kind].populationCost ?? 1), 0);
    if ((building.trainingQueue?.length ?? 0) >= 5) return this.reject('В очереди уже пять бойцов.');
    if (this.army.length + allOrders.length >= 24) return this.reject('Лимит армии с учётом очереди — 24.');
    if (this.population - this.getJobCount() - reservedCrew < (definition.populationCost ?? 1)) return this.reject('Нет свободных жителей для очереди.');
    if (!this.canAffordCost(definition.cost)) return this.reject('Не хватает припасов для обучения.');
    const duration = isSiegeKind(kind) ? kind === 'catapult' ? 18 : 14 : kind === 'spearman' ? 5 : kind === 'archer' ? 7 : 10;
    this.spend(definition.cost);
    (building.trainingQueue ??= []).push({kind, remaining: duration, duration, cost: {...definition.cost}});
    return true;
  }

  cancelTraining(buildingId: number, index: number): boolean {
    if (!['playing', 'paused'].includes(this.status) || !Number.isInteger(index) || index < 0) return false;
    const queue = this.buildings.find(item => item.id === buildingId)?.trainingQueue;
    if (!queue?.[index]) return false;
    const [order] = queue.splice(index, 1);
    for (const key of RESOURCE_KEYS) this.resources[key] += order.cost[key] ?? 0;
    this.clampResourcesToCapacity();
    return true;
  }

  private updateConstructionWork(dt: number): void {
    for (const building of this.buildings) {
      if ((building.repairRemaining ?? 0) > 0 && !this.hasEnemyWithinBuildingDistance(building.gx, building.gz)) {
        const restored = Math.min(building.repairRemaining!, building.maxHp - building.hp, building.maxHp * .04 * dt);
        building.hp += restored;
        building.repairRemaining = Math.max(0, building.repairRemaining! - restored);
        if (building.hp >= building.maxHp) building.repairRemaining = 0;
      }
      const order = building.trainingQueue?.[0];
      if (!order) continue;
      order.remaining = Math.max(0, order.remaining - dt);
      const definition = ARMY_UNITS[order.kind];
      if (order.remaining > 0 || this.population - this.getJobCount() < (definition.populationCost ?? 1) || this.army.length >= 24) continue;
      this.population -= definition.populationCost ?? 1;
      this.syncCivilianPopulation('civilian-departed');
      this.createTrainedUnit(order.kind, building);
      building.trainingQueue!.shift();
      this.events.onToast?.(`${definition.name}: обучение завершено.`, 'success');
    }
  }

  private createTrainedUnit(kind: ArmyUnitKind, building: BuildingState): void {
    const definition = ARMY_UNITS[kind];
    const spawn = this.findOpenFormationPoint({x: building.gx + .8, z: building.gz + .8}, []);
    this.army.push({id: this.nextId++, kind, x: spawn.x, z: spawn.z,
      hp: definition.maxHp, maxHp: definition.maxHp, speed: definition.speed,
      damage: definition.damage, range: definition.range, cooldown: .35, targetId: null,
      heading: 0, movement: 'idle', order: null, garrison: null, attacking: false, attackPulse: 0});
  }

  trainUnit(kind: ArmyUnitKind, buildingId: number): boolean {
    if (this.status !== "playing" || this.planningPaused) return this.reject("Обучение доступно только во время игры.");
    const definition = ARMY_UNITS[kind];
    const building = this.buildings.find((item) => item.id === buildingId);
    if (!building || building.kind !== definition.trainedAt) return false;
    if (building.cooldown > 0) return this.reject(`Подготовка следующего бойца: ${Math.ceil(building.cooldown)} сек.`);
    if (this.army.length >= 24) return this.reject("Лимит армии — 24 бойца.");
    const crew = definition.populationCost ?? 1;
    if (this.population - this.getJobCount() < crew) return this.reject(`Нужно свободных жителей: ${crew}.`);
    if (!this.canAffordCost(definition.cost)) return this.reject("Не хватает припасов для обучения.");
    this.spend(definition.cost);
    this.population -= crew;
    this.syncCivilianPopulation("civilian-departed");
    const unit: ArmyUnitState = {
      id: this.nextId++, kind,
      x: building.gx + 0.45, z: building.gz + 0.45,
      hp: definition.maxHp, maxHp: definition.maxHp,
      speed: definition.speed, damage: definition.damage, range: definition.range,
      cooldown: 0.35, targetId: null,
      heading: 0, movement: "idle", order: null, garrison: null, attacking: false, attackPulse: 0,
    };
    this.army.push(unit);
    building.cooldown = this.preparationStarted
      ? isSiegeKind(kind) ? kind === "catapult" ? 18 : 14
        : kind === "spearman" ? 5 : kind === "archer" ? 7 : 10
      : 0;
    this.events.onToast?.(isSiegeKind(kind) ? `${definition.name} готова к походу.` : `${definition.name} вступил в гарнизон.`, "success");
    this.events.onSound?.("build");
    return true;
  }

  setRallyPoint(gx: number, gz: number): boolean {
    if (this.status !== "playing" || gx < 0 || gz < 0 || gx >= this.gridSize || gz >= this.gridSize) return false;
    if (this.directControl?.entityKind === "army") this.leaveDirectControl("strategy-order");
    const resolved = this.findOpenFormationPoint(this.clampArmyPoint({ x: gx, z: gz }), []);
    this.rallyPoint = { gx: resolved.x, gz: resolved.z };
    for (const unit of this.army) {
      unit.targetId = null;
      if (!unit.garrison) unit.order = null;
    }
    this.armyPaths.clear();
    const adjusted = Math.hypot(resolved.x - gx, resolved.z - gz) > 0.05;
    this.events.onToast?.(
      adjusted
        ? `Точка сбора сдвинута к свободному проходу: ${Math.round(resolved.x) + 1}:${Math.round(resolved.z) + 1}.`
        : `Точка сбора: ${gx + 1}:${gz + 1}.`,
      "info",
    );
    return true;
  }

  selectArmyUnits(unitIds: readonly number[]): readonly number[] {
    const alive = new Set(this.army.filter((unit) => unit.hp > 0).map((unit) => unit.id));
    this.selectedArmyUnitIds = [...new Set(unitIds)].filter((id) => Number.isInteger(id) && alive.has(id));
    this.selectedCivilianId = null;
    if (this.directControl && (this.directControl.entityKind !== "army" || !this.selectedArmyUnitIds.includes(this.directControl.entityId))) {
      this.leaveDirectControl("selection-changed");
    }
    return [...this.selectedArmyUnitIds];
  }

  clearArmySelection(): void {
    if (this.directControl?.entityKind === "army") this.leaveDirectControl("selection-changed");
    this.selectedArmyUnitIds = [];
  }

  selectCivilian(civilianId: number): boolean {
    const civilian = this.civilianEntities.find((candidate) => candidate.id === civilianId && candidate.hp > 0);
    if (!civilian) return false;
    if (this.directControl && (this.directControl.entityKind !== "civilian" || this.directControl.entityId !== civilianId)) {
      this.leaveDirectControl("selection-changed");
    }
    this.selectedArmyUnitIds = [];
    this.selectedCivilianId = civilianId;
    return true;
  }

  clearCivilianSelection(): void {
    if (this.directControl?.entityKind === "civilian") this.leaveDirectControl("selection-changed");
    this.selectedCivilianId = null;
  }

  holdSelectedArmy(): boolean {
    if (!['playing','paused'].includes(this.status)) return false;
    const selected = this.army.filter(u => this.selectedArmyUnitIds.includes(u.id));
    for (const unit of selected) {
      unit.order = {kind: 'move', status: 'holding', holdPosition: true, anchorX: unit.x, anchorZ: unit.z, destinationX: unit.x, destinationZ: unit.z};
      unit.targetId = null; this.armyPaths.delete(unit.id);
    }
    return selected.length > 0;
  }

  issueArmyOrder(kind: ArmyOrderKind, target: ArmyCommandPoint): boolean {
    if ((this.status !== "playing" && this.status !== "paused")
      || (kind !== "move" && kind !== "attack-move")
      || !Number.isFinite(target.x) || !Number.isFinite(target.z)) return false;
    const selected = this.army
      .filter((unit) => unit.hp > 0 && this.selectedArmyUnitIds.includes(unit.id))
      .sort((a, b) => a.id - b.id);
    if (selected.length === 0) return false;
    if (this.directControl?.entityKind === "army" && selected.some((unit) => unit.id === this.directControl!.entityId)) {
      this.leaveDirectControl("strategy-order");
    }
    const anchor = this.clampArmyPoint(target);
    if (!terrainPassable(terrainAt(terrainFor(this.selectedMission,this.mapRulesVersion),anchor.x,anchor.z))) return this.reject('Цель недоступна — выберите берег или переправу.');
    const destinations = this.getFormationDestinations(selected, anchor);
    let dismounting = 0;
    selected.forEach((unit, index) => {
      const destination = destinations[index];
      const order: ArmyUnitOrderState = {
        kind, status: "moving",
        anchorX: anchor.x, anchorZ: anchor.z,
        destinationX: destination.x, destinationZ: destination.z,
      };
      unit.targetId = null;
      this.armyPaths.delete(unit.id);
      if (unit.garrison) {
        dismounting += 1;
        this.beginGarrisonDismount(unit, order);
      } else {
        unit.order = order;
      }
    });
    this.events.onToast?.(
      `${kind === "attack-move" ? "Наступление" : "Марш"}: ${selected.length} бойцов${dismounting ? ` · ${dismounting} сначала спустятся` : ""}.`,
      "info",
    );
    return true;
  }

  issueArmyAttackBuildingOrder(buildingId: number): boolean {
    if (this.missionCompleted) return false;
    const building = this.duelCastle?.buildings.find((candidate) => candidate.id === buildingId && candidate.hp > 0);
    if (!building) return false;
    if (!this.issueArmyOrder("attack-move", { x: building.gx, z: building.gz })) return false;
    const reservedApproaches: ArmyCommandPoint[] = [];
    for (const unit of this.army.filter((candidate) => this.selectedArmyUnitIds.includes(candidate.id) && candidate.hp > 0)
      .sort((a, b) => a.id - b.id)) {
      unit.targetId = building.id;
      const order = unit.order ?? unit.garrison?.queuedGroundOrder;
      if (order?.kind !== "attack-move") continue;
      order.targetBuildingId = building.id;
      if (unit.kind === "catapult") {
        const approach = this.findSiegeFiringPosition(unit.x, unit.z, building,
          unit.range, ARMY_UNITS.catapult.minRange ?? 0, false, reservedApproaches);
        if (approach) {
          order.destinationX = approach.x;
          order.destinationZ = approach.z;
          reservedApproaches.push(approach);
        }
      }
    }
    this.events.onToast?.(`Цель выбрана: ${BUILDINGS[building.kind].name}.`, "info");
    return true;
  }

  isGarrisonTarget(buildingId: number): boolean {
    const building = this.buildings.find((candidate) => candidate.id === buildingId && candidate.hp > 0);
    return Boolean(building && this.isGarrisonBuilding(building));
  }

  issueArmyGarrisonOrder(buildingId: number): boolean {
    if (this.status !== "playing" && this.status !== "paused") return false;
    const target = this.buildings.find((candidate) => candidate.id === buildingId && candidate.hp > 0);
    if (!target || !this.isGarrisonBuilding(target)) return false;
    const selected = this.army
      .filter((unit) => unit.hp > 0 && this.selectedArmyUnitIds.includes(unit.id))
      .sort((a, b) => a.id - b.id);
    if (selected.length === 0) return false;
    const eligible = selected.filter((unit) => unit.kind === "archer" || unit.kind === "spearman");
    if (eligible.length === 0) {
      return this.reject(selected.some((unit) => unit.kind === "knight")
        ? "Конница не может подниматься на стены и башни."
        : "На укрепления можно поставить лучников и копейщиков.");
    }
    const alreadyAssigned = eligible.filter((unit) => unit.garrison);
    const placeable = eligible.filter((unit) => !unit.garrison);
    if (placeable.length === 0) {
      this.events.onToast?.("Выбранные лучники и копейщики уже находятся на укреплениях.", "info");
      return true;
    }
    const reassignedIds = new Set(placeable.map((unit) => unit.id));
    const reserved = new Set(this.army
      .filter((unit) => unit.hp > 0 && unit.garrison && !reassignedIds.has(unit.id))
      .map((unit) => `${unit.garrison!.buildingId}:${unit.garrison!.slot}`));
    const slots = enumerateConnectedFortificationSlots(target, this.buildings)
      .filter((slot) => !reserved.has(`${slot.buildingId}:${slot.slot}`));
    if (slots.length === 0) return this.reject("На этом участке укреплений нет свободных мест.");

    const approaches: ArmyCommandPoint[] = [];
    const assignments: Array<{
      unit: ArmyUnitState;
      slot: (typeof slots)[number];
      building: BuildingState;
      approach: ArmyCommandPoint;
    }> = [];
    const remainingSlots = [...slots];
    for (const unit of placeable) {
      let assignment: (typeof assignments)[number] | undefined;
      for (let slotIndex = 0; slotIndex < remainingSlots.length && !assignment; slotIndex += 1) {
        const slot = remainingSlots[slotIndex];
        const building = this.buildings.find((candidate) => candidate.id === slot.buildingId)!;
        const approach = this.findGarrisonApproach(unit, building, approaches);
        if (approach) {
          assignment = { unit, slot, building, approach };
          remainingSlots.splice(slotIndex, 1);
        }
      }
      if (!assignment) continue;
      assignments.push(assignment);
      approaches.push(assignment.approach);
    }
    if (assignments.length === 0) return this.reject("К этому участку укреплений нет свободного подхода.");
    if (this.directControl?.entityKind === "army" && assignments.some(({ unit }) => unit.id === this.directControl!.entityId)) {
      this.leaveDirectControl("strategy-order");
    }
    for (const { unit, slot, building, approach } of assignments) {
      unit.garrison = {
        buildingId: building.id,
        buildingKind: slot.buildingKind,
        slot: slot.slot,
        status: "approaching",
        transition: 0,
        approachX: approach.x,
        approachZ: approach.z,
        deckX: slot.x,
        deckZ: slot.z,
        deckY: garrisonDeckHeight(slot.buildingKind),
        queuedGroundOrder: null,
      };
      unit.order = {
        kind: "garrison",
        status: "moving",
        anchorX: target.gx,
        anchorZ: target.gz,
        destinationX: approach.x,
        destinationZ: approach.z,
      };
      unit.targetId = null;
      this.armyPaths.delete(unit.id);
    }
    const assigned = assignments.length;
    const blockedKinds = selected.length - eligible.length;
    const overflow = placeable.length - assigned;
    const notes = [
      blockedKinds > 0 ? `${blockedKinds} неподходящих бойцов остались внизу` : "",
      alreadyAssigned.length > 0 ? `${alreadyAssigned.length} уже на укреплениях` : "",
      overflow > 0 ? `${overflow} бойцам не хватило места` : "",
    ].filter(Boolean);
    this.events.onToast?.(
      `${assigned} ${assigned === 1 ? "боец поднимается" : "бойца поднимаются"} на укрепления${notes.length ? ` · ${notes.join(" · ")}` : ""}.`,
      notes.length ? "info" : "success",
    );
    return assigned > 0;
  }

  enterDirectControl(unitId: number): boolean {
    return this.enterDirectControlEntity("army", unitId);
  }

  enterCivilianDirectControl(civilianId: number): boolean {
    return this.enterDirectControlEntity("civilian", civilianId);
  }

  enterDirectControlEntity(entityKind: ControllableEntityKind, entityId: number): boolean {
    if ((entityKind !== "army" && entityKind !== "civilian")
      || (this.status !== "playing" && this.status !== "paused")) return false;
    const entity = entityKind === "army"
      ? this.army.find((candidate) => candidate.id === entityId && candidate.hp > 0)
      : this.civilianEntities.find((candidate) => candidate.id === entityId && candidate.hp > 0);
    if (!entity) return false;
    if (entityKind === "army" && isSiegeKind((entity as ArmyUnitState).kind)) {
      return this.reject("Осадной машиной можно управлять только с тактической карты.");
    }
    if (this.directControl && (this.directControl.entityKind !== entityKind || this.directControl.entityId !== entityId)) {
      this.leaveDirectControl("unit-switched");
    }
    entity.movement = "idle";
    if (entityKind === "army") {
      const unit = entity as ArmyUnitState;
      if (unit.garrison?.status === "approaching") {
        unit.garrison = null;
        unit.order = null;
      } else if (!unit.garrison) {
        unit.order = null;
      }
      unit.targetId = null;
      this.armyPaths.delete(unit.id);
      this.selectedArmyUnitIds = [unit.id];
      this.selectedCivilianId = null;
    } else {
      const civilian = entity as CivilianState;
      civilian.activity = "controlled";
      this.selectedCivilianId = civilian.id;
      this.selectedArmyUnitIds = [];
    }
    this.directControl = {
      entityKind,
      entityId,
      moveX: 0,
      moveZ: 0,
      heading: entity.heading,
      sprint: false,
      aimX: entity.x + Math.sin(entity.heading),
      aimZ: entity.z + Math.cos(entity.heading),
      aimPitch: null,
      attackQueued: false,
      dancing: false,
    };
    return true;
  }

  exitDirectControl(): boolean {
    return this.leaveDirectControl("manual");
  }

  setDirectControlInput(input: DirectControlInput): boolean {
    const control = this.directControl;
    const entity = this.getDirectControlledEntity();
    if (!control || !entity || !Number.isFinite(input.moveX) || !Number.isFinite(input.moveZ) || !Number.isFinite(input.heading)) return false;
    const hasAim = input.aimX !== undefined || input.aimZ !== undefined;
    if (hasAim && (!Number.isFinite(input.aimX) || !Number.isFinite(input.aimZ))) return false;
    if (input.aimPitch !== undefined && !Number.isFinite(input.aimPitch)) return false;
    const length = Math.hypot(input.moveX, input.moveZ);
    // Keyboard vectors arrive at magnitude 1, while the mobile joystick carries
    // a deliberate analogue magnitude after its dead-zone/response curve. Keep
    // values inside the unit circle intact and only clamp over-range callers.
    const garrison = "garrison" in entity ? entity.garrison : null;
    const movementLocked = Boolean(garrison && garrison.status !== "stationed");
    control.moveX = movementLocked || length <= 0.000001 ? 0 : length > 1 ? input.moveX / length : input.moveX;
    control.moveZ = movementLocked || length <= 0.000001 ? 0 : length > 1 ? input.moveZ / length : input.moveZ;
    control.heading = this.normalizeAngle(input.heading);
    control.sprint = garrison ? false : movementLocked ? false : Boolean(input.sprint);
    if (length > 0.000001) {
      control.dancing = false;
    }
    if (hasAim) {
      control.aimX = input.aimX!;
      control.aimZ = input.aimZ!;
    }
    if (input.aimPitch !== undefined) control.aimPitch = Math.max(-1.2, Math.min(1.2, input.aimPitch));
    return true;
  }

  setDirectControlAim(target: ArmyCommandPoint & { pitch?: number }): boolean {
    if (!this.directControl || !Number.isFinite(target.x) || !Number.isFinite(target.z)) return false;
    if (target.pitch !== undefined && !Number.isFinite(target.pitch)) return false;
    this.directControl.aimX = target.x;
    this.directControl.aimZ = target.z;
    if (target.pitch !== undefined) this.directControl.aimPitch = Math.max(-1.2, Math.min(1.2, target.pitch));
    return true;
  }

  requestDirectControlAttack(target?: ArmyCommandPoint & { pitch?: number }): boolean {
    const control = this.directControl;
    const unit = control?.entityKind === "army"
      ? this.army.find((candidate) => candidate.id === control.entityId && candidate.hp > 0)
      : undefined;
    if (!control || !unit || (unit.garrison && unit.garrison.status !== "stationed")) return false;
    control.dancing = false;
    if (unit.cooldown > 0 || this.status !== "playing" || this.planningPaused || !this.preparationStarted) return false;
    if (target && !this.setDirectControlAim(target)) return false;
    control.attackQueued = true;
    return true;
  }

  toggleDirectControlDance(): boolean {
    const control = this.directControl;
    if (!control || this.status !== "playing" || this.planningPaused || !this.preparationStarted) return false;
    const unit = control.entityKind === "army"
      ? this.army.find((candidate) => candidate.id === control.entityId && candidate.hp > 0)
      : undefined;
    if (unit?.garrison && unit.garrison.status !== "stationed") return false;
    control.dancing = !control.dancing;
    if (control.dancing) {
      control.moveX = 0;
      control.moveZ = 0;
      control.sprint = false;
      control.attackQueued = false;
    }
    return control.dancing;
  }

  requestDirectControlDismount(): boolean {
    const control = this.directControl;
    const unit = control?.entityKind === "army"
      ? this.army.find((candidate) => candidate.id === control.entityId && candidate.hp > 0)
      : undefined;
    if (!control || !unit?.garrison || unit.garrison.status === "approaching" || unit.garrison.status === "dismounting") return false;
    if (this.status !== "playing" || this.planningPaused || !this.preparationStarted) {
      return this.reject("Спуск доступен, когда время идёт.");
    }
    control.dancing = false;
    control.moveX = 0;
    control.moveZ = 0;
    control.sprint = false;
    control.attackQueued = false;
    this.beginGarrisonDismount(unit, null);
    this.events.onToast?.("Боец спускается с укрепления.", "info");
    return true;
  }

  requestDirectControlMount(expectedBuildingId?: number): boolean {
    const control = this.directControl;
    const unit = control?.entityKind === "army"
      ? this.army.find((candidate) => candidate.id === control.entityId && candidate.hp > 0)
      : undefined;
    if (!control || !unit || unit.garrison) return false;
    if (this.status !== "playing" || this.planningPaused || !this.preparationStarted) {
      return this.reject("Подъём доступен, когда время идёт.");
    }
    if (unit.kind === "knight") return this.reject("Конница не может подниматься на стены и башни.");
    if (unit.kind !== "archer" && unit.kind !== "spearman") {
      return this.reject("На укрепления можно поднять лучника или копейщика.");
    }
    const candidate = this.findDirectControlGarrisonCandidate(unit);
    if (!candidate) return this.reject("Подойдите ближе к свободному месту на стене или башне.");
    if (expectedBuildingId !== undefined && candidate.building.id !== expectedBuildingId) {
      return this.reject("Место на выбранном укреплении уже недоступно.");
    }

    const deck = garrisonSlotPosition(candidate.building, candidate.slot);
    unit.garrison = {
      buildingId: candidate.building.id,
      buildingKind: candidate.building.kind,
      slot: candidate.slot,
      status: "mounting",
      transition: 0,
      approachX: unit.x,
      approachZ: unit.z,
      deckX: deck.x,
      deckZ: deck.z,
      deckY: garrisonDeckHeight(candidate.building.kind),
      queuedGroundOrder: null,
    };
    unit.order = null;
    unit.targetId = null;
    unit.movement = "idle";
    this.armyPaths.delete(unit.id);
    control.moveX = 0;
    control.moveZ = 0;
    control.sprint = false;
    control.attackQueued = false;
    control.dancing = false;
    this.events.onToast?.(
      candidate.building.kind === "tower" ? "Боец поднимается на башню." : "Боец поднимается на стену.",
      "success",
    );
    return true;
  }

  trade(buildingId: number, resource: StockpiledResourceKey, mode: "buy" | "sell"): boolean {
    if (this.status !== "playing" || this.planningPaused) return this.reject("Торговля доступна только во время игры.");
    const building = this.buildings.find((item) => item.id === buildingId);
    if (!building || building.kind !== "market" || !Object.prototype.hasOwnProperty.call(TRADE_RATES, resource)) return false;
    if (!building.enabled || (this.allocateWorkers().get(building.id) ?? 0) < 1) return this.reject("Рынку нужен свободный рабочий.");
    if (building.cooldown > 0) return this.reject(`Караван вернётся через ${Math.ceil(building.cooldown)} сек.`);
    const rate = TRADE_RATES[resource];
    if (mode === "sell") {
      if (this.resources[resource] < rate.lot) return this.reject(`Для продажи нужно: ${rate.label} ${rate.lot}.`);
      this.resources[resource] -= rate.lot;
      this.resources.gold += rate.sell;
      this.events.onToast?.(`Караван купил ${rate.label}: +${rate.sell} золота.`, "success");
    } else {
      if (this.resources.gold < rate.buy) return this.reject(`Для покупки нужно ${rate.buy} золота.`);
      const capacity = this.getStorageCapacity();
      if (this.resources[resource] + rate.lot > capacity[resource]) {
        return this.reject(`Нет места на складе: ${rate.label} ${Math.floor(capacity[resource])} максимум.`);
      }
      this.resources.gold -= rate.buy;
      this.resources[resource] += rate.lot;
      this.events.onToast?.(`Караван доставил ${rate.label}: +${rate.lot}.`, "success");
    }
    building.cooldown = this.preparationStarted ? 2 : 0;
    return true;
  }

  tick(delta: number): void {
    this.pruneArmyReferences();
    this.pruneCivilianReferences();
    if (this.status !== "playing" || this.planningPaused || !this.preparationStarted) return;
    if (!Number.isFinite(delta) || delta <= 0) return;
    const dt = Math.min(delta, 0.05) * this.timeScale;
    this.elapsed += dt;
    if (this.preparationStarted) {
      this.raidClock += dt;
      this.incomeClock += dt;
      this.growthClock += dt;
    }

    this.updateScenarioEvents();
    if (!this.mission.duel) {
      while (!this.missionCompleted && this.wave < this.mission.waves.length
        && this.raidClock >= this.scaledScenarioTime(this.mission.waves[this.wave].at)) {
        this.spawnWave(this.mission.waves[this.wave], this.wave + 1);
        this.wave += 1;
      }
    }
    while (this.preparationStarted && this.incomeClock >= ECONOMY_TICK_SECONDS) {
      this.incomeClock -= ECONOMY_TICK_SECONDS;
      this.applyEconomyTick();
      if (this.duelCastle) this.applyDuelEconomyTick();
    }
    for (const building of this.buildings) {
      if (["market", "barracks", "archery", "stable", "siegeWorkshop"].includes(building.kind)) building.cooldown = Math.max(0, building.cooldown - dt);
    }
    this.updateConstructionWork(dt);
    this.updateTowers(dt);
    if (this.duelCastle) this.updateDuel(dt);
    this.updateCivilians(dt);
    this.updateArmy(dt);
    this.updateRaiders(dt);
    if (this.duelCastle) this.updateResolvedDuelAssaults();

    if (!this.mission.duel && !this.missionCompleted && this.wave === this.mission.waves.length && this.raiders.length === 0 && this.isGoalComplete()) {
      this.missionCompleted = true;
      this.setStatus("victory");
      this.events.onSound?.("victory");
    }
    if (this.duelCastle) this.checkDuelOutcome();
  }

  debugSpawnWave(): void {
    if (this.status !== "playing" || this.planningPaused || this.wave >= this.mission.waves.length) return;
    this.preparationStarted = true;
    this.spawnWave(this.mission.waves[this.wave], this.wave + 1);
    this.wave += 1;
  }

  private resetState(): void {
    this.mapRulesVersion = 2;
    this.nextId = 1;
    this.incomeClock = 0;
    this.growthClock = 0;
    this.elapsed = 0;
    this.raidClock = 0;
    this.preparationStarted = false;
    this.timeScale = 1;
    this.planningPaused = false;
    this.resources = { ...this.mission.startingResources };
    for (const key of RESOURCE_KEYS) this.resources[key] = Math.floor(this.resources[key] * DIFFICULTIES[this.selectedDifficulty].startingResourceMultiplier);
    this.taxPolicy = "standard";
    this.rationPolicy = "normal";
    this.population = this.mission.startingPopulation;
    this.populationCap = this.mission.startingPopulationCap;
    this.hope = this.mission.startingHope;
    this.wave = 0;
    this.raiders = [];
    this.army = [];
    this.civilianEntities = [];
    this.selectedArmyUnitIds = [];
    this.selectedCivilianId = null;
    this.directControl = null;
    this.lastDirectControlExit = null;
    this.armyAttackTimers.clear();
    this.civilianRoutes.clear();
    this.chronicle = [];
    this.triggeredEvents.clear();
    this.scenarioEffects = [];
    this.missionCompleted = false;
    this.duelCastle = null;
    this.paths.clear();
    this.armyPaths.clear();
    this.buildings = [];
    this.addBuilding("keep", this.mission.keep.gx, this.mission.keep.gz);
    for (const building of this.mission.startingBuildings) this.addBuilding(building.kind, building.gx, building.gz);
    this.duelCastle = this.mission.duel ? this.createDuelCastle() : null;
    this.syncCivilianPopulation("civilian-departed");
    this.reconcileCivilianJobs();
    const rally = this.findOpenFormationPoint(this.clampArmyPoint({
      x: this.mission.keep.gx,
      z: this.mission.keep.gz,
    }), []);
    this.rallyPoint = { gx: rally.x, gz: rally.z };
    this.navigationRevision += 1;
    this.clampResourcesToCapacity();
  }

  private createDuelCastle(): DuelCastleState {
    const config = this.mission.duel;
    if (!config) throw new Error("Duel state requested for a wave mission");
    const tuning = this.getDuelTuning();
    const resources = { ...config.enemyStartingResources };
    for (const key of RESOURCE_KEYS) resources[key] = Math.floor(resources[key] * tuning.startingResourceMultiplier);
    const buildings: BuildingState[] = [];
    const add = (kind: BuildingKind, gx: number, gz: number, towerUpgrade: TowerUpgradeKind = "none"): void => {
      const definition = BUILDINGS[kind];
      buildings.push({
        id: this.nextId++, kind, gx, gz,
        hp: definition.maxHp, maxHp: definition.maxHp, cooldown: 0,
        efficiency: this.getEnemyPlacementEfficiency(kind, gx, gz),
        enabled: true, priority: "normal",
        towerUpgrade: kind === "tower" ? towerUpgrade : undefined,
      });
    };
    add("keep", config.enemyKeep.gx, config.enemyKeep.gz);
    for (const building of config.enemyStartingBuildings) add(building.kind, building.gx, building.gz, building.towerUpgrade ?? "none");
    return {
      resources,
      population: config.enemyStartingPopulation,
      populationCap: config.enemyStartingPopulationCap,
      growthClock: 0,
      buildings,
      decisionClock: 0,
      buildCooldown: tuning.buildCooldown,
      trainCooldown: tuning.trainCooldown,
      assaultCooldown: tuning.initialAssaultCooldown,
      assaultsLaunched: 0,
      assaultsDefeated: 0,
      fortificationsDestroyed: 0,
    };
  }

  private getDuelTuning(): DuelDifficultyTuning {
    const base = DUEL_DIFFICULTY_TUNING[this.selectedDifficulty];
    const pace = Math.max(0.5, this.mission.duel?.aiPace ?? 1);
    const cooldown = (value: number): number => value / pace;
    return {
      startingResourceMultiplier: base.startingResourceMultiplier * (0.85 + pace * 0.15),
      productionMultiplier: base.productionMultiplier * pace,
      techPaceMultiplier: base.techPaceMultiplier * pace,
      growthInterval: cooldown(base.growthInterval),
      decisionInterval: cooldown(base.decisionInterval),
      buildCooldown: cooldown(base.buildCooldown),
      repairCooldown: cooldown(base.repairCooldown),
      trainCooldown: cooldown(base.trainCooldown),
      siegeTrainCooldown: cooldown(base.siegeTrainCooldown),
      initialAssaultCooldown: cooldown(base.initialAssaultCooldown),
      repeatAssaultCooldown: cooldown(base.repeatAssaultCooldown),
      minimumAssaultSize: Math.max(2, Math.round(base.minimumAssaultSize / Math.sqrt(pace))),
      goldPerCivilian: base.goldPerCivilian * pace,
    };
  }

  private getDuelSnapshot(): DuelSnapshot | null {
    const state = this.duelCastle;
    const config = this.mission.duel;
    if (!state || !config) return null;
    const keep = state.buildings.find((building) => building.kind === "keep");
    const enemyArmyCount = this.raiders.filter((raider) => raider.hp > 0).length;
    const guards = this.raiders.filter((raider) => raider.hp > 0 && (raider.stance ?? "assault") === "guard").length;
    const phaseLabel = this.missionCompleted ? "Дружественный город"
      : this.raidClock < 70 ? "Соперник налаживает хозяйство"
      : state.assaultCooldown <= 18 ? "Соперник готовит поход"
        : this.raiders.some((raider) => raider.hp > 0 && raider.stance === "assault") ? "Идёт поход на ваш замок"
          : guards >= 5 ? "Соперник собирает силы" : "Соперник расширяет замок";
    return {
      enemyName: config.enemyName,
      friendly: this.missionCompleted,
      neutralZone: { ...config.neutralZone },
      enemyResourceZones: {
        lumber: { ...config.enemyResourceZones.lumber }, quarry: { ...config.enemyResourceZones.quarry },
        iron: { ...config.enemyResourceZones.iron }, fertile: { ...config.enemyResourceZones.fertile },
      },
      enemyResources: { ...state.resources },
      enemyPopulation: this.getEnemyPopulationUsed(),
      enemyPopulationCap: state.populationCap,
      enemyBuildings: state.buildings,
      enemyArmyCount,
      enemyKeepHp: Math.max(0, keep?.hp ?? 0),
      enemyKeepMaxHp: keep?.maxHp ?? BUILDINGS.keep.maxHp,
      enemyDevelopment: state.buildings.filter((building) => building.hp > 0).length,
      nextAssaultIn: Math.max(0, state.assaultCooldown),
      assaultsLaunched: state.assaultsLaunched,
      assaultsDefeated: state.assaultsDefeated,
      fortificationsDestroyed: state.fortificationsDestroyed,
      objectiveKind: config.objective.kind,
      objectiveProgress: this.getGoalProgress(),
      objectiveTarget: this.mission.goalTarget,
      phaseLabel,
    };
  }

  private getEnemyPlacementEfficiency(kind: BuildingKind, gx: number, gz: number): number {
    const zones = this.mission.duel?.enemyResourceZones;
    if (!zones) return 1;
    if (kind === "farm" || kind === "wheatFarm") {
      return this.round(Math.max(0.65, Math.min(1.25, 1.3 - Math.hypot(gx - zones.fertile.gx, gz - zones.fertile.gz) * 0.055)));
    }
    if (kind !== "lumber" && kind !== "quarry" && kind !== "ironMine") return 1;
    const zone = zones[kind === "ironMine" ? "iron" : kind];
    return Math.round(Math.max(0.35, Math.min(1.4, 1.52 - Math.hypot(gx - zone.gx, gz - zone.gz) * 0.12)) * 100) / 100;
  }

  private applyDuelEconomyTick(): void {
    const state = this.duelCastle;
    if (!state || this.missionCompleted) return;
    const tuning = this.getDuelTuning();
    const live = state.buildings.filter((building) => building.hp > 0 && building.enabled);
    const armyPopulation = this.getEnemyArmyPopulation();
    state.populationCap = Math.max(4, 12 + live.filter((building) => building.kind === "house").length * 4, armyPopulation);
    state.population = Math.min(state.population, Math.max(0, state.populationCap - armyPopulation));
    let workers = state.population;
    const allocation = new Map<number, number>();
    for (const building of live.slice().sort((a, b) => a.id - b.id)) {
      const required = BUILDINGS[building.kind].workers ?? 0;
      if (required > workers) continue;
      workers -= required;
      allocation.set(building.id, required);
    }
    // Deliver raw materials before consumers, as in the player's economy.
    const ordered = live.slice().sort((a, b) => Number(Boolean(BUILDINGS[a.kind].production?.inputs))
      - Number(Boolean(BUILDINGS[b.kind].production?.inputs)) || a.id - b.id);
    for (const building of ordered) {
      const definition = BUILDINGS[building.kind];
      const required = definition.workers ?? 0;
      const production = definition.production;
      if (!production?.outputs || required <= 0 || (allocation.get(building.id) ?? 0) < required
        || !this.hasProductionAccess(building, "enemy")) continue;
      if (production.requires && !live.some(candidate => candidate.kind === production.requires
        && (allocation.get(candidate.id) ?? 0) >= (BUILDINGS[candidate.kind].workers ?? 0)
        && this.hasProductionAccess(candidate, "enemy")
        && Math.hypot(candidate.gx - building.gx, candidate.gz - building.gz) <= (production.supportRadius ?? Infinity))) continue;
      if (production.inputs && !canEnemyAfford(state.resources, production.inputs)) continue;
      if (production.inputs) spendEnemyResources(state.resources, production.inputs);
      for (const [key, amount] of Object.entries(production.outputs) as Array<[ResourceKey, number]>) {
        state.resources[key] += amount * building.efficiency * tuning.productionMultiplier;
      }
    }
    const foodUse = this.getEnemyPopulationUsed() * 0.28;
    state.resources.food = Math.max(0, state.resources.food - foodUse);
    state.resources.gold += state.population * tuning.goldPerCivilian;
    state.growthClock += ECONOMY_TICK_SECONDS;
    if (state.growthClock >= tuning.growthInterval && this.getEnemyPopulationUsed() < state.populationCap && state.resources.food >= 22) {
      state.growthClock -= tuning.growthInterval;
      state.resources.food -= 8;
      state.population += 1;
    }
    for (const key of RESOURCE_KEYS) state.resources[key] = this.round(Math.max(0, state.resources[key]));
  }

  private updateDuel(dt: number): void {
    const state = this.duelCastle;
    if (!state || this.missionCompleted) return;
    const tuning = this.getDuelTuning();
    state.decisionClock += dt;
    state.buildCooldown = Math.max(0, state.buildCooldown - dt);
    state.trainCooldown = Math.max(0, state.trainCooldown - dt);
    state.assaultCooldown = Math.max(0, state.assaultCooldown - dt);
    if (state.decisionClock >= tuning.decisionInterval) {
      state.decisionClock %= tuning.decisionInterval;
      this.runEnemyDecision();
    }
    this.updateEnemyTowerWeapons(dt);
  }

  private runEnemyDecision(): void {
    const state = this.duelCastle;
    if (!state || this.missionCompleted) return;
    const tuning = this.getDuelTuning();
    if (state.buildCooldown <= 0) {
      if (!this.tryRepairEnemyBuilding()) {
        const preferred = chooseEnemyBuilding(state, this.raidClock * tuning.techPaceMultiplier, this.getEnemyPopulationUsed());
        const missing = (kind: BuildingKind, limit = 1) => state.buildings.filter(b => b.kind === kind && b.hp > 0).length < limit;
        const candidates: BuildingKind[] = [
          ...(missing('farm', 2) && state.resources.food < 40 ? ['farm' as const] : []),
          ...(['lumber','quarry','barracks'] as const).filter(kind => missing(kind)),
          ...(preferred ? [preferred] : []),
          ...(['farm','archery','ironMine','blacksmith'] as const).filter(kind => missing(kind)),
        ];
        const kind = candidates.find(kind => canEnemyAfford(state.resources, BUILDINGS[kind].cost) && this.findEnemyBuildCell(kind));
        if (kind) {
          const point = this.findEnemyBuildCell(kind);
          if (point) {
            spendEnemyResources(state.resources, BUILDINGS[kind].cost);
            this.addEnemyBuilding(kind, point.gx, point.gz);
            state.buildCooldown = tuning.buildCooldown;
            if (kind === "house") state.populationCap += 4;
            if (["archery", "blacksmith", "siegeWorkshop", "tower"].includes(kind)) {
              this.events.onToast?.(`${this.mission.duel!.enemyName}: построено «${BUILDINGS[kind].shortName}».`, "info");
            }
          }
        }
      }
    }

    const unarmedTower = state.buildings.find((building) => building.kind === "tower" && building.hp > 0
      && (building.towerUpgrade ?? "none") === "none");
    if (unarmedTower && this.raidClock > 65) {
      const playerHasSiege = this.army.some((unit) => unit.hp > 0 && isSiegeKind(unit.kind));
      const upgrade = (playerHasSiege || this.raidClock > 115)
        && state.buildings.filter((building) => building.kind === "tower" && building.towerUpgrade === "heavy").length === 0
        ? "heavy" : "light";
      const cost = TOWER_UPGRADES[upgrade].cost;
      if (canEnemyAfford(state.resources, cost)) {
        spendEnemyResources(state.resources, cost);
        unarmedTower.towerUpgrade = upgrade;
      }
    }

    if (state.trainCooldown <= 0) {
      const guardedKinds = this.raiders.filter((raider) => raider.hp > 0 && raider.stance === "guard")
        .map((raider) => raider.kind ?? "raider");
      const preferred = chooseEnemyUnit(state, this.raidClock * tuning.techPaceMultiplier, guardedKinds);
      if (preferred) for (const kind of [...new Set([preferred, 'archer', 'spearman'] as EnemyUnitKind[])]) {
        if (this.trainEnemyUnit(kind)) {state.trainCooldown = isSiegeKind(kind) ? tuning.siegeTrainCooldown : tuning.trainCooldown; break;}
      }
    }

    if (state.assaultCooldown <= 0) this.tryLaunchEnemyAssault();
  }

  private findEnemyBuildCell(kind: BuildingKind): GridPoint | null {
    const config = this.mission.duel;
    const state = this.duelCastle;
    if (!config || !state) return null;
    const occupied = (point: GridPoint): boolean => !terrainBuildable(terrainAt(terrainFor(this.selectedMission, this.mapRulesVersion), point.gx, point.gz)) || this.buildings.some((building) => building.hp > 0 && building.gx === point.gx && building.gz === point.gz)
      || state.buildings.some((building) => building.hp > 0 && building.gx === point.gx && building.gz === point.gz)
      || Object.values(this.mission.resourceZones).some((zone) => zone.gx === point.gx && zone.gz === point.gz)
      || Object.values(config.enemyResourceZones).some((zone) => zone.gx === point.gx && zone.gz === point.gz);
    const candidates = enemyBuildCandidates(kind, this.mission);
    for (const point of candidates) {
      if (point.gx >= config.enemyBuildArea.minGx && point.gx <= config.enemyBuildArea.maxGx
        && point.gz >= config.enemyBuildArea.minGz && point.gz <= config.enemyBuildArea.maxGz
        && !occupied(point) && !this.hasPlayerWithinBuildingDistance(point.gx, point.gz)) return point;
    }
    for (let radius = 1; radius <= 9; radius += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
        const point = { gx: config.enemyKeep.gx + dx, gz: config.enemyKeep.gz + dz };
        if (point.gx < config.enemyBuildArea.minGx || point.gx > config.enemyBuildArea.maxGx
          || point.gz < config.enemyBuildArea.minGz || point.gz > config.enemyBuildArea.maxGz || occupied(point)
          || this.hasPlayerWithinBuildingDistance(point.gx, point.gz)) continue;
        return point;
      }
    }
    return null;
  }

  private hasPlayerWithinBuildingDistance(x: number, z: number): boolean {
    return this.army.some((unit) => unit.hp > 0 && Math.hypot(unit.x - x, unit.z - z) <= ENEMY_BUILDING_EXCLUSION_RADIUS);
  }

  private tryRepairEnemyBuilding(): boolean {
    const state = this.duelCastle;
    if (!state) return false;
    const repairCost = (building: BuildingState) => {
      const missingRatio = (building.maxHp - building.hp) / building.maxHp;
      const baseStone = building.kind === "keep" ? 65 : Math.max(10, BUILDINGS[building.kind].cost.stone ?? 12);
      return {
        stone: Math.max(4, Math.ceil(baseStone * missingRatio * 0.55)),
        wood: building.kind === "wall" ? 0 : Math.max(0, Math.ceil(12 * missingRatio)),
      };
    };
    const target = state.buildings.filter((building) => building.hp > 0 && building.hp < building.maxHp
      && building.hp / building.maxHp <= (building.kind === "keep" ? 0.82 : 0.7)
      && !this.hasPlayerWithinBuildingDistance(building.gx, building.gz))
      .sort((a, b) => Number(b.kind === "keep") - Number(a.kind === "keep")
        || a.hp / a.maxHp - b.hp / b.maxHp || a.id - b.id)
      .find((building) => canEnemyAfford(state.resources, repairCost(building)));
    if (!target) return false;
    const cost = repairCost(target);
    spendEnemyResources(state.resources, cost);
    target.hp = target.maxHp;
    state.buildCooldown = this.getDuelTuning().repairCooldown;
    if (target.kind === "keep" || target.kind === "tower") {
      this.events.onToast?.(`${this.mission.duel!.enemyName}: ${BUILDINGS[target.kind].shortName} восстановлена.`, "info");
    }
    return true;
  }

  private addEnemyBuilding(kind: BuildingKind, gx: number, gz: number): BuildingState {
    const definition = BUILDINGS[kind];
    const building: BuildingState = {
      id: this.nextId++, kind, gx, gz, hp: definition.maxHp, maxHp: definition.maxHp,
      cooldown: 0, efficiency: this.getEnemyPlacementEfficiency(kind, gx, gz), enabled: true,
      priority: "normal", towerUpgrade: kind === "tower" ? "none" : undefined,
    };
    this.duelCastle!.buildings.push(building);
    this.navigationRevision += 1;
    this.paths.clear();
    this.armyPaths.clear();
    return building;
  }

  private getEnemyArmyPopulation(): number {
    return this.raiders.filter((raider) => raider.hp > 0)
      .reduce((sum, raider) => sum + enemyUnitStats(raider.kind ?? "raider").crew, 0);
  }

  private getEnemyPopulationUsed(): number {
    return (this.duelCastle?.population ?? 0) + this.getEnemyArmyPopulation();
  }

  private enemyFreeWorkers(): number {
    const state = this.duelCastle;
    if (!state) return 0;
    const jobs = state.buildings.filter((building) => building.hp > 0 && building.enabled)
      .reduce((sum, building) => sum + (BUILDINGS[building.kind].workers ?? 0), 0);
    return Math.max(0, state.population - jobs);
  }

  private trainEnemyUnit(kind: EnemyUnitKind): boolean {
    const state = this.duelCastle;
    const config = this.mission.duel;
    if (!state || !config) return false;
    const stats = enemyUnitStats(kind);
    if (this.enemyFreeWorkers() < stats.crew || !canEnemyAfford(state.resources, stats.cost)) return false;
    spendEnemyResources(state.resources, stats.cost);
    state.population -= stats.crew;
    const index = this.raiders.filter((raider) => raider.stance === "guard").length;
    const row = Math.floor(index / 4), column = index % 4;
    const hpMultiplier = DIFFICULTIES[this.selectedDifficulty].enemyHpMultiplier;
    const damageMultiplier = DIFFICULTIES[this.selectedDifficulty].enemyDamageMultiplier;
    this.raiders.push({
      id: this.nextId++, kind, stance: "guard",
      x: config.enemyKeep.gx - 2.1 - row * 0.58,
      z: config.enemyKeep.gz + (column - 1.5) * 0.62,
      homeX: config.enemyKeep.gx - 2.1 - row * 0.58,
      homeZ: config.enemyKeep.gz + (column - 1.5) * 0.62,
      hp: stats.maxHp * hpMultiplier, maxHp: stats.maxHp * hpMultiplier,
      speed: stats.speed, damage: stats.damage * damageMultiplier,
      cooldown: 0.4, elite: kind === "swordsman" || isSiegeKind(kind),
      heading: -Math.PI / 2, attacking: false, attackPulse: 0,
    });
    return true;
  }

  private tryLaunchEnemyAssault(): void {
    const state = this.duelCastle;
    if (!state) return;
    const tuning = this.getDuelTuning();
    const guards = this.raiders.filter((raider) => raider.hp > 0 && raider.stance === "guard");
    const siege = guards.filter((raider) => isSiegeKind(raider.kind));
    const minimum = tuning.minimumAssaultSize;
    if (guards.length < minimum) {
      state.assaultCooldown = 8;
      return;
    }
    const reserve = Math.min(2, Math.max(0, guards.length - minimum));
    const attackers = guards.slice(0, guards.length - reserve);
    for (const raider of attackers) raider.stance = "assault";
    state.assaultsLaunched += 1;
    state.assaultCooldown = tuning.repeatAssaultCooldown;
    this.paths.clear();
    this.events.onToast?.(`${this.mission.duel!.enemyName} начал поход: ${attackers.length} бойцов${siege.length ? `, осадных машин ${siege.length}` : ""}.`, "danger");
    this.events.onSound?.("wave");
  }

  private updateResolvedDuelAssaults(): void {
    const state = this.duelCastle;
    if (!state || state.assaultsDefeated >= state.assaultsLaunched) return;
    if (this.raiders.some((raider) => raider.hp > 0 && raider.stance === "assault")) return;
    state.assaultsDefeated = state.assaultsLaunched;
    if (this.mission.duel?.objective.kind === "hold-crossing") {
      const target = this.mission.duel.objective.primaryTarget;
      this.events.onToast?.(`Поход отбит: ${Math.min(state.assaultsDefeated, target)}/${target}.`, "success");
    }
  }

  private updateEnemyTowerWeapons(dt: number): void {
    const state = this.duelCastle;
    if (!state) return;
    for (const tower of state.buildings.filter((building) => building.hp > 0 && (building.kind === "keep" || building.kind === "tower"))) {
      if (tower.kind === "tower" && (tower.towerUpgrade ?? "none") === "none") continue;
      tower.cooldown -= dt;
      if (tower.cooldown > 0) continue;
      if (tower.kind === "keep") {
        const target = this.closestPlayerUnit(tower.gx, tower.gz, 5.3, () => true);
        if (!target) continue;
        target.hp -= 22;
        tower.cooldown = 1.25;
        this.events.onProjectile?.({ fromX: tower.gx, fromZ: tower.gz, toX: target.x, toZ: target.z, source: "tower" });
        continue;
      }
      const upgrade = tower.towerUpgrade ?? "none";
      if (upgrade === "none") continue;
      const definition = TOWER_UPGRADES[upgrade];
      const target = this.closestPlayerUnit(tower.gx, tower.gz, definition.range,
        (unit) => definition.targets === "siege" ? isSiegeKind(unit.kind) : !isSiegeKind(unit.kind));
      if (!target) continue;
      target.hp -= definition.damage;
      tower.cooldown = definition.cooldown;
      this.events.onProjectile?.({ fromX: tower.gx, fromZ: tower.gz, toX: target.x, toZ: target.z, source: upgrade === "heavy" ? "catapult" : "ballista" });
    }
    this.pruneArmyReferences();
  }

  private closestPlayerUnit(x: number, z: number, range: number, predicate: (unit: ArmyUnitState) => boolean): ArmyUnitState | undefined {
    return this.army.filter((unit) => unit.hp > 0 && predicate(unit))
      .map((unit) => ({ unit, distance: Math.hypot(unit.x - x, unit.z - z) }))
      .filter((candidate) => candidate.distance <= range)
      .sort((a, b) => a.distance - b.distance || a.unit.id - b.unit.id)[0]?.unit;
  }

  private checkDuelOutcome(): void {
    if (!this.duelCastle || this.missionCompleted) return;
    const config = this.mission.duel;
    if (!config) return;
    const enemyKeep = this.duelCastle.buildings.find((building) => building.kind === "keep");
    const keepDestroyed = !enemyKeep || enemyKeep.hp <= 0;
    const objectiveComplete = config.objective.kind === "hold-crossing"
      ? this.duelCastle.assaultsDefeated >= config.objective.primaryTarget
        && this.army.length >= (config.objective.supportTarget ?? 0)
      : config.objective.kind === "break-fortress"
        ? this.duelCastle.fortificationsDestroyed >= config.objective.primaryTarget
          && this.resources.weapons >= (config.objective.supportTarget ?? 0)
        : keepDestroyed;
    if (!keepDestroyed && !objectiveComplete) return;
    this.missionCompleted = true;
    // The defeated town remains in the valley as a friendly settlement. Restore
    // its keep for a clear visual handover and cancel every hostile order.
    if (enemyKeep) enemyKeep.hp = enemyKeep.maxHp;
    this.raiders = [];
    for (const unit of this.army) {
      unit.targetId = null;
      if (unit.order?.targetBuildingId !== undefined) unit.order = null;
      if (unit.garrison?.queuedGroundOrder?.targetBuildingId !== undefined) unit.garrison.queuedGroundOrder = null;
    }
    this.paths.clear();
    this.armyPaths.clear();
    this.navigationRevision += 1;
    this.setStatus("victory");
    const result = config.objective.kind === "hold-crossing" && !keepDestroyed
      ? `${config.enemyName} отказался от переправ и поднял бирюзовые флаги.`
      : config.objective.kind === "break-fortress" && !keepDestroyed
        ? `${config.enemyName} лишился опорных укреплений и заключил мир.`
        : `${config.enemyName} сдался и поднял бирюзовые флаги. Теперь это дружественный город.`;
    this.events.onToast?.(result, "success");
    this.events.onSound?.("victory");
  }

  private setStatus(status: GameStatus): void {
    this.status = status;
    this.events.onStatus?.(status);
  }

  private isValidSave(save: GameSaveDataV1): boolean {
    if (!save || save.version !== 1 || !Object.prototype.hasOwnProperty.call(MISSIONS, save.missionId)
      || !Object.prototype.hasOwnProperty.call(DIFFICULTIES, save.difficultyId)
      || !["playing", "paused", "victory"].includes(save.status)) return false;
    const state = save.state;
    if (!state || !Array.isArray(state.buildings) || !Array.isArray(state.raiders) || !Array.isArray(state.army)
      || !Array.isArray(state.civilianEntities) || !Array.isArray(state.chronicle)
      || !Array.isArray(state.triggeredEvents) || !Array.isArray(state.scenarioEffects)) return false;
    const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
    const nonNegative = (value: unknown): value is number => finite(value) && value >= 0;
    if (state.mapRulesVersion !== undefined && state.mapRulesVersion !== 1 && state.mapRulesVersion !== 2) return false;
    const mapSize = MISSIONS[save.missionId].gridSize ?? GRID_SIZE;
    const legacyDuelUpgrade = Boolean(MISSIONS[save.missionId].duel) && !state.duel
      && (save.missionId === "river" || save.missionId === "ruins");
    const maximumSavedWave = legacyDuelUpgrade ? 5 : MISSIONS[save.missionId].waves.length;
    const point = (x: unknown, z: unknown) => finite(x) && finite(z) && x >= -2 && z >= -2 && x <= mapSize + 2 && z <= mapSize + 2;
    if (![state.nextId, state.incomeClock, state.growthClock, state.elapsed, state.raidClock, state.population,
      state.populationCap, state.hope, state.wave, state.rallyPoint?.gx, state.rallyPoint?.gz].every(finite)
      || state.nextId < 1 || state.incomeClock < 0 || state.growthClock < 0 || state.elapsed < 0 || state.raidClock < 0
      || state.population < 0 || state.populationCap < 0 || state.hope < 0 || state.hope > 100
      || !Number.isInteger(state.wave) || state.wave < 0 || state.wave > maximumSavedWave
      || !point(state.rallyPoint.gx, state.rallyPoint.gz)
      || typeof state.preparationStarted !== "boolean" || typeof state.missionCompleted !== "boolean"
      || state.missionCompleted && state.wave !== MISSIONS[save.missionId].waves.length && !legacyDuelUpgrade
      || save.status === "victory" && !state.missionCompleted) return false;
    if (!state.resources || !RESOURCE_KEYS.every((key) => nonNegative(state.resources[key]))) return false;
    if (!Object.prototype.hasOwnProperty.call(TAX_POLICIES, state.taxPolicy)
      || !Object.prototype.hasOwnProperty.call(RATION_POLICIES, state.rationPolicy)
      || (state.timeScale !== 1 && state.timeScale !== 2)) return false;
    if (state.buildings.length > mapSize * mapSize || state.raiders.length > 500
      || state.army.length > 100 || state.civilianEntities.length > 500
      || !Array.isArray(state.selectedArmyUnitIds)) return false;
    const validBuilding = (building: BuildingState): boolean => Boolean(building)
      && Number.isSafeInteger(building.id) && building.id > 0
      && Object.prototype.hasOwnProperty.call(BUILDINGS, building.kind)
      && Number.isInteger(building.gx) && Number.isInteger(building.gz)
      && building.gx >= 0 && building.gz >= 0 && building.gx < mapSize && building.gz < mapSize
      && nonNegative(building.hp) && nonNegative(building.maxHp) && building.maxHp > 0 && building.hp <= building.maxHp
      && finite(building.cooldown) && building.cooldown >= -100_000 && nonNegative(building.efficiency)
      && typeof building.enabled === "boolean" && Object.prototype.hasOwnProperty.call(PRIORITY_ORDER, building.priority)
      && (building.repairRemaining === undefined || nonNegative(building.repairRemaining) && building.repairRemaining <= building.maxHp)
      && (building.trainingQueue === undefined || Array.isArray(building.trainingQueue) && building.trainingQueue.length <= 5 && building.trainingQueue.every(order =>
        order && Object.prototype.hasOwnProperty.call(ARMY_UNITS, order.kind) && ARMY_UNITS[order.kind].trainedAt === building.kind
        && nonNegative(order.remaining) && finite(order.duration) && order.duration > 0 && order.remaining <= order.duration
        && order.cost && RESOURCE_KEYS.every(key => (order.cost[key] ?? 0) === (ARMY_UNITS[order.kind].cost[key] ?? 0))))
      && (building.towerUpgrade === undefined || ["none", "light", "heavy"].includes(building.towerUpgrade));
    if (!state.buildings.every(validBuilding)) return false;
    const savedDuel = state.duel;
    if (!MISSIONS[save.missionId].duel && savedDuel) return false;
    if (MISSIONS[save.missionId].duel && !savedDuel && !legacyDuelUpgrade) return false;
    if (savedDuel !== undefined && savedDuel !== null) {
      if (!MISSIONS[save.missionId].duel || !savedDuel.resources || !RESOURCE_KEYS.every((key) => nonNegative(savedDuel.resources[key]))
        || !Array.isArray(savedDuel.buildings) || savedDuel.buildings.length > mapSize * mapSize
        || !savedDuel.buildings.every(validBuilding)
        || savedDuel.buildings.filter((building) => building.kind === "keep").length !== 1
        || ![savedDuel.population, savedDuel.populationCap, savedDuel.growthClock, savedDuel.decisionClock,
          savedDuel.buildCooldown, savedDuel.trainCooldown, savedDuel.assaultCooldown, savedDuel.assaultsLaunched].every(nonNegative)
        || !Number.isInteger(savedDuel.assaultsLaunched)
        || savedDuel.assaultsDefeated !== undefined && (!nonNegative(savedDuel.assaultsDefeated) || !Number.isInteger(savedDuel.assaultsDefeated))
        || savedDuel.fortificationsDestroyed !== undefined && (!nonNegative(savedDuel.fortificationsDestroyed) || !Number.isInteger(savedDuel.fortificationsDestroyed))) return false;
    }
    const buildingById = new Map(state.buildings.map((building) => [building.id, building]));
    const validOrder = (order: ArmyUnitOrderState | null) => order === null || (
      (order.kind === "move" || order.kind === "attack-move" || order.kind === "garrison")
      && (order.status === "moving" || order.status === "holding")
      && [order.anchorX, order.anchorZ, order.destinationX, order.destinationZ].every(finite)
      && (order.holdPosition === undefined || typeof order.holdPosition === "boolean")
      && (order.targetBuildingId === undefined || Number.isSafeInteger(order.targetBuildingId) && order.targetBuildingId > 0));
    const validArmy = state.army.every((unit) => {
      if (!unit || !Number.isSafeInteger(unit.id) || unit.id <= 0 || !Object.prototype.hasOwnProperty.call(ARMY_UNITS, unit.kind)
        || !point(unit.x, unit.z) || !nonNegative(unit.hp) || !nonNegative(unit.maxHp) || unit.maxHp <= 0 || unit.hp > unit.maxHp
        || !nonNegative(unit.speed) || !nonNegative(unit.damage) || !nonNegative(unit.range) || !nonNegative(unit.cooldown)
        || !finite(unit.heading) || !["idle", "walk", "sprint"].includes(unit.movement)
        || !validOrder(unit.order) || typeof unit.attacking !== "boolean" || !nonNegative(unit.attackPulse)) return false;
      if (!unit.garrison) return true;
      const host = buildingById.get(unit.garrison.buildingId);
      return Boolean(host && isGarrisonBuildingKind(host.kind) && host.kind === unit.garrison.buildingKind
        && Number.isInteger(unit.garrison.slot) && unit.garrison.slot >= 0 && unit.garrison.slot < garrisonCapacity(host.kind)
        && ["approaching", "mounting", "stationed", "dismounting"].includes(unit.garrison.status)
        && finite(unit.garrison.transition) && unit.garrison.transition >= 0 && unit.garrison.transition <= 1
        && point(unit.garrison.approachX, unit.garrison.approachZ) && point(unit.garrison.deckX, unit.garrison.deckZ)
        && nonNegative(unit.garrison.deckY) && unit.garrison.deckY <= 10
        && validOrder(unit.garrison.queuedGroundOrder));
    });
    if (!validArmy) return false;
    if (!state.raiders.every((raider) => Boolean(raider) && Number.isSafeInteger(raider.id) && raider.id > 0
      && point(raider.x, raider.z) && nonNegative(raider.hp) && nonNegative(raider.maxHp) && raider.maxHp > 0
      && raider.hp <= raider.maxHp && nonNegative(raider.speed) && nonNegative(raider.damage)
      && finite(raider.cooldown) && raider.cooldown >= -100_000 && typeof raider.elite === "boolean"
      && (raider.kind === undefined || ["raider", "spearman", "archer", "swordsman", "catapult", "batteringRam"].includes(raider.kind))
      && (raider.stance === undefined || raider.stance === "guard" || raider.stance === "assault")
      && (raider.targetBuildingId === undefined || Number.isSafeInteger(raider.targetBuildingId) && raider.targetBuildingId > 0))) return false;
    if (savedDuel && savedDuel.population + state.raiders.reduce((sum, raider) => sum + enemyUnitStats(raider.kind ?? "raider").crew, 0)
      > savedDuel.populationCap) return false;
    if (!state.civilianEntities.every((civilian) => Boolean(civilian) && Number.isSafeInteger(civilian.id) && civilian.id > 0
      && civilian.entityKind === "civilian" && point(civilian.x, civilian.z) && finite(civilian.heading)
      && nonNegative(civilian.speed) && nonNegative(civilian.hp) && nonNegative(civilian.maxHp) && civilian.maxHp > 0
      && civilian.hp <= civilian.maxHp && ["idle", "walk", "sprint"].includes(civilian.movement)
      && ["idle", "commuting", "working", "controlled"].includes(civilian.activity)
      && (civilian.jobBuildingId === null || (Number.isSafeInteger(civilian.jobBuildingId) && buildingById.has(civilian.jobBuildingId)))
      && (civilian.jobKind === null || Object.prototype.hasOwnProperty.call(BUILDINGS, civilian.jobKind)))) return false;
    if (!state.chronicle.every((entry) => Boolean(entry) && typeof entry.id === "string" && typeof entry.title === "string"
      && typeof entry.description === "string" && nonNegative(entry.at) && ["info", "danger", "success"].includes(entry.tone))
      || !state.triggeredEvents.every((id) => typeof id === "string")
      || !state.scenarioEffects.every((effect) => Boolean(effect) && typeof effect.id === "string" && typeof effect.title === "string"
        && nonNegative(effect.endsAt) && nonNegative(effect.foodProductionMultiplier))
      || !state.selectedArmyUnitIds.every((id) => Number.isSafeInteger(id))
      || (state.selectedCivilianId !== null && !Number.isSafeInteger(state.selectedCivilianId))) return false;
    const entities = [...state.buildings, ...(savedDuel?.buildings ?? []), ...state.raiders, ...state.army, ...state.civilianEntities];
    const ids = entities.map(({ id }) => id);
    return new Set(ids).size === ids.length;
  }

  private addBuilding(kind: BuildingKind, gx: number, gz: number): BuildingState {
    const definition = BUILDINGS[kind];
    const building: BuildingState = {
      id: this.nextId++, kind, gx, gz,
      hp: definition.maxHp, maxHp: definition.maxHp, cooldown: 0,
      efficiency: this.getPlacementEfficiency(kind, gx, gz),
      enabled: true, priority: kind === "tower" ? "high" : "normal",
      towerUpgrade: kind === "tower" ? "none" : undefined,
    };
    this.buildings.push(building);
    return building;
  }

  private removeBuilding(building: BuildingState): void {
    for (const unit of this.army.filter((candidate) => candidate.garrison?.buildingId === building.id)) {
      if (unit.garrison?.status === "approaching") this.cancelGarrisonApproach(unit);
      else this.evacuateGarrisonUnit(unit);
    }
    this.buildings = this.buildings.filter((item) => item.id !== building.id);
    if (building.kind === "house") {
      const armyPopulation = this.getArmyPopulation();
      this.populationCap = Math.max(4, this.populationCap - 4, armyPopulation);
      this.population = Math.min(this.population, Math.max(0, this.populationCap - armyPopulation));
      this.syncCivilianPopulation("civilian-departed");
    }
    this.navigationRevision += 1;
    this.paths.clear();
    this.armyPaths.clear();
    this.reconcileCivilianJobs();
    this.clampResourcesToCapacity();
  }

  private getJobCount(): number {
    return this.buildings.reduce((sum, building) => sum + (building.enabled ? BUILDINGS[building.kind].workers ?? 0 : 0), 0);
  }

  private getArmyPopulation(): number {
    return this.army.reduce((sum, unit) => sum + (ARMY_UNITS[unit.kind].populationCost ?? 1), 0);
  }

  private allocateWorkers(): Map<number, number> {
    const allocation = new Map<number, number>();
    let available = this.population;
    const workplaces = this.buildings
      .filter((building) => building.enabled && (BUILDINGS[building.kind].workers ?? 0) > 0)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.id - b.id);
    for (const workplace of workplaces) {
      const assigned = Math.min(available, BUILDINGS[workplace.kind].workers ?? 0);
      allocation.set(workplace.id, assigned);
      available -= assigned;
    }
    return allocation;
  }

  private syncCivilianPopulation(removalReason: DirectControlExitReason): void {
    while (this.civilianEntities.length < this.population) {
      const civilianId = this.nextId++;
      const spawn = this.getCivilianEntrance(this.buildings.find((building) => building.kind === "keep"), civilianId);
      const civilian: CivilianState = {
        id: civilianId,
        entityKind: "civilian",
        x: spawn.x,
        z: spawn.z,
        heading: 0,
        speed: CIVILIAN_SPEED,
        hp: CIVILIAN_MAX_HP,
        maxHp: CIVILIAN_MAX_HP,
        movement: "idle",
        activity: "idle",
        jobBuildingId: null,
        jobKind: null,
      };
      this.civilianEntities.push(civilian);
      this.civilianRoutes.set(civilian.id, {
        target: "home",
        points: [],
        pointIndex: 0,
        waitRemaining: 1 + stableUnitFraction(civilian.id, 0x51f15e) * 0.8,
        navigationRevision: this.navigationRevision,
        jobBuildingId: null,
      });
    }
    while (this.civilianEntities.length > this.population) {
      const controlledId = this.directControl?.entityKind === "civilian" ? this.directControl.entityId : null;
      const civilian = [...this.civilianEntities]
        .sort((a, b) => {
          const aRank = a.id === controlledId ? 2 : a.jobBuildingId === null ? 0 : 1;
          const bRank = b.id === controlledId ? 2 : b.jobBuildingId === null ? 0 : 1;
          return aRank - bRank || b.id - a.id;
        })[0];
      if (!civilian) break;
      this.detachCivilian(civilian, removalReason);
    }
  }

  private reconcileCivilianJobs(): void {
    if (this.civilianEntities.length !== this.population) this.syncCivilianPopulation("civilian-departed");
    const allocation = this.allocateWorkers();
    const desiredJobs: number[] = [];
    const workplaces = this.buildings
      .filter((building) => (allocation.get(building.id) ?? 0) > 0)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.id - b.id);
    for (const workplace of workplaces) {
      for (let count = 0; count < (allocation.get(workplace.id) ?? 0); count += 1) desiredJobs.push(workplace.id);
    }
    const civilians = [...this.civilianEntities].sort((a, b) => a.id - b.id);
    civilians.forEach((civilian, index) => {
      const nextJobId = desiredJobs[index] ?? null;
      const nextJob = nextJobId === null ? undefined : this.buildings.find((building) => building.id === nextJobId);
      if (civilian.jobBuildingId === nextJobId && civilian.jobKind === (nextJob?.kind ?? null)) return;
      civilian.jobBuildingId = nextJobId;
      civilian.jobKind = nextJob?.kind ?? null;
      this.rebuildCivilianRoute(civilian, nextJob ? "work" : "home");
      if (this.directControl?.entityKind === "civilian" && this.directControl.entityId === civilian.id) {
        civilian.activity = "controlled";
      }
    });
  }

  private rebuildCivilianRoute(civilian: CivilianState, target: "home" | "work"): CivilianRouteRuntime {
    const targetBuilding = target === "work" && civilian.jobBuildingId !== null
      ? this.buildings.find((building) => building.id === civilian.jobBuildingId)
      : this.buildings.find((building) => building.kind === "keep");
    const resolvedTarget = targetBuilding ? target : "home";
    const destination = this.getCivilianEntrance(targetBuilding, civilian.id);
    const start = {
      x: Math.max(0, Math.min(this.gridSize - 1, Math.round(civilian.x))),
      z: Math.max(0, Math.min(this.gridSize - 1, Math.round(civilian.z))),
    };
    const goal = {
      x: Math.max(0, Math.min(this.gridSize - 1, Math.round(destination.x))),
      z: Math.max(0, Math.min(this.gridSize - 1, Math.round(destination.z))),
    };
    const points = this.findPath(start, goal, "player");
    const last = points.at(-1);
    const pathReachedGoal = points.length > 0 || (start.x === goal.x && start.z === goal.z);
    if (pathReachedGoal && (!last || Math.hypot(last.x - destination.x, last.z - destination.z) > 0.04)
      && Math.hypot(civilian.x - destination.x, civilian.z - destination.z) > 0.055) {
      points.push(destination);
    }
    const route: CivilianRouteRuntime = {
      target: resolvedTarget,
      points,
      pointIndex: 0,
      waitRemaining: 0,
      navigationRevision: this.navigationRevision,
      jobBuildingId: civilian.jobBuildingId,
    };
    this.civilianRoutes.set(civilian.id, route);
    return route;
  }

  private getCivilianEntrance(building: BuildingState | undefined, seed: number): PathPoint {
    const origin = building ?? this.buildings.find((candidate) => candidate.kind === "keep");
    const gx = origin?.gx ?? this.mission.keep.gx;
    const gz = origin?.gz ?? this.mission.keep.gz;
    const stableSeed = Math.abs(Math.trunc(seed));
    // Stable entities must not collapse into the old four cardinal slots. A
    // golden-angle sequence gives every civilian a distinct readable position;
    // expanding bands provide deterministic fallbacks around crowded buildings.
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const band = Math.floor(attempt / 16);
      const radius = 1.04 + band * 0.55 + stableUnitFraction(stableSeed, 0x27d4eb2d ^ attempt) * 0.34;
      const angle = (stableSeed + attempt * 7) * CIVILIAN_GOLDEN_ANGLE;
      const x = gx + Math.sin(angle) * radius;
      const z = gz + Math.cos(angle) * radius;
      if (x >= UNIT_MAP_MARGIN && z >= UNIT_MAP_MARGIN
        && x <= this.gridSize - UNIT_MAP_MARGIN && z <= this.gridSize - UNIT_MAP_MARGIN
        && !this.isArmyPositionBlocked(x, z)) return { x, z };
    }
    return this.clampArmyPoint({ x: gx + 0.8, z: gz + 0.8 });
  }

  /** Both economies use the same terrain and entrances. Friendly gates are
   * traversable, while the other castle's gates remain obstacles. Source enable
   * changes are included because they need not change navigation geometry. */
  private hasProductionAccess(building: BuildingState, side: "player" | "enemy" = "player"): boolean {
    if (this.mapRulesVersion === 1) return true;
    const own = side === "player" ? this.buildings : this.duelCastle?.buildings ?? [];
    const other = side === "player" ? this.duelCastle?.buildings ?? [] : this.buildings;
    const sources = own.filter(b => b.hp > 0 && b.enabled && ["keep", "granary", "market"].includes(b.kind));
    const sourceKey = sources.map(source => source.id).join(",");
    let cache = this.productionAccess.get(side);
    if (!cache || cache.revision !== this.navigationRevision || cache.sources !== sourceKey) {
      const connected = new Set<number>();
      const terrain = terrainFor(this.selectedMission, this.mapRulesVersion);
      const blocked = new Set([
        ...own.filter(b => b.hp > 0 && b.kind !== "gate"),
        ...other.filter(b => b.hp > 0 && !(this.missionCompleted && b.kind === "gate")),
      ].map(b => b.gz * this.gridSize + b.gx));
      const reached = new Set<number>();
      const queue: number[] = [];
      const add = (x: number, z: number) => {
        if (x < 0 || z < 0 || x >= this.gridSize || z >= this.gridSize) return;
        const key = z * this.gridSize + x;
        if (!blocked.has(key) && !reached.has(key) && terrainPassable(terrainAt(terrain, x, z))) {
          reached.add(key); queue.push(key);
        }
      };
      for (const source of sources) {
        connected.add(source.id);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(source.gx + dx, source.gz + dz);
      }
      for (let index = 0; index < queue.length; index++) {
        const x = queue[index] % this.gridSize, z = Math.floor(queue[index] / this.gridSize);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(x + dx, z + dz);
      }
      for (const candidate of own) if (candidate.hp > 0 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
        const x = candidate.gx + dx, z = candidate.gz + dz;
        return x >= 0 && z >= 0 && x < this.gridSize && z < this.gridSize && reached.has(z * this.gridSize + x);
      })) connected.add(candidate.id);
      cache = { revision: this.navigationRevision, sources: sourceKey, connected };
      this.productionAccess.set(side, cache);
    }
    return cache.connected.has(building.id);
  }

  private projectProduction(): { production: BuildingProductionSnapshot[]; resources: Resources; net: Resources } {
    const key = [this.navigationRevision,this.economyRevision,this.population,this.taxPolicy,this.rationPolicy,
      ...RESOURCE_KEYS.map(k => this.resources[k]),this.army.map(u=>`${u.kind}:${u.garrison?.buildingId ?? 0}:${u.garrison?.status ?? ""}`).join(','),
      this.scenarioEffects.map(e=>e.id).join(',')].join('|');
    if (this.productionCache?.key === key) return this.productionCache.value;
    const resources = { ...this.resources };
    const capacity = this.getStorageCapacity();
    const allocation = this.allocateWorkers();
    const production: BuildingProductionSnapshot[] = [];
    // Raw materials are delivered before workshops, regardless of construction order.
    // This same projection drives both the actual economy and its UI diagnostics.
    const ordered = [...this.buildings].sort((a, b) => {
      const rank = (kind: BuildingKind) => kind === "market" ? 3 : BUILDINGS[kind].production?.inputs ? 2 : 1;
      return rank(a.kind) - rank(b.kind) || a.id - b.id;
    });
    for (const building of ordered) {
      const definition = BUILDINGS[building.kind];
      const workersNeeded = definition.workers ?? 0;
      const workersAssigned = allocation.get(building.id) ?? 0;
      const staffing = workersNeeded ? workersAssigned / workersNeeded : 1;
      const diagnostic: BuildingProductionSnapshot = {
        buildingId: building.id, kind: building.kind, enabled: building.enabled, priority: building.priority,
        status: "idle", statusLabel: "Готово", workersAssigned, workersNeeded,
        efficiency: this.round(building.efficiency * staffing), inputs: {}, outputs: {}, bonusLabel: "",
      };
      production.push(diagnostic);
      if (!building.enabled) {
        diagnostic.status = "disabled";
        diagnostic.statusLabel = "Приостановлено — рабочие свободны";
        continue;
      }
      if (workersNeeded > 0 && !this.hasProductionAccess(building)) {
        diagnostic.status = 'no-access'; diagnostic.statusLabel = 'Нет прохода к цитадели или складу'; continue;
      }
      if (workersNeeded > 0 && workersAssigned === 0) {
        diagnostic.status = "unstaffed";
        diagnostic.statusLabel = "Нет свободных работников";
        continue;
      }
      if (building.kind === "tower") {
        diagnostic.status = "working";
        const archers = this.army.filter(unit => unit.kind === 'archer' && unit.garrison?.buildingId === building.id).length;
        diagnostic.statusLabel = building.towerUpgrade && building.towerUpgrade !== 'none' ? TOWER_UPGRADES[building.towerUpgrade].name : archers ? `Лучников на позиции: ${archers}` : 'Пустая башня — установите модуль или разместите лучника';
        continue;
      }
      if (building.kind === "mill") {
        diagnostic.status = "working";
        diagnostic.statusLabel = "Обслуживает пекарни в радиусе 4 клеток";
        continue;
      }
      if (building.kind === "market") {
        for (const key of ["wood", "stone", "food"] as const) {
          if (resources[key] <= capacity[key] * 0.85) continue;
          const amount = (key === "stone" ? 1.5 : key === "food" ? 2.5 : 2) * staffing;
          const price = TRADE_RATES[key].sell / TRADE_RATES[key].lot;
          resources[key] -= amount;
          resources.gold += amount * price;
          diagnostic.inputs[key] = amount;
          diagnostic.outputs.gold = (diagnostic.outputs.gold ?? 0) + amount * price;
        }
        diagnostic.status = (diagnostic.outputs.gold ?? 0) > 0 ? "working" : "idle";
        diagnostic.statusLabel = diagnostic.status === "working" ? "Продаёт излишки со склада" : "Готов к торговле; излишков пока нет";
        continue;
      }
      if (!definition.production?.outputs) {
        if (building.kind === "well") diagnostic.statusLabel = "Орошает поля и снабжает соседние дома";
        if (building.kind === "granary") diagnostic.statusLabel = "Хранит еду и зерно; усиливает финиковые фермы";
        if (building.kind === "house") diagnostic.statusLabel = "+4 места для жителей и гарнизона";
        if (["barracks", "archery", "stable"].includes(building.kind)) diagnostic.statusLabel = building.cooldown > 0 ? "Готовит следующего бойца" : "Готово к обучению";
        continue;
      }
      const recipe = definition.production;
      if (recipe.requires) {
        const support = this.buildings.some((candidate) => candidate.kind === recipe.requires && candidate.enabled && this.hasProductionAccess(candidate)
          && (allocation.get(candidate.id) ?? 0) >= (BUILDINGS[candidate.kind].workers ?? 0)
          && Math.hypot(candidate.gx - building.gx, candidate.gz - building.gz) <= (recipe.supportRadius ?? 4));
        if (!support) {
          diagnostic.status = "missing-support";
          diagnostic.statusLabel = `Нужна работающая мельница в радиусе ${recipe.supportRadius ?? 4} клеток`;
          continue;
        }
        diagnostic.bonusLabel = "Мельница рядом";
      }
      let outputMultiplier = building.efficiency * staffing;
      if (building.kind === "farm" || building.kind === "wheatFarm") {
        const watered = this.buildings.some((candidate) => candidate.kind === "well" && candidate.enabled
          && Math.hypot(candidate.gx - building.gx, candidate.gz - building.gz) <= 4);
        const granaries = building.kind === "farm" ? this.buildings.filter((candidate) => candidate.kind === "granary"
          && Math.hypot(candidate.gx - building.gx, candidate.gz - building.gz) <= 4).length : 0;
        const storageBonus = Math.min(0.5, granaries * 0.25);
        const weather = this.scenarioEffects.reduce((product, effect) => product * (building.kind === 'wheatFarm' && effect.foodProductionMultiplier < 1
          ? 1 - (1 - effect.foodProductionMultiplier) * .4 : effect.foodProductionMultiplier), 1);
        outputMultiplier *= (1 + (watered ? 0.2 : 0) + storageBonus) * weather;
        diagnostic.bonusLabel = [`Плодородие ${Math.round(building.efficiency * 100)}%`,
          ...(watered ? ["колодец +20%"] : []), ...(storageBonus ? [`амбар +${Math.round(storageBonus * 100)}%`] : []),
          ...(weather !== 1 ? [`сезон ${Math.round(weather * 100)}%`] : [])].join(" · ");
      }
      diagnostic.efficiency = this.round(outputMultiplier);
      const desiredInputs: Partial<Resources> = {};
      const desiredOutputs: Partial<Resources> = {};
      for (const key of RESOURCE_KEYS) {
        if (recipe.inputs?.[key]) desiredInputs[key] = recipe.inputs[key]! * staffing;
        if (recipe.outputs?.[key]) desiredOutputs[key] = recipe.outputs[key]! * outputMultiplier;
      }
      let inputFraction = 1;
      let limitingInput: ResourceKey | null = null;
      for (const key of RESOURCE_KEYS) {
        const amount = desiredInputs[key] ?? 0;
        if (amount > 0 && resources[key] / amount < inputFraction) {
          inputFraction = Math.max(0, resources[key] / amount);
          limitingInput = key;
        }
      }
      let spaceFraction = 1;
      for (const key of STOCKPILE_KEYS) {
        const amount = desiredOutputs[key] ?? 0;
        // Food consumed this tick is a valid delivery slot, avoiding alternate
        // full/empty production diagnostics at a stable, full granary.
        const room = capacity[key] - resources[key] + (key === "food" ? this.getFoodUsePerTick() : 0);
        if (amount > 0) spaceFraction = Math.min(spaceFraction, Math.max(0, room / amount));
      }
      const fraction = Math.min(inputFraction, spaceFraction);
      if (fraction <= 0.000001) {
        diagnostic.status = inputFraction <= spaceFraction ? "missing-input" : "storage-full";
        diagnostic.statusLabel = diagnostic.status === "missing-input"
          ? `Не хватает: ${limitingInput && limitingInput !== "gold" ? TRADE_RATES[limitingInput].label : "сырьё"}`
          : "Склад заполнен — производство ждёт";
        continue;
      }
      for (const key of RESOURCE_KEYS) {
        const input = (desiredInputs[key] ?? 0) * fraction;
        const output = (desiredOutputs[key] ?? 0) * fraction;
        if (input > 0) { resources[key] -= input; diagnostic.inputs[key] = this.round(input); }
        if (output > 0) { resources[key] += output; diagnostic.outputs[key] = this.round(output); }
      }
      diagnostic.status = "working";
      diagnostic.statusLabel = fraction < 0.99 ? (inputFraction < spaceFraction ? "Работает частично — мало сырья" : "Работает частично — склад почти полон")
        : staffing < 1 ? "Неполная смена" : "Производство работает";
    }
    resources.gold += TAX_POLICIES[this.taxPolicy].goldPerCivilian * this.population;
    const foodBalance = resources.food - this.resources.food - this.getFoodUsePerTick();
    resources.food = Math.max(0, resources.food - this.getFoodUsePerTick());
    const net = emptyResources();
    for (const key of RESOURCE_KEYS) {
      if (key !== "gold") resources[key] = Math.max(0, Math.min(capacity[key], resources[key]));
      net[key] = this.round(resources[key] - this.resources[key]);
    }
    // A starving granary still has an unmet demand, even though its actual stock
    // cannot fall below zero. Keep that deficit visible to the player.
    net.food = this.round(foodBalance);
    const value = { production, resources, net };
    this.productionCache = {key, value};
    return value;
  }

  private applyEconomyTick(): void {
    this.resources = {...this.projectProduction().resources};

    const factors = this.getPopularityFactors();
    this.hope = Math.max(0, Math.min(100, this.hope + this.sumPopularityFactors(factors)));

    const growthInterval = RATION_POLICIES[this.rationPolicy].growthInterval;
    if (this.growthClock >= growthInterval) {
      this.growthClock %= growthInterval;
      const totalPopulation = this.population + this.getArmyPopulation();
      if (this.hope >= 45 && this.resources.food > totalPopulation * 3 && totalPopulation < this.populationCap) {
        this.population += 1;
        this.syncCivilianPopulation("civilian-departed");
        this.reconcileCivilianJobs();
        this.resources.food -= 6;
        this.hope = Math.min(100, this.hope + 0.5);
        this.events.onToast?.("Новый житель присоединился к поселению.", "success");
      } else if (this.hope < 22 && this.resources.food === 0 && this.population > 2) {
        this.population -= 1;
        this.syncCivilianPopulation("civilian-departed");
        this.reconcileCivilianJobs();
        this.events.onToast?.("Голод вынудил жителя покинуть поселение.", "danger");
      }
    }
    this.clampResourcesToCapacity();
  }

  private getStaffedRatio(): number {
    const jobs = this.getJobCount();
    return jobs === 0 ? 1 : Math.min(1, this.population / jobs);
  }

  private getStorageCapacity(): StorageCapacity {
    const granaries = this.buildings.filter((building) => building.kind === "granary").length;
    const markets = this.buildings.filter((building) => building.kind === "market").length;
    return {
      wood: BASE_STORAGE_CAPACITY.wood + markets * MARKET_STORAGE_BONUS.wood,
      stone: BASE_STORAGE_CAPACITY.stone + markets * MARKET_STORAGE_BONUS.stone,
      food: BASE_STORAGE_CAPACITY.food + granaries * GRANARY_STORAGE_BONUS,
      grain: BASE_STORAGE_CAPACITY.grain + granaries * GRANARY_GRAIN_BONUS,
      iron: BASE_STORAGE_CAPACITY.iron + markets * MARKET_STORAGE_BONUS.iron,
      weapons: BASE_STORAGE_CAPACITY.weapons + markets * MARKET_STORAGE_BONUS.weapons,
    };
  }

  private getFoodUsePerTick(): number {
    const armyFoodWeight = this.army.reduce((sum, unit) => sum
      + (unit.kind === "knight" ? 0.5 : 0.28) * (ARMY_UNITS[unit.kind].populationCost ?? 1), 0);
    const baseUse = Math.max(1, this.population * 0.28 + armyFoodWeight);
    return this.round(baseUse * RATION_POLICIES[this.rationPolicy].foodMultiplier);
  }

  private getPopularityFactors(): PopularityFactors {
    const totalPopulation = this.population + this.getArmyPopulation();
    const freeHousing = this.populationCap - totalPopulation;
    const foodUse = this.getFoodUsePerTick();
    return {
      taxes: TAX_POLICIES[this.taxPolicy].popularityPerTick,
      rations: RATION_POLICIES[this.rationPolicy].popularityPerTick,
      housing: freeHousing <= 0 ? -0.12 : freeHousing >= 3 ? 0.03 : 0,
      food: this.resources.food === 0 ? -3 : this.resources.food < foodUse * 3 ? -0.18 : 0,
      water: Math.min(0.16, this.buildings.filter((house) => house.kind === "house" && this.buildings.some((well) => well.kind === "well" && well.enabled
        && Math.hypot(house.gx - well.gx, house.gz - well.gz) <= 4)).length * 0.04),
    };
  }

  private sumPopularityFactors(factors: PopularityFactors): number {
    return factors.taxes + factors.rations + factors.housing + factors.food + factors.water;
  }

  private getEconomySnapshot(): EconomySnapshot {
    const storageCapacity = this.getStorageCapacity();
    const foodUsePerTick = this.getFoodUsePerTick();
    const popularityFactors = this.getPopularityFactors();
    const projection = this.projectProduction();
    const warnings: string[] = [];
    if (projection.net.food < -0.05) warnings.push(`Еда убывает: ${Math.abs(projection.net.food).toFixed(1)} за 2 с. Постройте ферму или пекарню.`);
    if (this.getJobCount() > this.population) warnings.push(`Не хватает работников: ${this.getJobCount() - this.population}. Приостановите лишние производства или повысьте приоритет важных.`);
    if (this.population + this.getArmyPopulation() >= this.populationCap) warnings.push("В домах нет мест. Без нового жилья жители не прибывают.");
    const stalled = projection.production.filter((entry) => entry.status === "missing-support" || entry.status === "missing-input");
    if (stalled.length) warnings.push(`${stalled.length} производств ждут сырья или поддержки. Выберите здание для подробностей.`);
    const storageRemaining = { ...storageCapacity };
    for (const key of STOCKPILE_KEYS) storageRemaining[key] = this.round(Math.max(0, storageCapacity[key] - this.resources[key]));
    return {
      taxPolicy: this.taxPolicy,
      rationPolicy: this.rationPolicy,
      taxIncomePerTick: this.round(TAX_POLICIES[this.taxPolicy].goldPerCivilian * this.population),
      foodUsePerTick,
      foodReserveSeconds: foodUsePerTick > 0 ? Math.floor((this.resources.food / foodUsePerTick) * 2) : 0,
      staffedRatio: this.round(this.getStaffedRatio()),
      popularityTrendPerTick: this.round(this.sumPopularityFactors(popularityFactors)),
      popularityFactors: {
        taxes: this.round(popularityFactors.taxes),
        rations: this.round(popularityFactors.rations),
        housing: this.round(popularityFactors.housing),
        food: this.round(popularityFactors.food),
        water: this.round(popularityFactors.water),
      },
      storageCapacity,
      storageRemaining,
      production: projection.production,
      netPerTick: projection.net,
      foodNetPerTick: projection.net.food,
      warnings,
    };
  }

  private clampResourcesToCapacity(): void {
    const capacity = this.getStorageCapacity();
    for (const key of STOCKPILE_KEYS) {
      this.resources[key] = Math.max(0, Math.min(capacity[key], this.resources[key]));
    }
  }

  private scaledScenarioTime(seconds: number): number {
    return seconds * DIFFICULTIES[this.selectedDifficulty].waveTimeMultiplier;
  }

  private updateScenarioEvents(): void {
    for (const effect of this.scenarioEffects.filter((item) => item.endsAt <= this.raidClock)) {
      const record: MissionEventRecord = {
        id: `${effect.id}-end`, at: this.raidClock, title: `${effect.title}: завершение`,
        description: "Урожайность полей вернулась к обычному уровню.", tone: "info",
      };
      this.chronicle.push(record);
      this.events.onToast?.(record.description, "info");
    }
    this.scenarioEffects = this.scenarioEffects.filter((effect) => effect.endsAt > this.raidClock);
    if (this.missionCompleted) return;
    for (const event of this.mission.events) {
      if (this.triggeredEvents.has(event.id) || this.raidClock < event.at) continue;
      this.triggeredEvents.add(event.id);
      this.applyScenarioEvent(event);
    }
  }

  private applyScenarioEvent(event: MissionEventDefinition): void {
    const notes: string[] = [];
    if (event.resources) {
      const capacity = this.getStorageCapacity();
      for (const key of RESOURCE_KEYS) {
        const delivered = event.resources[key] ?? 0;
        if (!delivered) continue;
        if (key !== "gold" && this.resources[key] + delivered > capacity[key]) {
          notes.push(`Часть груза «${TRADE_RATES[key].label}» не поместилась на складе.`);
        }
        this.resources[key] += delivered;
      }
      this.clampResourcesToCapacity();
    }
    if (event.population) {
      const accepted = Math.min(event.population, Math.max(0, this.populationCap - this.population - this.getArmyPopulation()));
      this.population += accepted;
      this.syncCivilianPopulation("civilian-departed");
      this.reconcileCivilianJobs();
      if (accepted < event.population) notes.push(`Принято ${accepted} из ${event.population}: не хватает жилья.`);
    }
    if (event.army) {
      const count = Math.min(event.army.count, 24 - this.army.length, Math.max(0, this.populationCap - this.population - this.getArmyPopulation()));
      const definition = ARMY_UNITS[event.army.kind];
      for (let index = 0; index < count; index += 1) {
        this.army.push({
          id: this.nextId++, kind: event.army.kind,
          x: this.mission.keep.gx + 0.4 + index * 0.2, z: this.mission.keep.gz + 0.4,
          hp: definition.maxHp, maxHp: definition.maxHp, speed: definition.speed,
          damage: definition.damage, range: definition.range, cooldown: 0, targetId: null,
          heading: 0, movement: "idle", order: null, garrison: null, attacking: false, attackPulse: 0,
        });
      }
      if (count < event.army.count) notes.push(`В гарнизон принято ${count} из ${event.army.count}: нужны свободные места в домах.`);
    }
    if (event.hope) this.hope = Math.max(0, Math.min(100, this.hope + event.hope));
    if (event.foodProductionMultiplier !== undefined && event.duration) {
      this.scenarioEffects.push({ id: event.id, title: event.title,
        endsAt: this.raidClock + event.duration, foodProductionMultiplier: event.foodProductionMultiplier });
    }
    const description = [event.description, ...notes].join(" ");
    this.chronicle.push({ id: event.id, title: event.title, description, at: this.raidClock, tone: event.tone });
    this.events.onToast?.(`${event.title}. ${description}`, event.tone);
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private spawnWave(wave: MissionWave, number: number): void {
    const difficulty = DIFFICULTIES[this.selectedDifficulty];
    const count = Math.max(1, Math.round(wave.count * difficulty.enemyCountMultiplier));
    for (let index = 0; index < count; index += 1) {
      const specialist = wave.specialists && index < wave.specialists.count ? wave.specialists.kind : undefined;
      const stats = specialist ? enemyUnitStats(specialist) : null;
      const elite = Boolean(wave.eliteEvery && (index + 1) % wave.eliteEvery === 0);
      const along = 2 + ((index * 2.7 + number * 3) % (this.gridSize - 4));
      const spawn = this.spawnPoint(wave.direction, along);
      const baseHp = (78 + number * 13) * (wave.hpScale ?? 1) * difficulty.enemyHpMultiplier;
      const hp = Math.round(stats ? stats.maxHp * difficulty.enemyHpMultiplier : baseHp * (elite ? 1.62 : 1));
      this.raiders.push({
        id: this.nextId++, x: spawn.x, z: spawn.z, kind: specialist, raidEconomy: wave.raidEconomy,
        hp, maxHp: hp,
        speed: stats ? stats.speed : (elite ? 0.5 : 0.59 + number * 0.024) * (wave.speedScale ?? 1),
        damage: Math.round((12 + number * 2.6) * (elite ? 1.4 : 1) * difficulty.enemyDamageMultiplier),
        cooldown: (index % 4) * 0.12,
        elite,
      });
    }
    this.events.onSound?.("wave");
    this.events.onToast?.(`Волна ${number}: ${count} врагов, направление — ${wave.direction}!`, "danger");
  }

  private spawnPoint(direction: MissionWave["direction"], along: number): { x: number; z: number } {
    if (direction === "запад") return { x: -1.8, z: along };
    if (direction === "восток") return { x: this.gridSize + 0.8, z: along };
    if (direction === "север") return { x: along, z: -1.8 };
    return { x: along, z: this.gridSize + 0.8 };
  }

  private updateTowers(dt: number): void {
    for (const tower of this.buildings.filter((item) => item.kind === "tower" || item.kind === "keep")) {
      if (!tower.enabled) continue;
      if (tower.kind === "tower" && (tower.towerUpgrade ?? "none") === "none") continue;
      tower.cooldown -= dt;
      if (tower.cooldown > 0) continue;
      if (tower.kind === "keep") {
        const target = this.closestRaider(tower.gx, tower.gz, 5.3);
        if (!target) continue;
        target.hp -= 22;
        tower.cooldown = 1.25;
        this.events.onProjectile?.({ fromX: tower.gx, fromZ: tower.gz, toX: target.x, toZ: target.z, source: "tower" });
        this.events.onSound?.("arrow");
        continue;
      }
      const upgrade = tower.towerUpgrade ?? "none";
      if (upgrade === "none") continue;
      const definition = TOWER_UPGRADES[upgrade];
      const target = this.closestRaider(tower.gx, tower.gz, definition.range,
        (raider) => definition.targets === "siege" ? isSiegeKind(raider.kind) : !isSiegeKind(raider.kind));
      if (!target) continue;
      target.hp -= definition.damage;
      tower.cooldown = definition.cooldown;
      this.events.onProjectile?.({ fromX: tower.gx, fromZ: tower.gz, toX: target.x, toZ: target.z, source: upgrade === "heavy" ? "catapult" : "ballista" });
      this.events.onSound?.("arrow");
    }
    this.removeDeadRaiders();
  }

  private updateCivilians(dt: number): void {
    this.reconcileCivilianJobs();
    for (const civilian of this.civilianEntities) {
      civilian.movement = "idle";
      if (this.directControl?.entityKind === "civilian" && this.directControl.entityId === civilian.id) {
        this.updateDirectControlledCivilian(civilian, this.directControl, dt);
      } else {
        this.updateCivilianAI(civilian, dt);
      }
    }
  }

  private updateDirectControlledCivilian(civilian: CivilianState, control: DirectControlRuntime, dt: number): void {
    civilian.heading = control.heading;
    civilian.activity = "controlled";
    if (Math.hypot(control.moveX, control.moveZ) <= 0.000001) return;
    const multiplier = control.sprint ? DIRECT_SPRINT_MULTIPLIER : 1;
    this.moveDirectEntity(
      civilian,
      control.moveX * civilian.speed * multiplier * dt,
      control.moveZ * civilian.speed * multiplier * dt,
    );
    civilian.movement = control.sprint ? "sprint" : "walk";
  }

  private updateCivilianAI(civilian: CivilianState, dt: number): void {
    let route = this.civilianRoutes.get(civilian.id);
    if (!route || route.navigationRevision !== this.navigationRevision || route.jobBuildingId !== civilian.jobBuildingId) {
      route = this.rebuildCivilianRoute(civilian, civilian.jobBuildingId === null ? "home" : route?.target ?? "work");
    }

    if (route.waitRemaining > 0) {
      route.waitRemaining = Math.max(0, route.waitRemaining - dt);
      civilian.activity = route.target === "work" && civilian.jobBuildingId !== null ? "working" : "idle";
      if (route.waitRemaining > 0) return;
      if (civilian.jobBuildingId === null) {
        route.waitRemaining = 4;
        return;
      }
      route = this.rebuildCivilianRoute(civilian, route.target === "work" ? "home" : "work");
    }

    while (route.pointIndex < route.points.length) {
      const target = route.points[route.pointIndex];
      const distance = Math.hypot(target.x - civilian.x, target.z - civilian.z);
      if (distance <= 0.055) {
        route.pointIndex += 1;
        continue;
      }
      const beforeX = civilian.x;
      const beforeZ = civilian.z;
      const step = Math.min(distance, civilian.speed * dt);
      this.moveDirectEntity(civilian, ((target.x - civilian.x) / distance) * step, ((target.z - civilian.z) / distance) * step);
      const movedX = civilian.x - beforeX;
      const movedZ = civilian.z - beforeZ;
      if (Math.hypot(movedX, movedZ) > 0.000001) {
        civilian.heading = Math.atan2(movedX, movedZ);
        civilian.movement = "walk";
        civilian.activity = "commuting";
      }
      return;
    }

    civilian.movement = "idle";
    civilian.activity = route.target === "work" && civilian.jobBuildingId !== null ? "working" : "idle";
    route.waitRemaining = route.target === "work"
      ? 2.2 + stableUnitFraction(civilian.id, 0x7f4a7c15) * 1.05
      : civilian.jobBuildingId === null ? 4 : 1.7 + stableUnitFraction(civilian.id, 0x165667b1) * 0.9;
  }

  private updateArmy(dt: number): void {
    for (let index = 0; index < this.army.length; index += 1) {
      const unit = this.army[index];
      unit.cooldown = Math.max(0, unit.cooldown - dt);
      const attackTime = Math.max(0, (this.armyAttackTimers.get(unit.id) ?? 0) - dt);
      if (attackTime > 0) this.armyAttackTimers.set(unit.id, attackTime);
      else this.armyAttackTimers.delete(unit.id);
      unit.attacking = attackTime > 0;
      unit.movement = "idle";

      if (unit.garrison && (unit.garrison.status === "mounting" || unit.garrison.status === "dismounting")) {
        this.updateGarrisonTransition(unit, dt);
      } else if (this.directControl?.entityKind === "army" && this.directControl.entityId === unit.id) {
        this.updateDirectControlledUnit(unit, this.directControl, dt);
      } else if (unit.garrison?.status === "stationed") {
        this.updateGarrisonedUnit(unit);
      } else if (unit.order) {
        this.updateOrderedArmyUnit(unit, dt);
      } else {
        this.updateFallbackArmyUnit(unit, index, dt);
      }
      this.updateWellRecovery(unit, dt);
    }
    this.removeDeadRaiders();
  }

  private updateWellRecovery(unit: ArmyUnitState, dt: number): void {
    if (unit.hp <= 0 || unit.hp >= unit.maxHp || isSiegeKind(unit.kind)) return;
    const well = this.buildings
      .filter((building) => building.kind === "well" && building.hp > 0 && building.enabled)
      .map((building) => ({ building, distance: Math.hypot(building.gx - unit.x, building.gz - unit.z) }))
      .filter((candidate) => candidate.distance <= WELL_RECOVERY_RADIUS)
      .sort((a, b) => a.distance - b.distance || a.building.id - b.building.id)[0]?.building;
    if (!well) return;
    const enemiesNearby = this.raiders.some((raider) => raider.hp > 0 && (
      Math.hypot(raider.x - unit.x, raider.z - unit.z) <= WELL_SAFE_RADIUS
      || Math.hypot(raider.x - well.gx, raider.z - well.gz) <= WELL_SAFE_RADIUS
    ));
    if (enemiesNearby) return;
    unit.hp = Math.min(unit.maxHp, this.round(unit.hp + unit.maxHp * WELL_RECOVERY_MAX_HP_PER_SECOND * dt));
  }

  private updateDirectControlledUnit(unit: ArmyUnitState, control: DirectControlRuntime, dt: number): void {
    unit.targetId = null;
    unit.heading = control.heading;
    const moving = Math.hypot(control.moveX, control.moveZ) > 0.000001;
    if (moving) {
      const multiplier = control.sprint ? DIRECT_SPRINT_MULTIPLIER : 1;
      if (unit.garrison?.status === "stationed") {
        this.moveDirectGarrisonedUnit(unit, control.moveX * unit.speed * dt, control.moveZ * unit.speed * dt);
        unit.movement = "walk";
      } else {
        this.moveDirectEntity(unit, control.moveX * unit.speed * multiplier * dt, control.moveZ * unit.speed * multiplier * dt);
        unit.movement = control.sprint ? "sprint" : "walk";
      }
    }
    if (control.attackQueued) {
      control.attackQueued = false;
      if (this.performDirectAttack(unit, control.aimX, control.aimZ, control.aimPitch)) control.heading = unit.heading;
    }
  }

  private updateOrderedArmyUnit(unit: ArmyUnitState, dt: number): void {
    const order = unit.order!;
    if (order.kind === "garrison") {
      const assignment = unit.garrison;
      const building = assignment
        ? this.buildings.find((candidate) => candidate.id === assignment.buildingId && candidate.hp > 0)
        : undefined;
      if (!assignment || !building || !this.isGarrisonBuilding(building)) {
        if (assignment?.status === "approaching") this.cancelGarrisonApproach(unit);
        else this.evacuateGarrisonUnit(unit);
        return;
      }
      if (Math.hypot(order.destinationX - unit.x, order.destinationZ - unit.z) <= 0.16) {
        assignment.status = "mounting";
        assignment.transition = 0;
        unit.x = assignment.approachX;
        unit.z = assignment.approachZ;
        unit.heading = this.garrisonFacing(building);
        unit.movement = "idle";
        unit.order = null;
        unit.targetId = null;
        this.armyPaths.delete(unit.id);
        return;
      }
      this.moveArmyToward(unit, order.destinationX, order.destinationZ, dt);
      return;
    }
    if (order.status === "moving") {
      if (order.kind === "attack-move") {
        const explicitBuilding = order.targetBuildingId === undefined
          ? undefined
          : this.duelCastle?.buildings.find((building) => building.id === order.targetBuildingId && building.hp > 0);
        if (explicitBuilding) {
          unit.targetId = explicitBuilding.id;
          this.engageArmyTarget(unit, explicitBuilding, dt);
          return;
        }
        if (order.targetBuildingId !== undefined) {
          order.targetBuildingId = undefined;
          unit.targetId = null;
        }
        const target = this.getArmyTarget(unit, this.armyAcquisitionRange(unit));
        if (target) {
          this.engageArmyTarget(unit, target, dt);
          return;
        }
      } else {
        unit.targetId = null;
      }
      if (Math.hypot(order.destinationX - unit.x, order.destinationZ - unit.z) <= 0.13) {
        order.status = "holding";
        unit.movement = "idle";
        return;
      }
      this.moveArmyToward(unit, order.destinationX, order.destinationZ, dt);
      if (Math.hypot(order.destinationX - unit.x, order.destinationZ - unit.z) <= 0.13) order.status = "holding";
      return;
    }

    if (order.holdPosition) {
      unit.movement = "idle";
      const target = this.getArmyTarget(unit, unit.range);
      unit.targetId = target?.id ?? null;
      if (target) {
        const point = this.hostilePosition(target);
        const distance = Math.hypot(point.x - unit.x, point.z - unit.z);
        if (distance <= unit.range && distance >= (ARMY_UNITS[unit.kind].minRange ?? 0)) {
          unit.heading = Math.atan2(point.x - unit.x, point.z - unit.z);
          if (unit.cooldown <= 0) this.applyArmyAttack(unit, target);
        }
      }
      return;
    }
    let target = this.getArmyTarget(unit, this.armyAcquisitionRange(unit));
    const targetPoint = target ? this.hostilePosition(target) : null;
    if (target && targetPoint && Math.hypot(targetPoint.x - order.destinationX, targetPoint.z - order.destinationZ) > 8.5) {
      target = undefined;
      unit.targetId = null;
    }
    if (target) this.engageArmyTarget(unit, target, dt);
  }

  private updateGarrisonedUnit(unit: ArmyUnitState): void {
    const assignment = unit.garrison;
    const building = assignment
      ? this.buildings.find((candidate) => candidate.id === assignment.buildingId && candidate.hp > 0)
      : undefined;
    if (!assignment || !building || !this.isGarrisonBuilding(building)) {
      this.evacuateGarrisonUnit(unit);
      return;
    }
    unit.x = assignment.deckX;
    unit.z = assignment.deckZ;
    assignment.deckY = this.directDeckHeight(building, assignment.deckX, assignment.deckZ);
    unit.movement = "idle";
    const range = this.unitAttackRange(unit);
    // Personnel on ramparts protect the walls from enemy fighters. Siege engines
    // need the dedicated heavy tower module instead of absorbing free arrow fire.
    const target = this.closestRaider(unit.x, unit.z, range, (raider) => !isSiegeKind(raider.kind));
    const targetPoint = target ? this.hostilePosition(target) : null;
    if (!target || !targetPoint || Math.hypot(targetPoint.x - unit.x, targetPoint.z - unit.z) > range) {
      unit.targetId = null;
      return;
    }
    unit.targetId = target.id;
    unit.heading = Math.atan2(targetPoint.x - unit.x, targetPoint.z - unit.z);
    if (unit.cooldown <= 0) this.applyArmyAttack(unit, target);
  }

  private updateGarrisonTransition(unit: ArmyUnitState, dt: number): void {
    const assignment = unit.garrison;
    const building = assignment
      ? this.buildings.find((candidate) => candidate.id === assignment.buildingId && candidate.hp > 0)
      : undefined;
    if (!assignment || !building || !this.isGarrisonBuilding(building)) {
      this.evacuateGarrisonUnit(unit);
      return;
    }
    const direction = assignment.status === "mounting" ? 1 : -1;
    assignment.transition = Math.max(0, Math.min(1,
      assignment.transition + direction * dt / GARRISON_TRANSITION_SECONDS));
    unit.x = assignment.approachX + (assignment.deckX - assignment.approachX) * assignment.transition;
    unit.z = assignment.approachZ + (assignment.deckZ - assignment.approachZ) * assignment.transition;
    unit.heading = this.garrisonFacing(building);
    unit.targetId = null;
    unit.movement = "idle";
    if (assignment.status === "mounting" && assignment.transition >= 1) {
      assignment.status = "stationed";
      unit.x = assignment.deckX;
      unit.z = assignment.deckZ;
      return;
    }
    if (assignment.status === "dismounting" && assignment.transition <= 0) {
      const queued = assignment.queuedGroundOrder;
      unit.x = assignment.approachX;
      unit.z = assignment.approachZ;
      unit.garrison = null;
      unit.order = queued;
      this.armyPaths.delete(unit.id);
    }
  }

  private updateFallbackArmyUnit(unit: ArmyUnitState, index: number, dt: number): void {
    let target = this.getArmyTarget(unit, this.armyAcquisitionRange(unit));
    const targetPoint = target ? this.hostilePosition(target) : null;
    if (target && targetPoint && Math.hypot(targetPoint.x - this.rallyPoint.gx, targetPoint.z - this.rallyPoint.gz) > 7) {
      target = undefined;
      unit.targetId = null;
    }
    if (target) {
      this.engageArmyTarget(unit, target, dt);
      return;
    }
    const angle = index * 2.399;
    const radius = 0.4 + Math.floor(index / 6) * 0.35;
    const destination = this.findOpenFormationPoint(this.clampArmyPoint({
      x: this.rallyPoint.gx + Math.cos(angle) * radius,
      z: this.rallyPoint.gz + Math.sin(angle) * radius,
    }), []);
    this.moveArmyToward(unit, destination.x, destination.z, dt);
  }

  private armyAcquisitionRange(unit: ArmyUnitState): number {
    return isSiegeKind(unit.kind) ? unit.range + 2 : unit.kind === "archer" ? 6.2 : 5.6;
  }

  private getArmyTarget(unit: ArmyUnitState, acquisitionRange: number): HostileTarget | undefined {
    const enemyBuildings = this.missionCompleted ? [] : this.duelCastle?.buildings ?? [];
    let target: HostileTarget | undefined = unit.targetId === null ? undefined
      : this.raiders.find((raider) => raider.id === unit.targetId)
        ?? enemyBuildings.find((building) => building.id === unit.targetId);
    const position = target ? this.hostilePosition(target) : null;
    if (!target || target.hp <= 0 || !position || Math.hypot(position.x - unit.x, position.z - unit.z) > Math.max(9.5, acquisitionRange + 1)) {
      if (ARMY_UNITS[unit.kind].allowedTargets !== "buildings") target = this.closestRaider(unit.x, unit.z, acquisitionRange);
      if (!target && enemyBuildings.length > 0) target = this.closestEnemyBuilding(unit, acquisitionRange);
      unit.targetId = target?.id ?? null;
    }
    return target;
  }

  private closestEnemyBuilding(unit: ArmyUnitState, range: number): BuildingState | undefined {
    const buildings = this.missionCompleted ? [] : this.duelCastle?.buildings.filter((building) => building.hp > 0) ?? [];
    const priority = (building: BuildingState): number => unit.kind === "batteringRam"
      ? building.kind === "gate" ? 0 : building.kind === "wall" ? 1 : building.kind === "tower" ? 2 : building.kind === "keep" ? 3 : 4
      : building.kind === "tower" ? 0 : building.kind === "gate" || building.kind === "wall" ? 1 : building.kind === "keep" ? 2 : 3;
    return buildings.map((building) => ({ building, distance: Math.hypot(building.gx - unit.x, building.gz - unit.z) }))
      .filter((candidate) => candidate.distance <= range)
      .sort((a, b) => priority(a.building) - priority(b.building) || a.distance - b.distance || a.building.id - b.building.id)[0]?.building;
  }

  private hostilePosition(target: HostileTarget): ArmyCommandPoint {
    return "gx" in target ? { x: target.gx, z: target.gz } : { x: target.x, z: target.z };
  }

  private findSiegeFiringPosition(
    originX: number,
    originZ: number,
    target: BuildingState,
    range: number,
    minRange: number,
    enemyPerspective: boolean,
    reserved: readonly ArmyCommandPoint[] = [],
  ): ArmyCommandPoint | null {
    const preferred = Math.atan2(originZ - target.gz, originX - target.gx);
    const outer = Math.max(minRange + 0.45, range - 0.65);
    const inner = Math.max(minRange + 0.4, Math.min(outer, range * 0.72));
    const radii = outer - inner > 0.2 ? [outer, inner] : [outer];
    const offsets = [0];
    for (let step = 1; step <= 12; step += 1) offsets.push(step * Math.PI / 12, -step * Math.PI / 12);
    const start = {
      x: Math.max(0, Math.min(this.gridSize - 1, Math.round(originX))),
      z: Math.max(0, Math.min(this.gridSize - 1, Math.round(originZ))),
    };
    for (const radius of radii) for (const offset of offsets) {
      const point = this.clampArmyPoint({
        x: target.gx + Math.cos(preferred + offset) * radius,
        z: target.gz + Math.sin(preferred + offset) * radius,
      });
      const targetDistance = Math.hypot(point.x - target.gx, point.z - target.gz);
      if (targetDistance < minRange + 0.15 || targetDistance > range - 0.1
        || reserved.some((other) => Math.hypot(other.x - point.x, other.z - point.z) < FORMATION_SPACING * 0.7)
        || (enemyPerspective ? this.enemyObstructionDepth(point.x, point.z) : this.armyObstructionDepth(point.x, point.z)) > 0) continue;
      const goal = {
        x: Math.max(0, Math.min(this.gridSize - 1, Math.round(point.x))),
        z: Math.max(0, Math.min(this.gridSize - 1, Math.round(point.z))),
      };
      const path = this.findPath(start, goal, enemyPerspective ? "enemy" : "player");
      if (path.length > 0 || start.x === goal.x && start.z === goal.z) return point;
    }
    return null;
  }

  private engageArmyTarget(unit: ArmyUnitState, target: HostileTarget, dt: number): void {
    unit.targetId = target.id;
    const point = this.hostilePosition(target);
    unit.heading = Math.atan2(point.x - unit.x, point.z - unit.z);
    const distance = Math.hypot(point.x - unit.x, point.z - unit.z);
    const minRange = ARMY_UNITS[unit.kind].minRange ?? 0;
    if (distance <= unit.range && distance >= minRange) {
      if (unit.cooldown <= 0) this.applyArmyAttack(unit, target);
    } else {
      if (distance > unit.range) {
        const explicitOrder = unit.order?.kind === "attack-move" && unit.order.targetBuildingId === target.id
          ? unit.order : null;
        const approach = unit.kind === "catapult" && "gx" in target
          ? explicitOrder
            ? { x: explicitOrder.destinationX, z: explicitOrder.destinationZ }
            : this.findSiegeFiringPosition(unit.x, unit.z, target, unit.range, minRange, false)
          : null;
        this.moveArmyToward(unit, approach?.x ?? point.x, approach?.z ?? point.z, dt);
      }
      else if (distance < minRange && distance > 0.0001) {
        const retreat = minRange - distance + 0.35;
        this.moveArmyToward(
          unit,
          unit.x + ((unit.x - point.x) / distance) * retreat,
          unit.z + ((unit.z - point.z) / distance) * retreat,
          dt,
        );
      }
    }
  }

  private performDirectAttack(unit: ArmyUnitState, aimX: number, aimZ: number, aimPitch: number | null = null): boolean {
    if (unit.cooldown > 0) return false;
    let directionX = aimX - unit.x;
    let directionZ = aimZ - unit.z;
    const aimLength = Math.hypot(directionX, directionZ);
    if (aimLength > 0.000001) {
      directionX /= aimLength;
      directionZ /= aimLength;
    } else {
      directionX = Math.sin(unit.heading);
      directionZ = Math.cos(unit.heading);
    }
    unit.heading = Math.atan2(directionX, directionZ);
    const attackRange = this.unitAttackRange(unit);
    if (unit.kind === "archer" && aimPitch !== null) {
      return this.performDirectBallisticArcherAttack(unit, directionX, directionZ, aimPitch, attackRange);
    }
    const candidates = this.raiders.map((raider) => {
      const dx = raider.x - unit.x;
      const dz = raider.z - unit.z;
      const distance = Math.hypot(dx, dz);
      const forwardDistance = dx * directionX + dz * directionZ;
      const lateralDistance = Math.abs(dx * directionZ - dz * directionX);
      const alignment = distance > 0.000001 ? forwardDistance / distance : 1;
      return { raider, distance, forwardDistance, lateralDistance, alignment };
    });
    const target = unit.kind === "archer"
      ? candidates
        .filter(({ raider, forwardDistance, lateralDistance }) => raider.hp > 0
          && forwardDistance >= 0.15 && forwardDistance <= attackRange && lateralDistance <= 0.46)
        .sort((a, b) => a.lateralDistance - b.lateralDistance || a.forwardDistance - b.forwardDistance)[0]?.raider
      : candidates
        .filter(({ raider, distance, alignment }) => {
          const halfAngle = unit.kind === "spearman" ? Math.PI / 4 : Math.PI / 3;
          return raider.hp > 0 && distance <= attackRange && alignment >= Math.cos(halfAngle);
        })
        .sort((a, b) => b.alignment - a.alignment || a.distance - b.distance)[0]?.raider;
    unit.targetId = target?.id ?? null;
    if (target) {
      this.applyArmyAttack(unit, target);
      return true;
    }
    this.signalArmyAttack(unit);
    if (unit.kind === "archer") {
      const distance = aimLength > 0.000001 ? Math.min(attackRange, aimLength) : attackRange;
      this.events.onProjectile?.({
        fromX: unit.x, fromZ: unit.z,
        toX: unit.x + directionX * distance,
        toZ: unit.z + directionZ * distance,
        fromY: this.unitProjectileHeight(unit),
        toY: HUMAN_TARGET_HEIGHT,
        source: "archer",
      });
      this.events.onSound?.("arrow");
    }
    return true;
  }

  private performDirectBallisticArcherAttack(
    unit: ArmyUnitState,
    directionX: number,
    directionZ: number,
    aimPitch: number,
    attackRange: number,
  ): boolean {
    const pitch = Math.max(-1.2, Math.min(1.2, aimPitch));
    const horizontal = Math.cos(pitch);
    const solution = solveBallisticArc({
      sourceX: unit.x,
      sourceZ: unit.z,
      sourceY: this.unitProjectileHeight(unit),
      aimDirection: {
        x: directionX * horizontal,
        y: Math.sin(pitch),
        z: directionZ * horizontal,
      },
      maxRangeGrid: attackRange,
      tileSize: TILE_SIZE,
      speed: DIRECT_ARCHER_SPEED,
      gravity: DIRECT_ARCHER_GRAVITY,
      groundY: DIRECT_ARCHER_GROUND_Y,
      bounds: { minX: 0, maxX: this.gridSize - 1, minZ: 0, maxZ: this.gridSize - 1 },
    });
    const target = this.raiders
      .filter((raider) => raider.hp > 0
        && Math.hypot(raider.x - solution.landing.x, raider.z - solution.landing.z) <= DIRECT_ARCHER_IMPACT_RADIUS)
      .sort((a, b) => Math.hypot(a.x - solution.landing.x, a.z - solution.landing.z)
        - Math.hypot(b.x - solution.landing.x, b.z - solution.landing.z) || a.id - b.id)[0];
    unit.targetId = target?.id ?? null;
    if (target) target.hp -= unit.damage;
    this.signalArmyAttack(unit);
    this.events.onProjectile?.({
      fromX: unit.x,
      fromZ: unit.z,
      toX: solution.landing.x,
      toZ: solution.landing.z,
      fromY: this.unitProjectileHeight(unit),
      toY: solution.landing.y,
      source: "archer",
      ballistic: {
        flightSeconds: solution.flightSeconds,
        initialVelocityY: solution.initialVelocityY,
        gravity: solution.gravity,
        lingerSeconds: 1,
        impact: target ? "target" : "ground",
      },
    });
    this.events.onSound?.("arrow");
    return true;
  }

  private applyArmyAttack(unit: ArmyUnitState, target: HostileTarget): void {
    const isBuilding = "gx" in target;
    target.hp -= isBuilding ? ARMY_UNITS[unit.kind].buildingDamage ?? unit.damage * 0.6 : unit.damage;
    this.signalArmyAttack(unit);
    const point = this.hostilePosition(target);
    if (unit.kind === "archer" || unit.kind === "catapult") {
      this.events.onProjectile?.({
        fromX: unit.x,
        fromZ: unit.z,
        toX: point.x,
        toZ: point.z,
        fromY: this.unitProjectileHeight(unit),
        toY: isBuilding ? 0.9 : HUMAN_TARGET_HEIGHT,
        source: unit.kind === "catapult" ? "catapult" : "archer",
      });
      this.events.onSound?.("arrow");
    }
    if (isBuilding && target.hp <= 0) this.destroyEnemyBuilding(target);
  }

  private signalArmyAttack(unit: ArmyUnitState): void {
    unit.cooldown = ARMY_UNITS[unit.kind].cooldown;
    unit.attackPulse += 1;
    unit.attacking = true;
    this.armyAttackTimers.set(unit.id, ATTACK_POSE_SECONDS);
  }

  private updateRaiders(dt: number): void {
    const keep = this.buildings.find((item) => item.kind === "keep");
    if (!keep) return;
    for (const raider of this.raiders) {
      raider.cooldown -= dt;
      raider.attacking = false;
      const kind = raider.kind ?? "raider";
      const stats = enemyUnitStats(kind);
      const guard = raider.stance === "guard";
      if (!isSiegeKind(kind)) {
        const detection = guard ? kind === "archer" ? 7.2 : 4.5 : kind === "archer" ? 5.4 : 1.5;
        const defender = this.closestPlayerUnit(raider.x, raider.z, detection,
          (unit) => !unit.garrison || unit.garrison.status === "approaching");
        if (defender) {
          const distance = Math.hypot(raider.x - defender.x, raider.z - defender.z);
          raider.heading = Math.atan2(defender.x - raider.x, defender.z - raider.z);
          if (distance <= stats.range) {
            if (raider.cooldown <= 0) this.enemyAttackPlayerUnit(raider, defender, stats.cooldown);
            continue;
          }
          if (this.moveEnemyAlongPath(raider, defender.x, defender.z, dt, defender.id)) continue;
        }
      }

      if (guard) {
        const homeX = raider.homeX ?? this.mission.duel?.enemyKeep.gx ?? raider.x;
        const homeZ = raider.homeZ ?? this.mission.duel?.enemyKeep.gz ?? raider.z;
        if (Math.hypot(homeX - raider.x, homeZ - raider.z) > 0.14) {
          this.moveEnemyAlongPath(raider, homeX, homeZ, dt, -raider.id);
        }
        continue;
      }

      if (isSiegeKind(kind)) {
        const target = this.playerBuildingTargetForSiege(raider, kind);
        if (!target) continue;
        const distance = Math.hypot(target.gx - raider.x, target.gz - raider.z);
        raider.heading = Math.atan2(target.gx - raider.x, target.gz - raider.z);
        if (distance <= stats.range && distance >= stats.minRange) {
          if (raider.cooldown <= 0) this.enemyAttackBuilding(raider, target, stats);
        } else if (distance > stats.range) {
          const path = this.getEnemySiegePath(raider, target, stats.range, stats.minRange);
          if (path.length === 0) continue;
          if (Math.hypot(path[0].x - raider.x, path[0].z - raider.z) < 0.18 && path.length > 1) path.shift();
          const waypoint = path[0];
          raider.heading = Math.atan2(waypoint.x - raider.x, waypoint.z - raider.z);
          this.moveToward(raider, waypoint.x, waypoint.z, dt);
        }
        else if (distance < stats.minRange && distance > 0.0001) {
          const retreat = stats.minRange - distance + 0.35;
          this.moveToward(
            raider,
            raider.x + ((raider.x - target.gx) / distance) * retreat,
            raider.z + ((raider.z - target.gz) / distance) * retreat,
            dt,
          );
        }
        continue;
      }

      const nearby = this.buildings.map((building) => ({ building, distance: Math.hypot(raider.x - building.gx, raider.z - building.gz) }))
        .filter(({ building, distance }) => distance < (building.kind === "keep" ? 1.05 : 0.76))
        .sort((a, b) => a.distance - b.distance)[0]?.building;
      if (nearby) {
        if (raider.cooldown <= 0) this.enemyAttackBuilding(raider, nearby, stats);
        continue;
      }

      const destination = raider.raidEconomy ? this.buildings.filter(b=>b.hp>0 && ['lumber','quarry','farm','ironMine'].includes(b.kind))
        .sort((a,b)=>Math.hypot(a.gx-raider.x,a.gz-raider.z)-Math.hypot(b.gx-raider.x,b.gz-raider.z))[0] ?? keep : keep;
      const path = this.getPath(raider, destination);
      const waypoint = path[0] ?? { x: keep.gx, z: keep.gz };
      if (Math.hypot(waypoint.x - raider.x, waypoint.z - raider.z) < 0.22 && path.length > 1) path.shift();
      const target = path[0] ?? waypoint;
      raider.heading = Math.atan2(target.x - raider.x, target.z - raider.z);
      this.moveToward(raider, target.x, target.z, dt);
    }
  }

  private enemyAttackPlayerUnit(raider: RaiderState, defender: ArmyUnitState, cooldown: number): void {
    const protectedByWalls = defender.kind === "spearman" && this.buildings.some((building) => ["wall", "gate", "tower"].includes(building.kind)
      && Math.hypot(building.gx - defender.x, building.gz - defender.z) < 1.8);
    const armor = defender.kind === "swordsman" ? 0.78 : isSiegeKind(defender.kind) ? 0.72 : protectedByWalls ? 0.82 : 1;
    defender.hp -= raider.damage * armor;
    raider.cooldown = cooldown;
    raider.attacking = true;
    raider.attackPulse = (raider.attackPulse ?? 0) + 1;
    if ((raider.kind ?? "raider") === "archer") {
      this.events.onProjectile?.({ fromX: raider.x, fromZ: raider.z, toX: defender.x, toZ: defender.z, source: "archer" });
      this.events.onSound?.("arrow");
    }
    if (defender.hp <= 0) {
      this.removeArmyUnit(defender.id);
      this.hope = Math.max(0, this.hope - 2);
    }
  }

  private playerBuildingTargetForSiege(raider: RaiderState, kind: EnemyUnitKind): BuildingState | undefined {
    const priority = (building: BuildingState): number => kind === "batteringRam"
      ? building.kind === "gate" ? 0 : building.kind === "wall" ? 1 : building.kind === "tower" ? 2 : building.kind === "keep" ? 3 : 4
      : building.kind === "tower" ? 0 : building.kind === "gate" || building.kind === "wall" ? 1 : building.kind === "keep" ? 2 : 3;
    const candidates = this.buildings.filter((building) => building.hp > 0)
      .map((building) => ({ building, distance: Math.hypot(building.gx - raider.x, building.gz - raider.z) }))
      .sort((a, b) => priority(a.building) - priority(b.building) || a.distance - b.distance || a.building.id - b.building.id);
    const stats = enemyUnitStats(kind);
    const canEngage = ({ building, distance }: { building: BuildingState; distance: number }): boolean => {
      if (distance <= stats.range) return true;
      return this.getEnemySiegePath(raider, building, stats.range, stats.minRange).length > 0;
    };
    const locked = raider.targetBuildingId === undefined
      ? undefined
      : candidates.find(({ building }) => building.id === raider.targetBuildingId);
    if (locked && canEngage(locked)) return locked.building;
    raider.targetBuildingId = undefined;
    const target = candidates.find(canEngage)?.building;
    if (target) raider.targetBuildingId = target.id;
    return target;
  }

  private enemyAttackBuilding(
    raider: RaiderState,
    building: BuildingState,
    stats: ReturnType<typeof enemyUnitStats>,
  ): void {
    building.hp -= stats.buildingDamage * DIFFICULTIES[this.selectedDifficulty].enemyDamageMultiplier;
    raider.cooldown = stats.cooldown;
    raider.attacking = true;
    raider.attackPulse = (raider.attackPulse ?? 0) + 1;
    if ((raider.kind ?? "raider") === "catapult") {
      this.events.onProjectile?.({ fromX: raider.x, fromZ: raider.z, toX: building.gx, toZ: building.gz, toY: 0.9, source: "catapult" });
    }
    if (building.hp <= 0) this.destroyBuilding(building);
  }

  private getPath(raider: RaiderState, keep: BuildingState): PathPoint[] {
    const cached = this.paths.get(raider.id);
    if (cached && cached.revision === this.navigationRevision && cached.expires > this.raidClock
      && cached.targetId === keep.id) return cached.points;
    const start = {
      x: Math.max(0, Math.min(this.gridSize - 1, Math.round(raider.x))),
      z: Math.max(0, Math.min(this.gridSize - 1, Math.round(raider.z))),
    };
    const points = this.findPath(start, { x: keep.gx, z: keep.gz }, "enemy");
    let usable = points;
    if (usable.length === 0) {
      const barrier = this.buildings
        .filter((item) => item.kind === "wall" || item.kind === "gate")
        .map((item) => ({ item, score: Math.hypot(item.gx - raider.x, item.gz - raider.z) + Math.hypot(item.gx - keep.gx, item.gz - keep.gz) * 0.22 }))
        .sort((a, b) => a.score - b.score)[0]?.item;
      usable = barrier ? this.findPath(start, { x: barrier.gx, z: barrier.gz }, "enemy") : [];
      if (usable.length === 0) usable = barrier ? [{ x: barrier.gx, z: barrier.gz }] : [{ x: keep.gx, z: keep.gz }];
    }
    this.paths.set(raider.id, { revision: this.navigationRevision, expires: this.raidClock + 0.62, points: usable, targetId: keep.id });
    return usable;
  }

  private moveEnemyAlongPath(
    raider: RaiderState,
    targetX: number,
    targetZ: number,
    dt: number,
    targetId: number,
  ): boolean {
    let path: PathPoint[];
    const cached = this.paths.get(raider.id);
    if (cached && cached.revision === this.navigationRevision && cached.expires > this.raidClock
      && cached.targetId === targetId) path = cached.points;
    else {
      const start = {
        x: Math.max(0, Math.min(this.gridSize - 1, Math.round(raider.x))),
        z: Math.max(0, Math.min(this.gridSize - 1, Math.round(raider.z))),
      };
      const goal = {
        x: Math.max(0, Math.min(this.gridSize - 1, Math.round(targetX))),
        z: Math.max(0, Math.min(this.gridSize - 1, Math.round(targetZ))),
      };
      path = this.findPath(start, goal, "enemy");
      const reachable = path.length > 0 || start.x === goal.x && start.z === goal.z;
      const last = path.at(-1);
      if (reachable && (!last || Math.hypot(last.x - targetX, last.z - targetZ) > 0.04)) path.push({ x: targetX, z: targetZ });
      this.paths.set(raider.id, {
        revision: this.navigationRevision,
        expires: this.raidClock + 0.42,
        points: reachable ? path : [],
        targetId,
      });
      if (!reachable) return false;
    }
    if (path.length === 0) return false;
    if (Math.hypot(path[0].x - raider.x, path[0].z - raider.z) < 0.18 && path.length > 1) path.shift();
    const waypoint = path[0];
    raider.heading = Math.atan2(waypoint.x - raider.x, waypoint.z - raider.z);
    this.moveToward(raider, waypoint.x, waypoint.z, dt);
    return true;
  }

  private getEnemySiegePath(
    raider: RaiderState,
    target: BuildingState,
    range: number,
    minRange: number,
  ): PathPoint[] {
    const cached = this.paths.get(raider.id);
    if (cached && cached.revision === this.navigationRevision && cached.expires > this.raidClock
      && cached.targetId === target.id) return cached.points;
    const start = {
      x: Math.max(0, Math.min(this.gridSize - 1, Math.round(raider.x))),
      z: Math.max(0, Math.min(this.gridSize - 1, Math.round(raider.z))),
    };
    const approach = (raider.kind ?? "raider") === "catapult"
      ? this.findSiegeFiringPosition(raider.x, raider.z, target, range, minRange, true)
      : { x: target.gx, z: target.gz };
    if (!approach) {
      this.paths.set(raider.id, {
        revision: this.navigationRevision,
        expires: this.raidClock + 0.62,
        points: [],
        targetId: target.id,
      });
      return [];
    }
    const goal = {
      x: Math.max(0, Math.min(this.gridSize - 1, Math.round(approach.x))),
      z: Math.max(0, Math.min(this.gridSize - 1, Math.round(approach.z))),
    };
    const points = this.findPath(start, goal, "enemy");
    const reachable = points.length > 0 || start.x === goal.x && start.z === goal.z;
    const last = points.at(-1);
    if (reachable && (!last || Math.hypot(last.x - approach.x, last.z - approach.z) > 0.04)) points.push(approach);
    this.paths.set(raider.id, {
      revision: this.navigationRevision,
      expires: this.raidClock + 0.62,
      points: reachable ? points : [],
      targetId: target.id,
    });
    return reachable ? points : [];
  }

  private findPath(start: PathPoint, goal: PathPoint, perspective: "player" | "enemy"): PathPoint[] {
    const terrain = terrainFor(this.selectedMission, this.mapRulesVersion);
    if (!terrainPassable(terrainAt(terrain, goal.x, goal.z))) return [];
    const key = (point: PathPoint) => `${point.x},${point.z}`;
    const duelBuildings = this.duelCastle?.buildings ?? [];
    const friendly = perspective === "player"
      ? this.missionCompleted ? [...this.buildings, ...duelBuildings] : this.buildings
      : duelBuildings;
    const hostile = perspective === "player"
      ? this.missionCompleted ? [] : duelBuildings
      : this.buildings;
    const obstacles = [...friendly.filter((item) => item.kind !== "gate"), ...hostile];
    const blocked = new Set(obstacles
      .filter((item) => item.hp > 0)
      .map((item) => `${item.gx},${item.gz}`));
    blocked.delete(key(start));
    blocked.delete(key(goal));
    const open: Array<{ point: PathPoint; score: number }> = [{ point: start, score: 0 }];
    const cameFrom = new Map<string, PathPoint>();
    const costs = new Map<string, number>([[key(start), 0]]);
    while (open.length > 0) {
      open.sort((a, b) => a.score - b.score);
      const current = open.shift()!.point;
      if (current.x === goal.x && current.z === goal.z) {
        const result: PathPoint[] = [];
        let cursor = current;
        while (key(cursor) !== key(start)) {
          result.unshift(cursor);
          const previous = cameFrom.get(key(cursor));
          if (!previous) break;
          cursor = previous;
        }
        return result;
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { x: current.x + dx, z: current.z + dz };
        if (next.x < 0 || next.z < 0 || next.x >= this.gridSize || next.z >= this.gridSize || blocked.has(key(next)) || !terrainPassable(terrainAt(terrain, next.x, next.z))) continue;
        const nextCost = (costs.get(key(current)) ?? 0) + 1;
        if (nextCost >= (costs.get(key(next)) ?? Infinity)) continue;
        costs.set(key(next), nextCost);
        cameFrom.set(key(next), current);
        const heuristic = Math.abs(goal.x - next.x) + Math.abs(goal.z - next.z);
        open.push({ point: next, score: nextCost + heuristic });
      }
    }
    return [];
  }

  private destroyBuilding(building: BuildingState): void {
    if (building.kind === "keep") {
      this.setStatus("defeat");
      this.events.onSound?.("defeat");
      return;
    }
    this.removeBuilding(building);
    this.hope = Math.max(0, this.hope - 7);
    this.events.onToast?.(`${BUILDINGS[building.kind].name} разрушен!`, "danger");
  }

  private destroyEnemyBuilding(building: BuildingState): void {
    const state = this.duelCastle;
    if (!state || !state.buildings.some((candidate) => candidate.id === building.id)) return;
    if (building.kind === "keep") {
      building.hp = 0;
      this.checkDuelOutcome();
      return;
    }
    state.buildings = state.buildings.filter((candidate) => candidate.id !== building.id);
    if (building.kind === "house") {
      state.populationCap = Math.max(4, state.populationCap - 4, this.getEnemyArmyPopulation());
      state.population = Math.min(state.population, Math.max(0, state.populationCap - this.getEnemyArmyPopulation()));
    }
    if (["tower", "wall", "gate"].includes(building.kind)) {
      state.fortificationsDestroyed += 1;
    }
    this.navigationRevision += 1;
    this.paths.clear();
    this.armyPaths.clear();
    this.events.onToast?.(`${this.mission.duel!.enemyName}: ${BUILDINGS[building.kind].shortName} разрушен.`, "success");
  }

  private closestRaider(x: number, z: number, range: number, predicate: (raider: RaiderState) => boolean = () => true): RaiderState | undefined {
    return this.raiders
      .map((raider) => ({ raider, distance: Math.hypot(raider.x - x, raider.z - z) }))
      .filter(({ raider, distance }) => raider.hp > 0 && distance <= range && predicate(raider))
      .sort((a, b) => a.distance - b.distance)[0]?.raider;
  }

  private hasEnemyWithinBuildingDistance(x: number, z: number): boolean {
    return this.raiders.some((raider) => raider.hp > 0
      && Math.hypot(raider.x - x, raider.z - z) <= ENEMY_BUILDING_EXCLUSION_RADIUS);
  }

  private moveToward(unit: { x: number; z: number; speed: number }, x: number, z: number, dt: number): void {
    const dx = x - unit.x;
    const dz = z - unit.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.04) return;
    const step = Math.min(length, unit.speed * dt);
    const nextX=unit.x+(dx/length)*step, nextZ=unit.z+(dz/length)*step;
    if (Math.round(nextX)>=0 && Math.round(nextZ)>=0 && Math.round(nextX)<this.gridSize && Math.round(nextZ)<this.gridSize
      && !terrainPassable(terrainAt(terrainFor(this.selectedMission,this.mapRulesVersion),nextX,nextZ))) return;
    unit.x=nextX; unit.z=nextZ;
  }

  private moveArmyToward(unit: ArmyUnitState, targetX: number, targetZ: number, dt: number): void {
    const path = this.getArmyPath(unit, targetX, targetZ);
    if (path.length === 0) return;
    if (Math.hypot(path[0].x - unit.x, path[0].z - unit.z) < 0.18 && path.length > 1) path.shift();
    const waypoint = path[0];
    const beforeX = unit.x;
    const beforeZ = unit.z;
    this.moveToward(unit, waypoint.x, waypoint.z, dt);
    const movedX = unit.x - beforeX;
    const movedZ = unit.z - beforeZ;
    if (Math.hypot(movedX, movedZ) > 0.000001) {
      unit.heading = Math.atan2(movedX, movedZ);
      unit.movement = "walk";
    }
  }

  private getArmyPath(unit: ArmyUnitState, targetX: number, targetZ: number): PathPoint[] {
    const goal = {
      x: Math.max(0, Math.min(this.gridSize - 1, Math.round(targetX))),
      z: Math.max(0, Math.min(this.gridSize - 1, Math.round(targetZ))),
    };
    const cached = this.armyPaths.get(unit.id);
    if (
      cached &&
      cached.revision === this.navigationRevision &&
      cached.expires > this.elapsed &&
      cached.targetX === goal.x &&
      cached.targetZ === goal.z
    ) return cached.points;
    const start = {
      x: Math.max(0, Math.min(this.gridSize - 1, Math.round(unit.x))),
      z: Math.max(0, Math.min(this.gridSize - 1, Math.round(unit.z))),
    };
    const points = this.findPath(start, goal, "player");
    if (points.length > 0 || (start.x === goal.x && start.z === goal.z)) {
      const exactTarget = {
        x: Math.max(0, Math.min(this.gridSize - 1, targetX)),
        z: Math.max(0, Math.min(this.gridSize - 1, targetZ)),
      };
      const last = points.at(-1);
      if (!last || Math.hypot(last.x - exactTarget.x, last.z - exactTarget.z) > 0.04) points.push(exactTarget);
    }
    this.armyPaths.set(unit.id, {
      revision: this.navigationRevision,
      expires: this.elapsed + 0.55,
      targetX: goal.x,
      targetZ: goal.z,
      points,
    });
    return points;
  }

  private getFormationDestinations(units: readonly ArmyUnitState[], anchor: ArmyCommandPoint): ArmyCommandPoint[] {
    const centroid = units.reduce((sum, unit) => ({ x: sum.x + unit.x, z: sum.z + unit.z }), { x: 0, z: 0 });
    centroid.x /= units.length;
    centroid.z /= units.length;
    let forwardX = anchor.x - centroid.x;
    let forwardZ = anchor.z - centroid.z;
    const forwardLength = Math.hypot(forwardX, forwardZ);
    if (forwardLength > 0.000001) {
      forwardX /= forwardLength;
      forwardZ /= forwardLength;
    } else {
      forwardX = 0;
      forwardZ = 1;
    }
    const rightX = forwardZ;
    const rightZ = -forwardX;
    const columns = Math.ceil(Math.sqrt(units.length));
    const rows = Math.ceil(units.length / columns);
    const destinations: ArmyCommandPoint[] = [];
    for (let index = 0; index < units.length; index += 1) {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const entriesInRow = Math.min(columns, units.length - row * columns);
      const sideOffset = (column - (entriesInRow - 1) / 2) * FORMATION_SPACING;
      const depthOffset = (row - (rows - 1) / 2) * FORMATION_SPACING;
      const candidate = this.clampArmyPoint({
        x: anchor.x + rightX * sideOffset - forwardX * depthOffset,
        z: anchor.z + rightZ * sideOffset - forwardZ * depthOffset,
      });
      destinations.push(this.findOpenFormationPoint(candidate, destinations));
    }
    return destinations;
  }

  private findOpenFormationPoint(candidate: ArmyCommandPoint, reserved: readonly ArmyCommandPoint[]): ArmyCommandPoint {
    const available = (point: ArmyCommandPoint) => !this.isArmyPositionBlocked(point.x, point.z)
      && reserved.every((other) => Math.hypot(other.x - point.x, other.z - point.z) >= FORMATION_SPACING * 0.55);
    if (available(candidate)) return candidate;
    for (let radius = FORMATION_SPACING; radius <= FORMATION_SPACING * 4; radius += FORMATION_SPACING) {
      for (let step = 0; step < 12; step += 1) {
        const angle = (step / 12) * Math.PI * 2;
        const point = this.clampArmyPoint({ x: candidate.x + Math.cos(angle) * radius, z: candidate.z + Math.sin(angle) * radius });
        if (available(point)) return point;
      }
    }
    return candidate;
  }

  private findGarrisonApproach(
    unit: ArmyUnitState,
    building: BuildingState,
    reserved: readonly ArmyCommandPoint[],
  ): ArmyCommandPoint | null {
    const candidates = [
      { x: building.gx, z: building.gz - 0.92 },
      { x: building.gx + 0.92, z: building.gz },
      { x: building.gx, z: building.gz + 0.92 },
      { x: building.gx - 0.92, z: building.gz },
    ]
      .map((point) => this.clampArmyPoint(point))
      .filter((point, index, all) => all.findIndex((other) => Math.hypot(other.x - point.x, other.z - point.z) < 0.01) === index)
      .filter((point) => !this.isArmyPositionBlocked(point.x, point.z))
      .filter((point) => reserved.every((other) => Math.hypot(other.x - point.x, other.z - point.z) >= FORMATION_SPACING * 0.55))
      .map((point) => {
        const start = {
          x: Math.max(0, Math.min(this.gridSize - 1, Math.round(unit.x))),
          z: Math.max(0, Math.min(this.gridSize - 1, Math.round(unit.z))),
        };
        const goal = {
          x: Math.max(0, Math.min(this.gridSize - 1, Math.round(point.x))),
          z: Math.max(0, Math.min(this.gridSize - 1, Math.round(point.z))),
        };
        const path = this.findPath(start, goal, "player");
        const reachable = (start.x === goal.x && start.z === goal.z) || path.length > 0;
        return { point, reachable, score: reachable ? path.length + Math.hypot(point.x - unit.x, point.z - unit.z) * 0.01 : Infinity };
      })
      .filter((candidate) => candidate.reachable)
      .sort((a, b) => a.score - b.score);
    return candidates[0]?.point ?? null;
  }

  private findDirectControlGarrisonCandidate(unit: ArmyUnitState): {
    building: BuildingState & { kind: GarrisonBuildingKind };
    slot: number;
  } | null {
    if (unit.garrison || (unit.kind !== "archer" && unit.kind !== "spearman")) return null;
    const reserved = new Set(this.army
      .filter((candidate) => candidate.hp > 0 && candidate.garrison)
      .map((candidate) => `${candidate.garrison!.buildingId}:${candidate.garrison!.slot}`));
    const nearby = this.buildings
      .filter((building): building is BuildingState & { kind: GarrisonBuildingKind } =>
        this.isGarrisonBuilding(building))
      .map((building) => ({ building, approachDistance: this.directGarrisonApproachDistance(unit, building) }))
      .filter((candidate) => candidate.approachDistance <= DIRECT_GARRISON_APPROACH_RADIUS)
      .sort((a, b) => a.approachDistance - b.approachDistance || a.building.id - b.building.id);
    for (const { building } of nearby) {
      for (let slot = 0; slot < garrisonCapacity(building.kind); slot += 1) {
        if (!reserved.has(`${building.id}:${slot}`)) return { building, slot };
      }
    }
    return null;
  }

  private directGarrisonApproachDistance(unit: ArmyUnitState, building: BuildingState): number {
    const candidates = [
      { x: building.gx, z: building.gz - 0.92 },
      { x: building.gx + 0.92, z: building.gz },
      { x: building.gx, z: building.gz + 0.92 },
      { x: building.gx - 0.92, z: building.gz },
    ]
      .map((point) => this.clampArmyPoint(point))
      .filter((point, index, all) => all.findIndex((other) => Math.hypot(other.x - point.x, other.z - point.z) < 0.01) === index)
      .filter((point) => !this.isArmyPositionBlocked(point.x, point.z));
    return candidates.reduce(
      (closest, point) => Math.min(closest, Math.hypot(unit.x - point.x, unit.z - point.z)),
      Infinity,
    );
  }

  private beginGarrisonDismount(unit: ArmyUnitState, queuedOrder: ArmyUnitOrderState | null): void {
    const assignment = unit.garrison;
    if (!assignment) {
      unit.order = queuedOrder;
      return;
    }
    if (assignment.status === "approaching") {
      unit.garrison = null;
      unit.order = queuedOrder;
      return;
    }
    assignment.status = "dismounting";
    assignment.queuedGroundOrder = queuedOrder;
    unit.order = null;
    unit.targetId = null;
    this.armyPaths.delete(unit.id);
  }

  private cancelGarrisonApproach(unit: ArmyUnitState): void {
    unit.garrison = null;
    unit.order = null;
    unit.targetId = null;
    unit.movement = "idle";
    this.armyPaths.delete(unit.id);
  }

  private evacuateGarrisonUnit(unit: ArmyUnitState): void {
    const assignment = unit.garrison;
    if (!assignment) return;
    const destination = this.findOpenFormationPoint(
      this.clampArmyPoint({ x: assignment.approachX, z: assignment.approachZ }),
      this.army.filter((candidate) => candidate.id !== unit.id && !candidate.garrison).map((candidate) => ({ x: candidate.x, z: candidate.z })),
    );
    unit.x = destination.x;
    unit.z = destination.z;
    unit.garrison = null;
    unit.order = null;
    unit.targetId = null;
    unit.movement = "idle";
    this.armyPaths.delete(unit.id);
    if (this.directControl?.entityKind === "army" && this.directControl.entityId === unit.id) {
      this.directControl.moveX = 0;
      this.directControl.moveZ = 0;
      this.directControl.sprint = false;
      this.directControl.attackQueued = false;
      this.directControl.dancing = false;
    }
  }

  private isGarrisonBuilding(building: BuildingState): building is BuildingState & { kind: GarrisonBuildingKind } {
    return building.hp > 0 && isGarrisonBuildingKind(building.kind);
  }

  private garrisonFacing(building: BuildingState): number {
    const awayX = building.gx - this.mission.keep.gx;
    const awayZ = building.gz - this.mission.keep.gz;
    return Math.abs(awayX) + Math.abs(awayZ) > 0.000001 ? Math.atan2(awayX, awayZ) : 0;
  }

  private unitAttackRange(unit: ArmyUnitState): number {
    const assignment = unit.garrison;
    if (!assignment || assignment.status !== "stationed") return unit.range;
    if (unit.kind === "spearman") return 1.15;
    if (unit.kind === "archer") return unit.range * (assignment.buildingKind === "tower" ? 1.35 : 1.2);
    return unit.range;
  }

  private unitProjectileHeight(unit: ArmyUnitState): number {
    const assignment = unit.garrison;
    const deckHeight = assignment ? assignment.deckY * assignment.transition : 0;
    return deckHeight + (isSiegeKind(unit.kind) ? 0.75 : HUMAN_RELEASE_HEIGHT);
  }

  private moveDirectGarrisonedUnit(unit: ArmyUnitState, deltaX: number, deltaZ: number): void {
    const distance = Math.hypot(deltaX, deltaZ);
    const steps = Math.max(1, Math.ceil(distance / 0.04));
    const stepX = deltaX / steps;
    const stepZ = deltaZ / steps;
    for (let step = 0; step < steps; step += 1) {
      if (this.tryDirectGarrisonStep(unit, unit.x + stepX, unit.z + stepZ)) continue;
      if (this.tryDirectGarrisonStep(unit, unit.x + stepX, unit.z)) continue;
      this.tryDirectGarrisonStep(unit, unit.x, unit.z + stepZ);
    }
  }

  private tryDirectGarrisonStep(unit: ArmyUnitState, x: number, z: number): boolean {
    const assignment = unit.garrison;
    const host = assignment
      ? this.buildings.find((building) => building.id === assignment.buildingId)
      : undefined;
    if (!assignment || !host || !this.isGarrisonBuilding(host) || assignment.status !== "stationed") return false;
    if (this.army.some((other) => other.id !== unit.id && other.hp > 0 && other.garrison?.status === "stationed"
      && Math.hypot(other.x - x, other.z - z) < 0.2)) return false;

    const offsetX = x - host.gx;
    const offsetZ = z - host.gz;
    const halfExtent = 0.5;
    if (Math.abs(offsetX) <= halfExtent && Math.abs(offsetZ) <= halfExtent) {
      unit.x = assignment.deckX = x;
      unit.z = assignment.deckZ = z;
      assignment.deckY = this.directDeckHeight(host, x, z);
      return true;
    }

    const horizontal = Math.abs(offsetX) > Math.abs(offsetZ);
    const dx = horizontal ? Math.sign(offsetX) : 0;
    const dz = horizontal ? 0 : Math.sign(offsetZ);
    const along = horizontal ? Math.abs(offsetX) : Math.abs(offsetZ);
    const across = horizontal ? Math.abs(offsetZ) : Math.abs(offsetX);
    if (along <= 0.5 || along > 0.58 || across > 0.22) return false;
    const neighbour = this.buildings
      .filter((building): building is BuildingState & { kind: GarrisonBuildingKind } => this.isGarrisonBuilding(building))
      .filter((building) => building.gx === host.gx + dx && building.gz === host.gz + dz)
      .sort((a, b) => a.id - b.id)[0];
    if (!neighbour) return false;
    const reserved = new Set(this.army
      .filter((other) => other.id !== unit.id && other.hp > 0 && other.garrison)
      .map((other) => `${other.garrison!.buildingId}:${other.garrison!.slot}`));
    let nextSlot = -1;
    for (let slot = 0; slot < garrisonCapacity(neighbour.kind); slot += 1) {
      if (!reserved.has(`${neighbour.id}:${slot}`)) { nextSlot = slot; break; }
    }
    if (nextSlot < 0) return false;
    assignment.buildingId = neighbour.id;
    assignment.buildingKind = neighbour.kind;
    assignment.slot = nextSlot;
    const exit = this.localGarrisonExit(neighbour, unit.x, unit.z);
    assignment.approachX = exit.x;
    assignment.approachZ = exit.z;
    unit.x = assignment.deckX = x;
    unit.z = assignment.deckZ = z;
    assignment.deckY = this.directDeckHeight(neighbour, x, z);
    return true;
  }

  private directDeckHeight(host: BuildingState & { kind: GarrisonBuildingKind }, x: number, z: number): number {
    const hostHeight = garrisonDeckHeight(host.kind);
    const neighbours = this.buildings
      .filter((building): building is BuildingState & { kind: GarrisonBuildingKind } => this.isGarrisonBuilding(building))
      .filter((building) => Math.abs(building.gx - host.gx) + Math.abs(building.gz - host.gz) === 1)
      .sort((a, b) => a.id - b.id);
    for (const neighbour of neighbours) {
      const dx = neighbour.gx - host.gx;
      const dz = neighbour.gz - host.gz;
      const along = (x - host.gx) * dx + (z - host.gz) * dz;
      const across = Math.abs((x - host.gx) * dz - (z - host.gz) * dx);
      if (along < 0.32 || along > 0.68 || across > 0.22) continue;
      const blend = Math.max(0, Math.min(1, (along - 0.32) / 0.36));
      return hostHeight + (garrisonDeckHeight(neighbour.kind) - hostHeight) * blend;
    }
    return hostHeight;
  }

  private localGarrisonExit(building: BuildingState, fromX: number, fromZ: number): ArmyCommandPoint {
    return [
      { x: building.gx, z: building.gz - 0.92 },
      { x: building.gx + 0.92, z: building.gz },
      { x: building.gx, z: building.gz + 0.92 },
      { x: building.gx - 0.92, z: building.gz },
    ]
      .map((point) => this.clampArmyPoint(point))
      .filter((point) => !this.isArmyPositionBlocked(point.x, point.z))
      .sort((a, b) => Math.hypot(a.x - fromX, a.z - fromZ) - Math.hypot(b.x - fromX, b.z - fromZ))[0]
      ?? this.clampArmyPoint({ x: building.gx, z: building.gz + 0.92 });
  }

  private clampArmyPoint(point: ArmyCommandPoint): ArmyCommandPoint {
    return {
      x: Math.max(UNIT_MAP_MARGIN, Math.min(this.gridSize - 1 - UNIT_MAP_MARGIN, point.x)),
      z: Math.max(UNIT_MAP_MARGIN, Math.min(this.gridSize - 1 - UNIT_MAP_MARGIN, point.z)),
    };
  }

  private moveDirectEntity(unit: { x: number; z: number }, deltaX: number, deltaZ: number): void {
    const distance = Math.hypot(deltaX, deltaZ);
    const steps = Math.max(1, Math.ceil(distance / 0.08));
    const stepX = deltaX / steps;
    const stepZ = deltaZ / steps;
    for (let step = 0; step < steps; step += 1) {
      const combined = this.clampArmyPoint({ x: unit.x + stepX, z: unit.z + stepZ });
      if (this.canArmyStepEscape(unit.x, unit.z, combined.x, combined.z)) {
        unit.x = combined.x;
        unit.z = combined.z;
        continue;
      }
      const xOnly = this.clampArmyPoint({ x: unit.x + stepX, z: unit.z });
      if (this.canArmyStepEscape(unit.x, unit.z, xOnly.x, xOnly.z)) unit.x = xOnly.x;
      const zOnly = this.clampArmyPoint({ x: unit.x, z: unit.z + stepZ });
      if (this.canArmyStepEscape(unit.x, unit.z, zOnly.x, zOnly.z)) unit.z = zOnly.z;
    }
  }

  private canArmyStepEscape(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
    const nextDepth = this.armyObstructionDepth(toX, toZ);
    if (nextDepth <= 0) return true;
    const currentDepth = this.armyObstructionDepth(fromX, fromZ);
    return currentDepth > 0 && nextDepth < currentDepth - 0.000001;
  }

  private armyObstructionDepth(x: number, z: number): number {
    let depth = terrainPassable(terrainAt(terrainFor(this.selectedMission, this.mapRulesVersion), x, z)) ? 0 : 1;
    const obstacles = [
      ...this.buildings.map((building) => ({ building, enemy: false })),
      ...(this.duelCastle?.buildings ?? []).map((building) => ({ building, enemy: !this.missionCompleted })),
    ];
    for (const { building, enemy } of obstacles) {
      if (building.hp <= 0 || building.kind === "gate" && !enemy) continue;
      const radius = building.kind === "keep" ? 0.74
        : building.kind === "tower" ? 0.62
          : building.kind === "wall" ? 0.52
            : 0.56;
      depth = Math.max(depth, radius - Math.hypot(x - building.gx, z - building.gz));
    }
    return depth;
  }

  private enemyObstructionDepth(x: number, z: number): number {
    let depth = terrainPassable(terrainAt(terrainFor(this.selectedMission, this.mapRulesVersion), x, z)) ? 0 : 1;
    const obstacles = [
      ...(this.duelCastle?.buildings ?? []).map((building) => ({ building, friendly: true })),
      ...this.buildings.map((building) => ({ building, friendly: false })),
    ];
    for (const { building, friendly } of obstacles) {
      if (building.hp <= 0 || building.kind === "gate" && friendly) continue;
      const radius = building.kind === "keep" ? 0.74
        : building.kind === "tower" ? 0.62
          : building.kind === "wall" ? 0.52
            : 0.56;
      depth = Math.max(depth, radius - Math.hypot(x - building.gx, z - building.gz));
    }
    return depth;
  }

  private isArmyPositionBlocked(x: number, z: number): boolean {
    return this.armyObstructionDepth(x, z) > 0;
  }

  private normalizeAngle(value: number): number {
    return Math.atan2(Math.sin(value), Math.cos(value));
  }

  private getDirectControlledEntity(): ArmyUnitState | CivilianState | undefined {
    const control = this.directControl;
    if (!control) return undefined;
    return control.entityKind === "army"
      ? this.army.find((candidate) => candidate.id === control.entityId && candidate.hp > 0)
      : this.civilianEntities.find((candidate) => candidate.id === control.entityId && candidate.hp > 0);
  }

  private leaveDirectControl(reason: DirectControlExitReason): boolean {
    const control = this.directControl;
    if (!control) return false;
    if (control.entityKind === "army") {
      const unit = this.army.find((candidate) => candidate.id === control.entityId);
      if (unit) {
        unit.movement = "idle";
        unit.targetId = null;
      }
    } else {
      const civilian = this.civilianEntities.find((candidate) => candidate.id === control.entityId);
      if (civilian) {
        civilian.movement = "idle";
        const previousTarget = this.civilianRoutes.get(civilian.id)?.target ?? (civilian.jobBuildingId === null ? "home" : "work");
        this.rebuildCivilianRoute(civilian, previousTarget);
        civilian.activity = civilian.jobBuildingId === null ? "idle" : "commuting";
      }
    }
    this.lastDirectControlExit = {
      entityKind: control.entityKind,
      entityId: control.entityId,
      unitId: control.entityId,
      reason,
      elapsed: this.elapsed,
    };
    this.directControl = null;
    return true;
  }

  private removeArmyUnit(unitId: number): void {
    if (this.directControl?.entityKind === "army" && this.directControl.entityId === unitId) this.leaveDirectControl("unit-dead");
    this.army = this.army.filter((unit) => unit.id !== unitId);
    const lastSelected = this.selectedArmyUnitIds.length === 1 && this.selectedArmyUnitIds[0] === unitId;
    this.selectedArmyUnitIds = this.selectedArmyUnitIds.filter((id) => id !== unitId);
    if (lastSelected) this.events.onToast?.('Выбранный отряд погиб. Наймите подкрепление или отступите к укреплениям.', 'danger');
    this.armyPaths.delete(unitId);
    this.armyAttackTimers.delete(unitId);
  }

  private pruneArmyReferences(): void {
    for (const unit of this.army.filter((candidate) => candidate.hp <= 0)) this.removeArmyUnit(unit.id);
    const alive = new Set(this.army.map((unit) => unit.id));
    this.selectedArmyUnitIds = this.selectedArmyUnitIds.filter((id) => alive.has(id));
    if (this.directControl?.entityKind === "army" && !alive.has(this.directControl.entityId)) this.leaveDirectControl("unit-dead");
    for (const id of this.armyAttackTimers.keys()) if (!alive.has(id)) this.armyAttackTimers.delete(id);
  }

  private detachCivilian(civilian: CivilianState, reason: DirectControlExitReason): void {
    if (this.directControl?.entityKind === "civilian" && this.directControl.entityId === civilian.id) this.leaveDirectControl(reason);
    this.civilianEntities = this.civilianEntities.filter((candidate) => candidate.id !== civilian.id);
    this.civilianRoutes.delete(civilian.id);
    if (this.selectedCivilianId === civilian.id) this.selectedCivilianId = null;
  }

  private pruneCivilianReferences(): void {
    const dead = this.civilianEntities.filter((civilian) => civilian.hp <= 0);
    if (dead.length === 0) return;
    for (const civilian of dead) this.detachCivilian(civilian, "civilian-dead");
    this.population = Math.max(0, this.population - dead.length);
    this.reconcileCivilianJobs();
  }

  private removeDeadRaiders(): void {
    const defeated = this.raiders.filter((raider) => raider.hp <= 0).length;
    if (defeated > 0) this.resources.gold += defeated * 2;
    const alive = new Set(this.raiders.filter((raider) => raider.hp > 0).map((raider) => raider.id));
    this.raiders = this.raiders.filter((raider) => alive.has(raider.id));
    for (const id of this.paths.keys()) if (!alive.has(id)) this.paths.delete(id);
  }

  private getGoalProgress(): number {
    if (this.mission.goalKind === "tutorial") {
      const hasFoodBuilding = this.buildings.filter((building) => ["farm", "wheatFarm", "bakery"].includes(building.kind)).length >= 2;
      const hasTower = this.buildings.some((building) => building.kind === "tower");
      const trained = this.army.length >= 2;
      const repelledWave = this.wave === this.mission.waves.length && this.wave > 0
        && this.raiders.length === 0;
      return Number(hasFoodBuilding) + Number(hasTower) + Number(trained) + Number(repelledWave);
    }
    if (this.mission.goalKind === "duel") {
      if (this.missionCompleted) return this.mission.goalTarget;
      const config = this.mission.duel;
      const state = this.duelCastle;
      if (config?.objective.kind === "hold-crossing") {
        return Math.min(config.objective.primaryTarget, state?.assaultsDefeated ?? 0)
          + Math.min(config.objective.supportTarget ?? 0, this.army.length);
      }
      if (config?.objective.kind === "break-fortress") {
        return Math.min(config.objective.primaryTarget, state?.fortificationsDestroyed ?? 0)
          + Math.min(config.objective.supportTarget ?? 0, Math.floor(this.resources.weapons));
      }
      const keep = this.duelCastle?.buildings.find((building) => building.kind === "keep");
      if (!keep || keep.maxHp <= 0) return 100;
      return Math.max(0, Math.min(100, Math.round((1 - keep.hp / keep.maxHp) * 100)));
    }
    if (this.mission.goalKind === "survive") return Math.max(0, this.wave - (this.raiders.length > 0 ? 1 : 0));
    if (this.mission.goalKind === "army") return this.army.length;
    if (this.mission.goalKind === "food") return Math.floor(this.resources.food);
    if (this.mission.goalKind === "weapons") return Math.floor(this.resources.weapons);
    return Math.floor(this.resources.gold);
  }

  private isGoalComplete(): boolean {
    return this.getGoalProgress() >= this.mission.goalTarget;
  }

  private canAffordCost(cost: Partial<Resources>): boolean {
    return (Object.keys(cost) as ResourceKey[]).every((key) => this.resources[key] >= (cost[key] ?? 0));
  }

  private spend(cost: Partial<Resources>): void {
    for (const key of Object.keys(cost) as ResourceKey[]) this.resources[key] -= cost[key] ?? 0;
  }

  private reject(message: string): false {
    this.events.onToast?.(message, "danger");
    this.events.onSound?.("error");
    return false;
  }

  private formatTime(seconds: number): string {
    const safe = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
  }
}
