import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GameRenderer } from './GameRenderer';
import { GraphicsSettings } from './GraphicsSettings';
vi.mock('./world/SceneEffects', () => ({ SceneEffects: class {
  dispose = vi.fn();
  resize = vi.fn();
} }));
afterEach(() => vi.unstubAllGlobals());
it('releases AO and shadow targets when changing quality without touching the world', () => {
  vi.stubGlobal('devicePixelRatio', 2);
  const setItem = vi.fn();
  vi.stubGlobal('window', { localStorage: { setItem } });
  const sun = new THREE.DirectionalLight();
  sun.shadow.mapSize.set(1024, 1024);
  let pixelRatio = 1;
  const view = Object.assign(Object.create(GameRenderer.prototype), {
    graphics: new GraphicsSettings(), disposed: false, contextLost: false,
    sun, effects: null, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(),
    renderer: { setPixelRatio: (value: number) => { pixelRatio = value; }, getPixelRatio: () => pixelRatio,
      extensions: { has: () => true } },
    resize: vi.fn(),
  }) as GameRenderer;
  view.setGraphicsPreset('high');
  expect(view.getGraphicsSettings()).toMatchObject({ quality: 'high', pixelRatio: 2, ambientOcclusion: true, shadowSize: 2048 });
  const internal = view as unknown as { effects: { dispose: ReturnType<typeof vi.fn> } | null };
  const effects = internal.effects!;
  sun.shadow.map = new THREE.WebGLRenderTarget(8, 8);
  const releaseShadow = vi.spyOn(sun.shadow.map, 'dispose');
  view.setGraphicsPreset('low');
  expect(effects.dispose).toHaveBeenCalledOnce();
  expect(releaseShadow).toHaveBeenCalledOnce();
  expect(sun.shadow.map).toBeNull();
  expect(view.getGraphicsSettings()).toMatchObject({ quality: 'low', pixelRatio: 1, ambientOcclusion: false, shadowSize: 1024 });
  expect(setItem).toHaveBeenLastCalledWith('dunekeep.graphics', 'low');
  view.setGraphicsPreset('medium');
  expect(view.getGraphicsSettings().pixelRatio).toBe(1.5);
  expect(effects.dispose).toHaveBeenCalledOnce();
});
