import { describe, expect, it } from 'vitest';
import {
  usesHardwareEncoder,
  usesHardwarePreset,
} from '../src/frontend/settings/presetWarnings';

describe('presetWarnings', () => {
  it('detects active hardware presets and custom encoder arguments', () => {
    expect(
      usesHardwareEncoder({
        FFmpeg_toggle: 0,
        preset: 'H.264 (NVENC)',
      }),
    ).toBe(true);
    expect(
      usesHardwareEncoder({
        FFmpeg_toggle: 1,
        preset: 'H.264 (NVENC)',
        custom_preset_string: '-c:v h264_nvenc',
      }),
    ).toBe(true);
  });

  it('detects hardware recipes in reusable presets', () => {
    expect(
      usesHardwarePreset({
        id: 'p1',
        name: 'NVENC',
        handbrake: { preset: 'H.264 (NVENC)' },
      }),
    ).toBe(true);
    expect(
      usesHardwarePreset({
        id: 'p2',
        name: 'Software',
        ffmpeg: { inputArgs: '', outputArgs: '-c:v libx264 -crf 20' },
      }),
    ).toBe(false);
  });

  it('ignores inactive hardware presets and software encoders', () => {
    expect(
      usesHardwareEncoder({
        FFmpeg_toggle: 0,
        preset: 'H.264 (NVENC)',
        custom_preset_string: '-e x264 -q 22',
      }),
    ).toBe(false);
    expect(
      usesHardwareEncoder({
        FFmpeg_toggle: 0,
        preset: 'Very Fast 1080p30',
      }),
    ).toBe(false);
  });
});
