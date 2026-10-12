export type BuildingCategory = "economy" | "fortress" | "military";

export type BuildingKind =
  | "keep"
  | "house"
  | "lumber"
  | "quarry"
  | "farm"
  | "wheatFarm"
  | "mill"
  | "bakery"
  | "ironMine"
  | "blacksmith"
  | "well"
  | "granary"
  | "market"
  | "tower"
  | "wall"
  | "gate"
  | "barracks"
  | "archery"
  | "stable"
  | "siegeWorkshop";

export type ResourceKey = "wood" | "stone" | "food" | "gold" | "grain" | "iron" | "weapons";
export type StockpiledResourceKey = Exclude<ResourceKey, "gold">;
export type ArmyUnitKind = "spearman" | "archer" | "swordsman" | "knight" | "catapult" | "batteringRam";
export type EnemyUnitKind = "raider" | "spearman" | "archer" | "swordsman" | "catapult" | "batteringRam";
export type EnemyUnitStance = "guard" | "assault";
export type ArmyOrderKind = "move" | "attack-move" | "garrison";
export type ArmyOrderStatus = "moving" | "holding";
export type ArmyMovementMode = "idle" | "walk" | "sprint";
export type ControllableEntityKind = "army" | "civilian";
export type GarrisonBuildingKind = "wall" | "tower";
export type CivilianActivity = "idle" | "commuting" | "working" | "controlled";
export type DirectControlExitReason = "manual" | "selection-changed" | "strategy-order" | "unit-switched" | "unit-dead" | "civilian-dead" | "civilian-departed";
export type MissionId = "oasis" | "canyon" | "salt" | "river" | "ruins" | "siege";
export type MapTheme = "oasis" | "red-canyon" | "salt-flat" | "river-valley" | "ancient-ruins" | "siege-frontier";
export type RaidDirection = "запад" | "восток" | "юг" | "север";
export type MissionGoalKind = "tutorial" | "survive" | "army" | "wealth" | "food" | "weapons" | "duel";
export type DuelObjectiveKind = "hold-crossing" | "break-fortress" | "destroy-keep";
export type TaxPolicy = "none" | "standard" | "high";
export type RationPolicy = "half" | "normal" | "double";
export type DifficultyId = "relaxed" | "standard" | "veteran";
export type WorkPriority = "low" | "normal" | "high";
export type TowerUpgradeKind = "none" | "light" | "heavy";

export interface DifficultyDefinition {
  id: DifficultyId;
  label: string;
  description: string;
  startingResourceMultiplier: number;
  waveTimeMultiplier: number;
  enemyHpMultiplier: number;
  enemyDamageMultiplier: number;
  enemyCountMultiplier: number;
}

export interface Resources {
  wood: number;
  stone: number;
  food: number;
  gold: number;
  grain: number;
  iron: number;
  weapons: number;
}

export interface StorageCapacity {
  wood: number;
  stone: number;
  food: number;
  grain: number;
  iron: number;
  weapons: number;
}

export interface TaxPolicyDefinition {
  id: TaxPolicy;
  label: string;
  description: string;
  goldPerCivilian: number;
  popularityPerTick: number;
}

export interface RationPolicyDefinition {
  id: RationPolicy;
  label: string;
  description: string;
  foodMultiplier: number;
  popularityPerTick: number;
  growthInterval: number;
}

export interface PopularityFactors {
  taxes: number;
  rations: number;
  housing: number;
  food: number;
  water: number;
}

export interface BuildingProductionSnapshot {
  buildingId: number;
  kind: BuildingKind;
  enabled: boolean;
  priority: WorkPriority;
  status: "working" | "disabled" | "unstaffed" | "missing-input" | "missing-support" | "no-access" | "storage-full" | "idle";
  statusLabel: string;
  workersAssigned: number;
  workersNeeded: number;
  efficiency: number;
  inputs: Partial<Resources>;
  outputs: Partial<Resources>;
  bonusLabel: string;
}

export interface EconomySnapshot {
  taxPolicy: TaxPolicy;
  rationPolicy: RationPolicy;
  taxIncomePerTick: number;
  foodUsePerTick: number;
  foodReserveSeconds: number;
  staffedRatio: number;
  popularityTrendPerTick: number;
  popularityFactors: PopularityFactors;
  storageCapacity: StorageCapacity;
  storageRemaining: StorageCapacity;
  production: BuildingProductionSnapshot[];
  netPerTick: Resources;
  foodNetPerTick: number;
  warnings: string[];
}

