import { afterEach, expect, it, vi } from 'vitest';
import { AUDIO_SETTINGS_KEY, GameAudio } from './GameAudio';
function node() { return { connect: vi.fn(), disconnect: vi.fn() }; }
function fakeGain() { return { ...node(), gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } }; }
function fakeSource() { return { ...node(), buffer: null, loop: false, start: vi.fn(), stop: vi.fn() }; }
function fakeOscillator() { return { ...node(), type: '', frequency: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, start: vi.fn(), stop: vi.fn(), onended: null }; }
class FakeContext {
  static instances: FakeContext[] = [];
  currentTime = 0; sampleRate = 1000; state = 'suspended'; destination = {};
  gains: ReturnType<typeof fakeGain>[] = [];
  sources: ReturnType<typeof fakeSource>[] = [];
  oscillators: ReturnType<typeof fakeOscillator>[] = [];
  constructor() { FakeContext.instances.push(this); }
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; });
  createGain() { const gain = fakeGain(); this.gains.push(gain); return gain; }
  createBuffer(_channels: number, length: number) { const data = new Float32Array(length); return { getChannelData: () => data }; }
  createBufferSource() { const source = fakeSource(); this.sources.push(source); return source; }
  createBiquadFilter() { return { ...node(), type: '', frequency: { value: 0 }, Q: { value: 0 } }; }
  createOscillator() { const oscillator = fakeOscillator(); this.oscillators.push(oscillator); return oscillator; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeContext.instances = []; });
it('persists independent clamped volume controls without creating an AudioContext', () => {
  vi.stubGlobal('AudioContext', FakeContext);
  const storage = { getItem: () => '{"effects":0.6,"ambient":0.2}', setItem: vi.fn() };
  const audio = new GameAudio(storage);
  expect(audio.volumes).toEqual({ effects: 0.6, ambient: 0.2 });
  audio.setVolume('ambient', 2); audio.setVolume('effects', -1); audio.setVolume('effects', NaN);
  expect(audio.volumes).toEqual({ effects: 0, ambient: 1 });
  expect(storage.setItem).toHaveBeenLastCalledWith(AUDIO_SETTINGS_KEY, '{"effects":0,"ambient":1}');
  audio.play('arrow'); audio.updateAmbience(true);
  expect(FakeContext.instances).toHaveLength(0);
});
it('starts one wind source after unlock and stops it on pause or mute', () => {
  vi.stubGlobal('AudioContext', FakeContext);
  const audio = new GameAudio(null);
  audio.updateAmbience(true); audio.unlock();
  const context = FakeContext.instances[0];
  expect(context.sources).toHaveLength(1);
  audio.updateAmbience(true); audio.unlock();
  expect(context.sources).toHaveLength(1);
  audio.updateAmbience(false);
  expect(context.sources[0].stop).toHaveBeenCalledOnce();
  expect(context.sources[0].disconnect).toHaveBeenCalledOnce();
  audio.updateAmbience(true);
  expect(context.sources).toHaveLength(2);
  audio.setEnabled(false);
  expect(context.sources[1].stop).toHaveBeenCalledOnce();
  audio.dispose(); audio.dispose(); audio.unlock();
  expect(context.close).toHaveBeenCalledOnce();
  expect(FakeContext.instances).toHaveLength(1);
});
it('cancels delayed tones and releases all active nodes on dispose', () => {
  vi.useFakeTimers(); vi.stubGlobal('AudioContext', FakeContext);
  const audio = new GameAudio(null); audio.unlock(); audio.play('victory');
  vi.advanceTimersByTime(1);
  const context = FakeContext.instances[0];
  expect(context.oscillators).toHaveLength(1);
  audio.dispose(); vi.runAllTimers();
  expect(context.oscillators).toHaveLength(1);
  expect(context.oscillators[0].disconnect).toHaveBeenCalledOnce();
  expect(context.close).toHaveBeenCalledOnce();
});
it('survives inaccessible preferences and unsupported audio', () => {
  vi.stubGlobal('AudioContext', class { constructor() { throw new Error('not available'); } });
  const audio = new GameAudio({ getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('quota'); } });
  expect(() => { audio.setVolume('ambient', 0.1); audio.unlock(); audio.play('build'); audio.dispose(); }).not.toThrow();
});
