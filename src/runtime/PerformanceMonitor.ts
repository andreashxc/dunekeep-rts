export interface FrameMeasurement {
  frameMs: number;
  simulationMs: number;
  snapshotMs: number;
  /** CPU submission time, not GPU completion time. */
  renderMs: number;
  uiMs?: number;
  autosaveMs?: number;
  /** Local QA automation overhead, excluded from simulationMs. */
  pilotMs?: number;
}
const metrics = ['frameMs', 'simulationMs', 'snapshotMs', 'renderMs', 'uiMs', 'autosaveMs', 'pilotMs'] as const;
export function percentiles(values: readonly number[]) {
  const sorted = values.filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : 0;
  return { samples: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

/** Bounded recording; sorting happens only on explicit summary requests. */
export class PerformanceMonitor {
  private frames: FrameMeasurement[] = [];
  private cursor = 0;
  private totalFrames = 0;
  constructor(readonly capacity = 600) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Invalid sample capacity');
  }
  record(frame: FrameMeasurement): void {
    if (!Number.isFinite(frame.frameMs) || frame.frameMs < 0) return;
    this.frames[this.cursor] = { ...frame };
    this.cursor = (this.cursor + 1) % this.capacity;
    this.totalFrames++;
  }
  reset(): void { this.frames = []; this.cursor = 0; this.totalFrames = 0; }
  summary() {
    return {
      totalFrames: this.totalFrames,
      samples: this.frames.length,
      slowFrames: this.frames.filter((frame) => frame.frameMs > 50).length,
      metrics: Object.fromEntries(metrics.map((key) => [key, percentiles(this.frames.flatMap((frame) => frame[key] === undefined ? [] : [frame[key]!]))])) as Record<typeof metrics[number], ReturnType<typeof percentiles>>,
    };
  }
}
