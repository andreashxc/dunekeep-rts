import * as THREE from "three";
import { createWallMaterials, createWallTopology, WALL_HEALTH_BAR_HEIGHT } from "./world/WallArchitecture";
import { BUILDINGS, GRID_SIZE, TILE_SIZE } from "../game/content";
import { TOWER_UPGRADES } from "../game/duel";
import type {
  ArmyUnitKind,
  ArmyUnitState,
  BuildingKind,
  BuildingState,
  CivilianState,
  ControllableEntityKind,
  DuelSnapshot,
  GameSnapshot,
  MapTheme,
  ProjectileEvent,
  RaiderState,
} from "../game/types";
import { animateCharacter, createRaider, createSoldier, createVillager, disposeCharacterResources, getVillagerProfession } from "./objects/CharacterFactory";
import { WorldScenery, WORLD_COLORS } from "./world/WorldScenery";
import { disposeEntity } from "./objects/EntityDisposal";
import { DesertLandscape } from "./world/DesertLandscape";
import { disposeDesertArchitectureResources } from "./world/DesertArchitecture";
import { SettlementDressing } from "./world/SettlementDressing";
import { HUMAN_WORLD_SCALE, HUMAN_RELEASE_HEIGHT, HUMAN_TARGET_HEIGHT } from "../game/worldScale";
import { createWorldBuilding } from "./world/WorldBuilding";
import { ContactShadows } from "./world/ContactShadows";
import { ProductionEffects } from "./world/ProductionEffects";
import { AnimationClock } from "./AnimationClock";
import { TerrainLayer } from "./world/TerrainLayer";
import { SceneEffects } from "./world/SceneEffects";
import { GraphicsSettings, GRAPHICS_QUALITY, GRAPHICS_SETTINGS_KEY, isGraphicsPreset, type GraphicsPreset } from "./GraphicsSettings";
import { addHealthBar, updateHealthBar } from "./objects/HealthBar";
import { cameraViewSpan, clampCameraTarget, screenPanToGround, TOP_VIEW_PITCH } from "./CameraNavigation";
import { ThirdPersonRig } from "./ThirdPersonRig";
import { horizontalAimTarget, screenDragToLookDelta } from "../input/BetaUnitControls";
import { createSiegeEngine } from "./objects/SiegeEngineFactory";
import { createTowerWeapon } from "./objects/TowerWeaponFactory";

interface ProjectileVisual {
  mesh: THREE.Mesh;
  start: THREE.Vector3;
  end: THREE.Vector3;
  progress: number;
  elapsed: number;
  landedFor: number;
  ballistic: ProjectileEvent["ballistic"];
}

interface DustVisual {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  progress: number;
}

