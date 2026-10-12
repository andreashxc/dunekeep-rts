import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { GameRenderer, createEnemyThreatRing } from './GameRenderer';
import { GameSimulation } from '../game/simulation';
import { TOWER_UPGRADES } from '../game/duel';
import { TILE_SIZE } from '../game/content';
import type { GameSnapshot } from '../game/types';
import { disposeEntity } from './objects/EntityDisposal';
function setup() {
  const simulation = new GameSimulation(); simulation.selectMission('river'); simulation.start();
  const snapshot = simulation.snapshot;
  const tower = { ...snapshot.duel!.enemyBuildings.find(item => item.kind === 'tower')!, towerUpgrade: 'light' as const };
  const selectionRing = new THREE.Mesh(new THREE.RingGeometry(), new THREE.MeshBasicMaterial());
  const enemyThreatRing = createEnemyThreatRing();
  const view = Object.assign(Object.create(GameRenderer.prototype), {
    selectionRing, enemyThreatRing, selectedEnemyBuildingId: null, selectedEnemyWorld: null,
    currentMissionId: snapshot.missionId, currentMapRulesVersion: snapshot.mapRulesVersion ?? 1,
    currentGridSize: snapshot.gridSize,
  }) as GameRenderer;
  const sync = (value: GameSnapshot) => (view as unknown as { syncSelectedEnemyBuilding(snapshot: GameSnapshot): void }).syncSelectedEnemyBuilding(value);
  return { view, sync, tower, snapshot, selectionRing, enemyThreatRing };
}
it('uses the live light/heavy tower definitions, keeps one ring, and never invents range for empty towers or keeps', () => {
  const { view, tower, enemyThreatRing } = setup();
  const geometry = enemyThreatRing.geometry, material = enemyThreatRing.material;
  for (let i = 0; i < 100; i++) {
    const towerUpgrade = i % 2 ? 'light' : 'heavy';
    view.selectEnemyBuilding({ ...tower, towerUpgrade });
    expect(enemyThreatRing.scale.x).toBe(TOWER_UPGRADES[towerUpgrade].range * TILE_SIZE);
    expect(enemyThreatRing.visible).toBe(true);
    expect(enemyThreatRing.geometry).toBe(geometry); expect(enemyThreatRing.material).toBe(material);
  }
  view.selectEnemyBuilding({ ...tower, towerUpgrade: 'none' }); expect(enemyThreatRing.visible).toBe(false);
  view.selectEnemyBuilding({ ...tower, kind: 'keep' }); expect(enemyThreatRing.visible).toBe(false);
  const releaseGeometry = vi.spyOn(geometry, 'dispose'), releaseMaterial = vi.spyOn(material, 'dispose');
  disposeEntity(enemyThreatRing); disposeEntity(enemyThreatRing);
  expect(releaseGeometry).toHaveBeenCalledOnce(); expect(releaseMaterial).toHaveBeenCalledOnce();
});
it('refreshes upgrades and hides selection for destroyed towers, friendly cities, and world changes with reused IDs', () => {
  const { view, sync, tower, snapshot, selectionRing, enemyThreatRing } = setup();
  const withTower = { ...snapshot, duel: { ...snapshot.duel!, enemyBuildings: [{ ...tower, towerUpgrade: 'heavy' as const }] } };
  view.selectEnemyBuilding(tower); sync(withTower);
  expect(enemyThreatRing.scale.x).toBe(TOWER_UPGRADES.heavy.range * TILE_SIZE);
  sync({ ...withTower, duel: { ...withTower.duel, enemyBuildings: [{ ...tower, hp: 0 }] } });
  expect(enemyThreatRing.visible).toBe(false); expect(selectionRing.visible).toBe(false);
  view.selectEnemyBuilding(tower); sync({ ...withTower, duel: { ...withTower.duel, friendly: true } });
  expect(enemyThreatRing.visible).toBe(false);
  view.selectEnemyBuilding(tower); sync({ ...withTower, missionId: 'siege' });
  expect(enemyThreatRing.visible).toBe(false);
  view.selectEnemyBuilding(tower); sync({ ...withTower, mapRulesVersion: snapshot.mapRulesVersion === 2 ? 1 : 2 });
  expect(enemyThreatRing.visible).toBe(false);
});
it('normal selection clears enemy range and restores the friendly ring colour', () => {
  const { view, tower, selectionRing, enemyThreatRing } = setup();
  view.selectEnemyBuilding(tower); view.selectBuilding(tower);
  expect(enemyThreatRing.visible).toBe(false);
  expect(selectionRing.visible).toBe(true);
  expect((selectionRing.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('fff0a8');
  view.selectBuilding(null); expect(selectionRing.visible).toBe(false);
});
