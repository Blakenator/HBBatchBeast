import { describe, expect, it } from 'vitest';
import { GlobalAppConfig } from '../src/common';
import { buildWorkerItemConfig } from '../src/backend/run/buildWorkerItemConfig';

function makeConfig(
  batch: GlobalAppConfig['configs'][number]['tab_batch'] = {},
  appSettings: GlobalAppConfig['app_settings'] = {},
): GlobalAppConfig {
  return {
    lang: 'en',
    selected_config: 0,
    version_message: 'test',
    app_settings: appSettings,
    configs: [{ name: 'Default', tab_batch: batch }],
  };
}

const item = {
  path: '/src/a.mkv',
  preset: '-Z "Very Fast 1080p30"',
  destinationPath: '/dst/a.mp4',
};

describe('buildWorkerItemConfig', () => {
  it('maps a queue item onto the structured worker payload', () => {
    const config = buildWorkerItemConfig(makeConfig(), item, 3, 'linux', []);

    expect(config).toMatchObject({
      queueNumber: 3,
      sourcePath: '/src/a.mkv',
      outputPath: '/dst/a.mp4',
      finalPath: '/dst/a.mp4',
      action: 'encode',
      encoder: {
        kind: 'handbrake',
        executable: 'HandBrakeCLI',
        preset: '-Z "Very Fast 1080p30"',
        presetImportFiles: [],
      },
    });
  });

  it('carries file-handling toggles, filters and sizes', () => {
    const config = buildWorkerItemConfig(
      makeConfig({
        path: { source_path: '/s', destination_path: '/d', temp_toggle: 1 },
        advanced: {
          copy_filtered_files_toggle: 1,
          replace_original_file_if_converted_is_smaller_toggle: 1,
          replace_original_file_always_toggle: 1,
          delete_source_files_toggle: 1,
          custom_bat_path: '/run.sh',
          low_process_priority_toggle: 1,
          min_file_size_filter_toggle: 1,
          min_file_size_filter: '10',
          max_file_size_filter_toggle: 1,
          max_file_size_filter: '900',
          included_property_filter: "codec_name: 'h264'",
          excluded_property_filter: "codec_name: 'hevc'",
          included_property_filter_any_toggle: 1,
          excluded_property_filter_all_toggle: 1,
        },
      }),
      { ...item, destinationFinalPath: '/final/a.mp4', action: 'copy' },
      0,
      'linux',
      [],
    );

    expect(config.action).toBe('copy');
    expect(config.finalPath).toBe('/final/a.mp4');
    expect(config.copyFilteredFiles).toBe(true);
    expect(config.replaceOriginal).toBe('always');
    expect(config.deleteSource).toBe(true);
    expect(config.customBatPath).toBe('/run.sh');
    expect(config.lowPriority).toBe(true);
    expect(config.filters.include).toEqual({
      mode: 'any',
      rows: [{ key: 'codec_name', value: 'h264' }],
    });
    expect(config.filters.exclude).toEqual({
      mode: 'all',
      rows: [{ key: 'codec_name', value: 'hevc' }],
    });
    expect(config.filters.size).toEqual({ minMb: 10, maxMb: 900 });
  });

  it('switches to FFmpeg mode and honours verbose logging', () => {
    const config = buildWorkerItemConfig(
      makeConfig({ FFmpeg_toggle: 1 }, { save_worker_logs_toggle: 1 }),
      item,
      0,
      'win32',
      ['/presets.json'],
    );

    expect(config.encoder.kind).toBe('ffmpeg');
    expect(config.encoder.executable).toBe('ffmpeg');
    // HandBrake preset imports do not apply to FFmpeg.
    expect(config.encoder.presetImportFiles).toEqual([]);
    expect(config.saveWorkerLogs).toBe(true);
  });

  it('carries GUI preset files so custom preset names resolve at runtime', () => {
    const config = buildWorkerItemConfig(makeConfig(), item, 0, 'linux', [
      '/home/user/.config/ghb/presets.json',
    ]);
    expect(config.encoder.presetImportFiles).toEqual([
      '/home/user/.config/ghb/presets.json',
    ]);
  });

  it('reads legacy per-profile log settings when no global value exists', () => {
    const config = buildWorkerItemConfig(
      {
        ...makeConfig(),
        configs: [
          {
            name: 'Legacy',
            tab_batch: {},
            tab_system: { save_worker_logs_toggle: 1 },
          },
        ],
      },
      item,
      0,
      'linux',
    );

    expect(config.saveWorkerLogs).toBe(true);
  });

  it('fails loudly when required paths or sizes are invalid', () => {
    expect(() =>
      buildWorkerItemConfig(makeConfig(), { ...item, destinationPath: '' }, 0),
    ).toThrow(/no output path/);

    expect(() =>
      buildWorkerItemConfig(
        makeConfig({
          path: { source_path: '/s', destination_path: '/d', temp_toggle: 1 },
        }),
        item,
        0,
      ),
    ).toThrow(/no final destination/);

    expect(() =>
      buildWorkerItemConfig(
        makeConfig({
          advanced: {
            min_file_size_filter_toggle: 1,
            min_file_size_filter: 'nope',
          },
        }),
        item,
        0,
      ),
    ).toThrow(/Invalid minimum file size/);
  });

  it('uses the item path as a placeholder destination for skipped items', () => {
    const config = buildWorkerItemConfig(
      makeConfig(),
      { path: '/src/a.mkv', preset: 'x', action: 'skip' },
      1,
    );
    expect(config.outputPath).toBe('/src/a.mkv');
    expect(config.finalPath).toBe('/src/a.mkv');
    expect(config.skipReason).toBeTruthy();
  });
});
