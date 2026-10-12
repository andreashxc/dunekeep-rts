/** A bounded fixed-step scheduler. Time scale belongs to the simulation, not this clock. */
export class FixedStepClock {
  private previous: number | null = null;
  private accumulator = 0;
  constructor(readonly stepSeconds = 1 / 60, readonly maxSteps = 12) {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0 || !Number.isInteger(maxSteps) || maxSteps < 1) {
      throw new Error('Invalid fixed step clock configuration');
    }
  }

  reset(nowMs?: number): void {
    this.previous = nowMs !== undefined && Number.isFinite(nowMs) ? nowMs : null;
    this.accumulator = 0;
  }

  advance(nowMs: number, active: boolean, step: (seconds: number) => void) {
    if (!Number.isFinite(nowMs)) return { steps: 0, alpha: 0, frameMs: 0, droppedSeconds: 0 };
    const frameMs = this.previous === null ? 0 : Math.max(0, nowMs - this.previous);
    this.previous = nowMs;
    if (!active) {
      this.accumulator = 0;
      return { steps: 0, alpha: 0, frameMs, droppedSeconds: 0 };
    }
    const budget = this.stepSeconds * this.maxSteps;
    const available = this.accumulator + frameMs / 1000;
    const droppedSeconds = Math.max(0, available - budget);
    this.accumulator = Math.min(available, budget);
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.stepSeconds && steps < this.maxSteps) {
      step(this.stepSeconds);
      this.accumulator = Math.max(0, this.accumulator - this.stepSeconds);
      steps++;
    }
    return { steps, alpha: this.accumulator / this.stepSeconds, frameMs, droppedSeconds };
  }
}
