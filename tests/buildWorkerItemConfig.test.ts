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
  it('maps a queue item onto the worker payload', () => {
    const config = buildWorkerItemConfig(makeConfig(), item, 3, 'linux');

    expect(config.queueNumber).toBe(3);
    expect(config.sourcePath).toBe('/src/a.mkv');
    expect(config.destinationPath).toBe('/dst/a.mp4');
    expect(config.preset).toBe('-Z "Very Fast 1080p30"');
    expect(config.handBrakeMode).toBe(true);
    expect(config.ffmpegMode).toBe(false);
  });

  it('carries file-handling toggles from the batch config', () => {
    const config = buildWorkerItemConfig(
      makeConfig({
        path: { source_path: '/s', destination_path: '/d', temp_toggle: 1 },
        advanced: {
          copy_filtered_files_toggle: 1,
          replace_original_file_if_converted_is_smaller_toggle: 1,
          replace_original_file_always_toggle: 1,
          delete_source_files_toggle: 1,
          custom_bat_path: '/run.sh',
          min_file_size_filter_toggle: 1,
          min_file_size_filter: '10',
          max_file_size_filter_toggle: 1,
          max_file_size_filter: '900',
          included_property_filter: 'codec_name=h264',
          excluded_property_filter: 'codec_name=hevc',
          included_property_filter_any_toggle: 1,
          excluded_property_filter_all_toggle: 1,
        },
      }),
      item,
      0,
      'linux',
    );

    expect(config.copyOnOff).toBe(true);
    expect(config.replaceOriginalFile).toBe(true);
    expect(config.replaceOriginalFileAlways).toBe(true);
    expect(config.deleteSourceFiles).toBe(true);
    expect(config.customBatOn).toBe(true);
    expect(config.tempFolderSelected).toBe(true);
    expect(config.minFileSizeOnOff).toBe(true);
    expect(config.maxFileSize).toBe('900');
    expect(config.fileFiltersInclude).toBe('codec_name=h264');
    expect(config.fileFiltersExclude).toBe('codec_name=hevc');
    expect(config.includeAnyProperties).toBe(true);
    expect(config.excludeAllProperties).toBe(true);
  });

  it('switches to FFmpeg mode and honours verbose logging', () => {
    const config = buildWorkerItemConfig(
      makeConfig({ FFmpeg_toggle: 1 }, { save_worker_logs_toggle: 1 }),
      item,
      0,
      'win32',
    );

    expect(config.ffmpegMode).toBe(true);
    expect(config.handBrakeMode).toBe(false);
    expect(config.saveWorkerLogs).toBe(true);
    expect(config.handBrakeCliPath).toBe('HandBrakeCLI.exe');
    // health check is out of scope and must stay disabled
    expect(config.thoroughHealthCheck).toBe(false);
    expect(config.repairFile).toBe(false);
  });

  it('carries GUI preset files so custom preset names resolve at runtime', () => {
    const withPresets = buildWorkerItemConfig(
      makeConfig(),
      { ...item, preset: '-Z "H.265 MKV 1080p30 HouseHunters"' },
      0,
      'linux',
      ['/home/user/.config/ghb/presets.json'],
    );
    const withoutPresets = buildWorkerItemConfig(
      makeConfig(),
      item,
      0,
      'linux',
      [],
    );

    expect(withPresets.handBrakePresetImportFiles).toEqual([
      '/home/user/.config/ghb/presets.json',
    ]);
    expect(withoutPresets.handBrakePresetImportFiles).toEqual([]);
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
});
