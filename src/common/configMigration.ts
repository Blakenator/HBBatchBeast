/**
 * One-way migration from the v1 profile file to the library/preset model.
 *
 * The migration is pure: it returns the converted config and whether the caller
 * should persist it. Handlers write a `.v1.bak` copy before replacing the file.
 */

import {
  APP_CONFIG_SCHEMA_VERSION,
  DEFAULT_PRESET,
  type AppConfigV2,
  type ConversionPreset,
  type EncoderKind,
  type FolderPair,
  type Library,
  type PresetRule,
  type RunDefaults,
  createDefaultAppConfig,
  createFolderId,
  createLibraryId,
  createPresetId,
  createRuleId,
  emptyLibrary,
} from './library';
import {
  normalizePresetName,
  parseCommandPair,
  parseMappedRows,
} from './configValues';
import { outputContainerExtension } from './outputPaths';
import {
  createFilterGroup,
  createFilterRule,
  resolveFilterExpression,
  type FilterExpression,
} from './filterExpression';
import { DEFAULT_GLOBAL_SETTINGS } from './appSettings';
import type {
  BatchConfig,
  BatchTabConfig,
  GlobalAppConfig,
  GlobalSettingsConfig,
} from './types';

function trimOrEmpty(value: string | undefined): string {
  return (value ?? '').trim();
}

function padTo(length: number, values: string[], fallback: string): string[] {
  return Array.from({ length }, (_, index) => values[index] ?? fallback);
}

function pickDefaults(batch: Partial<BatchTabConfig>): RunDefaults {
  const advanced: Partial<BatchTabConfig['advanced']> = batch.advanced ?? {};
  return {
    temp_toggle: batch.path?.temp_toggle === 1 ? 1 : 0,
    included_file_types: advanced.included_file_types,
    temp_marker_toggle: advanced.temp_marker_toggle,
    copy_srt_files_toggle: advanced.copy_srt_files_toggle,
    copy_filtered_files_toggle: advanced.copy_filtered_files_toggle,
    include_converted_files_toggle:
      advanced.include_converted_files_toggle,
    delete_source_files_toggle: advanced.delete_source_files_toggle,
    replace_original_file_if_converted_is_smaller_toggle:
      advanced.replace_original_file_if_converted_is_smaller_toggle,
    replace_original_file_always_toggle:
      advanced.replace_original_file_always_toggle,
    remove_filename_apostrophes: advanced.remove_filename_apostrophes,
    reverse_file_queue: advanced.reverse_file_queue,
    custom_bat_path: advanced.custom_bat_path,
    low_process_priority_toggle: advanced.low_process_priority_toggle,
  };
}

interface PresetFactory {
  fromRow: (row: string, encoder: EncoderKind) => ConversionPreset | undefined;
}

function createPresetFactory(): PresetFactory {
  const byKey = new Map<string, ConversionPreset>();
  const usedNames = new Map<string, string>();

  const uniqueName = (desired: string, key: string): string => {
    const trimmed = desired.trim() || 'Preset';
    const owner = usedNames.get(trimmed);
    if (!owner || owner === key) {
      usedNames.set(trimmed, key);
      return trimmed;
    }
    let suffix = 2;
    let candidate = `${trimmed} (${suffix})`;
    while (usedNames.has(candidate)) {
      suffix += 1;
      candidate = `${trimmed} (${suffix})`;
    }
    usedNames.set(candidate, key);
    return candidate;
  };

  return {
    fromRow: (row, encoder) => {
      const value = row.trim();
      if (!value) return undefined;

      if (encoder === 'handbrake') {
        const isPresetArgument = /^-Z\s/i.test(value);
        const isArguments = value.startsWith('-') && !isPresetArgument;
        const key = isArguments
          ? `handbrake:args:${value}`
          : `handbrake:preset:${normalizePresetName(value)}`;
        const existing = byKey.get(key);
        if (existing) return existing;

        const preset: ConversionPreset = isArguments
          ? {
              id: createPresetId(),
              name: uniqueName('HandBrake arguments', key),
              handbrake: { args: value },
            }
          : {
              id: createPresetId(),
              name: uniqueName(normalizePresetName(value), key),
              handbrake: { preset: normalizePresetName(value) },
            };
        byKey.set(key, preset);
        return preset;
      }

      const pair = parseCommandPair(value);
      if (!pair.input && !pair.output) return undefined;
      const key = `ffmpeg:${pair.input}|${pair.output}`;
      const existing = byKey.get(key);
      if (existing) return existing;
      const preset: ConversionPreset = {
        id: createPresetId(),
        name: uniqueName('FFmpeg arguments', key),
        ffmpeg: { inputArgs: pair.input, outputArgs: pair.output },
      };
      byKey.set(key, preset);
      return preset;
    },
  };
}