export interface GridPoint {
  gx: number;
  gz: number;
}

/** Coordinates in the simulation's x/z space (the same space used by ArmyUnitState). */
export interface ArmyCommandPoint {
  x: number;
  z: number;
}

export interface ArmyUnitOrderState {
  kind: ArmyOrderKind;
  status: ArmyOrderStatus;
  anchorX: number;
  anchorZ: number;
  destinationX: number;
  destinationZ: number;
  /** Explicit duel building target. Unlike ambient acquisition, it remains authoritative across the whole map. */
  targetBuildingId?: number;
  holdPosition?: boolean;
}

export interface ArmyGarrisonState {
  buildingId: number;
  buildingKind: GarrisonBuildingKind;
  slot: number;
  status: "approaching" | "mounting" | "stationed" | "dismounting";
  /** 0 = ground approach, 1 = rampart deck. Simulation time drives the transition. */
  transition: number;
  approachX: number;
  approachZ: number;
  /** Exact simulation x/z used on the walkable rampart deck. */
  deckX: number;
  deckZ: number;
  /** Simulation-owned current deck height, including wall/tower transitions. */
  deckY: number;
  queuedGroundOrder: ArmyUnitOrderState | null;
}

export interface DirectControlInput {
  moveX: number;
  moveZ: number;
  heading: number;
  sprint: boolean;
  aimX?: number;
  aimZ?: number;
  /** Vertical camera aim in radians. Omitted callers retain legacy horizontal targeting. */
  aimPitch?: number;
}

export interface DirectControlSnapshot {
  entityKind: ControllableEntityKind;
  entityId: number;
  /** Backward-compatible alias for entityId. New code should use entityKind/entityId. */
  unitId: number;
  moveX: number;
  moveZ: number;
  heading: number;
  sprint: boolean;
  aimX: number;
  aimZ: number;
  aimPitch: number | null;
  canAttack: boolean;
  attackReady: boolean;
  dancing: boolean;
  /** Nearby free fortification that this ground unit can climb without leaving direct control. */
  mountTarget: { buildingId: number; buildingKind: GarrisonBuildingKind } | null;
}

export interface DirectControlExitSnapshot {
  entityKind: ControllableEntityKind;
  entityId: number;
  /** Backward-compatible alias for entityId. */
  unitId: number;
  reason: DirectControlExitReason;
  elapsed: number;
}

export interface BuildingDefinition {
  kind: BuildingKind;
  category: BuildingCategory;
  name: string;
  shortName: string;
  icon: string;
  description: string;
  cost: Partial<Resources>;
  maxHp: number;
  hotkey?: string;
  workers?: number;
  production?: {
    inputs?: Partial<Resources>;
    outputs?: Partial<Resources>;
    requires?: BuildingKind;
    supportRadius?: number;
  };
}

export interface TrainingOrder {
  kind: ArmyUnitKind;
  remaining: number;
  duration: number;
  cost: Partial<Resources>;
}

export interface BuildingState {
  trainingQueue?: TrainingOrder[];
  repairRemaining?: number;
  id: number;
  kind: BuildingKind;
  gx: number;
  gz: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  efficiency: number;
  enabled: boolean;
  priority: WorkPriority;
  /** Towers are inert by default. A module supplies autonomous light or anti-siege fire. */
  towerUpgrade?: TowerUpgradeKind;
}

export interface RaiderState {
  raidEconomy?: boolean;
  id: number;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  cooldown: number;
  elite: boolean;
  /** Legacy wave enemies omit this and are treated as ordinary raiders. */
  kind?: EnemyUnitKind;
  /** Duel defenders wait at their castle until an assault begins. */
  stance?: EnemyUnitStance;
  homeX?: number;
  homeZ?: number;
  heading?: number;
  attacking?: boolean;
  attackPulse?: number;
  /** Persistent siege objective chosen by the rival; cleared when the structure falls or becomes unreachable. */
  targetBuildingId?: number;
}

export interface ArmyUnitState {
  id: number;
  kind: ArmyUnitKind;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  range: number;
  cooldown: number;
  targetId: number | null;
  heading: number;
  movement: ArmyMovementMode;
  order: ArmyUnitOrderState | null;
  garrison: ArmyGarrisonState | null;
  attacking: boolean;
  /** Monotonic counter incremented for every attack action; useful for animation edges, including misses. */
  attackPulse: number;
}

