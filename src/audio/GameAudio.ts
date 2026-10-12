export type AudioChannel = "effects" | "ambient";
export const AUDIO_SETTINGS_KEY = "dunekeep.audio";
type AudioStorage = Pick<Storage, "getItem" | "setItem">;

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private effects: GainNode | null = null;
  private wind: { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
  private ambienceActive = false;
  private disposed = false;
  private levels = { effects: 1, ambient: 0.35 };
  private storage: AudioStorage | null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private tones = new Map<OscillatorNode, GainNode>();

  constructor(storage?: AudioStorage | null) {
    this.storage = storage ?? null;
    if (storage === undefined) {
      try { this.storage = window.localStorage; } catch { /* unavailable storage */ }
    }
    try {
      const saved: unknown = JSON.parse(this.storage?.getItem(AUDIO_SETTINGS_KEY) ?? "null");
      if (saved && typeof saved === "object") for (const channel of ["effects", "ambient"] as const) {
        const value = (saved as Record<string, unknown>)[channel];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) this.levels[channel] = value;
      }
    } catch { /* malformed preferences keep safe defaults */ }
  }

  get volumes(): Readonly<{ effects: number; ambient: number }> { return { ...this.levels }; }
  getVolume(channel: AudioChannel): number { return this.levels[channel]; }
  setVolume(channel: AudioChannel, value: number): void {
    if (this.disposed || (channel !== "effects" && channel !== "ambient") || !Number.isFinite(value)) return;
    this.levels[channel] = Math.max(0, Math.min(1, value));
    if (this.effects) this.effects.gain.value = this.levels.effects;
    if (this.wind) this.wind.gain.gain.value = this.levels.ambient * 0.12;
    this.syncAmbience();
    try { this.storage?.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(this.levels)); } catch { /* non-fatal */ }
  }

  updateAmbience(active: boolean): void {
    this.ambienceActive = active;
    this.syncAmbience();
  }
  private lastArrow = 0;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master) this.master.gain.value = enabled ? 0.2 : 0;
    this.syncAmbience();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  unlock(): void {
    if (this.disposed) return;
    if (!this.context) {
      try {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.enabled ? 0.2 : 0;
      this.master.connect(this.context.destination);
      this.effects = this.context.createGain();
      this.effects.gain.value = this.levels.effects;
      this.effects.connect(this.master);
      } catch {
        const context = this.context;
        this.context = null; this.master = null; this.effects = null;
        if (context) void context.close().catch(() => {});
        return;
      }
    }
    if (this.context.state === "suspended") void this.context.resume().catch(() => {});
    this.syncAmbience();
  }

  play(sound: "build" | "error" | "wave" | "arrow" | "victory" | "defeat"): void {
    if (!this.enabled || !this.context || this.disposed || this.levels.effects === 0) return;
    const now = performance.now();
    if (sound === "arrow" && now - this.lastArrow < 110) return;
    if (sound === "arrow") this.lastArrow = now;

    switch (sound) {
      case "build":
        this.sequence([220, 330, 440], 0.055, "triangle", 0.09);
        break;
      case "error":
        this.sequence([150, 110], 0.08, "sawtooth", 0.07);
        break;
      case "wave":
        this.sequence([110, 110, 146], 0.18, "sawtooth", 0.14);
        break;
      case "arrow":
        this.tone(760, 0.035, "triangle", 0.035, -280);
        break;
      case "victory":
        this.sequence([262, 330, 392, 523], 0.14, "triangle", 0.12);
        break;
      case "defeat":
        this.sequence([220, 185, 147, 110], 0.18, "sawtooth", 0.09);
        break;
    }
  }

  private sequence(frequencies: number[], duration: number, type: OscillatorType, volume: number): void {
    frequencies.forEach((frequency, index) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.tone(frequency, duration, type, volume);
      }, index * duration * 850);
      this.timers.add(timer);
    });
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number, sweep = 0): void {
    if (!this.context || !this.effects || this.disposed || !this.enabled) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const start = this.context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.linearRampToValueAtTime(Math.max(40, frequency + sweep), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.effects);
    this.tones.set(oscillator, gain);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.tones.delete(oscillator); };
    oscillator.start(start);
    oscillator.stop(start + duration);
  }

  private syncAmbience(): void {
    if (!this.context || !this.master || this.disposed) return;
    if (!this.enabled || !this.ambienceActive || this.levels.ambient === 0) {
      this.stopWind();
      return;
    }
    if (this.wind) return;
    const source = this.context.createBufferSource();
    const buffer = this.context.createBuffer(1, this.context.sampleRate * 3, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    // A repeatable low-passed noise bed; no network or decoded audio assets.
    let seed = 713, previous = 0;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      previous = previous * 0.94 + (seed / 4294967296 * 2 - 1) * 0.06;
      const envelope = 0.55 + 0.2 * Math.sin(i / data.length * Math.PI * 2);
      const edge = Math.min(1, i / 512, (data.length - 1 - i) / 512);
      data[i] = previous * envelope * edge;
    }
    source.buffer = buffer; source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = "lowpass"; filter.frequency.value = 700; filter.Q.value = 0.4;
    const gain = this.context.createGain();
    gain.gain.value = this.levels.ambient * 0.12;
    source.connect(filter); filter.connect(gain); gain.connect(this.master);
    this.wind = { source, filter, gain };
    source.start();
  }

  private stopWind(): void {
    if (!this.wind) return;
    this.wind.gain.gain.value = 0;
    this.wind.source.stop();
    this.wind.source.disconnect(); this.wind.filter.disconnect(); this.wind.gain.disconnect();
    this.wind = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWind();
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const [oscillator, gain] of this.tones) {
      oscillator.onended = null;
      oscillator.stop(); oscillator.disconnect(); gain.disconnect();
    }
    this.tones.clear();
    this.effects?.disconnect(); this.master?.disconnect();
    const context = this.context;
    this.context = null; this.master = null; this.effects = null;
    if (context) void context.close().catch(() => {});
  }

}
