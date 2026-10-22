import { describe, expect, it } from 'vitest';
import { BatchOperationMode, GlobalAppConfig } from '../src/common';
import { buildQueueBuildConfig } from '../src/backend/helpers';

function makeConfig(
  batch: GlobalAppConfig['configs'][number]['tab_batch'] = {},
): GlobalAppConfig {
  return {
    lang: 'en',
    selected_config: 0,
    version_message: 'test',
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

describe('buildQueueBuildConfig', () => {
  it('sends one HandBrake -Z argument per source folder', () => {
    const payload = buildQueueBuildConfig({
      config: makeConfig(twoSources),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(payload.sources).toEqual(['/media/movies', '/media/tv']);
    expect(payload.destinations).toEqual(['/out/movies', '/out/tv']);
    expect(payload.mode).toBe('scanOnly');
    expect(payload.presets).toEqual([
      '-Z "Very Fast 1080p30"',
      '-Z "Very Fast 1080p30"',
    ]);
  });

  it('always sends a dotted container extension', () => {
    const withoutDot = buildQueueBuildConfig({
      config: makeConfig({ ...twoSources, container: 'mkv' }),
      operationMode: BatchOperationMode.ScanOnly,
    });
    const withDot = buildQueueBuildConfig({
      config: makeConfig({ ...twoSources, container: '.mkv' }),
      operationMode: BatchOperationMode.ScanOnly,
    });
    const empty = buildQueueBuildConfig({
      config: makeConfig({ ...twoSources, container: '  ' }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(withoutDot.container).toBe('.mkv');
    expect(withDot.container).toBe('.mkv');
    expect(empty.container).toBe('.mp4');
  });

  it('does not double-wrap presets that are already arguments', () => {
    const payload = buildQueueBuildConfig({
      config: makeConfig({ ...twoSources, preset: '-Z "HQ 1080p30"' }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(payload.presets).toEqual(['-Z "HQ 1080p30"', '-Z "HQ 1080p30"']);
  });

  it('uses custom preset rows when they are present', () => {
    const payload = buildQueueBuildConfig({
      config: makeConfig({
        ...twoSources,
        custom_preset_string:
          '--preset-import-file a.json\n--preset-import-file b.json',
      }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(payload.presets).toEqual([
      '--preset-import-file a.json',
      '--preset-import-file b.json',
    ]);
  });

  it('falls back to the legacy preset field when custom rows are empty', () => {
    const payload = buildQueueBuildConfig({
      config: makeConfig({
        ...twoSources,
        custom_preset_string: '\n',
      }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(payload.presets).toEqual([
      '-Z "Very Fast 1080p30"',
      '-Z "Very Fast 1080p30"',
    ]);
  });

  it('wraps bare custom HandBrake presets but keeps custom arguments intact', () => {
    const payload = buildQueueBuildConfig({
      config: makeConfig({
        ...twoSources,
        FFmpeg_toggle: 0,
        custom_preset_string:
          'H.265 MKV 1080p30 HouseHunters\n-e x264 -q 22',
      }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(payload.presets).toEqual([
      '-Z "H.265 MKV 1080p30 HouseHunters"',
      '-e x264 -q 22',
    ]);
  });

  it('uses custom arguments for FFmpeg', () => {
    const payload = buildQueueBuildConfig({
      config: makeConfig({
        ...twoSources,
        FFmpeg_toggle: 1,
        custom_preset_string:
          '-ss 00:00:10,-c:v libx264 -crf 20\n-ss 0,-c:v libx265 -crf 24',
      }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(payload.presets).toEqual([
      '-ss 00:00:10,-c:v libx264 -crf 20',
      '-ss 0,-c:v libx265 -crf 24',
    ]);
  });

  it('only includes already-converted files when the profile asks for it', () => {
    const defaults = buildQueueBuildConfig({
      config: makeConfig(twoSources),
      operationMode: BatchOperationMode.ScanOnly,
    });
    expect(defaults.includeConverted).toBe(false);

    const includeConverted = buildQueueBuildConfig({
      config: makeConfig({
        ...twoSources,
        advanced: { include_converted_files_toggle: 1 },
      }),
      operationMode: BatchOperationMode.ScanOnly,
    });
    expect(includeConverted.includeConverted).toBe(true);
  });

  it('emits one suffix entry per source even when suffixes are disabled (D1)', () => {
    const payload = buildQueueBuildConfig({
      config: makeConfig(twoSources),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(payload.fileSuffixes).toEqual(['', '']);
  });

  it('pads a partial suffix list instead of leaving holes', () => {
    const payload = buildQueueBuildConfig({
      config: makeConfig({
        ...twoSources,
        advanced: { file_name_suffix_toggle: 1, file_name_suffix: '_720p' },
      }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(payload.fileSuffixes).toEqual(['_720p', '']);
  });

  it('keeps an empty suffix attached to its own row instead of shifting', () => {
    const payload = buildQueueBuildConfig({
      config: makeConfig({
        path: {
          source_path: '/media/movies\n/media/tv\n/media/home',
          destination_path: '/out/movies\n/out/tv\n/out/home',
        },
        preset: 'Fast 1080p30',
        advanced: {
          file_name_suffix_toggle: 1,
          file_name_suffix: '_movies\n\n_home',
        },
      }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(payload.fileSuffixes).toEqual(['_movies', '', '_home']);
  });

  it('passes temp folders only when the temp toggle is enabled', () => {
    const disabled = buildQueueBuildConfig({
      config: makeConfig(twoSources),
      operationMode: BatchOperationMode.ScanOnly,
    });
    expect(disabled.tempDestinations).toEqual([]);
    expect(disabled.useTempFolder).toBe(false);

    const enabled = buildQueueBuildConfig({
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
    expect(enabled.tempDestinations).toEqual(['/tmp/a', '/tmp/b']);
    expect(enabled.useTempFolder).toBe(true);
  });

  it('appends srt file types when SRT copying is on', () => {
    const payload = buildQueueBuildConfig({
      config: makeConfig({
        ...twoSources,
        advanced: { included_file_types: 'mp4,mkv', copy_srt_files_toggle: 1 },
      }),
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(payload.includedFileTypes).toBe('mp4,mkv,srt,SRT');
  });

  it('carries the file-handling toggles across', () => {
    const payload = buildQueueBuildConfig({
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

    expect(payload.titleWordFilter).toBe('sample');
    expect(payload.replaceIfSmaller).toBe(true);
    expect(payload.removeApostrophes).toBe(true);
    expect(payload.replaceAlways).toBe(true);
    expect(payload.reverseQueue).toBe(true);
  });

  it('rejects unsupported operation modes, including the dropped health check', () => {
    const config = makeConfig(twoSources);

    expect(() =>
      buildQueueBuildConfig({
        config,
        operationMode: 'healthCheck' as BatchOperationMode,
      }),
    ).toThrow(/Unsupported batch operation mode/);

    expect(() => buildQueueBuildConfig({ config })).toThrow(
      /Unsupported batch operation mode/,
    );
  });

  it('rejects a missing selected configuration', () => {
    expect(() =>
      buildQueueBuildConfig({
        config: { ...makeConfig(twoSources), selected_config: 3 },
        operationMode: BatchOperationMode.ScanOnly,
      }),
    ).toThrow(/Selected configuration does not exist/);
  });
});
