import { ARMY_UNITS, BUILDINGS } from "./content";
import type {
  ArmyUnitKind,
  BuildingKind,
  BuildingState,
  DifficultyId,
  DuelCastleState,
  EnemyUnitKind,
  GridPoint,
  MissionDefinition,
  Resources,
  TowerUpgradeKind,
} from "./types";

export interface DuelDifficultyTuning {
  startingResourceMultiplier: number;
  productionMultiplier: number;
  techPaceMultiplier: number;
  growthInterval: number;
  decisionInterval: number;
  buildCooldown: number;
  repairCooldown: number;
  trainCooldown: number;
  siegeTrainCooldown: number;
  initialAssaultCooldown: number;
  repeatAssaultCooldown: number;
  minimumAssaultSize: number;
  goldPerCivilian: number;
}

/** Duel-only pacing. Standard and hard rivals must visibly grow and attack instead of idling behind a stockpile. */
export const DUEL_DIFFICULTY_TUNING: Record<DifficultyId, DuelDifficultyTuning> = {
  relaxed: {
    startingResourceMultiplier: 0.86,
    productionMultiplier: 0.9,
    techPaceMultiplier: 0.9,
    growthInterval: 24,
    decisionInterval: 1,
    buildCooldown: 12,
    repairCooldown: 10,
    trainCooldown: 9,
    siegeTrainCooldown: 15,
    initialAssaultCooldown: 150,
    repeatAssaultCooldown: 120,
    minimumAssaultSize: 6,
    goldPerCivilian: 0.09,
  },
  standard: {
    startingResourceMultiplier: 1.12,
    productionMultiplier: 1.24,
    techPaceMultiplier: 1.22,
    growthInterval: 16,
    decisionInterval: 0.75,
    buildCooldown: 6.5,
    repairCooldown: 6,
    trainCooldown: 5.2,
    siegeTrainCooldown: 9.5,
    initialAssaultCooldown: 78,
    repeatAssaultCooldown: 66,
    minimumAssaultSize: 4,
    goldPerCivilian: 0.17,
  },
  veteran: {
    startingResourceMultiplier: 1.34,
    productionMultiplier: 1.48,
    techPaceMultiplier: 1.5,
    growthInterval: 12,
    decisionInterval: 0.55,
    buildCooldown: 4.5,
    repairCooldown: 4,
    trainCooldown: 3.7,
    siegeTrainCooldown: 7,
    initialAssaultCooldown: 52,
    repeatAssaultCooldown: 44,
    minimumAssaultSize: 3,
    goldPerCivilian: 0.23,
  },
};

export interface TowerUpgradeDefinition {
  kind: Exclude<TowerUpgradeKind, "none">;
  name: string;
  description: string;
  cost: Partial<Resources>;
  range: number;
  damage: number;
  cooldown: number;
  targets: "personnel" | "siege";
}

export const TOWER_UPGRADES: Record<Exclude<TowerUpgradeKind, "none">, TowerUpgradeDefinition> = {
  light: {
    kind: "light",
    name: "Лёгкая баллиста",
    description: "Быстро поражает обычных бойцов. Осадные машины слишком хорошо защищены.",
    cost: { wood: 38, stone: 18, gold: 30 },
    range: 7.2,
    damage: 23,
    cooldown: 0.92,
    targets: "personnel",
  },
  heavy: {
    kind: "heavy",
    name: "Тяжёлая катапульта",
    description: "Медленный контр-осадный модуль. Стреляет только по катапультам и таранам.",
    cost: { wood: 55, stone: 42, iron: 8, gold: 38 },
    range: 8.2,
    damage: 105,
    cooldown: 3.8,
    targets: "siege",
  },
};

export const isSiegeKind = (kind: ArmyUnitKind | EnemyUnitKind | undefined): boolean =>
  kind === "catapult" || kind === "batteringRam";

export const enemyUnitStats = (kind: EnemyUnitKind): {
  maxHp: number;
  speed: number;
  damage: number;
  buildingDamage: number;
  range: number;
  minRange: number;
  cooldown: number;
  cost: Partial<Resources>;
  crew: number;
} => {
  if (kind !== "raider") {
    const shared = ARMY_UNITS[kind];
    return {
      maxHp: shared.maxHp,
      speed: shared.speed,
      damage: shared.damage,
      buildingDamage: shared.buildingDamage ?? shared.damage * 0.6,
      range: shared.range,
      minRange: shared.minRange ?? 0,
      cooldown: shared.cooldown,
      cost: shared.cost,
      crew: shared.populationCost ?? 1,
    };
  }
  switch (kind) {
    default: return { maxHp: 92, speed: 0.86, damage: 20, buildingDamage: 16, range: 0.62, minRange: 0, cooldown: 1.02, cost: { food: 13, gold: 12 }, crew: 1 };
  }
};

const count = (buildings: readonly BuildingState[], kind: BuildingKind): number =>
  buildings.filter((building) => building.hp > 0 && building.kind === kind).length;

/**
 * Reactive priorities: the rival replaces broken supply chains before adding
 * military capacity. Timers only pace decisions; they never grant a building.
 */
