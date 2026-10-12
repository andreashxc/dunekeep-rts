import { describe, expect, it } from 'vitest';
import { AnimationClock } from './AnimationClock';
describe('simulation-driven animation time', () => {
  for (const fps of [15, 30, 60, 120]) for (const scale of [1, 2]) {
    it(`tracks one minute at ${fps} FPS and ${scale}x without double scaling`, () => {
      const clock = new AnimationClock();
      clock.advance(0, 'river:2', false);
      let animated = 0;
      for (let frame = 1; frame <= 60 * fps; frame++) {
        const completedSteps = Math.floor(frame * 60 / fps);
        animated += clock.advance(completedSteps / 60 * scale, 'river:2', false);
      }
      expect(animated).toBeCloseTo(60 * scale, 8);
    });
  }
  it('freezes pauses and consumes only newly completed steps after resuming', () => {
    const clock = new AnimationClock();
    clock.advance(4, 'oasis:2', false);
    expect(clock.advance(4.1, 'oasis:2', false)).toBeCloseTo(0.1);
    expect(clock.advance(4.1, 'oasis:2', true)).toBe(0);
    expect(clock.advance(4.1, 'oasis:2', false)).toBe(0);
    expect(clock.advance(4.15, 'oasis:2', false)).toBeCloseTo(0.05);
  });
  it('does not fast-forward effects on mission, rules version, save restore or reset', () => {
    const clock = new AnimationClock();
    clock.advance(100, 'oasis:2', false);
    expect(clock.advance(250, 'river:2', false)).toBe(0);
    expect(clock.advance(300, 'river:1', false)).toBe(0);
    expect(clock.advance(0, 'river:1', false)).toBe(0);
    clock.reset();
    expect(clock.advance(700, 'river:1', false)).toBe(0);
    expect(clock.advance(NaN, 'river:1', false)).toBe(0);
  });
});
