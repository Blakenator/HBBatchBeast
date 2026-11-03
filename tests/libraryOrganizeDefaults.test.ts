import { describe, expect, it } from 'vitest';
import {
  APP_CONFIG_SCHEMA_VERSION,
  DEFAULT_PRESET,
  createDefaultAppConfig,
  createOrganizeSettings,
  createQuickOrganizeLibrary,
  emptyLibrary,
  libraryOrganizeSettings,
  migrateAppConfig,
  resolveOrganizeSettings,
  validateLibrary,
  withLibraryMediaType,
} from '../src/common';

function v2Config() {
  return {
    schema_version: 2,
    lang: 'en',
    version_message: 'test',
    selected_library: 'library-1',
    app_settings: {},
    presets: [{ ...DEFAULT_PRESET }],
    libraries: [
      {
        id: 'library-1',
        name: 'Movies',
        folders: [
          { id: 'folder-1', source: '/media/movies', destination: '/out' },
        ],
        filters: undefined,
        encoder: 'handbrake',
        container: '.mkv',
        defaultPresetId: DEFAULT_PRESET.id,
        mappingRules: [],
        defaults: {},
      },
    ],
  };
}

describe('library organizer defaults', () => {
  it('gives a migrated v2 library organizer defaults', () => {
    const { config, changed } = migrateAppConfig(v2Config());

    expect(changed).toBe(true);
    expect(config.schema_version).toBe(APP_CONFIG_SCHEMA_VERSION);
    expect(config.libraries[0].mediaType).toBe('movies');
    expect(config.libraries[0].organize?.namingRules.length).toBeGreaterThan(0);
  });

  it('strips the retired capability field and keeps a customized profile', () => {
    const library = {
      ...emptyLibrary({ id: 'lib', mediaType: 'tv' }),
      capabilities: ['organize'],
      organize: { ...createOrganizeSettings('tv') },
    };
    const { config } = migrateAppConfig({
      ...createDefaultAppConfig('test'),
      libraries: [library as never],
    });

    expect(config.libraries[0]).not.toHaveProperty('capabilities');
    expect(config.libraries[0].mediaType).toBe('tv');
    expect(config.libraries[0].organize?.namingRules[0].folderTemplate).toBe(
      '{show}/Season {season:02}',
    );
  });

  it('defaults organizer settings for libraries saved without them', () => {
    const library = { ...emptyLibrary({ id: 'lib' }), organize: undefined };

    expect(libraryOrganizeSettings(library).namingRules[0].folderTemplate).toBe(
      '{title} ({year}) [{resolution}]',
    );
    expect(
      resolveOrganizeSettings(undefined, 'tv').namingRules[0].folderTemplate,
    ).toBe('{show}/Season {season:02}');
  });

  it('hoists the legacy media type, Plex path and folder series', () => {
    const legacy = {
      ...v2Config(),
      schema_version: 3,
      libraries: [
        {
          ...v2Config().libraries[0],
          organize: {
            mediaType: 'tv',
            plex: { dbPath: '/var/lib/plex/library.db', updateByDefault: true },
            tvdb: {
              seriesByFolder: {
                'folder-1': { id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II' },
              },
            },
            namingRules: [],
          },
        },
      ],
    };
    const { config } = migrateAppConfig(legacy);

    expect(config.libraries[0].mediaType).toBe('tv');
    expect(config.app_settings?.plex).toEqual({
      dbPath: '/var/lib/plex/library.db',
      updateByDefault: true,
    });
    expect(config.libraries[0].organize?.tvdb?.shows).toEqual([
      expect.objectContaining({ folderId: 'folder-1', subpath: '' }),
    ]);
    expect(config.libraries[0].organize).not.toHaveProperty('plex');
    expect(config.libraries[0].organize).not.toHaveProperty('mediaType');
  });

  it('creates an unsaved quick organize copy', () => {
    const source = {
      ...emptyLibrary({ id: 'lib-source', name: 'TV', mediaType: 'tv' }),
      folders: [{ id: 'folder-1', source: '/media/tv', destination: '/out' }],
    };
    const quick = createQuickOrganizeLibrary({ source });

    expect(quick.id).not.toBe(source.id);
    expect(quick.name).toBe('Quick organize');
    expect(quick.mediaType).toBe('tv');
    expect(quick.folders).toEqual(source.folders);
    expect(createQuickOrganizeLibrary({}).mediaType).toBe('movies');
  });

  it('resets naming rules and match fixes when the type changes', () => {
    const library = {
      ...emptyLibrary({ id: 'lib', mediaType: 'tv' as const }),
      organize: {
        ...createOrganizeSettings('tv'),
        overrides: {
          '/media/tv/Show/S01E01.mkv': {
            episode: { tag: 'S01E01', name: 'One', seasonNumber: 1, episodeNumber: 1 },
          },
        },
        tvdb: {
          shows: [
            {
              id: 'show-1',
              folderId: 'folder-1',
              subpath: 'Show',
              series: { id: '1', slug: 'show', name: 'Show' },
            },
          ],
        },
      },
    };

    const movies = withLibraryMediaType(library, 'movies');
    expect(movies.mediaType).toBe('movies');
    expect(movies.organize?.overrides).toEqual({});
    expect(movies.organize?.tvdb?.shows).toEqual([]);
    expect(movies.organize?.namingRules[0].folderTemplate).toBe(
      '{title} ({year}) [{resolution}]',
    );
  });

  it('keeps conversion validation for every library', () => {
    const library = {
      ...emptyLibrary({ id: 'lib', name: 'Mixed' }),
      folders: [{ id: 'folder-1', source: '/media/tv', destination: '' }],
      defaultPresetId: '',
    };

    expect(validateLibrary(library, [{ ...DEFAULT_PRESET }])).toEqual(
      expect.arrayContaining([
        'Folder 1: add a destination folder.',
        'Choose a default HandBrake preset for this library.',
      ]),
    );
  });
});