/**
 * A real, stable civilian simulation entity. Economy staffing still uses the
 * aggregate population count; direct control never removes this civilian from
 * their job allocation. The renderer may use activity/movement to select a
 * visual animation, but position and work lifecycle belong to the simulation.
 */
export interface CivilianState {
  id: number;
  entityKind: "civilian";
  x: number;
  z: number;
  heading: number;
  speed: number;
  hp: number;
  maxHp: number;
  movement: ArmyMovementMode;
  activity: CivilianActivity;
  jobBuildingId: number | null;
  jobKind: BuildingKind | null;
}

export interface ArmyUnitDefinition {
  kind: ArmyUnitKind;
  name: string;
  shortName: string;
  icon: string;
  description: string;
  trainedAt: "barracks" | "archery" | "stable" | "siegeWorkshop";
  cost: Partial<Resources>;
  maxHp: number;
  speed: number;
  damage: number;
  range: number;
  cooldown: number;
  unitClass?: "personnel" | "siege";
  allowedTargets?: "units" | "buildings" | "both";
  populationCost?: number;
  buildingDamage?: number;
  minRange?: number;
}

export interface MissionWave {
  specialists?: { kind: EnemyUnitKind; count: number };
  raidEconomy?: boolean;
  at: number;
  count: number;
  direction: RaidDirection;
  eliteEvery?: number;
  hpScale?: number;
  speedScale?: number;
}

export interface MissionEventDefinition {
  id: string;
  at: number;
  title: string;
  description: string;
  tone: "info" | "danger" | "success";
  resources?: Partial<Resources>;
  population?: number;
  hope?: number;
  foodProductionMultiplier?: number;
  duration?: number;
  army?: { kind: ArmyUnitKind; count: number };
}

export interface MissionEventRecord {
  id: string;
  title: string;
  description: string;
  at: number;
  tone: "info" | "danger" | "success";
}

export interface ActiveScenarioEffect {
  id: string;
  title: string;
  remainingSeconds: number;
  foodProductionMultiplier: number;
}

export interface MissionDefinition {
  id: MissionId;
  order: number;
  name: string;
  subtitle: string;
  briefing: string;
  difficulty: "Просто" | "Обычно" | "Сложно";
  theme: MapTheme;
  goalKind: MissionGoalKind;
  goalTarget: number;
  goalLabel: string;
  startingResources: Resources;
  startingPopulation: number;
  startingPopulationCap: number;
  startingHope: number;
  keep: GridPoint;
  resourceZones: { lumber: GridPoint; quarry: GridPoint; iron: GridPoint; fertile: GridPoint };
  startingBuildings: ReadonlyArray<{ kind: BuildingKind; gx: number; gz: number }>;
  waves: readonly MissionWave[];
  events: readonly MissionEventDefinition[];
  strategyHint: string;
  /** Missions use the classic 18-cell map unless explicitly enlarged. */
  gridSize?: number;
  duel?: DuelMissionDefinition;
}

export interface BuildExclusionZone {
  minGx: number;
  maxGx: number;
  minGz: number;
  maxGz: number;
}

export interface DuelMissionDefinition {
  enemyName: string;
  /** Each confrontation teaches a different way to overcome a rival settlement. */
  objective: {
    kind: DuelObjectiveKind;
    primaryTarget: number;
    supportTarget?: number;
  };
  /** Per-stage rival tempo. Difficulty selection is applied on top of this value. */
  aiPace: number;
  enemyKeep: GridPoint;
  enemyResourceZones: MissionDefinition["resourceZones"];
  neutralZone: BuildExclusionZone;
  playerBuildArea: BuildExclusionZone;
  enemyBuildArea: BuildExclusionZone;
  enemyStartingResources: Resources;
  enemyStartingPopulation: number;
  enemyStartingPopulationCap: number;
  enemyStartingBuildings: ReadonlyArray<{ kind: BuildingKind; gx: number; gz: number; towerUpgrade?: TowerUpgradeKind }>;
}

export interface DuelCastleState {
  resources: Resources;
  population: number;
  populationCap: number;
  growthClock: number;
  buildings: BuildingState[];
  decisionClock: number;
  buildCooldown: number;
  trainCooldown: number;
  assaultCooldown: number;
  assaultsLaunched: number;
  assaultsDefeated: number;
  fortificationsDestroyed: number;
}

