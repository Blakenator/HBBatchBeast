import { describe, expect, it } from 'vitest';
import {
  APP_CONFIG_SCHEMA_VERSION,
  AppConfigV2,
  BatchOperationMode,
  Library,
  createFilterGroup,
  createFilterRule,
  defaultFilterExpression,
  libraryToRuntimeConfig,
} from '../src/common';
import { buildQueueBuildConfig } from '../src/backend/helpers';

const library: Library = {
  id: 'library-1',
  name: 'Movies',
  folders: [
    {
      id: 'folder-1',
      source: '/media/movies',
      destination: '/out/movies',
      suffix: '_hd',
    },
  ],
  filters: defaultFilterExpression(),
  encoder: 'handbrake',
  container: '.mkv',
  defaultPresetId: 'preset-default',
  mappingRules: [
    {
      id: 'rule-1',
      name: 'Folder override',
      presetId: 'preset-hd',
      condition: {
        version: 1,
        root: createFilterGroup('and', [
          createFilterRule('folder', 'is', { folderId: 'folder-1' }),
        ]),
      },
    },
  ],
  defaults: {
    temp_marker_toggle: 1,
    included_file_types: 'mkv,mp4',
  },
};

const presets = [
  {
    id: 'preset-default',
    name: 'Default',
    handbrake: { preset: 'Very Fast 1080p30' },
  },
  {
    id: 'preset-hd',
    name: 'HD',
    handbrake: { preset: 'Fast 1080p30' },
  },
  {
    id: 'preset-ffmpeg',
    name: 'FFmpeg',
    ffmpeg: { inputArgs: '', outputArgs: '-c:v libx264' },
  },
];

function appConfig(libraries: Library[] = [library]): AppConfigV2 {
  return {
    schema_version: APP_CONFIG_SCHEMA_VERSION,
    lang: 'en',
    version_message: 'test',
    selected_library: libraries[0].id,
    presets,
    libraries,
  };
}

describe('buildQueueBuildConfig for libraries', () => {
  it('emits the preset catalog, folder ids and mapping rules', () => {
    const config = appConfig();
    const payload = buildQueueBuildConfig({
      config: libraryToRuntimeConfig(config, library),
      library,
      presets,
      operationMode: BatchOperationMode.ScanOnly,
    });

    expect(payload.sources).toEqual(['/media/movies']);
    expect(payload.folderIds).toEqual(['folder-1']);
    expect(payload.container).toBe('.mkv');
    expect(payload.fileSuffixes).toEqual(['_hd']);
    expect(payload.defaultPresetId).toBe('preset-default');
    expect(payload.defaultPreset).toBe('-Z "Very Fast 1080p30"');
    expect(payload.presets).toEqual(['-Z "Very Fast 1080p30"']);
    expect(payload.presetCatalog).toEqual([
      { id: 'preset-default', name: 'Default', argument: '-Z "Very Fast 1080p30"' },
      { id: 'preset-hd', name: 'HD', argument: '-Z "Fast 1080p30"' },
    ]);
    expect(payload.mappingRules).toHaveLength(1);
  });

  it('rejects an invalid library before scanning', () => {
    const invalid: Library = {
      ...library,
      defaultPresetId: 'missing',
    };
    const config = appConfig([invalid]);

    expect(() =>
      buildQueueBuildConfig({
        config: libraryToRuntimeConfig(config, invalid),
        library: invalid,
        presets,
        operationMode: BatchOperationMode.ScanOnly,
      }),
    ).toThrow(/Library configuration is invalid/);
  });
});
