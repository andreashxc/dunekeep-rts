import { describe, expect, it } from 'vitest';
import { GameSimulation } from '../game/simulation';
import { FixedStepClock } from './FixedStepClock';

function run(fps: number, speed: 1 | 2) {
  const game = new GameSimulation();
  game.start(); game.beginPreparation(); game.setTimeScale(speed);
  const clock = new FixedStepClock();
  for (let frame = 0; frame <= (300 / speed) * fps; frame++) {
    clock.advance(frame * 1000 / fps, true, dt => game.tick(dt));
  }
  const { elapsed, resources, population, wave, buildings, army, raiders } = game.snapshot;
  return { elapsed, resources, population, wave, keepHp: buildings.find(building => building.kind === "keep")?.hp, army, raiders };
}

describe('frame-independent game economy and combat', () => {
  for (const speed of [1, 2] as const) {
    it(`produces identical game state at 15/30/60/120 FPS at ${speed}x`, () => {
      const baseline = run(60, speed);
      expect(baseline.elapsed).toBeCloseTo(300, 6);
      expect(baseline.wave).toBe(1);
      for (const fps of [15, 30, 120]) expect(run(fps, speed)).toEqual(baseline);
    });
  }
});