export interface DuelSnapshot {
  enemyName: string;
  /** The defeated settlement remains on the map as a non-hostile allied town. */
  friendly: boolean;
  neutralZone: BuildExclusionZone;
  enemyResourceZones: MissionDefinition["resourceZones"];
  enemyResources: Resources;
  enemyPopulation: number;
  enemyPopulationCap: number;
  enemyBuildings: readonly BuildingState[];
  enemyArmyCount: number;
  enemyKeepHp: number;
  enemyKeepMaxHp: number;
  enemyDevelopment: number;
  nextAssaultIn: number;
  assaultsLaunched: number;
  assaultsDefeated: number;
  fortificationsDestroyed: number;
  objectiveKind: DuelObjectiveKind;
  objectiveProgress: number;
  objectiveTarget: number;
  phaseLabel: string;
}

export interface ProjectileEvent {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  /** World-space heights. Omitted sources retain their legacy tower trajectory. */
  fromY?: number;
  toY?: number;
  source?: "tower" | "archer" | "ballista" | "catapult";
  /** Optional simulation-authored ballistic flight. Legacy projectiles keep their visual arc. */
  ballistic?: {
    flightSeconds: number;
    initialVelocityY: number;
    gravity: number;
    lingerSeconds: number;
    impact: "target" | "ground";
  };
}

export type GameStatus = "title" | "playing" | "paused" | "victory" | "defeat";

export interface GameSaveDataV1 {
  version: 1;
  savedAt: number;
  missionId: MissionId;
  difficultyId: DifficultyId;
  status: "playing" | "paused" | "victory";
  state: {
    mapRulesVersion?: 1 | 2;
    nextId: number;
    incomeClock: number;
    growthClock: number;
    elapsed: number;
    raidClock: number;
    preparationStarted: boolean;
    timeScale: 1 | 2;
    resources: Resources;
    taxPolicy: TaxPolicy;
    rationPolicy: RationPolicy;
    population: number;
    populationCap: number;
    hope: number;
    wave: number;
    buildings: BuildingState[];
    raiders: RaiderState[];
    army: ArmyUnitState[];
    civilianEntities: CivilianState[];
    rallyPoint: GridPoint;
    selectedArmyUnitIds: number[];
    selectedCivilianId: number | null;
    chronicle: MissionEventRecord[];
    triggeredEvents: string[];
    scenarioEffects: Array<{ id: string; title: string; endsAt: number; foodProductionMultiplier: number }>;
    missionCompleted: boolean;
    duel?: DuelCastleState | null;
  };
}

export interface GameSnapshot {
  canCallTutorialRaid?: boolean;
  mapRulesVersion?: 1 | 2;
  layoutRevision?: number;
  status: GameStatus;
  missionId: MissionId;
  missionName: string;
  missionSubtitle: string;
  missionOrder: number;
  difficultyId: DifficultyId;
  difficultyName: string;
  mapTheme: MapTheme;
  gridSize: number;
  keep: GridPoint;
  resourceZones: MissionDefinition["resourceZones"];
  goalKind: MissionGoalKind;
  goalLabel: string;
  goalProgress: number;
  goalTarget: number;
  /** The scripted objective is complete; normal simulation may continue as a sandbox. */
  missionCompleted: boolean;
  elapsed: number;
  raidClock: number;
  preparationStarted: boolean;
  resources: Resources;
  economy: EconomySnapshot;
  population: number;
  civilians: number;
  armyCount: number;
  populationCap: number;
  hope: number;
  wave: number;
  waveCount: number;
  nextWaveIn: number | null;
  enemiesAlive: number;
  jobs: number;
  freeWorkers: number;
  timeScale: 1 | 2;
  timePaused: boolean;
  nextRaidDirection: RaidDirection | null;
  rallyPoint: GridPoint;
  selectedArmyUnitIds: readonly number[];
  selectedCivilianId: number | null;
  directControl: DirectControlSnapshot | null;
  lastDirectControlExit: DirectControlExitSnapshot | null;
  buildings: readonly BuildingState[];
  raiders: readonly RaiderState[];
  army: readonly ArmyUnitState[];
  civilianEntities: readonly CivilianState[];
  chronicle: readonly MissionEventRecord[];
  nextEvent: { id: string; title: string; description: string; inSeconds: number } | null;
  activeEffects: readonly ActiveScenarioEffect[];
  duel: DuelSnapshot | null;
}

export interface SimulationEvents {
  onToast?: (message: string, tone?: "info" | "danger" | "success") => void;
  onSound?: (sound: "build" | "error" | "wave" | "arrow" | "victory" | "defeat") => void;
  onProjectile?: (event: ProjectileEvent) => void;
  onStatus?: (status: GameStatus) => void;
}