export class GameRenderer {
  readonly element: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private sun: THREE.DirectionalLight | null = null;
  private camera = new THREE.OrthographicCamera(-16, 16, 10, -10, 0.1, 180);
  private thirdPersonRig = new ThirdPersonRig({
    fov: 55,
    backOffset: 1.8,
    shoulderOffset: 0.28,
    cameraHeight: 1.12,
    maximumAimRange: 24,
  });
  private raycaster = new THREE.Raycaster();
  private directCameraRaycaster = new THREE.Raycaster();
  private directCameraAnchor = new THREE.Vector3();
  private directCameraDirection = new THREE.Vector3();
  private directCameraHiddenBuildings = new Set<THREE.Group>();
  private directCameraHiddenAllies = new Set<THREE.Group>();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private buildingMeshes = new Map<number, THREE.Group>();
  private enemyBuildingMeshes = new Map<number, THREE.Group>();
  private raiderMeshes = new Map<number, THREE.Group>();
  private armyMeshes = new Map<number, THREE.Group>();
  private selectedArmyIds = new Set<number>();
  private selectedCivilianId: number | null = null;
  private directControlUnitId: number | null = null;
  private directControlEntityKind: ControllableEntityKind | null = null;
  private villagerMeshes = new Map<number, THREE.Group>();
  private projectiles: ProjectileVisual[] = [];
  private dustEffects: DustVisual[] = [];
  private projectileGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.44, 6);
  private projectileMaterial = new THREE.MeshBasicMaterial({ color: "#fff3c4" });
  private ballistaGeometry = new THREE.CylinderGeometry(0.026, 0.026, 0.62, 6);
  private ballistaMaterial = new THREE.MeshStandardMaterial({ color: "#d9d5bd", roughness: 0.62, metalness: 0.14 });
  private catapultGeometry = new THREE.DodecahedronGeometry(0.14, 0);
  private catapultMaterial = new THREE.MeshStandardMaterial({ color: "#6f7470", roughness: 1, flatShading: true });
  private dustGeometry = new THREE.IcosahedronGeometry(0.22, 0);
  private world = new THREE.Group();
  private scenery: WorldScenery | null = null;
  private landscape: DesertLandscape | null = null;
  private terrainLayer: TerrainLayer | null = null;
  private currentMapRulesVersion: 1 | 2 | null = null;
  private settlement = new SettlementDressing();
  private contactShadows = new ContactShadows();
  private effects: SceneEffects | null = null;
  private constructionGrid: THREE.GridHelper | null = null;
  private neutralZoneVisual: THREE.Group | null = null;
  private enemyResourceMarkers: THREE.Group | null = null;
  private woodResourceMarker: THREE.Group | null = null;
  private stoneResourceMarker: THREE.Group | null = null;
  private ironResourceMarker: THREE.Group | null = null;
  private fertileResourceMarker: THREE.Group | null = null;
  private groundMaterial: THREE.MeshStandardMaterial | null = null;
  private currentMapTheme: MapTheme | null = null;
  private currentGridSize = GRID_SIZE;
  private currentMissionId: GameSnapshot["missionId"] | null = null;
  private currentKeep = { gx: Math.floor(GRID_SIZE / 2), gz: Math.floor(GRID_SIZE / 2) };
  private duelVisualKey = "";
  private currentResourceZones: GameSnapshot["resourceZones"] = {
    lumber: { gx: 2, gz: 15 }, quarry: { gx: 14, gz: 2 },
    iron: { gx: 15, gz: 14 }, fertile: { gx: 4, gz: 12 },
  };
  private wallMaterials = createWallMaterials();
  private enemyWallMaterials = createWallMaterials(true);
  private highlight: THREE.Mesh;
  private placementGhost: THREE.Group | null = null;
  private placementGhostKind: BuildingKind | null = null;
  private placementFillMaterial = new THREE.MeshBasicMaterial({
    color: "#77d98b",
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.12,
    depthTest: false,
    depthWrite: false,
  });
  private placementLineMaterial = new THREE.LineBasicMaterial({
    color: "#baffc4",
    transparent: true,
    opacity: 0.98,
    depthTest: false,
    depthWrite: false,
  });
  private selectionRing: THREE.Mesh;
  private enemyThreatRing: THREE.Mesh;
  private selectedEnemyBuildingId: number | null = null;
  private selectedEnemyWorld: string | null = null;
  private rallyMarker: THREE.Group;
  private cameraTarget = new THREE.Vector3(0, 0, 0);
  private cameraYaw = Math.PI * 0.25;
  private cameraDistance = 21;
  private cameraPitch = 0.64;
  private savedCameraPitch = 0.64;
  private cameraMode: "isometric" | "top" = "isometric";
  private elapsed = 0;
  private animationClock = new AnimationClock();
  private productionEffects = new ProductionEffects();
  private lowPower: boolean;
  private graphics = new GraphicsSettings();
  private disposed = false;
  private contextLost = false;
  private onContextLost = (event: Event): void => { event.preventDefault(); this.contextLost = true; this.animationClock.reset(); };
  private onContextRestored = (): void => {
    this.contextLost = false;
    this.renderer.info.autoReset = false;
    this.applyGraphicsSettings();
  };

  get isAvailable(): boolean { return !this.contextLost && !this.disposed; }

  constructor(container: HTMLElement) {
    for (const material of Object.values(this.wallMaterials)) material.userData.shared = true;
    for (const material of Object.values(this.enemyWallMaterials)) material.userData.shared = true;
    this.lowPower = matchMedia("(pointer: coarse)").matches || navigator.hardwareConcurrency <= 4;
    try {
      const saved = window.localStorage.getItem(GRAPHICS_SETTINGS_KEY);
      if (isGraphicsPreset(saved)) this.graphics.setPreset(saved);
    } catch { /* unavailable browser storage is non-fatal */ }
    // Native antialiasing remains enabled across all quality presets.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
    this.element = this.renderer.domElement;
    this.element.className = "game-canvas";
    this.element.setAttribute("aria-label", "Трёхмерная карта крепости");
    this.element.tabIndex = 0;
    this.element.addEventListener("webglcontextlost", this.onContextLost);
    this.element.addEventListener("webglcontextrestored", this.onContextRestored);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, GRAPHICS_QUALITY[this.graphics.quality].pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    container.prepend(this.element);

    this.scene.background = new THREE.Color("#8eafb4");
    this.scene.fog = new THREE.Fog("#d6c8a5", 65, 125);
    this.scene.add(this.world);
    this.setupLights();
    this.setupTerrain();
    this.world.add(this.settlement.group, this.contactShadows.mesh, this.productionEffects.mesh);


    this.highlight = new THREE.Mesh(
      new THREE.PlaneGeometry(TILE_SIZE * 0.9, TILE_SIZE * 0.9),
      new THREE.MeshBasicMaterial({
        color: "#f5c75b",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.42,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.highlight.rotation.x = -Math.PI / 2;
    this.highlight.position.y = 0.065;
    this.highlight.renderOrder = 28;
    this.highlight.visible = false;
    this.world.add(this.highlight);

    this.selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(TILE_SIZE * 0.48, TILE_SIZE * 0.6, 24),
      new THREE.MeshBasicMaterial({ color: "#fff0a8", side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.position.y = 0.08;
    this.selectionRing.visible = false;
    this.world.add(this.selectionRing);
    this.enemyThreatRing = createEnemyThreatRing();
    this.world.add(this.enemyThreatRing);

    this.rallyMarker = this.createRallyMarker();
    this.rallyMarker.visible = false;
    this.world.add(this.rallyMarker);

    this.resetCamera();
    this.applyGraphicsSettings();
  }

  getGraphicsSettings() {
    return { preset: this.graphics.preset, quality: this.graphics.quality,
      pixelRatio: this.renderer.getPixelRatio(), ambientOcclusion: Boolean(this.effects),
      shadowSize: GRAPHICS_QUALITY[this.graphics.quality].shadowSize };
  }

  setGraphicsPreset(preset: GraphicsPreset): void {
    if (!isGraphicsPreset(preset) || this.disposed) return;
    this.graphics.setPreset(preset);
    try { window.localStorage.setItem(GRAPHICS_SETTINGS_KEY, preset); } catch { /* non-fatal */ }
    this.applyGraphicsSettings();
  }

  /** Feed visible, active RAF intervals only; never call heavyweight diagnostics here. */
  recordFrameTime(frameMs: number): void {
    if (this.isAvailable && this.graphics.recordFrameTime(frameMs)) this.applyGraphicsSettings();
  }

  performanceCounters() {
    const info = this.renderer.info;
    return { calls: info.render.calls, triangles: info.render.triangles,
      geometries: info.memory.geometries, textures: info.memory.textures,
      smoke: this.productionEffects.diagnostics(this.thirdPersonRig.active ? this.thirdPersonRig.camera : this.camera) };
  }

  private applyGraphicsSettings(): void {
    const settings = GRAPHICS_QUALITY[this.graphics.quality];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, settings.pixelRatio));
    if (this.sun && this.sun.shadow.mapSize.x !== settings.shadowSize) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
      this.sun.shadow.needsUpdate = true;
    }
    const useEffects = settings.ambientOcclusion && this.renderer.extensions.has("EXT_color_buffer_float");
    if (!useEffects && this.effects) { this.effects.dispose(); this.effects = null; }
    if (useEffects && !this.effects) this.effects = new SceneEffects(this.renderer, this.scene, this.camera);
    this.resize();
  }

  resize(): void {
    const width = this.element.clientWidth || window.innerWidth;
    const height = this.element.clientHeight || window.innerHeight;
    this.updateCamera();
    this.renderer.setSize(width, height, false);
    this.thirdPersonRig.resize(width, height);
    this.effects?.resize(width, height);
  }

  render(snapshot: GameSnapshot, delta: number): void {
    if (!this.isAvailable) return;
    // World animation follows simulation time, so planning and explicit pauses freeze people,
    // combat motion, projectiles and ambient movement on the exact same frame.
    this.elapsed = snapshot.elapsed;
    const animationDelta = this.animationClock.advance(snapshot.elapsed, `${snapshot.missionId}:${snapshot.mapRulesVersion ?? 1}`, snapshot.timePaused);
    this.syncMap(snapshot);
    this.syncBuildings(snapshot.buildings, snapshot.timePaused);
    this.syncEnemyBuildings(snapshot.duel?.enemyBuildings ?? [], snapshot.timePaused, snapshot.duel?.friendly ?? false);
    this.syncDuelVisuals(snapshot.duel);
    this.syncSelectedEnemyBuilding(snapshot);
    for (const production of snapshot.economy.production) {
      const building = this.buildingMeshes.get(production.buildingId);
      if (building) building.userData.isOperating = production.status === "working";
    }
    this.scenery?.setOccupied([...snapshot.buildings, ...(snapshot.duel?.enemyBuildings ?? []),
      ...(this.terrainLayer?.blockingCells ?? [])]);
    if (snapshot.gridSize === GRID_SIZE) {
      this.settlement.group.visible = true;
      this.settlement.sync(snapshot.buildings, snapshot.resourceZones);
    } else {
      // The duel spans two independently growing towns. Its authored neutral strip
      // and resource pockets replace the single-settlement road dressing.
      this.settlement.group.visible = false;
    }
    this.syncRaiders(snapshot.raiders, snapshot.timePaused);
    this.syncArmy(snapshot.army, snapshot.timePaused);
    this.syncVillagers(
      snapshot.civilianEntities,
      snapshot.timePaused,
      snapshot.directControl?.entityKind === "civilian" && snapshot.directControl.dancing
        ? snapshot.directControl.entityId
        : null,
    );
    this.syncDirectControl(snapshot, delta);
    this.syncResourceMarkerVisibility(snapshot);
    this.syncRallyPoint(snapshot);
    this.updateAnimations(animationDelta, snapshot);
    this.productionEffects.update(this.buildingMeshes, snapshot.elapsed, snapshot.timePaused, this.graphics.quality === "low");
    this.scenery?.update(this.elapsed);
    this.landscape?.update(this.elapsed);
    this.terrainLayer?.setOccupied([...snapshot.buildings, ...(snapshot.duel?.enemyBuildings ?? [])]);
    this.terrainLayer?.update(this.elapsed, snapshot.timePaused);
    this.settlement.update(this.elapsed, snapshot.timePaused);
    this.contactShadows.begin();
    for (const building of [...this.buildingMeshes.values(), ...this.enemyBuildingMeshes.values()]) {
      const kind = building.userData.buildingKind as BuildingKind;
      const size = kind === "keep" ? 2.65 : kind === "wall" ? 1.25 : 1.45;
      this.contactShadows.add(building.position.x, building.position.z, size);
    }
    for (const person of [...this.villagerMeshes.values(), ...this.armyMeshes.values(), ...this.raiderMeshes.values()]) {
      if (!person.visible || person.position.y > 0.12) continue;
      this.contactShadows.add(person.position.x, person.position.z, person.userData.siegeEngine ? 0.9 : person.userData.unitKind === "knight" ? 0.42 : 0.22);
    }
    this.contactShadows.end();
    this.renderer.info.reset();
    if (this.thirdPersonRig.active) this.renderer.render(this.scene, this.thirdPersonRig.camera);
    else if (this.effects) this.effects.render(animationDelta);
    else this.renderer.render(this.scene, this.camera);
  }

  diagnostics() {
    const pose = (group: THREE.Group) => {
      const values: number[] = [];
      group.traverse((node) => values.push(...node.position.toArray(), ...node.quaternion.toArray(), ...node.scale.toArray()));
      return { name: group.name, values };
    };
    return {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      lowPower: this.lowPower,
      graphics: this.getGraphicsSettings(),
      ambientOcclusion: Boolean(this.effects),
      antialias: this.renderer.getContext().getContextAttributes()?.antialias ?? false,
      pixelRatio: this.renderer.getPixelRatio(),
      groundTextured: Boolean(this.groundMaterial?.map || this.groundMaterial?.normalMap || this.groundMaterial?.roughnessMap),
      villagers: [...this.villagerMeshes.values()].map(pose),
      army: [...this.armyMeshes.values()].map(pose),
      garrisonedArmy: [...this.armyMeshes.entries()]
        .filter(([, group]) => typeof group.userData.garrisonBuildingId === "number")
        .map(([id, group]) => ({
          id,
          buildingId: group.userData.garrisonBuildingId as number,
          status: group.userData.garrisonStatus as string,
          transition: group.userData.garrisonTransition as number,
          y: group.position.y,
        })),
      raiders: [...this.raiderMeshes.values()].map(pose),
      enemyBuildings: this.enemyBuildingMeshes.size,
      gridSize: this.currentGridSize,
      camera: this.thirdPersonRig.active ? this.thirdPersonRig.diagnostics() : {
        yaw: this.cameraYaw, pitch: this.cameraPitch, mode: this.cameraMode,
        distance: this.cameraDistance, projection: "orthographic",
        target: { x: this.cameraTarget.x, z: this.cameraTarget.z },
      },
      selectedArmyUnitIds: [...this.selectedArmyIds],
      selectedCivilianId: this.selectedCivilianId,
      directControlUnitId: this.directControlUnitId,
      directControlEntityKind: this.directControlEntityKind,
      directCameraCutaways: this.directCameraHiddenBuildings.size,
      directCameraHiddenAllies: this.directCameraHiddenAllies.size,
    };
  }

  resetTransientWorld(): void {
    this.hidePlacement();
    this.disposePlacementGhost();
    this.selectBuilding(null);
    this.setArmySelection([]);
    this.setCivilianSelection(null);
    this.directControlUnitId = null;
    this.directControlEntityKind = null;
    this.thirdPersonRig.exit();
    this.restoreDirectCameraCutaways();
    this.restoreDirectCameraAllyVisibility();
    this.rallyMarker.visible = false;
    for (const entities of [this.buildingMeshes, this.enemyBuildingMeshes, this.armyMeshes, this.raiderMeshes]) {
      for (const entity of entities.values()) disposeEntity(entity);
      entities.clear();
    }
    for (const person of this.villagerMeshes.values()) disposeEntity(person);
    this.villagerMeshes.clear();
    for (const projectile of this.projectiles) this.world.remove(projectile.mesh);
    this.projectiles = [];
    for (const dust of this.dustEffects) {
      this.world.remove(dust.mesh);
      dust.material.dispose();
    }
    this.dustEffects = [];
    this.elapsed = 0;
    this.animationClock.reset();
    this.productionEffects.reset();
  }

  projectCell(gx: number, gz: number): { x: number; y: number } {
    const point = new THREE.Vector3(this.gridToWorld(gx), 0, this.gridToWorld(gz)).project(this.camera);
    const rect = this.element.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) * rect.width * 0.5, y: rect.top + (1 - point.y) * rect.height * 0.5 };
  }

  pickGrid(clientX: number, clientY: number): { gx: number; gz: number } | null {
    const rect = this.element.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    const gx = Math.round(hit.x / TILE_SIZE + (this.currentGridSize - 1) / 2);
    const gz = Math.round(hit.z / TILE_SIZE + (this.currentGridSize - 1) / 2);
    if (gx < 0 || gz < 0 || gx >= this.currentGridSize || gz >= this.currentGridSize) return null;
    return { gx, gz };
  }

  pickBuilding(clientX: number, clientY: number): number | null {
    const rect = this.element.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.buildingMeshes.values()], true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && node !== this.world) {
        if (typeof node.userData.buildingId === "number") return node.userData.buildingId;
        node = node.parent;
      }
    }
    return null;
  }

  /** Returns an enemy structure id so strategy controls can issue an explicit siege order. */
  pickEnemyBuilding(clientX: number, clientY: number): number | null {
    const rect = this.element.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.enemyBuildingMeshes.values()], true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && node !== this.world) {
        if (typeof node.userData.enemyBuildingId === "number") return node.userData.enemyBuildingId;
        node = node.parent;
      }
    }
    return null;
  }

  /** Smoothly useful for UI shortcuts such as "my keep" and "rival keep". */
  focusCell(gx: number, gz: number, distance?: number): void {
    this.cameraTarget.set(this.gridToWorld(gx), 0, this.gridToWorld(gz));
    if (distance !== undefined) this.cameraDistance = THREE.MathUtils.clamp(distance, 15, 46);
    this.updateCamera();
  }

  pickArmyUnit(clientX: number, clientY: number): number | null {
    const rect = this.element.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.armyMeshes.values()], true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && node !== this.world) {
        if (typeof node.userData.armyUnitId === "number") return node.userData.armyUnitId;
        node = node.parent;
      }
    }
    return this.pickNearbyPerson(this.armyMeshes, clientX, clientY);
  }

  pickCivilian(clientX: number, clientY: number): number | null {
    const rect = this.element.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.villagerMeshes.values()], true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && node !== this.world) {
        if (typeof node.userData.civilianId === "number") return node.userData.civilianId;
        node = node.parent;
      }
    }
    return this.pickNearbyPerson(this.villagerMeshes, clientX, clientY);
  }

  /** Smaller, human-scale models retain a practical mouse/touch target. */
  private pickNearbyPerson(people: ReadonlyMap<number, THREE.Group>, clientX: number, clientY: number): number | null {
    const rect = this.element.getBoundingClientRect();
    const radius = rect.width <= 720 ? 16 : 10;
    let nearest = radius * radius;
    let selected: number | null = null;
    for (const [id, person] of people) {
      if (!person.visible) continue;
      const point = person.position.clone();
      point.y += person.userData.unitKind === "knight" ? 0.46 : HUMAN_TARGET_HEIGHT;
      point.project(this.camera);
      if (point.z < -1 || point.z > 1) continue;
      const dx = rect.left + (point.x + 1) * rect.width / 2 - clientX;
      const dy = rect.top + (1 - point.y) * rect.height / 2 - clientY;
      const distance = dx * dx + dy * dy;
      if (distance < nearest) { nearest = distance; selected = id; }
    }
    return selected;
  }

  armyUnitsInScreenRect(left: number, top: number, right: number, bottom: number): number[] {
    const rect = this.element.getBoundingClientRect();
    const minX = Math.min(left, right);
    const maxX = Math.max(left, right);
    const minY = Math.min(top, bottom);
    const maxY = Math.max(top, bottom);
    const result: number[] = [];
    for (const [id, group] of this.armyMeshes) {
      const point = group.position.clone();
      point.y += group.userData.unitKind === "knight" ? 0.46 : HUMAN_TARGET_HEIGHT;
      point.project(this.camera);
      if (point.z < -1 || point.z > 1) continue;
      const clientX = rect.left + (point.x + 1) * rect.width * 0.5;
      const clientY = rect.top + (1 - point.y) * rect.height * 0.5;
      if (clientX >= minX && clientX <= maxX && clientY >= minY && clientY <= maxY) result.push(id);
    }
    return result;
  }

  setArmySelection(ids: readonly number[]): void {
    this.selectedArmyIds = new Set(ids);
    for (const [id, group] of this.armyMeshes) this.applyArmyRingState(id, group);
  }

  setCivilianSelection(id: number | null): void {
    const previous = this.selectedCivilianId;
    this.selectedCivilianId = id;
    if (previous !== null) {
      const group = this.villagerMeshes.get(previous);
      if (group) this.applyCivilianRingState(previous, group);
    }
    if (id !== null) {
      const group = this.villagerMeshes.get(id);
      if (group) this.applyCivilianRingState(id, group);
    }
  }

  lookDirect(deltaX: number, deltaY: number): void {
    if (!this.thirdPersonRig.active) return;
    const look = screenDragToLookDelta({ x: deltaX, y: deltaY });
    this.thirdPersonRig.look(look.yawDelta, look.pitchDelta);
  }

  resetDirectLook(): void {
    this.thirdPersonRig.resetLook();
  }

  directControlView(): { heading: number; aimX: number; aimZ: number; aimPitch: number } | null {
    if (!this.thirdPersonRig.active) return null;
    const diagnostics = this.thirdPersonRig.diagnostics();
    const controlled = this.directControlUnitId === null ? null
      : this.directControlEntityKind === "civilian"
        ? this.villagerMeshes.get(this.directControlUnitId)
        : this.armyMeshes.get(this.directControlUnitId);
    if (!controlled) return null;
    const heading = diagnostics.look.worldYaw;
    // Combat uses the horizontal camera course instead of a shoulder-camera ray
    // hitting the ground. Pitch and terrain can no longer make the archer jump
    // between a near cell and a max-range fallback target.
    const originX = this.worldToGrid(controlled.position.x);
    const originZ = this.worldToGrid(controlled.position.z);
    const aim = horizontalAimTarget({ x: originX, z: originZ }, heading);
    return {
      heading,
      aimX: aim.x,
      aimZ: aim.z,
      aimPitch: Math.asin(THREE.MathUtils.clamp(diagnostics.aim.directionY, -1, 1)),
    };
  }

  isDirectControlActive(): boolean {
    return this.thirdPersonRig.active;
  }

  showPlacement(kind: BuildingKind, gx: number, gz: number, valid: boolean): void {
    this.highlight.visible = true;
    if (this.constructionGrid) this.constructionGrid.visible = true;
    this.highlight.position.x = this.gridToWorld(gx);
    this.highlight.position.z = this.gridToWorld(gz);
    (this.highlight.material as THREE.MeshBasicMaterial).color.set(valid ? "#77d98b" : "#db564b");

    if (!this.placementGhost || this.placementGhostKind !== kind) {
      this.disposePlacementGhost();
      this.placementGhost = this.createPlacementGhost(kind);
      this.placementGhostKind = kind;
      this.world.add(this.placementGhost);
    }
    const fillColor = valid ? "#62e59a" : "#ff6256";
    const lineColor = valid ? "#c7ffd5" : "#ffd0ca";
    this.placementFillMaterial.color.set(fillColor);
    this.placementFillMaterial.opacity = valid ? 0.22 : 0.3;
    this.placementLineMaterial.color.set(lineColor);
    this.placementGhost.position.x = this.gridToWorld(gx);
    this.placementGhost.position.y = 0.08;
    this.placementGhost.position.z = this.gridToWorld(gz);
    this.placementGhost.visible = true;
  }

  hidePlacement(): void {
    this.highlight.visible = false;
    if (this.constructionGrid) this.constructionGrid.visible = false;
    if (this.placementGhost) this.placementGhost.visible = false;
  }

  selectBuilding(building: BuildingState | null): void {
    this.selectedEnemyBuildingId = null;
    this.selectedEnemyWorld = null;
    this.enemyThreatRing.visible = false;
    (this.selectionRing.material as THREE.MeshBasicMaterial).color.set("#fff0a8");
    if (!building) {
      this.selectionRing.visible = false;
      return;
    }
    this.selectionRing.visible = true;
    this.selectionRing.position.x = this.gridToWorld(building.gx);
    this.selectionRing.position.z = this.gridToWorld(building.gz);
  }

  selectEnemyBuilding(building: BuildingState | null): void {
    this.selectBuilding(null);
    if (!building || building.hp <= 0) return;
    this.selectedEnemyBuildingId = building.id;
    this.selectedEnemyWorld = `${this.currentMissionId}:${this.currentMapRulesVersion}`;
    this.selectionRing.visible = true;
    (this.selectionRing.material as THREE.MeshBasicMaterial).color.set("#ed8065");
    this.selectionRing.position.x = this.gridToWorld(building.gx);
    this.selectionRing.position.z = this.gridToWorld(building.gz);
    const upgrade = building.towerUpgrade ?? "none";
    if (building.kind !== "tower" || upgrade === "none") return;
    const radius = TOWER_UPGRADES[upgrade].range * TILE_SIZE;
    this.enemyThreatRing.position.set(this.selectionRing.position.x, 0.085, this.selectionRing.position.z);
    this.enemyThreatRing.scale.setScalar(radius);
    this.enemyThreatRing.visible = true;
  }

  private syncSelectedEnemyBuilding(snapshot: GameSnapshot): void {
    if (this.selectedEnemyBuildingId === null) return;
    const world = `${snapshot.missionId}:${snapshot.mapRulesVersion ?? 1}`;
    if (world !== this.selectedEnemyWorld || !snapshot.duel || snapshot.duel.friendly) {
      this.selectBuilding(null);
      return;
    }
    const building = snapshot.duel.enemyBuildings.find(candidate => candidate.id === this.selectedEnemyBuildingId);
    this.selectEnemyBuilding(building ?? null);
  }

  pan(screenX: number, screenY: number): void {
    const offset = screenPanToGround(screenX, screenY, this.navigationView());
    this.cameraTarget.x += offset.x;
    this.cameraTarget.z += offset.z;
    this.updateCamera();
  }

  panDirection(x: number, z: number): void {
    this.pan(x * -28, z * 28);
  }

  zoom(amount: number): void {
    this.cameraDistance = THREE.MathUtils.clamp(this.cameraDistance + amount, 15, this.currentGridSize > GRID_SIZE ? 46 : 38);
    this.updateCamera();
  }

  rotate(amount: number): void {
    this.cameraYaw += amount;
    this.updateCamera();
  }

  /** Pixel-based orbit helper for mouse/pointer dragging on desktop. */
  orbit(deltaX: number, deltaY = 0): void {
    this.cameraYaw -= deltaX * 0.007;
    if (Math.abs(deltaY) > 0.01) {
      if (this.cameraMode === "top") this.setTopView(false);
      this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + deltaY * 0.0045, 0.42, 1.25);
    }
    this.updateCamera();
  }

  setTopView(enabled: boolean): void {
    if (enabled === (this.cameraMode === "top")) return;
    if (enabled) {
      this.savedCameraPitch = this.cameraPitch;
      this.cameraMode = "top";
    } else {
      this.cameraMode = "isometric";
      this.cameraPitch = this.savedCameraPitch;
    }
    this.updateCamera();
  }

  toggleTopView(): boolean {
    const enabled = this.cameraMode !== "top";
    this.setTopView(enabled);
    return enabled;
  }

  isTopView(): boolean {
    return this.cameraMode === "top";
  }

  resetCamera(): void {
    const width = this.element.clientWidth || window.innerWidth;
    const height = this.element.clientHeight || window.innerHeight;
    const wide = width > 720 && width > height;
    const keepX = this.gridToWorld(this.currentKeep.gx);
    const keepZ = this.gridToWorld(this.currentKeep.gz);
    this.cameraTarget.set(keepX + (wide ? -1.5 : 0), 0, keepZ + (wide ? 0.8 : 0));
    this.cameraYaw = Math.PI * 0.25;
    this.cameraDistance = this.currentGridSize > GRID_SIZE ? (wide ? 27 : 29) : (wide ? 19 : 21);
    if (isCompactLandscape(width, height)) this.cameraDistance = Math.max(15, this.cameraDistance / 1.4);
    this.cameraPitch = 0.64;
    this.savedCameraPitch = this.cameraPitch;
    this.cameraMode = "isometric";
    this.updateCamera();
  }

  addProjectile(event: ProjectileEvent): void {
    const mesh = event.source === "catapult"
      ? new THREE.Mesh(this.catapultGeometry, this.catapultMaterial)
      : event.source === "ballista"
        ? new THREE.Mesh(this.ballistaGeometry, this.ballistaMaterial)
        : new THREE.Mesh(this.projectileGeometry, this.projectileMaterial);
    mesh.castShadow = event.source === "catapult";
    const start = new THREE.Vector3(this.gridToWorld(event.fromX), event.fromY ?? (event.source === "archer" ? HUMAN_RELEASE_HEIGHT : event.source === "tower" ? 2.85 : 2.35), this.gridToWorld(event.fromZ));
    const end = new THREE.Vector3(this.gridToWorld(event.toX), event.toY ?? HUMAN_TARGET_HEIGHT, this.gridToWorld(event.toZ));
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    const generatedFlight = event.source === "catapult"
      ? { flightSeconds: THREE.MathUtils.clamp(0.72 + distance * 0.055, 0.85, 1.65), gravity: 7.4, lingerSeconds: 0.8, impact: "target" as const }
      : event.source === "ballista"
        ? { flightSeconds: THREE.MathUtils.clamp(0.2 + distance * 0.025, 0.28, 0.58), gravity: 1.2, lingerSeconds: 0.12, impact: "target" as const }
        : null;
    const ballistic = event.ballistic ?? (generatedFlight ? {
      ...generatedFlight,
      initialVelocityY: (end.y - start.y + 0.5 * generatedFlight.gravity * generatedFlight.flightSeconds ** 2) / generatedFlight.flightSeconds,
    } : undefined);
    mesh.position.copy(start);
    this.world.add(mesh);
    this.projectiles.push({ mesh, start, end, progress: 0, elapsed: 0, landedFor: 0, ballistic });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.element.removeEventListener("webglcontextlost", this.onContextLost);
    this.element.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.resetTransientWorld();
    this.placementFillMaterial.dispose();
    this.placementLineMaterial.dispose();
    this.projectileGeometry.dispose();
    this.projectileMaterial.dispose();
    this.ballistaGeometry.dispose();
    this.ballistaMaterial.dispose();
    this.catapultGeometry.dispose();
    this.catapultMaterial.dispose();
    for (const dust of this.dustEffects) {
      this.world.remove(dust.mesh);
      dust.material.dispose();
    }
    this.dustEffects = [];
    this.dustGeometry.dispose();
    this.scenery?.dispose();
    this.landscape?.dispose();
    this.terrainLayer?.dispose();
    this.settlement.dispose();
    this.contactShadows.dispose();
    this.productionEffects.dispose();
    disposeEntity(this.world);
    for (const material of Object.values(this.wallMaterials)) material.dispose();
    for (const material of Object.values(this.enemyWallMaterials)) material.dispose();
    disposeCharacterResources();
    disposeDesertArchitectureResources();
    this.effects?.dispose();
    this.thirdPersonRig.dispose();
    this.renderer.dispose();
  }

  private navigationView() {
    return {
      width: this.element.clientWidth || window.innerWidth,
      height: this.element.clientHeight || window.innerHeight,
      distance: this.cameraDistance,
      yaw: this.cameraYaw,
      pitch: this.cameraMode === "top" ? TOP_VIEW_PITCH : this.cameraPitch,
    };
  }

  private updateCamera(): void {
    const navigation = this.navigationView();
    const target = clampCameraTarget(this.cameraTarget, navigation, this.currentGridSize, TILE_SIZE);
    this.cameraTarget.x = target.x;
    this.cameraTarget.z = target.z;
    const pitch = navigation.pitch;
    // Orthographic scale is independent of orbit radius: no perspective distortion
    // when planning walls, and a real top view that preserves the same cell centers.
    const horizontal = 48 * Math.cos(pitch);
    const height = 48 * Math.sin(pitch);
    this.camera.position.set(
      this.cameraTarget.x + Math.sin(this.cameraYaw) * horizontal,
      Math.max(7.5, height),
      this.cameraTarget.z + Math.cos(this.cameraYaw) * horizontal,
    );
    this.camera.lookAt(this.cameraTarget.x, 0, this.cameraTarget.z);
    this.camera.updateMatrixWorld(true);
    this.updateProjection(navigation.width, navigation.height);
  }

  private updateProjection(width: number, height: number): void {
    const span = cameraViewSpan(this.cameraDistance);
    const aspect = width / Math.max(1, height);
    this.camera.left = -span * aspect / 2;
    this.camera.right = span * aspect / 2;
    this.camera.top = span / 2;
    this.camera.bottom = -span / 2;
    this.camera.updateProjectionMatrix();
  }

  private setupLights(): void {
    this.scene.add(new THREE.HemisphereLight("#d6e7ee", "#a69a86", 1.75));
    const sun = new THREE.DirectionalLight("#ffedcf", 3.0);
    this.sun = sun;
    sun.position.set(-16, 28, 14);
    sun.castShadow = true;
    const shadowSize = GRAPHICS_QUALITY[this.graphics.quality].shadowSize;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16;
    sun.shadow.camera.bottom = -16;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 85;
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.018;
    sun.shadow.radius = 3;
    this.scene.add(sun);
  }

  private setupTerrain(gridSize = this.currentGridSize): void {
    if (this.constructionGrid) {
      this.world.remove(this.constructionGrid);
      this.constructionGrid.geometry.dispose();
      const materials = Array.isArray(this.constructionGrid.material) ? this.constructionGrid.material : [this.constructionGrid.material];
      for (const material of materials) material.dispose();
    }
    const terrainSize = gridSize * TILE_SIZE;
    const grid = new THREE.GridHelper(terrainSize, gridSize, "#9c835e", "#9c835e");
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.2;
    grid.position.y = 0.035;
    grid.visible = false;
    this.constructionGrid = grid;
    this.world.add(grid);
    if (!this.woodResourceMarker) this.setupResourceZones();
  }

  private setupResourceZones(): void {
    this.woodResourceMarker = this.createResourceMarker(0, 0, "ЛЕС", "#66915a");
    this.woodResourceMarker.name = "wood-resource-marker";
    this.stoneResourceMarker = this.createResourceMarker(0, 0, "КАМЕНЬ", "#d09b4e");
    this.stoneResourceMarker.name = "stone-resource-marker";
    this.ironResourceMarker = this.createResourceMarker(0, 0, "ЖЕЛЕЗО", "#9ca8af");
    this.ironResourceMarker.name = "iron-resource-marker";
    this.fertileResourceMarker = this.createResourceMarker(0, 0, "ПОЧВА", "#95af66");
    this.fertileResourceMarker.name = "fertile-resource-marker";
    this.world.add(this.woodResourceMarker, this.stoneResourceMarker, this.ironResourceMarker, this.fertileResourceMarker);
    this.positionResourceZones();
  }

  private positionResourceZones(): void {
    const markers = {
      lumber: this.woodResourceMarker, quarry: this.stoneResourceMarker,
      iron: this.ironResourceMarker, fertile: this.fertileResourceMarker,
    };
    for (const key of Object.keys(markers) as (keyof typeof markers)[]) {
      const zone = this.currentResourceZones[key];
      markers[key]?.position.set(this.gridToWorld(zone.gx), 0, this.gridToWorld(zone.gz));
    }
  }

  private syncMap(snapshot: GameSnapshot): void {
    const gridChanged = snapshot.gridSize !== this.currentGridSize;
    const missionChanged = snapshot.missionId !== this.currentMissionId;
    const mapRulesVersion = snapshot.mapRulesVersion ?? 1;
    const terrainChanged = mapRulesVersion !== this.currentMapRulesVersion;
    const zonesChanged = (Object.keys(snapshot.resourceZones) as (keyof GameSnapshot["resourceZones"])[])
      .some((key) => {
        const next = snapshot.resourceZones[key];
        const previous = this.currentResourceZones[key];
        return next.gx !== previous.gx || next.gz !== previous.gz;
      });
    const duelZonesChanged = Boolean(snapshot.duel) !== Boolean(this.duelVisualKey)
      || (snapshot.duel ? this.resourceZoneKey(snapshot.duel.enemyResourceZones) : "") !== this.duelVisualKey.split("|")[0];
    if (snapshot.mapTheme === this.currentMapTheme && !zonesChanged && !gridChanged && !missionChanged && !duelZonesChanged && !terrainChanged && this.scenery) return;
    this.currentMissionId = snapshot.missionId;
    this.currentMapRulesVersion = mapRulesVersion;
    this.currentGridSize = snapshot.gridSize;
    this.currentKeep = { ...snapshot.keep };
    if (gridChanged) this.setupTerrain(snapshot.gridSize);
    if (gridChanged && this.sun) {
      const extent = Math.max(16, snapshot.gridSize * TILE_SIZE * 0.72);
      this.sun.shadow.camera.left = -extent;
      this.sun.shadow.camera.right = extent;
      this.sun.shadow.camera.top = extent;
      this.sun.shadow.camera.bottom = -extent;
      this.sun.shadow.camera.updateProjectionMatrix();
    }
    this.currentMapTheme = snapshot.mapTheme;
    this.currentResourceZones = {
      lumber: { ...snapshot.resourceZones.lumber }, quarry: { ...snapshot.resourceZones.quarry },
      iron: { ...snapshot.resourceZones.iron }, fertile: { ...snapshot.resourceZones.fertile },
    };
    this.positionResourceZones();
    const colors = WORLD_COLORS[snapshot.mapTheme];
    this.scene.background = new THREE.Color(colors.sky);
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.set(colors.fog);
    this.landscape?.dispose();
    this.landscape = new DesertLandscape(snapshot.mapTheme, colors, !this.lowPower, snapshot.gridSize);
    this.groundMaterial = this.landscape.groundMaterial;
    this.world.add(this.landscape.group);
    if (snapshot.missionId === 'river' && mapRulesVersion === 2) {
      const decorativeWater = this.landscape.group.getObjectByName('turquoise-wadi');
      if (decorativeWater) decorativeWater.visible = false;
    }
    this.terrainLayer?.dispose();
    this.terrainLayer = new TerrainLayer(snapshot.missionId, mapRulesVersion);
    this.world.add(this.terrainLayer.group);
    if (this.scenery) {
      this.world.remove(this.scenery.group);
      this.scenery.dispose();
    }
    this.scenery = new WorldScenery(snapshot.mapTheme, snapshot.resourceZones, this.lowPower, snapshot.gridSize, snapshot.duel?.enemyResourceZones);
    this.world.add(this.scenery.group);
    if (gridChanged || missionChanged) {
      if (snapshot.duel && !isCompactLandscape(this.element.clientWidth || innerWidth, this.element.clientHeight || innerHeight)) {
        // Establish the scale of the full valley once, then leave navigation in
        // the player's hands. Both strongholds are visible on a wide display.
        const enemyKeep = snapshot.duel.enemyBuildings.find((building) => building.kind === "keep");
        const midpointGx = enemyKeep ? (snapshot.keep.gx + enemyKeep.gx) / 2 : snapshot.keep.gx;
        const midpointGz = enemyKeep ? (snapshot.keep.gz + enemyKeep.gz) / 2 : snapshot.keep.gz;
        this.cameraTarget.set(this.gridToWorld(midpointGx), 0, this.gridToWorld(midpointGz));
        this.cameraDistance = (this.element.clientWidth || innerWidth) > (this.element.clientHeight || innerHeight) ? 42 : 34;
      } else {
        this.resetCamera();
      }
      this.updateCamera();
    }
  }

  private resourceZoneKey(zones: GameSnapshot["resourceZones"]): string {
    return (["lumber", "quarry", "iron", "fertile"] as const)
      .map((key) => `${zones[key].gx}:${zones[key].gz}`).join(";");
  }

  private syncDuelVisuals(duel: DuelSnapshot | null): void {
    const key = duel
      ? `${this.resourceZoneKey(duel.enemyResourceZones)}|${duel.neutralZone.minGx}:${duel.neutralZone.maxGx}:${duel.neutralZone.minGz}:${duel.neutralZone.maxGz}:${this.currentGridSize}|${duel.friendly ? "friendly" : "hostile"}`
      : "";
    if (key === this.duelVisualKey) return;
    this.duelVisualKey = key;
    if (this.neutralZoneVisual) disposeEntity(this.neutralZoneVisual);
    if (this.enemyResourceMarkers) disposeEntity(this.enemyResourceMarkers);
    this.neutralZoneVisual = null;
    this.enemyResourceMarkers = null;
    if (!duel || duel.friendly) return;

    const zone = duel.neutralZone;
    const minX = this.gridToWorld(zone.minGx) - TILE_SIZE / 2;
    const maxX = this.gridToWorld(zone.maxGx) + TILE_SIZE / 2;
    const minZ = this.gridToWorld(zone.minGz) - TILE_SIZE / 2;
    const maxZ = this.gridToWorld(zone.maxGz) + TILE_SIZE / 2;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const neutral = new THREE.Group();
    neutral.name = "duel-neutral-no-build-zone";
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshStandardMaterial({
        color: "#bba77f", roughness: 1, transparent: true, opacity: 0.24,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
      }),
    );
    field.rotation.x = -Math.PI / 2;
    field.position.set((minX + maxX) / 2, 0.012, (minZ + maxZ) / 2);
    field.receiveShadow = true;
    neutral.add(field);
    const boundaryMaterial = new THREE.MeshBasicMaterial({ color: "#8b7655", transparent: true, opacity: 0.52, depthWrite: false });
    for (const x of [minX + 0.045, maxX - 0.045]) {
      const boundary = new THREE.Mesh(new THREE.PlaneGeometry(0.09, depth), boundaryMaterial);
      boundary.rotation.x = -Math.PI / 2;
      boundary.position.set(x, 0.03, (minZ + maxZ) / 2);
      neutral.add(boundary);
    }
    const stripeMaterial = new THREE.MeshBasicMaterial({ color: "#efe2bb", transparent: true, opacity: 0.18, depthWrite: false });
    const stripeCount = Math.max(5, Math.floor(depth / 3.2));
    for (let index = 0; index < stripeCount; index += 1) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.82, 0.055), stripeMaterial);
      stripe.rotation.x = -Math.PI / 2;
      stripe.rotation.z = -0.35;
      stripe.position.set((minX + maxX) / 2, 0.027, minZ + (index + 0.5) * depth / stripeCount);
      neutral.add(stripe);
    }
    this.neutralZoneVisual = neutral;
    this.world.add(neutral);

    const markers = new THREE.Group();
    markers.name = "enemy-resource-markers";
    const definitions = [
      ["lumber", "ЛЕС", "#b95b50"], ["quarry", "КАМЕНЬ", "#b95b50"],
      ["iron", "ЖЕЛЕЗО", "#b95b50"], ["fertile", "ПОЧВА", "#b95b50"],
    ] as const;
    for (const [kind, label, color] of definitions) {
      const marker = this.createResourceMarker(0, 0, label, color);
      marker.name = `enemy-${kind}-resource-marker`;
      const cell = duel.enemyResourceZones[kind];
      marker.position.set(this.gridToWorld(cell.gx), 0, this.gridToWorld(cell.gz));
      marker.scale.setScalar(0.88);
      markers.add(marker);
    }
    this.enemyResourceMarkers = markers;
    this.world.add(markers);
  }

  private createResourceMarker(x: number, z: number, label: string, color: string): THREE.Group {
    const marker = new THREE.Group();
    marker.position.set(x, 0, z);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.67, 0.7, 40),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.38, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.075;
    marker.add(ring);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 72;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "rgba(250, 245, 229, 0.96)";
    context.beginPath();
    context.roundRect(5, 5, 246, 62, 20);
    context.fill();
    context.strokeStyle = "rgba(93, 86, 62, 0.14)";
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = color;
    context.beginPath();
    context.arc(29, 36, 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#484738";
    context.font = "700 36px Manrope, system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 139, 37);
    const labelTexture = new THREE.CanvasTexture(canvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    labelTexture.userData.entityOwned = true;
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: true }));
    sign.position.set(0.15, 0.27, 0.82);
    sign.scale.set(1.56, 0.44, 1);
    sign.renderOrder = 3;
    marker.add(sign);
    return marker;
  }

  private syncBuildings(buildings: readonly BuildingState[], paused: boolean): void {
    const ids = new Set(buildings.map((building) => building.id));
    const connectorCells = new Set(
      buildings
        .filter((building) => ["wall", "gate", "tower"].includes(building.kind as string))
        .map((building) => `${building.gx}:${building.gz}`),
    );
    const visibleWallHealthBars = this.getVisibleWallHealthBars(buildings);
    for (const [id, mesh] of this.buildingMeshes) {
      if (!ids.has(id)) {
        disposeEntity(mesh);
        this.buildingMeshes.delete(id);
      }
    }
    for (const building of buildings) {
      let group = this.buildingMeshes.get(building.id);
      const rebuildForKind = group && group.userData.buildingKind !== building.kind;
      if (!group || rebuildForKind) {
        const wasVisible = Boolean(group);
        if (group) disposeEntity(group);
        group = this.createBuilding(building.kind);
        group.position.set(this.gridToWorld(building.gx), 0, this.gridToWorld(building.gz));
        // Construction is allowed while planning; the new model must not wait for an unpaused animation.
        group.scale.setScalar(wasVisible || paused ? 1 : 0.01);
        group.userData.spawn = wasVisible || paused ? 1 : 0;
        group.userData.buildingKind = building.kind;
        this.world.add(group);
        this.buildingMeshes.set(building.id, group);
      }
      group.userData.buildingId = building.id;
      group.position.x = this.gridToWorld(building.gx);
      group.position.z = this.gridToWorld(building.gz);
      const hpRatio = building.hp / building.maxHp;
      group.userData.hpRatio = hpRatio;
      const isWall = (building.kind as string) === "wall";
      updateHealthBar(group, hpRatio, isWall ? visibleWallHealthBars.has(building.id) : undefined);
      if (isWall) {
        const mask =
          (connectorCells.has(`${building.gx}:${building.gz - 1}`) ? 1 : 0) |
          (connectorCells.has(`${building.gx + 1}:${building.gz}`) ? 2 : 0) |
          (connectorCells.has(`${building.gx}:${building.gz + 1}`) ? 4 : 0) |
          (connectorCells.has(`${building.gx - 1}:${building.gz}`) ? 8 : 0);
        if (group.userData.wallMask !== mask) this.updateWallTopology(group, mask);
      } else if ((building.kind as string) === "gate") {
        const northSouth = Number(connectorCells.has(`${building.gx}:${building.gz - 1}`)) + Number(connectorCells.has(`${building.gx}:${building.gz + 1}`));
        const eastWest = Number(connectorCells.has(`${building.gx - 1}:${building.gz}`)) + Number(connectorCells.has(`${building.gx + 1}:${building.gz}`));
        group.rotation.y = northSouth > eastWest ? Math.PI / 2 : 0;
      }
      if (building.kind === "tower") this.syncTowerWeapon(group, building.towerUpgrade ?? "none", false);
    }
  }

  private syncEnemyBuildings(buildings: readonly BuildingState[], paused: boolean, friendly: boolean): void {
    const ids = new Set(buildings.map((building) => building.id));
    const connectorCells = new Set(
      buildings.filter((building) => ["wall", "gate", "tower"].includes(building.kind))
        .map((building) => `${building.gx}:${building.gz}`),
    );
    const visibleWallHealthBars = this.getVisibleWallHealthBars(buildings);
    for (const [id, mesh] of this.enemyBuildingMeshes) {
      if (ids.has(id)) continue;
      this.spawnDust(mesh.position);
      disposeEntity(mesh);
      this.enemyBuildingMeshes.delete(id);
    }
    for (const building of buildings) {
      let group = this.enemyBuildingMeshes.get(building.id);
      if (!group || group.userData.buildingKind !== building.kind || Boolean(group.userData.friendly) !== friendly) {
        const wasVisible = Boolean(group);
        if (group) disposeEntity(group);
        group = friendly ? this.createBuilding(building.kind) : this.createEnemyBuilding(building.kind);
        group.position.set(this.gridToWorld(building.gx), 0, this.gridToWorld(building.gz));
        group.scale.setScalar(wasVisible || paused ? 1 : 0.01);
        group.userData.spawn = wasVisible || paused ? 1 : 0;
        group.userData.buildingKind = building.kind;
        group.userData.enemy = !friendly;
        group.userData.friendly = friendly;
        if (friendly) group.name = `${BUILDINGS[building.kind].name} дружественного города`;
        this.world.add(group);
        this.enemyBuildingMeshes.set(building.id, group);
      }
      if (friendly) delete group.userData.enemyBuildingId;
      else group.userData.enemyBuildingId = building.id;
      group.position.set(this.gridToWorld(building.gx), 0, this.gridToWorld(building.gz));
      const hpRatio = building.hp / building.maxHp;
      group.userData.hpRatio = hpRatio;
      const isWall = building.kind === "wall";
      updateHealthBar(group, hpRatio, isWall ? visibleWallHealthBars.has(building.id) : undefined);
      if (isWall) {
        const mask =
          (connectorCells.has(`${building.gx}:${building.gz - 1}`) ? 1 : 0) |
          (connectorCells.has(`${building.gx + 1}:${building.gz}`) ? 2 : 0) |
          (connectorCells.has(`${building.gx}:${building.gz + 1}`) ? 4 : 0) |
          (connectorCells.has(`${building.gx - 1}:${building.gz}`) ? 8 : 0);
        if (group.userData.wallMask !== mask) this.updateWallTopology(group, mask);
      } else if (building.kind === "gate") {
        const northSouth = Number(connectorCells.has(`${building.gx}:${building.gz - 1}`)) + Number(connectorCells.has(`${building.gx}:${building.gz + 1}`));
        const eastWest = Number(connectorCells.has(`${building.gx - 1}:${building.gz}`)) + Number(connectorCells.has(`${building.gx + 1}:${building.gz}`));
        group.rotation.y = northSouth > eastWest ? Math.PI / 2 : 0;
      }
      if (building.kind === "tower") this.syncTowerWeapon(group, building.towerUpgrade ?? "none", !friendly);
    }
  }

  private syncTowerWeapon(group: THREE.Group, upgrade: BuildingState["towerUpgrade"], enemy: boolean): void {
    const previous = group.getObjectByName("tower-weapon") as THREE.Group | undefined;
    const previousKind = previous?.userData.towerUpgrade as BuildingState["towerUpgrade"] | undefined;
    if (!previous && (!upgrade || upgrade === "none")) return;
    if (previousKind === upgrade) return;
    if (previous) disposeEntity(previous);
    if (!upgrade || upgrade === "none") return;
    group.add(createTowerWeapon(upgrade, enemy));
  }

  /** Keep dense battlements readable: one damage meter per contiguous damaged section. */
  private getVisibleWallHealthBars(buildings: readonly BuildingState[]): Set<number> {
    const damaged = new Map<string, BuildingState>();
    for (const building of buildings) {
      if ((building.kind as string) === "wall" && building.hp / building.maxHp < 0.995) {
        damaged.set(`${building.gx}:${building.gz}`, building);
      }
    }
    const visible = new Set<number>();
    const visited = new Set<string>();
    for (const [startKey, start] of damaged) {
      if (visited.has(startKey)) continue;
      const queue = [start];
      let representative = start;
      visited.add(startKey);
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        if (current.hp / current.maxHp < representative.hp / representative.maxHp) representative = current;
        for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const key = `${current.gx + dx}:${current.gz + dz}`;
          const neighbour = damaged.get(key);
          if (!neighbour || visited.has(key)) continue;
          visited.add(key);
          queue.push(neighbour);
        }
      }
      visible.add(representative.id);
    }
    return visible;
  }

  private updateWallTopology(group: THREE.Group, mask: number): void {
    const previous = group.getObjectByName("wall-topology");
    if (previous) {
      previous.traverse((node) => {
        if (node instanceof THREE.Mesh) node.geometry.dispose();
      });
      group.remove(previous);
    }

    const materials = group.userData.enemy ? this.enemyWallMaterials : this.wallMaterials;
    const topology = createWallTopology(mask, materials, { lowPower: this.lowPower });
    const healthBar = group.userData.healthBar as THREE.Group | undefined;
    if (healthBar) healthBar.position.y = WALL_HEALTH_BAR_HEIGHT;
    group.add(topology);
    group.userData.wallMask = mask;
  }

  private syncRaiders(raiders: readonly RaiderState[], paused: boolean): void {
    const ids = new Set(raiders.map((raider) => raider.id));
    const visibleHealthBars = this.getVisibleRaiderHealthBars(raiders);
    for (const [id, mesh] of this.raiderMeshes) {
      if (!ids.has(id)) {
        this.spawnDust(mesh.position);
        disposeEntity(mesh);
        this.raiderMeshes.delete(id);
      }
    }
    for (const raider of raiders) {
      let group = this.raiderMeshes.get(raider.id);
      const unitKind = raider.kind ?? "raider";
      if (group && group.userData.unitKind !== unitKind) {
        disposeEntity(group);
        this.raiderMeshes.delete(raider.id);
        group = undefined;
      }
      if (group && paused) continue;
      if (!group) {
        group = this.createEnemyUnit(unitKind, raider.elite);
        this.world.add(group);
        this.raiderMeshes.set(raider.id, group);
      }
      const targetX = this.gridToWorld(raider.x);
      const targetZ = this.gridToWorld(raider.z);
      const dx = targetX - group.position.x;
      const dz = targetZ - group.position.z;
      if (Number.isFinite(raider.heading)) group.rotation.y = raider.heading!;
      else if (Math.abs(dx) + Math.abs(dz) > 0.001) group.rotation.y = Math.atan2(dx, dz);
      group.position.x = targetX;
      group.position.z = targetZ;
      const hpRatio = raider.hp / raider.maxHp;
      group.userData.hpRatio = hpRatio;
      group.userData.moving = Math.abs(dx) + Math.abs(dz) > 0.001;
      group.userData.inCombat = Boolean(raider.attacking) || !group.userData.moving;
      group.userData.attackPulse = raider.attackPulse ?? 0;
      updateHealthBar(group, hpRatio, visibleHealthBars.has(raider.id));
    }
  }

  private getVisibleRaiderHealthBars(raiders: readonly RaiderState[]): Set<number> {
    const damaged = raiders.filter((raider) => raider.hp / raider.maxHp < 0.995);
    const visible = new Set<number>();
    const visited = new Set<number>();
    for (const start of damaged) {
      if (visited.has(start.id)) continue;
      const queue = [start];
      let representative = start;
      visited.add(start.id);
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        if (current.hp / current.maxHp < representative.hp / representative.maxHp) representative = current;
        for (const neighbour of damaged) {
          if (visited.has(neighbour.id)) continue;
          if (Math.hypot(neighbour.x - current.x, neighbour.z - current.z) > 1.1) continue;
          visited.add(neighbour.id);
          queue.push(neighbour);
        }
      }
      visible.add(representative.id);
    }
    return visible;
  }

  private syncArmy(army: readonly ArmyUnitState[], paused: boolean): void {
    const ids = new Set(army.map((unit) => unit.id));
    for (const [id, mesh] of this.armyMeshes) {
      if (!ids.has(id)) {
        this.spawnDust(mesh.position);
        disposeEntity(mesh);
        this.armyMeshes.delete(id);
        this.selectedArmyIds.delete(id);
      }
    }
    for (const unit of army) {
      let group = this.armyMeshes.get(unit.id);
      if (!group) {
        group = this.createArmyUnit(unit.kind);
        group.userData.armyUnitId = unit.id;
        group.position.set(this.gridToWorld(unit.x), 0, this.gridToWorld(unit.z));
        this.world.add(group);
        this.armyMeshes.set(unit.id, group);
      }
      const garrisonHeight = unit.garrison
        ? unit.garrison.deckY * unit.garrison.transition
        : 0;
      const targetX = this.gridToWorld(unit.x);
      const targetZ = this.gridToWorld(unit.z);
      const dx = targetX - group.position.x;
      const dz = targetZ - group.position.z;
      group.position.x = targetX;
      group.position.y = garrisonHeight;
      group.position.z = targetZ;
      if (!paused) {
        if (Number.isFinite(unit.heading)) group.rotation.y = unit.heading;
        else if (Math.abs(dx) + Math.abs(dz) > 0.001) group.rotation.y = Math.atan2(dx, dz);
        group.userData.moving = unit.movement !== "idle" || Math.abs(dx) + Math.abs(dz) > 0.001;
      }
      const hpRatio = unit.hp / unit.maxHp;
      group.userData.hpRatio = hpRatio;
      group.userData.inCombat = unit.attacking || unit.targetId !== null;
      group.userData.attackPulse = unit.attackPulse;
      group.userData.garrisonBuildingId = unit.garrison?.buildingId ?? null;
      group.userData.garrisonStatus = unit.garrison?.status ?? null;
      group.userData.garrisonTransition = unit.garrison?.transition ?? 0;
      group.userData.dancing = false;
      updateHealthBar(group, hpRatio);
      this.applyArmyRingState(unit.id, group);
    }
  }

  private syncDirectControl(snapshot: GameSnapshot, delta: number): void {
    this.restoreDirectCameraAllyVisibility();
    const nextId = snapshot.directControl?.entityId ?? null;
    const nextKind = snapshot.directControl?.entityKind ?? null;
    if (nextId === null) {
      const previousId = this.directControlUnitId;
      const previousKind = this.directControlEntityKind;
      if (this.thirdPersonRig.active) this.thirdPersonRig.exit();
      this.restoreDirectCameraCutaways();
      this.directControlUnitId = null;
      this.directControlEntityKind = null;
      if (previousId !== null && previousKind) this.refreshEntityRing(previousKind, previousId);
      return;
    }
    const entity = nextKind === "civilian"
      ? snapshot.civilianEntities.find((candidate) => candidate.id === nextId)
      : snapshot.army.find((candidate) => candidate.id === nextId);
    const group = nextKind === "civilian" ? this.villagerMeshes.get(nextId) : this.armyMeshes.get(nextId);
    if (!nextKind || !entity || !group) {
      if (this.thirdPersonRig.active) this.thirdPersonRig.exit();
      this.restoreDirectCameraCutaways();
      this.directControlUnitId = null;
      this.directControlEntityKind = null;
      return;
    }
    const pose = {
      position: { x: group.position.x, y: group.position.y, z: group.position.z },
      heading: entity.heading,
    };
    if (!this.thirdPersonRig.active || this.directControlUnitId !== nextId || this.directControlEntityKind !== nextKind) {
      const previousId = this.directControlUnitId;
      const previousKind = this.directControlEntityKind;
      this.thirdPersonRig.enter(pose);
      this.directControlUnitId = nextId;
      this.directControlEntityKind = nextKind;
      if (previousId !== null && previousKind && (previousId !== nextId || previousKind !== nextKind)) {
        this.refreshEntityRing(previousKind, previousId);
      }
    }
    else this.thirdPersonRig.update(Math.min(0.05, Math.max(0, delta)), pose);
    this.directControlUnitId = nextId;
    this.directControlEntityKind = nextKind;
    group.userData.dancing = Boolean(snapshot.directControl?.dancing);
    this.refreshEntityRing(nextKind, nextId);
    this.hideCrowdingAllies(group);
    this.resolveDirectCameraOcclusion(group);
  }

  private hideCrowdingAllies(controlled: THREE.Group): void {
    for (const candidate of [...this.armyMeshes.values(), ...this.villagerMeshes.values()]) {
      if (candidate === controlled || !candidate.visible) continue;
      if (Math.hypot(candidate.position.x - controlled.position.x, candidate.position.z - controlled.position.z) > 0.44) continue;
      candidate.visible = false;
      this.directCameraHiddenAllies.add(candidate);
    }
  }

  private restoreDirectCameraAllyVisibility(): void {
    for (const ally of this.directCameraHiddenAllies) ally.visible = true;
    this.directCameraHiddenAllies.clear();
  }

  private resolveDirectCameraOcclusion(controlled: THREE.Group): void {
    this.restoreDirectCameraCutaways();
    const camera = this.thirdPersonRig.camera;
    const anchor = this.directCameraAnchor.copy(controlled.position);
    anchor.y += controlled.userData.unitKind === "knight" ? 0.56 : HUMAN_RELEASE_HEIGHT;
    const direction = this.directCameraDirection.copy(camera.position).sub(anchor);
    const desiredDistance = direction.length();
    if (desiredDistance <= 0.001) return;
    direction.multiplyScalar(1 / desiredDistance);
    this.directCameraRaycaster.set(anchor, direction);
    this.directCameraRaycaster.near = 0.12;
    this.directCameraRaycaster.far = desiredDistance;
    const collisionMeshes: THREE.Mesh[] = [];
    const buildingByMesh = new Map<THREE.Mesh, THREE.Group>();
    const protectedBuildingId = typeof controlled.userData.garrisonBuildingId === "number"
      ? controlled.userData.garrisonBuildingId as number
      : null;
    for (const building of [...this.buildingMeshes.values(), ...this.enemyBuildingMeshes.values()]) {
      if (protectedBuildingId !== null && building.userData.buildingId === protectedBuildingId) continue;
      building.traverse((node) => {
        if (node instanceof THREE.Mesh && node.visible) {
          collisionMeshes.push(node);
          buildingByMesh.set(node, building);
        }
      });
    }
    let availableMeshes = collisionMeshes;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const obstruction = this.directCameraRaycaster.intersectObjects(availableMeshes, false)[0];
      if (!obstruction) return;
      const safeDistance = Math.max(0.28, obstruction.distance - 0.24);
      // A very short follow arm makes mobile framing dive behind parapets and
      // crowds the avatar. Keep a useful over-shoulder distance; tighter
      // obstructions use a temporary castle cutaway instead.
      if (safeDistance >= 2.35) {
        camera.position.copy(anchor).addScaledVector(direction, safeDistance);
        camera.position.y = Math.max(camera.position.y, anchor.y + 0.65);
        camera.updateMatrixWorld(true);
        return;
      }
      const blockingBuilding = obstruction.object instanceof THREE.Mesh
        ? buildingByMesh.get(obstruction.object)
        : undefined;
      if (!blockingBuilding || this.directCameraHiddenBuildings.has(blockingBuilding)) return;
      blockingBuilding.visible = false;
      this.directCameraHiddenBuildings.add(blockingBuilding);
      availableMeshes = availableMeshes.filter((mesh) => buildingByMesh.get(mesh) !== blockingBuilding);
    }
  }

  private restoreDirectCameraCutaways(): void {
    for (const building of this.directCameraHiddenBuildings) building.visible = true;
    this.directCameraHiddenBuildings.clear();
  }

  private applyArmyRingState(id: number, group: THREE.Group): void {
    const ring = group.userData.allyRing as THREE.Mesh | undefined;
    if (!ring) return;
    const material = ring.material as THREE.MeshBasicMaterial;
    const controlled = this.directControlEntityKind === "army" && id === this.directControlUnitId;
    const selected = this.selectedArmyIds.has(id);
    material.color.set(controlled ? "#ffd26c" : selected ? "#c8fff4" : "#63d1cf");
    material.opacity = 0.56;
    ring.renderOrder = controlled ? 8 : selected ? 7 : 4;
  }

  private applyCivilianRingState(id: number, group: THREE.Group): void {
    const ring = group.userData.allyRing as THREE.Mesh | undefined;
    if (!ring) return;
    const material = ring.material as THREE.MeshBasicMaterial;
    const controlled = this.directControlEntityKind === "civilian" && id === this.directControlUnitId;
    const selected = id === this.selectedCivilianId;
    material.color.set(controlled ? "#ffd26c" : "#c8fff4");
    material.opacity = controlled ? 0.82 : selected ? 0.66 : 0;
    ring.renderOrder = controlled ? 8 : selected ? 7 : 3;
  }

  private refreshEntityRing(kind: ControllableEntityKind, id: number): void {
    if (kind === "civilian") {
      const group = this.villagerMeshes.get(id);
      if (group) this.applyCivilianRingState(id, group);
      return;
    }
    const group = this.armyMeshes.get(id);
    if (group) this.applyArmyRingState(id, group);
  }

  private syncRallyPoint(snapshot: GameSnapshot): void {
    this.rallyMarker.visible = snapshot.status !== "title" && snapshot.armyCount > 0;
    this.rallyMarker.position.x = this.gridToWorld(snapshot.rallyPoint.gx);
    this.rallyMarker.position.z = this.gridToWorld(snapshot.rallyPoint.gz);
  }

  private syncResourceMarkerVisibility(snapshot: GameSnapshot): void {
    const tactical = snapshot.directControl === null;
    if (this.enemyResourceMarkers) this.enemyResourceMarkers.visible = tactical;
    if (this.woodResourceMarker) this.woodResourceMarker.visible = tactical;
    if (this.stoneResourceMarker) this.stoneResourceMarker.visible = tactical;
    if (this.ironResourceMarker) this.ironResourceMarker.visible = tactical;
    if (this.fertileResourceMarker) {
      const cultivated = snapshot.buildings.some((building) =>
        building.gx === snapshot.resourceZones.fertile.gx && building.gz === snapshot.resourceZones.fertile.gz);
      this.fertileResourceMarker.visible = tactical && !cultivated;
    }
  }

  private createRallyMarker(): THREE.Group {
    const marker = new THREE.Group();
    marker.name = "army-rally-marker";
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.48, 28),
      new THREE.MeshBasicMaterial({ color: "#75d8d1", side: THREE.DoubleSide, transparent: true, opacity: 0.62, depthWrite: false }),
    );
    ring.name = "rally-ring";
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.055;
    marker.add(ring);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.025, 0.94, 6),
      new THREE.MeshStandardMaterial({ color: "#413127", roughness: 1 }),
    );
    pole.position.set(0, 0.49, 0);
    marker.add(pole);
    const pennantGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.48, -0.14, 0),
      new THREE.Vector3(0, -0.28, 0),
    ]);
    pennantGeometry.setIndex([0, 1, 2]);
    pennantGeometry.computeVertexNormals();
    const pennant = new THREE.Mesh(
      pennantGeometry,
      new THREE.MeshStandardMaterial({ color: "#2f8586", side: THREE.DoubleSide, roughness: 0.82 }),
    );
    pennant.name = "rally-pennant";
    pennant.position.set(0, 0.88, 0);
    marker.add(pennant);
    return marker;
  }

  private createArmyUnit(kind: ArmyUnitKind): THREE.Group {
    const siege = kind === "catapult" || kind === "batteringRam";
    const group = siege ? createSiegeEngine(kind, false) : createSoldier(kind);
    if (!siege) group.scale.multiplyScalar(HUMAN_WORLD_SCALE);
    group.traverse((node) => {
      if (node instanceof THREE.Mesh) node.castShadow = true;
    });

    const allyRing = new THREE.Mesh(
      new THREE.RingGeometry(siege ? 0.46 : kind === "knight" ? 0.38 : 0.27, siege ? 0.59 : kind === "knight" ? 0.49 : 0.37, 20),
      new THREE.MeshBasicMaterial({ color: "#63d1cf", side: THREE.DoubleSide, transparent: true, opacity: 0.56, depthWrite: false }),
    );
    allyRing.rotation.x = -Math.PI / 2;
    allyRing.position.y = 0.025;
    allyRing.renderOrder = 4;
    group.userData.allyRing = allyRing;
    group.userData.unitKind = kind;
    group.userData.healthTone = "ally";
    group.add(allyRing);
    addHealthBar(group, false);
    return group;
  }

  private syncVillagers(civilians: readonly CivilianState[], paused: boolean, dancingCivilianId: number | null): void {
    const capacity = this.lowPower ? 14 : 22;
    const controlledCivilianId = this.directControlEntityKind === "civilian" ? this.directControlUnitId : null;
    const importantIds = new Set([this.selectedCivilianId, controlledCivilianId].filter((id): id is number => id !== null));
    const visible = [...civilians]
      .sort((a, b) => Number(importantIds.has(b.id)) - Number(importantIds.has(a.id)) || a.id - b.id)
      .slice(0, capacity);
    const visibleIds = new Set(visible.map((civilian) => civilian.id));

    for (const [id, person] of this.villagerMeshes) {
      if (visibleIds.has(id)) continue;
      disposeEntity(person);
      this.villagerMeshes.delete(id);
    }

    for (const civilian of visible) {
      const profession = getVillagerProfession(civilian.jobKind ?? "resident");
      let person = this.villagerMeshes.get(civilian.id);
      if (!person || person.userData.profession !== profession) {
        const replacement = this.createCivilian(civilian, profession);
        if (person) {
          replacement.position.copy(person.position);
          replacement.rotation.copy(person.rotation);
          disposeEntity(person);
        }
        this.world.add(replacement);
        this.villagerMeshes.set(civilian.id, replacement);
        person = replacement;
      }
      person.visible = true;
      person.position.set(this.gridToWorld(civilian.x), 0.015, this.gridToWorld(civilian.z));
      person.rotation.y = civilian.heading;
      person.userData.moving = civilian.movement !== "idle";
      person.userData.activity = civilian.activity;
      person.userData.dancing = civilian.id === dancingCivilianId;
      if (!paused) {
        const toolWorking = civilian.activity === "working" && ["woodcutter", "mason", "blacksmith"].includes(profession);
        animateCharacter(person, this.elapsed, civilian.movement !== "idle", toolWorking, civilian.id === dancingCivilianId);
      }
      this.applyCivilianRingState(civilian.id, person);
    }
  }

  private createCivilian(civilian: CivilianState, profession: ReturnType<typeof getVillagerProfession>): THREE.Group {
    const person = createVillager(civilian.id, profession);
    person.scale.setScalar(HUMAN_WORLD_SCALE);
    person.userData.profession = profession;
    person.userData.civilianId = civilian.id;
    person.traverse((node) => {
      if (node instanceof THREE.Mesh) node.castShadow = true;
    });
    const allyRing = new THREE.Mesh(
      new THREE.RingGeometry(0.25, 0.35, 20),
      new THREE.MeshBasicMaterial({ color: "#c8fff4", side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false }),
    );
    allyRing.rotation.x = -Math.PI / 2;
    allyRing.position.y = 0.025;
    allyRing.renderOrder = 3;
    person.userData.allyRing = allyRing;
    person.add(allyRing);
    return person;
  }

  private updateAnimations(delta: number, snapshot: GameSnapshot): void {
    (this.highlight.material as THREE.MeshBasicMaterial).opacity = 0.34;
    // Freeze breathing, limbs, weapon swings, projectiles and flags, not just positions.
    // Camera and DOM controls are intentionally still interactive on a pause.
    if (snapshot.timePaused) return;
    for (const group of [...this.buildingMeshes.values(), ...this.enemyBuildingMeshes.values()]) {
      if (group.userData.spawn < 1) {
        group.userData.spawn = Math.min(1, group.userData.spawn + delta * 4.5);
        const scale = 1 - Math.pow(1 - group.userData.spawn, 3);
        group.scale.setScalar(scale);
      }
      const hpRatio = group.userData.hpRatio as number;
      group.rotation.z = hpRatio < 0.35 ? Math.sin(this.elapsed * 4) * 0.008 : 0;
      const banner = group.getObjectByName("enemy-banner-cloth") ?? group.getObjectByName("banner-cloth");
      if (banner) banner.rotation.y = Math.sin(this.elapsed * 2.15 + group.id * 0.17) * 0.09;
      const sails = group.getObjectByName("mill-sails");
      if (sails && group.userData.isOperating) sails.rotation.z -= delta * 0.62;
      const towerWeapon = group.getObjectByName("tower-weapon");
      if (towerWeapon) towerWeapon.rotation.y = Math.sin(this.elapsed * 0.34 + group.id) * 0.34;
    }

    for (const [index, group] of [...this.raiderMeshes.values()].entries()) {
      if (group.userData.siegeEngine) this.animateSiegeEngine(group, delta);
      else animateCharacter(group, this.elapsed, Boolean(group.userData.moving), Boolean(group.userData.inCombat));
      const hostileRing = group.userData.hostileRing as THREE.Mesh | undefined;
      if (hostileRing) {
        const pulse = 1 + Math.sin(this.elapsed * 4.2 + index * 0.7) * 0.08;
        hostileRing.scale.setScalar(pulse);
        (hostileRing.material as THREE.MeshBasicMaterial).opacity = 0.68 + Math.sin(this.elapsed * 4.2 + index) * 0.12;
      }
    }

    for (const [index, [id, group]] of [...this.armyMeshes.entries()].entries()) {
      if (group.userData.siegeEngine) this.animateSiegeEngine(group, delta);
      else animateCharacter(group, this.elapsed, Boolean(group.userData.moving), Boolean(group.userData.inCombat), Boolean(group.userData.dancing));
      const allyRing = group.userData.allyRing as THREE.Mesh | undefined;
      if (allyRing) {
        const engaged = Boolean(group.userData.inCombat);
        const controlled = id === this.directControlUnitId;
        const selected = this.selectedArmyIds.has(id);
        const pulse = controlled ? 1.18 + Math.sin(this.elapsed * 5.6) * 0.08
          : selected ? 1.1 + Math.sin(this.elapsed * 4.2 + index) * 0.04
            : engaged ? 1 + Math.sin(this.elapsed * 5.2 + index) * 0.09 : 1;
        allyRing.scale.setScalar(pulse);
        (allyRing.material as THREE.MeshBasicMaterial).opacity = controlled ? 0.96 : selected ? 0.86 : engaged ? 0.74 : 0.48;
      }
    }

    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      if (projectile.ballistic) {
        const flightSeconds = Math.max(0.001, projectile.ballistic.flightSeconds);
        if (projectile.elapsed < flightSeconds) {
          projectile.elapsed = Math.min(flightSeconds, projectile.elapsed + delta);
          const t = projectile.elapsed / flightSeconds;
          projectile.mesh.position.lerpVectors(projectile.start, projectile.end, t);
          projectile.mesh.position.y = projectile.start.y
            + projectile.ballistic.initialVelocityY * projectile.elapsed
            - 0.5 * projectile.ballistic.gravity * projectile.elapsed ** 2;
          const velocity = new THREE.Vector3(
            (projectile.end.x - projectile.start.x) / flightSeconds,
            projectile.ballistic.initialVelocityY - projectile.ballistic.gravity * projectile.elapsed,
            (projectile.end.z - projectile.start.z) / flightSeconds,
          );
          this.orientProjectile(projectile.mesh, velocity);
          continue;
        }
        projectile.mesh.position.copy(projectile.end);
        this.orientProjectile(projectile.mesh, new THREE.Vector3(
          projectile.end.x - projectile.start.x,
          0.04,
          projectile.end.z - projectile.start.z,
        ));
        projectile.landedFor += delta;
        if (projectile.landedFor >= projectile.ballistic.lingerSeconds) {
          this.world.remove(projectile.mesh);
          this.projectiles.splice(index, 1);
        }
        continue;
      }
      projectile.progress += delta * 3.4;
      const t = Math.min(1, projectile.progress);
      projectile.mesh.position.lerpVectors(projectile.start, projectile.end, t);
      projectile.mesh.position.y += Math.sin(t * Math.PI) * 1.8;
      this.orientProjectile(projectile.mesh, new THREE.Vector3(
        projectile.end.x - projectile.start.x,
        Math.cos(t * Math.PI) * 1.8,
        projectile.end.z - projectile.start.z,
      ));
      if (t >= 1) {
        this.world.remove(projectile.mesh);
        this.projectiles.splice(index, 1);
      }
    }

    for (let index = this.dustEffects.length - 1; index >= 0; index -= 1) {
      const dust = this.dustEffects[index];
      dust.progress += delta * 2;
      const t = Math.min(1, dust.progress);
      dust.mesh.scale.setScalar(1 + t * 3);
      dust.material.opacity = Math.max(0, 0.42 * (1 - t));
      if (t >= 1) {
        this.world.remove(dust.mesh);
        dust.material.dispose();
        this.dustEffects.splice(index, 1);
      }
    }

    this.selectionRing.rotation.z = this.elapsed * 0.22;
    if (this.rallyMarker.visible) {
      const rallyRing = this.rallyMarker.getObjectByName("rally-ring");
      if (rallyRing) {
        rallyRing.rotation.z = this.elapsed * 0.52;
        const pulse = 1 + Math.sin(this.elapsed * 3.1) * 0.07;
        rallyRing.scale.setScalar(pulse);
      }
      const pennant = this.rallyMarker.getObjectByName("rally-pennant");
      if (pennant) pennant.rotation.y = Math.sin(this.elapsed * 2.4) * 0.12;
    }
    if (this.placementGhost?.visible) {
      this.placementGhost.position.y = 0.08 + Math.sin(this.elapsed * 3.4) * 0.025;
      this.placementLineMaterial.opacity = 0.86 + Math.sin(this.elapsed * 4.1) * 0.12;
    }
  }

  private orientProjectile(mesh: THREE.Mesh, velocity: THREE.Vector3): void {
    if (velocity.lengthSq() <= 1e-8) return;
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), velocity.normalize());
  }

  private animateSiegeEngine(group: THREE.Group, delta: number): void {
    const moving = Boolean(group.userData.moving);
    const wheelTurn = (group.userData.wheelTurn as number | undefined ?? 0) + (moving ? delta * 6.2 : 0);
    group.userData.wheelTurn = wheelTurn;
    group.traverse((node) => {
      if (node.name === "siege-wheel") node.rotation.x = wheelTurn;
    });
    const attackPulse = group.userData.attackPulse as number | undefined ?? 0;
    if (group.userData.lastAnimatedAttackPulse !== attackPulse) {
      group.userData.lastAnimatedAttackPulse = attackPulse;
      group.userData.siegeAttackTime = 0;
    }
    const attackTime = Math.min(0.7, (group.userData.siegeAttackTime as number | undefined ?? 0.7) + delta);
    group.userData.siegeAttackTime = attackTime;
    const action = Math.sin(Math.min(1, attackTime / 0.7) * Math.PI);
    const arm = group.getObjectByName("catapult-arm-pivot");
    if (arm) arm.rotation.x = -0.55 + action * 0.92;
    const ram = group.getObjectByName("ram-log");
    if (ram) ram.position.z = -0.12 - action * 0.24;
  }

  /** The blueprint uses the exact same architecture as the finished building. */
  private createPlacementGhost(kind: BuildingKind): THREE.Group {
    const group = new THREE.Group();
    group.name = `placement-preview-${kind}`;
    group.visible = false;
    const addShape = (geometry: THREE.BufferGeometry): void => {
      const mesh = new THREE.Mesh(geometry, this.placementFillMaterial);
      mesh.renderOrder = 30;
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 32), this.placementLineMaterial);
      outline.renderOrder = 31;
      mesh.add(outline);
      group.add(mesh);
    };
    const source = createWorldBuilding(kind, false);
    if (!source) return group;
    source.updateMatrixWorld(true);
    source.traverse((node) => {
      if (node instanceof THREE.Mesh) addShape(node.geometry.clone().applyMatrix4(node.matrixWorld));
    });
    disposeEntity(source);

    return group;
  }

  private disposePlacementGhost(): void {
    if (!this.placementGhost) return;
    this.world.remove(this.placementGhost);
    this.placementGhost.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.LineSegments) node.geometry.dispose();
    });
    this.placementGhost = null;
    this.placementGhostKind = null;
  }

  private createBuilding(kind: BuildingKind): THREE.Group {
    const group = kind === "wall" ? new THREE.Group() : createWorldBuilding(kind, true);
    if (!group) throw new Error(`Missing original architecture: ${kind}`);
    if (kind === "wall") group.userData.wallMask = -1;
    group.name = BUILDINGS[kind].name;
    addHealthBar(group, false);
    return group;
  }

  private createEnemyBuilding(kind: BuildingKind): THREE.Group {
    const group = kind === "wall" ? new THREE.Group() : createWorldBuilding(kind, true);
    if (!group) throw new Error(`Missing rival architecture: ${kind}`);
    group.userData.enemy = true;
    group.userData.healthTone = "enemy";
    if (kind === "wall") group.userData.wallMask = -1;
    const materialClones = new Map<THREE.Material, THREE.Material>();
    group.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const tint = (source: THREE.Material): THREE.Material => {
        let clone = materialClones.get(source);
        if (clone) return clone;
        clone = source.clone();
        clone.userData = { ...clone.userData, shared: false };
        if (clone instanceof THREE.MeshStandardMaterial) {
          if (source.name.includes("glaze")) clone.color.set("#f18476");
          else if (source.name.includes("stone")) clone.color.set("#ffe3dc");
        }
        materialClones.set(source, clone);
        return clone;
      };
      node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material);
    });
    if (kind !== "wall") {
      const territoryRing = new THREE.Mesh(
        new THREE.RingGeometry(kind === "keep" ? 0.96 : 0.68, kind === "keep" ? 1.08 : 0.76, 32),
        new THREE.MeshBasicMaterial({ color: "#bd4f47", side: THREE.DoubleSide, transparent: true, opacity: 0.42, depthWrite: false }),
      );
      territoryRing.name = "enemy-building-ring";
      territoryRing.rotation.x = -Math.PI / 2;
      territoryRing.position.y = 0.018;
      group.add(territoryRing);
    }
    if (["keep", "tower", "gate"].includes(kind)) group.add(this.createEnemyPennant(kind === "keep" ? (group.userData.modelHeight as number) - 0.12 : 1.72));
    group.name = `${BUILDINGS[kind].name} соперника`;
    addHealthBar(group, false);
    return group;
  }

  private createEnemyPennant(height: number): THREE.Group {
    const pennant = new THREE.Group();
    pennant.name = "enemy-pennant";
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.021, 0.82, 6),
      new THREE.MeshStandardMaterial({ color: "#3d302b", roughness: 0.94 }),
    );
    pole.position.y = height;
    pennant.add(pole);
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.53, -0.14, 0), new THREE.Vector3(0, -0.28, 0),
    ]);
    geometry.setIndex([0, 1, 2]);
    geometry.computeVertexNormals();
    const cloth = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: "#b7433e", side: THREE.DoubleSide, roughness: 0.84 }),
    );
    cloth.name = "enemy-banner-cloth";
    cloth.position.set(0, height + 0.36, 0);
    pennant.add(cloth);
    return pennant;
  }

  private createEnemyUnit(kind: NonNullable<RaiderState["kind"]>, elite: boolean): THREE.Group {
    let group: THREE.Group;
    if (kind === "catapult" || kind === "batteringRam") group = createSiegeEngine(kind, true);
    else if (kind === "raider") group = createRaider(elite);
    else group = createSoldier(kind);
    if (kind !== "catapult" && kind !== "batteringRam") group.scale.multiplyScalar(HUMAN_WORLD_SCALE);
    group.userData.unitKind = kind;
    group.userData.healthTone = "enemy";
    group.traverse((node) => { if (node instanceof THREE.Mesh) node.castShadow = true; });
    const siege = kind === "catapult" || kind === "batteringRam";
    const hostileRing = new THREE.Mesh(
      new THREE.RingGeometry(siege ? 0.46 : elite ? 0.31 : 0.25, siege ? 0.6 : elite ? 0.43 : 0.36, 20),
      new THREE.MeshBasicMaterial({ color: "#ff5c48", side: THREE.DoubleSide, transparent: true, opacity: 0.78, depthWrite: false }),
    );
    hostileRing.rotation.x = -Math.PI / 2;
    hostileRing.position.y = 0.025;
    hostileRing.renderOrder = 4;
    group.userData.hostileRing = hostileRing;
    group.add(hostileRing);
    addHealthBar(group, false);
    return group;
  }

  private spawnDust(position: THREE.Vector3): void {
    const material = new THREE.MeshBasicMaterial({ color: "#d3ad72", transparent: true, opacity: 0.42, depthWrite: false });
    const dust = new THREE.Mesh(
      this.dustGeometry,
      material,
    );
    dust.position.copy(position);
    dust.position.y = 0.22;
    this.world.add(dust);
    this.dustEffects.push({ mesh: dust, material, progress: 0 });
  }

  private gridToWorld(grid: number): number {
    return (grid - (this.currentGridSize - 1) / 2) * TILE_SIZE;
  }

  private worldToGrid(world: number): number {
    return world / TILE_SIZE + (this.currentGridSize - 1) / 2;
  }

}

export function isCompactLandscape(width: number, height: number): boolean {
  return width > height && width <= 960 && height <= 480;
}

/** A single reusable ground-space outline; selection only changes its transform. */
export function createEnemyThreatRing(): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.992, 1, 96),
    new THREE.MeshBasicMaterial({ color: "#e87960", side: THREE.DoubleSide,
      transparent: true, opacity: 0.72, depthWrite: false }));
  ring.name = "selected-enemy-tower-range";
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  return ring;
}
