import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { GameRenderer } from './GameRenderer';
import { disposeEntity } from './objects/EntityDisposal';

afterEach(() => vi.unstubAllGlobals());
it('releases all four private label textures on every repeated mission-marker retirement', () => {
  const context = { beginPath() {}, roundRect() {}, fill() {}, stroke() {}, arc() {}, fillText() {} };
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
  const factory = GameRenderer.prototype as unknown as {
    createResourceMarker(x: number, z: number, label: string, color: string): THREE.Group;
  };
  const liveTextures = new Set<THREE.Texture>();
  let created = 0;
  for (let cycle = 0; cycle < 20; cycle++) {
    const group = new THREE.Group();
    for (const label of ['ЛЕС', 'КАМЕНЬ', 'ЖЕЛЕЗО', 'ПОЧВА']) {
      const marker = factory.createResourceMarker(0, 0, label, '#66915a');
      group.add(marker);
      marker.traverse(node => {
        if (!(node instanceof THREE.Sprite) || !node.material.map) return;
        const texture = node.material.map;
        expect(texture.userData.entityOwned).toBe(true);
        created++;
        liveTextures.add(texture);
        texture.addEventListener('dispose', () => liveTextures.delete(texture));
      });
    }
    expect(liveTextures.size).toBe(4);
    disposeEntity(group);
    expect(liveTextures.size).toBe(0);
    disposeEntity(group);
    expect(liveTextures.size).toBe(0);
  }
  expect(created).toBe(80);
});
