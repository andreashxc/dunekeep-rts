/** Visual time comes from completed simulation steps, never the RAF delta or timeScale. */
export class AnimationClock {
  private elapsed: number | null = null;
  private worldKey: string | null = null;

  reset(): void { this.elapsed = null; this.worldKey = null; }

  advance(elapsed: number, worldKey: string, paused: boolean): number {
    if (!Number.isFinite(elapsed) || elapsed < 0) { this.reset(); return 0; }
    const previous = this.elapsed;
    const sameWorld = this.worldKey === worldKey;
    this.elapsed = elapsed;
    this.worldKey = worldKey;
    if (paused || previous === null || !sameWorld || elapsed < previous) return 0;
    return elapsed - previous;
  }
}
