export type GraphicsPreset = 'low' | 'medium' | 'high' | 'auto';
export type GraphicsQuality = Exclude<GraphicsPreset, 'auto'>;
export const GRAPHICS_SETTINGS_KEY = 'dunekeep.graphics';
export const GRAPHICS_QUALITY = {
  low: { pixelRatio: 1, ambientOcclusion: false, shadowSize: 1024 },
  medium: { pixelRatio: 1.5, ambientOcclusion: false, shadowSize: 2048 },
  high: { pixelRatio: 2, ambientOcclusion: true, shadowSize: 2048 },
} as const;
export function isGraphicsPreset(value: unknown): value is GraphicsPreset {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'auto';
}
/** Auto degrades once after sustained slow rendering; hidden-tab gaps must not be sampled. */
export class GraphicsSettings {
  preset: GraphicsPreset;
  quality: GraphicsQuality;
  private slowMs = 0;
  constructor(preset: GraphicsPreset = 'auto') {
    this.preset = preset;
    this.quality = preset === 'auto' ? 'medium' : preset;
  }
  setPreset(preset: GraphicsPreset): void {
    this.preset = preset;
    this.quality = preset === 'auto' ? 'medium' : preset;
    this.slowMs = 0;
  }
  recordFrameTime(frameMs: number): boolean {
    if (this.preset !== 'auto' || this.quality === 'low') return false;
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) { this.slowMs = 0; return false; }
    this.slowMs = frameMs > 33 ? this.slowMs + frameMs : Math.max(0, this.slowMs - frameMs * 2);
    if (this.slowMs < 5000) return false;
    this.quality = 'low';
    this.slowMs = 0;
    return true;
  }
}
