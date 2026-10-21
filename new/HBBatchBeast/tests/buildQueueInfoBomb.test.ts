import { describe, expect, it } from 'vitest';
import { BatchOperationMode, GlobalAppConfig } from '../src/common';
import { buildQueueInfoBomb } from '../src/backend/helpers';

function makeConfig(
  batch: GlobalAppConfig['configs'][number]['tab_batch'] = {},
): GlobalAppConfig {
  return {
    lang: 'en',
    selected_config: 0,
    version_message: 'test',
    api_key: '',
    configs: [{ name: 'Default', tab_batch: batch }],
  };
}

const twoSources = {
  path: {
    source_path: '/media/movies\n/media/tv',
    destination_path: '/out/movies\n/out/tv',
  },
  preset: 'Very Fast 1080p30',
  container: '.mp4',
};

describe('buildQueueInfoBomb', () => {
  it('sends one HandBrake -Z argument per source folder', () => {
    const bomb = buildQueueInfoBomb({
      config: makeConfig(twoSources),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(bomb[1]).toEqual(['/media/movies', '/media/tv']);
    expect(bomb[2]).toEqual(['/out/movies', '/out/tv']);
    expect(bomb[7]).toBe('scanOnly');
    expect(bomb[8]).toEqual([
      '-Z "Very Fast 1080p30"',
      '-Z "Very Fast 1080p30"',
    ]);
  });

  it('does not double-wrap presets that are already arguments', () => {
    const bomb = buildQueueInfoBomb({
      config: makeConfig({ ...twoSources, preset: '-Z "HQ 1080p30"' }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(bomb[8]).toEqual(['-Z "HQ 1080p30"', '-Z "HQ 1080p30"']);
  });

  it('uses raw custom preset lines when the custom toggle is on', () => {
    const bomb = buildQueueInfoBomb({
      config: makeConfig({
        ...twoSources,
        custom_preset_toggle: 1,
        custom_preset_string: '--preset-import-file a.json\n--preset-import-file b.json',
      }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(bomb[8]).toEqual([
      '--preset-import-file a.json',
      '--preset-import-file b.json',
    ]);
  });

  it('emits one suffix entry per source even when suffixes are disabled (D1)', () => {
    const bomb = buildQueueInfoBomb({
      config: makeConfig(twoSources),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(bomb[11]).toEqual(['', '']);
  });

  it('pads a partial suffix list instead of leaving holes', () => {
    const bomb = buildQueueInfoBomb({
      config: makeConfig({
        ...twoSources,
        advanced: {
          file_name_suffix_toggle: 1,
          file_name_suffix: '_720p',
        },
      }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(bomb[11]).toEqual(['_720p', '']);
  });

  it('passes temp folders only when the temp toggle is enabled', () => {
    const disabled = buildQueueInfoBomb({
      config: makeConfig(twoSources),
      operationMode: BatchOperationMode.ScanOnly,
    });
    expect(disabled[3]).toEqual([]);
    expect(disabled[4]).toBe(false);

    const enabled = buildQueueInfoBomb({
      config: makeConfig({
        ...twoSources,
        path: {
          ...twoSources.path,
          temp_toggle: 1,
          temp_destination_path: '/tmp/a\n/tmp/b',
        },
      }),
      operationMode: BatchOperationMode.ScanOnly,
    });
    expect(enabled[3]).toEqual(['/tmp/a', '/tmp/b']);
    expect(enabled[4]).toBe(true);
  });

  it('appends srt file types when SRT copying is on', () => {
    const bomb = buildQueueInfoBomb({
      config: makeConfig({
        ...twoSources,
        advanced: {
          included_file_types: 'mp4,mkv',
          copy_srt_files_toggle: 1,
        },
      }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(bomb[5]).toBe('mp4,mkv,srt,SRT');
  });

  it('carries the file-handling toggles across', () => {
    const bomb = buildQueueInfoBomb({
      config: makeConfig({
        ...twoSources,
        advanced: {
          title_word_filter: 'sample',
          replace_original_file_if_converted_is_smaller_toggle: 1,
          remove_filename_apostrophes: 1,
          replace_original_file_always_toggle: 1,
          reverse_file_queue: 1,
        },
      }),
      operationMode: BatchOperationMode.ScanAndConvert,
    });

    expect(bomb[9]).toBe('sample');
    expect(bomb[10]).toBe(true);
    expect(bomb[12]).toBe(true);
    expect(bomb[13]).toBe(true);
    expect(bomb[14]).toBe(true);
  });

  it('rejects unsupported operation modes, including the dropped health check', () => {
    const config = makeConfig(twoSources);

    expect(() =>
      buildQueueInfoBomb({
        config,
        operationMode: 'healthCheck' as BatchOperationMode,
      }),
    ).toThrow(/Unsupported batch operation mode/);

    expect(() => buildQueueInfoBomb({ config })).toThrow(
      /Unsupported batch operation mode/,
    );
  });

  it('rejects a missing selected configuration', () => {
    expect(() =>
      buildQueueInfoBomb({
        config: { ...makeConfig(twoSources), selected_config: 3 },
        operationMode: BatchOperationMode.ScanOnly,
      }),
    ).toThrow(/Selected configuration does not exist/);
  });
});
