import { expect, it } from 'vitest';
import { GraphicsSettings } from './GraphicsSettings';
it('starts auto at medium and lowers only after sustained slow frames', () => {
  const settings = new GraphicsSettings();
  for (let i = 0; i < 124; i++) expect(settings.recordFrameTime(40)).toBe(false);
  expect(settings.quality).toBe('medium');
  expect(settings.recordFrameTime(40)).toBe(true);
  expect(settings.quality).toBe('low');
  for (let i = 0; i < 1000; i++) settings.recordFrameTime(16);
  expect(settings.quality).toBe('low');
});
it('never overrides manual settings and ignores background gaps', () => {
  const settings = new GraphicsSettings('high');
  for (let i = 0; i < 1000; i++) settings.recordFrameTime(40);
  expect(settings.quality).toBe('high');
  settings.setPreset('auto');
  settings.recordFrameTime(10000);
  expect(settings.quality).toBe('medium');
});
