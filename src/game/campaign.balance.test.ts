import { describe, expect, it } from "vitest";
import { MISSIONS, MISSION_LIST } from "./content";
import { GameSimulation } from "./simulation";
import type { BuildingKind, DifficultyId, GridPoint, MissionId } from "./types";

const waveMissions = MISSION_LIST.filter((mission) => !mission.duel);

/** A reproducible public-API campaign run. No state writes, debug waves or resource cheats.
 * The policy represents a cautious player: food/housing first, two resource yards,
 * towers in a ring, then bread/metal industry and a mixed garrison. */
function runSettlement(missionId: MissionId, difficulty: DifficultyId = "standard", policy: "fortified" | "mobile" = "fortified") {
  const simulation = new GameSimulation();
  simulation.selectMission(missionId);
  simulation.selectDifficulty(difficulty);
  simulation.start();
  simulation.setTimeScale(2);
  const mission = MISSIONS[missionId];
  const keep = mission.keep;
  const towerLimit = policy === "mobile" ? 2 : 4;
  const armyLimit = policy === "mobile" ? 22 : 14;
  const count = (kind: BuildingKind) => simulation.snapshot.buildings.filter((item) => item.kind === kind).length;
  const placeNear = (kind: BuildingKind, anchor: GridPoint): boolean => {
    if (!simulation.canAfford(kind)) return false;
    const candidates: Array<{ gx: number; gz: number; distance: number }> = [];
    for (let gx = 1; gx < simulation.snapshot.gridSize - 1; gx += 1) for (let gz = 1; gz < simulation.snapshot.gridSize - 1; gz += 1) {
      candidates.push({ gx, gz, distance: Math.hypot(gx - anchor.gx, gz - anchor.gz) });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const occupied = simulation.snapshot.buildings;
    const candidate = candidates.find((point) => !occupied.some(b => Math.abs(b.gx-point.gx)+Math.abs(b.gz-point.gz) <= 1)
      && simulation.canPlace(kind, point.gx, point.gz).valid);
    return candidate ? simulation.place(kind, candidate.gx, candidate.gz) : false;
  };
  const ensure = (kind: BuildingKind, number: number, anchor: GridPoint): boolean => count(kind) < number && placeNear(kind, anchor);
  const farmAnchor = mission.resourceZones.fertile;
  ensure("lumber", 1, mission.resourceZones.lumber);
  ensure("quarry", 1, mission.resourceZones.quarry);
  ensure("farm", 2, farmAnchor);
  ensure("tower", 1, { gx: keep.gx - 2, gz: keep.gz - 2 });
  simulation.beginPreparation();

  let decisions = 0;
  let minimumFood = simulation.snapshot.resources.food;
  let minimumKeepHp = simulation.snapshot.buildings.find((building) => building.kind === "keep")!.hp;
  const seenBuildings = new Set(simulation.snapshot.buildings.map((building) => building.id));
  const seenArmy = new Set<number>();
  const observe = () => {
    const snapshot = simulation.snapshot;
    for (const building of snapshot.buildings) seenBuildings.add(building.id);
    for (const unit of snapshot.army) seenArmy.add(unit.id);
    minimumFood = Math.min(minimumFood, snapshot.resources.food);
    minimumKeepHp = Math.min(minimumKeepHp, snapshot.buildings.find((item) => item.kind === "keep")?.hp ?? 0);
  };
  const towerAnchors = [[-2, -2], [2, -2], [-2, 2], [2, 2], [-4, 0], [4, 0], [0, -4], [0, 4]];
  while (simulation.snapshot.status === "playing" && simulation.snapshot.raidClock < 1000) {
    for (let tick = 0; tick < 20 && simulation.snapshot.status === "playing"; tick += 1) { observe(); simulation.tick(0.05); }
    observe();
    decisions += 1;
    let snapshot = simulation.snapshot;
    if (snapshot.status !== "playing") break;
    // Mobile defenders intercept raids on remote yards. Fortified defenders
    // leave the castle after the last wave to clear surviving ranged/siege units.
    if (decisions % 5 === 0 && snapshot.armyCount >= 5 && snapshot.raiders.length
      && (policy === "mobile" || snapshot.wave === snapshot.waveCount)) {
      const enemy = [...snapshot.raiders].sort((a,b) => Math.hypot(a.x-keep.gx,a.z-keep.gz)-Math.hypot(b.x-keep.gx,b.z-keep.gz))[0];
      simulation.selectArmyUnits(snapshot.army.map(unit => unit.id));
      simulation.issueArmyOrder("attack-move", {x: enemy.x, z: enemy.z});
    }
    for (const damaged of snapshot.buildings.filter((item) => item.hp < item.maxHp * 0.65 && ["keep", "tower", "gate"].includes(item.kind))) {
      simulation.repair(damaged.id);
    }
    const plainTowers = snapshot.buildings.filter((item) => item.kind === "tower" && (item.towerUpgrade ?? "none") === "none");
    const armedTowers = snapshot.buildings.filter((item) => item.kind === "tower" && (item.towerUpgrade ?? "none") !== "none").length;
    if (plainTowers.length > 0 && armedTowers < towerLimit && simulation.upgradeTower(plainTowers[0].id, "light")) continue;
    if (snapshot.populationCap - snapshot.population <= 2 && snapshot.populationCap < 48) {
      if (placeNear("house", { gx: keep.gx, gz: keep.gz + 2 })) continue;
    }
    if (ensure("lumber", 1, mission.resourceZones.lumber) || ensure("quarry", 1, mission.resourceZones.quarry)) continue;
    if (ensure("farm", 2, farmAnchor)) continue;
    if (snapshot.resources.food < 45 || snapshot.economy.foodNetPerTick < -0.5) {
      if (count("farm") < 5 && placeNear("farm", farmAnchor)) continue;
    }
    if (count("tower") < 2) {
      const [dx, dz] = towerAnchors[count("tower")];
      if (placeNear("tower", { gx: keep.gx + dx, gz: keep.gz + dz })) continue;
    }
    if (ensure("well", 1, farmAnchor) || ensure("granary", 1, farmAnchor)) continue;
    if (snapshot.freeWorkers > 1) {
      if (ensure("lumber", 2, mission.resourceZones.lumber) || ensure("quarry", 2, mission.resourceZones.quarry)) continue;
    }
    if ((missionId === "river" || snapshot.population > 18) && snapshot.freeWorkers >= 1) {
      if (ensure("wheatFarm", 1, farmAnchor) || ensure("mill", 1, { gx: farmAnchor.gx + 1, gz: farmAnchor.gz + 1 })) continue;
      const mill = simulation.snapshot.buildings.find((item) => item.kind === "mill");
      if (mill && ensure("bakery", 1, mill)) continue;
    }
    if (count("tower") < towerLimit && snapshot.freeWorkers > 0) {
      const [dx, dz] = towerAnchors[count("tower")];
      if (placeNear("tower", { gx: keep.gx + dx, gz: keep.gz + dz })) continue;
    }
    if (ensure("market", 1, keep)) continue;
    if ((missionId === "ruins" || missionId === "siege") && snapshot.freeWorkers >= 2) {
      if (ensure("ironMine", 1, mission.resourceZones.iron) || ensure("blacksmith", 1, keep)) continue;
    }
    if (ensure("archery", 1, keep) || ensure("barracks", 1, keep)) continue;
    snapshot = simulation.snapshot;
    const queued = snapshot.buildings.flatMap(b => b.trainingQueue ?? []);
    if (snapshot.freeWorkers > 2 && snapshot.resources.food > 70 && snapshot.armyCount + queued.length < armyLimit) {
      const archery = snapshot.buildings.find((item) => item.kind === "archery");
      const barracks = snapshot.buildings.find((item) => item.kind === "barracks");
      const archers = snapshot.army.filter((item) => item.kind === "archer").length + queued.filter(item => item.kind === "archer").length;
      if (archers < (policy === "mobile" ? 10 : 9) && archery && simulation.enqueueUnit("archer", archery.id)) continue;
      if (barracks && simulation.enqueueUnit(snapshot.resources.weapons >= 3 && missionId !== "ruins" ? "swordsman" : "spearman", barracks.id)) continue;
    }
    // Expand the curtain wall only after the productive bootstrap and garrison.
    if (policy === "fortified" && snapshot.resources.stone > 90) {
      const wallRing: GridPoint[] = [];
      for (let offset = -4; offset <= 4; offset += 1) {
        wallRing.push({ gx: keep.gx + offset, gz: keep.gz - 4 }, { gx: keep.gx + offset, gz: keep.gz + 4 });
        wallRing.push({ gx: keep.gx - 4, gz: keep.gz + offset }, { gx: keep.gx + 4, gz: keep.gz + offset });
      }
      for (const point of wallRing) {
        // Leave wide service corridors to the farms and resource yards.
        if (Math.abs(point.gx - keep.gx) <= 1 || Math.abs(point.gz - keep.gz) <= 1) continue;
        const kind = point.gx === keep.gx && point.gz === keep.gz + 4 ? "gate" : "wall";
        if (simulation.canPlace(kind, point.gx, point.gz).valid) { simulation.place(kind, point.gx, point.gz); break; }
      }
    }
  }
  const snapshot = simulation.snapshot;
  return { missionId, difficulty, policy, status: snapshot.status, seconds: Math.round(snapshot.raidClock),
    waves: snapshot.wave, goal: snapshot.goalProgress, target: snapshot.goalTarget,
    population: snapshot.population, army: snapshot.armyCount, towers: count("tower"),
    food: Math.round(snapshot.resources.food), gold: Math.round(snapshot.resources.gold),
    buildingsLost: seenBuildings.size - snapshot.buildings.length, unitsLost: seenArmy.size - snapshot.army.length,
    minimumFood: Math.round(minimumFood), minimumKeepHp: Math.round(minimumKeepHp), decisions,
    remainingEnemies: snapshot.raiders.map(enemy => ({kind:enemy.kind,x:enemy.x,z:enemy.z,hp:enemy.hp})),
    events: snapshot.chronicle.map((event) => ({ id: event.id, at: event.at })) };
}

describe("public-API full campaign balance", () => {
  it.each(waveMissions)("allows a cautious standard-policy settlement to complete $id", (mission) => {
    const result = runSettlement(mission.id);
    console.info("campaign-balance", JSON.stringify(result));
    expect(result.status, JSON.stringify(result)).toBe("victory");
    expect(result.waves).toBe(mission.waves.length);
    expect(result.goal).toBeGreaterThanOrEqual(result.target);
    expect(result.minimumFood).toBeGreaterThan(0);
    for (const event of mission.events) {
      const recorded = result.events.filter((item) => item.id === event.id);
      expect(recorded).toHaveLength(1);
      expect(recorded[0].at).toBeGreaterThanOrEqual(event.at - 0.00001);
      expect(recorded[0].at).toBeLessThanOrEqual(event.at + 0.101);
    }
  }, 90000);


  it.each(waveMissions.filter(mission => mission.id !== "oasis"))("allows a mobile-army standard policy to complete $id", mission => {
    const result = runSettlement(mission.id, "standard", "mobile");
    console.info("campaign-balance", JSON.stringify(result));
    expect(result.status, JSON.stringify(result)).toBe("victory");
    expect(result.goal).toBeGreaterThanOrEqual(result.target);
    expect(result.minimumFood).toBeGreaterThan(0);
    expect(result.towers).toBeLessThanOrEqual(2);
  }, 90000);

  it.each(MISSION_LIST)("does not hand an idle player a free victory in $id", (mission) => {
    const simulation = new GameSimulation();
    simulation.selectMission(mission.id); simulation.start(); simulation.beginPreparation(); simulation.setTimeScale(2);
    for (let step = 0; step < 10000 && simulation.snapshot.status === "playing"; step += 1) simulation.tick(0.05);
    expect(simulation.snapshot.status, `${mission.id}: idle keep ${simulation.snapshot.buildings[0].hp}`).not.toBe("victory");
    if (mission.id !== "oasis") expect(simulation.snapshot.status).toBe("defeat");
    else expect(simulation.snapshot.goalProgress).toBeLessThan(simulation.snapshot.goalTarget);
  }, 30000);
});
