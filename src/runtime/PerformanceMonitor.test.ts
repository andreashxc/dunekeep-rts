import { expect, it } from 'vitest';
import { PerformanceMonitor, percentiles } from './PerformanceMonitor';
it('calculates known nearest-rank percentiles, rejecting invalid values', () => {
  expect(percentiles([...Array.from({ length: 100 }, (_, i) => i + 1), NaN, -1])).toEqual({samples: 100, p50: 50, p95: 95, p99: 99});
});
it('keeps a bounded window and omits unsampled optional timings', () => {
  const monitor = new PerformanceMonitor(2);
  for (const frameMs of [100, 10, 20]) monitor.record({frameMs, simulationMs: 1, snapshotMs: 2, renderMs: 3});
  expect(monitor.summary()).toMatchObject({totalFrames: 3, samples: 2, slowFrames: 0, metrics: {frameMs: {p50: 10, p95: 20}, uiMs: {samples: 0}}});
  monitor.reset(); expect(monitor.summary().samples).toBe(0);
});
