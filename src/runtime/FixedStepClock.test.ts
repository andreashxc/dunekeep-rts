import { describe, expect, it } from 'vitest';
import { FixedStepClock } from './FixedStepClock';
describe('FixedStepClock', () => {
  for (const fps of [15, 30, 60, 120]) it(`preserves one minute at ${fps} FPS`, () => {
    const clock = new FixedStepClock();
    let elapsed = 0;
    clock.reset(0);
    for (let frame = 1; frame <= fps * 60; frame++) clock.advance(frame * 1000 / fps, true, (dt) => { elapsed += dt; });
    expect(elapsed).toBeCloseTo(60, 7);
  });
  it('bounds catch-up and reports discarded time', () => {
    const clock = new FixedStepClock(); clock.reset(0);
    const result = clock.advance(2000, true, () => {});
    expect(result.steps).toBe(12);
    expect(result.droppedSeconds).toBeCloseTo(1.8);
  });
  it('does not simulate paused or hidden time after reset', () => {
    const clock = new FixedStepClock(); clock.reset(0);
    expect(clock.advance(1000, false, () => { throw new Error('paused'); }).steps).toBe(0);
    clock.reset();
    expect(clock.advance(9000, true, () => { throw new Error('hidden'); }).steps).toBe(0);
    expect(clock.advance(9017, true, () => {}).steps).toBe(1);
  });
});