function folderRule(folder: FolderPair, presetId: string): PresetRule {
  const condition: FilterExpression = {
    version: 1,
    root: createFilterGroup('and', [
      createFilterRule('folder', 'is', { folderId: folder.id }),
    ]),
  };
  return {
    id: createRuleId(),
    name: `Folder ${folder.source.split(/[\\/]/).pop() || folder.id}`,
    condition,
    presetId,
  };
}

interface MigratedProfile {
  library: Library;
  presets: ConversionPreset[];
}

function migrateProfile(
  profile: BatchConfig,
  index: number,
  factory: PresetFactory,
): MigratedProfile {
  const batch: Partial<BatchTabConfig> = profile.tab_batch ?? {};
  const advanced: Partial<BatchTabConfig['advanced']> = batch.advanced ?? {};
  const paths: Partial<BatchTabConfig['path']> = batch.path ?? {};
  const encoder: EncoderKind =
    batch.FFmpeg_toggle === 1 ? 'ffmpeg' : 'handbrake';

  const sources = parseMappedRows(paths.source_path);
  const destinations = parseMappedRows(paths.destination_path);
  const tempEnabled = paths.temp_toggle === 1;
  const temps = tempEnabled
    ? parseMappedRows(paths.temp_destination_path)
    : [];
  const suffixRows =
    advanced.file_name_suffix_toggle === 1
      ? parseMappedRows(advanced.file_name_suffix)
      : [];
  const folderCount = Math.max(
    sources.length,
    destinations.length,
    temps.length,
  );

  const folders: FolderPair[] = Array.from({ length: folderCount }, (_, i) => ({
    id: createFolderId(),
    source: trimOrEmpty(sources[i]),
    destination: trimOrEmpty(destinations[i]),
    ...(tempEnabled ? { temp: trimOrEmpty(temps[i]) } : {}),
    ...(suffixRows[i]?.trim() ? { suffix: suffixRows[i].trim() } : {}),
  }));

  const customRows = parseMappedRows(batch.custom_preset_string);
  const hasCustomRows = customRows.some((row) => row.trim().length > 0);
  const presetRows =
    encoder === 'ffmpeg'
      ? customRows
      : hasCustomRows
        ? customRows
        : parseMappedRows(batch.preset);
  const firstPresetRow =
    presetRows.find((row) => row.trim().length > 0) ?? '';
  const paddedPresetRows = padTo(folderCount, presetRows, firstPresetRow);

  const presets: ConversionPreset[] = [];
  const folderPresetIds = paddedPresetRows.map((row) => {
    const preset = factory.fromRow(row, encoder);
    if (!preset) return '';
    if (!presets.some((item) => item.id === preset.id)) presets.push(preset);
    return preset.id;
  });

  const defaultPresetId = folderPresetIds.find((id) => id.length > 0) ?? '';
  const distinct = new Set(folderPresetIds.filter(Boolean));
  const mappingRules =
    distinct.size > 1
      ? folders.flatMap((folder, i) => {
          const presetId = folderPresetIds[i];
          return presetId ? [folderRule(folder, presetId)] : [];
        })
      : [];

  return {
    library: {
      id: createLibraryId(),
      name: profile.name?.trim() || `Library ${index + 1}`,
      folders,
      filters: resolveFilterExpression(advanced),
      encoder,
      container: outputContainerExtension(batch.container),
      defaultPresetId,
      mappingRules,
      defaults: pickDefaults(batch),
    },
    presets,
  };
}

