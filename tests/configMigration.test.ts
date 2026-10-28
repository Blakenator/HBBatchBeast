import { describe, expect, it } from 'vitest';
import {
  APP_CONFIG_SCHEMA_VERSION,
  GlobalAppConfig,
  migrateAppConfig,
} from '../src/common';

function legacy(overrides: Partial<GlobalAppConfig> = {}): GlobalAppConfig {
  return {
    lang: 'en',
    app_settings: { worker_instance_number: '6', save_worker_logs_toggle: 1 },
    selected_config: 0,
    version_message: 'test',
    configs: [
      {
        name: 'Movies',
        tab_batch: {
          path: {
            source_path: '/media/movies',
            destination_path: '/out/movies',
            temp_destination_path: '',
            temp_toggle: 0,
          },
          preset: 'Fast 1080p30',
          container: '.mkv',
          FFmpeg_toggle: 0,
          advanced: { included_file_types: 'mkv,mp4' },
        },
      },
    ],
    ...overrides,
  };
}

describe('migrateAppConfig', () => {
  it('converts a profile to a library with a reusable preset', () => {
    const { config, changed } = migrateAppConfig(legacy());

    expect(changed).toBe(true);
    expect(config.schema_version).toBe(APP_CONFIG_SCHEMA_VERSION);
    expect(config.libraries).toHaveLength(1);
    expect(config.presets).toHaveLength(1);
    expect(config.presets[0].handbrake?.preset).toBe('Fast 1080p30');
    const library = config.libraries[0];
    expect(library.name).toBe('Movies');
    expect(library.folders).toHaveLength(1);
    expect(library.folders[0].source).toBe('/media/movies');
    expect(library.defaultPresetId).toBe(config.presets[0].id);
    expect(library.mappingRules).toHaveLength(0);
    expect(library.encoder).toBe('handbrake');
    expect(library.container).toBe('.mkv');
    expect(config.selected_library).toBe(library.id);
    expect(config.app_settings?.worker_instance_number).toBe('6');
  });

  it('turns differing per-folder presets into ordered folder rules', () => {
    const { config } = migrateAppConfig(
      legacy({
        configs: [
          {
            name: 'Mixed',
            tab_batch: {
              path: {
                source_path: '/tv\n/movies',
                destination_path: '/out/tv\n/out/movies',
                temp_destination_path: '',
                temp_toggle: 1,
              },
              custom_preset_string: 'Fast 720p30\nHQ 1080p30 Surround',
              container: '.mp4',
              advanced: {
                file_name_suffix_toggle: 1,
                file_name_suffix: '_720p\n_1080p',
              },
            },
          },
        ],
      }),
    );

    const library = config.libraries[0];
    expect(config.presets.map((preset) => preset.handbrake?.preset)).toEqual([
      'Fast 720p30',
      'HQ 1080p30 Surround',
    ]);
    expect(library.mappingRules).toHaveLength(2);
    expect(library.mappingRules[0].presetId).toBe(config.presets[0].id);
    expect(library.mappingRules[1].presetId).toBe(config.presets[1].id);
    expect(library.defaultPresetId).toBe(config.presets[0].id);
    expect(library.defaults.temp_toggle).toBe(1);
    expect(library.folders.map((folder) => folder.suffix)).toEqual([
      '_720p',
      '_1080p',
    ]);

    const firstCondition = library.mappingRules[0].condition.root.children[0];
    expect(firstCondition).toMatchObject({
      field: 'folder',
      operator: 'is',
      value: { folderId: library.folders[0].id },
    });
  });

  it('migrates FFmpeg input/output pairs without wrapping them as presets', () => {
    const { config } = migrateAppConfig(
      legacy({
        configs: [
          {
            name: 'FFmpeg',
            tab_batch: {
              path: {
                source_path: '/media',
                destination_path: '/out',
                temp_destination_path: '',
                temp_toggle: 0,
              },
              FFmpeg_toggle: 1,
              custom_preset_string: '-ss 10,-c:v libx264 -crf 20',
              container: 'mkv',
            },
          },
        ],
      }),
    );

    const library = config.libraries[0];
    expect(library.encoder).toBe('ffmpeg');
    expect(config.presets[0].ffmpeg).toEqual({
      inputArgs: '-ss 10',
      outputArgs: '-c:v libx264 -crf 20',
    });
    expect(library.container).toBe('.mkv');
  });

  it('keeps already-current files intact', () => {
    const current = {
      schema_version: 2 as const,
      lang: 'de',
      version_message: 'x',
      selected_library: 'library-1',
      presets: [
        { id: 'preset-1', name: 'One', handbrake: { preset: 'Fast 1080p30' } },
      ],
      libraries: [
        {
          id: 'library-1',
          name: 'One',
          folders: [{ id: 'folder-1', source: '/a', destination: '/b' }],
          filters: {
            version: 1 as const,
            root: {
              id: 'g',
              kind: 'group' as const,
              combinator: 'and' as const,
              children: [],
            },
          },
          encoder: 'handbrake' as const,
          container: '.mkv',
          defaultPresetId: 'preset-1',
          mappingRules: [],
          defaults: {},
        },
      ],
    };

    const { config } = migrateAppConfig(current);
    expect(config.libraries[0].name).toBe('One');
    expect(config.libraries[0].folders[0].id).toBe('folder-1');
  });
});