export function chooseEnemyBuilding(
  state: DuelCastleState,
  elapsed: number,
  occupiedPopulation = state.population,
): BuildingKind | null {
  const buildings = state.buildings;
  if (state.populationCap - occupiedPopulation < 3) return "house";
  if (count(buildings, "lumber") === 0) return "lumber";
  if (count(buildings, "quarry") === 0) return "quarry";
  if (count(buildings, "farm") === 0 || state.resources.food < 50 && count(buildings, "farm") < 3) return "farm";
  if (elapsed > 20 && count(buildings, "barracks") === 0) return "barracks";
  if (elapsed > 35 && count(buildings, "archery") === 0) return "archery";
  if (elapsed > 55 && count(buildings, "ironMine") === 0) return "ironMine";
  if (elapsed > 70 && count(buildings, "blacksmith") === 0) return "blacksmith";
  if (elapsed > 90 && count(buildings, "siegeWorkshop") === 0) return "siegeWorkshop";
  if (elapsed > 45 && count(buildings, "tower") < 2) return "tower";
  if (elapsed > 65 && count(buildings, "wall") < 6) return "wall";
  if (elapsed > 105 && count(buildings, "house") < 4) return "house";
  if (elapsed > 130 && count(buildings, "farm") < 3) return "farm";
  if (elapsed > 150 && count(buildings, "tower") < 3) return "tower";
  return null;
}

export function chooseEnemyUnit(
  state: DuelCastleState,
  elapsed: number,
  currentKinds: readonly EnemyUnitKind[],
): EnemyUnitKind | null {
  const has = (kind: BuildingKind): boolean => state.buildings.some((building) => building.kind === kind && building.hp > 0);
  const siegeCount = currentKinds.filter(isSiegeKind).length;
  const archerCount = currentKinds.filter((kind) => kind === "archer").length;
  const swordsmen = currentKinds.filter((kind) => kind === "swordsman").length;
  if (elapsed > 105 && has("siegeWorkshop") && siegeCount < Math.max(1, Math.floor(currentKinds.length / 5))) {
    return currentKinds.filter((kind) => kind === "catapult").length <= currentKinds.filter((kind) => kind === "batteringRam").length
      ? "catapult" : "batteringRam";
  }
  if (has("archery") && archerCount < Math.ceil(currentKinds.length * 0.36)) return "archer";
  if (has("barracks") && has("blacksmith") && state.resources.weapons >= 2 && swordsmen < Math.ceil(currentKinds.length * 0.3)) return "swordsman";
  if (has("barracks")) return "spearman";
  return null;
}

export function canAfford(resources: Resources, cost: Partial<Resources>): boolean {
  return (Object.keys(cost) as Array<keyof Resources>).every((key) => resources[key] >= (cost[key] ?? 0));
}

export function spendResources(resources: Resources, cost: Partial<Resources>): void {
  for (const key of Object.keys(cost) as Array<keyof Resources>) resources[key] -= cost[key] ?? 0;
}

const BUILD_OFFSETS: Partial<Record<BuildingKind, readonly GridPoint[]>> = {
  house: [{ gx: 2, gz: 3 }, { gx: 0, gz: 4 }, { gx: -2, gz: 3 }, { gx: 3, gz: 1 }],
  lumber: [{ gx: 2, gz: 8 }, { gx: 1, gz: 7 }],
  quarry: [{ gx: 2, gz: -8 }, { gx: 1, gz: -7 }],
  farm: [{ gx: -2, gz: -3 }, { gx: -3, gz: -1 }, { gx: -2, gz: 4 }],
  archery: [{ gx: -3, gz: 2 }, { gx: -4, gz: 3 }],
  ironMine: [{ gx: -3, gz: 9 }, { gx: -2, gz: 8 }],
  blacksmith: [{ gx: -2, gz: 1 }, { gx: -3, gz: 0 }],
  siegeWorkshop: [{ gx: -4, gz: -3 }, { gx: -3, gz: -4 }],
  tower: [{ gx: -4, gz: 3 }, { gx: -4, gz: -3 }, { gx: -5, gz: 0 }],
  wall: [{ gx: -4, gz: 2 }, { gx: -4, gz: 1 }, { gx: -4, gz: -1 }, { gx: -4, gz: -2 }, { gx: -5, gz: 3 }, { gx: -5, gz: -3 }],
};

export function enemyBuildCandidates(kind: BuildingKind, mission: MissionDefinition): GridPoint[] {
  const duel = mission.duel;
  if (!duel) return [];
  if (kind === "lumber") return [{ gx: duel.enemyResourceZones.lumber.gx - 1, gz: duel.enemyResourceZones.lumber.gz }];
  if (kind === "quarry") return [{ gx: duel.enemyResourceZones.quarry.gx - 1, gz: duel.enemyResourceZones.quarry.gz }];
  if (kind === "ironMine") return [{ gx: duel.enemyResourceZones.iron.gx + 1, gz: duel.enemyResourceZones.iron.gz }];
  if (kind === "farm") return [{ gx: duel.enemyResourceZones.fertile.gx, gz: duel.enemyResourceZones.fertile.gz }, ...(BUILD_OFFSETS.farm ?? []).map((offset) => ({ gx: duel.enemyKeep.gx + offset.gx, gz: duel.enemyKeep.gz + offset.gz }))];
  return (BUILD_OFFSETS[kind] ?? []).map((offset) => ({ gx: duel.enemyKeep.gx + offset.gx, gz: duel.enemyKeep.gz + offset.gz }));
}

export function towerUpgradeCost(kind: Exclude<TowerUpgradeKind, "none">): Partial<Resources> {
  return TOWER_UPGRADES[kind].cost;
}

export function buildingCost(kind: BuildingKind): Partial<Resources> {
  return BUILDINGS[kind].cost;
}