function legacySettings(raw: GlobalAppConfig): Partial<GlobalSettingsConfig> {
  if (raw.app_settings) return raw.app_settings;
  const selected = raw.configs?.[raw.selected_config ?? 0];
  return selected?.tab_system ?? { ...DEFAULT_GLOBAL_SETTINGS };
}

function normalizeV2(raw: Partial<AppConfigV2>): AppConfigV2 {
  const libraries =
    Array.isArray(raw.libraries) && raw.libraries.length > 0
      ? raw.libraries
      : [
          emptyLibrary({
            defaultPresetId: raw.presets?.[0]?.id ?? DEFAULT_PRESET.id,
          }),
        ];
  const presets =
    Array.isArray(raw.presets) && raw.presets.length > 0
      ? raw.presets
      : [{ ...DEFAULT_PRESET }];
  const selected =
    raw.selected_library &&
    libraries.some((library) => library.id === raw.selected_library)
      ? raw.selected_library
      : libraries[0].id;

  return {
    schema_version: APP_CONFIG_SCHEMA_VERSION,
    lang: raw.lang ?? 'en',
    app_settings: raw.app_settings ?? { ...DEFAULT_GLOBAL_SETTINGS },
    version_message: raw.version_message ?? '',
    selected_library: selected,
    presets,
    libraries: libraries.map((library) => ({
      ...library,
      filters: library.filters ?? resolveFilterExpression(undefined),
      mappingRules: library.mappingRules ?? [],
      defaults: library.defaults ?? {},
      folders: (library.folders ?? []).map((folder) => ({
        ...folder,
        id: folder.id || createFolderId(),
      })),
    })),
  };
}

/**
 * Converts a loaded configuration file to the current schema. Already-current
 * files are normalized without dropping known data.
 */
export function migrateAppConfig(raw: unknown): {
  config: AppConfigV2;
  changed: boolean;
} {
  if (!raw || typeof raw !== 'object') {
    return { config: createDefaultAppConfig(''), changed: true };
  }

  const candidate = raw as Partial<AppConfigV2> & Partial<GlobalAppConfig>;
  if (candidate.schema_version === APP_CONFIG_SCHEMA_VERSION) {
    const config = normalizeV2(candidate);
    // Normalization may add missing ids/defaults; persist that once so a
    // partially written v2 file cannot regenerate folder ids on every launch.
    return {
      config,
      changed: JSON.stringify(candidate) !== JSON.stringify(config),
    };
  }

  const legacyConfigs = candidate.configs;
  if (!Array.isArray(legacyConfigs) || legacyConfigs.length === 0) {
    return {
      config: createDefaultAppConfig(candidate.version_message ?? ''),
      changed: true,
    };
  }

  const factory = createPresetFactory();
  const migrated = legacyConfigs.map((profile, index) =>
    migrateProfile(profile ?? { tab_batch: {} }, index, factory),
  );
  const presetById = new Map<string, ConversionPreset>();
  for (const entry of migrated) {
    for (const preset of entry.presets) {
      if (!presetById.has(preset.id)) presetById.set(preset.id, preset);
    }
  }

  const libraries = migrated.map((entry) => entry.library);
  const selectedIndex = candidate.selected_config ?? 0;
  const selected = libraries[selectedIndex]?.id ?? libraries[0]?.id ?? '';

  return {
    config: {
      schema_version: APP_CONFIG_SCHEMA_VERSION,
      lang: candidate.lang ?? 'en',
      app_settings: legacySettings(candidate as GlobalAppConfig),
      version_message: candidate.version_message ?? '',
      selected_library: selected,
      presets: [...presetById.values()],
      libraries,
    },
    changed: true,
  };
}
