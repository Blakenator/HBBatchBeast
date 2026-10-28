/**
 * Persisted conversion model.
 *
 * A library owns the folders, scan filters, encoder/container and the ordered
 * preset mapping rules. Presets are reusable encoding recipes referenced by a
 * stable id. The legacy profile shape in `types.ts` is kept only as a runtime
 * adapter for the scanner/worker and as the v1 migration input.
 */

import type {
  FilterExpression,
  FilterNode,
  FilterRule,
} from './filterExpression';
import {
  defaultFilterExpression,
  expressionHasField,
  validateFilterExpression,
} from './filterExpression';
import {
  DEFAULT_INCLUDED_FILE_TYPES,
  DEFAULT_TEMP_MARKER_TOGGLE,
} from './defaults';
import { DEFAULT_GLOBAL_SETTINGS } from './appSettings';
import { HANDBRAKE_CONTAINERS } from './configValues';
import { outputContainerExtension } from './outputPaths';
import type {
  BatchTabConfig,
  GlobalAppConfig,
  GlobalSettingsConfig,
} from './types';

export const APP_CONFIG_SCHEMA_VERSION = 2;
export const DEFAULT_PRESET_ID = 'preset-default';
export const DEFAULT_LIBRARY_ID = 'library-default';

export type EncoderKind = 'handbrake' | 'ffmpeg';

export interface FolderPair {
  id: string;
  source: string;
  destination: string;
  temp?: string;
  suffix?: string;
}

/** Encoding recipe only; the library/run owns encoder and container. */
export interface ConversionPreset {
  id: string;
  name: string;
  handbrake?: { preset?: string; args?: string };
  ffmpeg?: { inputArgs?: string; outputArgs?: string };
}

export interface PresetRule {
  id: string;
  name?: string;
  /** Condition uses the shared filter expression tree with mapping fields. */
  condition: FilterExpression;
  presetId: string;
}

export interface RunDefaults {
  /** Stored here because it used to live in `path.temp_toggle`. */
  temp_toggle?: 0 | 1;
  included_file_types?: string;
  temp_marker_toggle?: 0 | 1;
  copy_srt_files_toggle?: 0 | 1;
  copy_filtered_files_toggle?: 0 | 1;
  include_converted_files_toggle?: 0 | 1;
  delete_source_files_toggle?: 0 | 1;
  replace_original_file_if_converted_is_smaller_toggle?: 0 | 1;
  replace_original_file_always_toggle?: 0 | 1;
  remove_filename_apostrophes?: 0 | 1;
  reverse_file_queue?: number;
  custom_bat_path?: string;
  low_process_priority_toggle?: 0 | 1;
}

export interface Library {
  id: string;
  name: string;
  folders: FolderPair[];
  filters: FilterExpression;
  encoder: EncoderKind;
  container: string;
  defaultPresetId: string;
  mappingRules: PresetRule[];
  defaults: RunDefaults;
}

export interface AppConfigV2 {
  schema_version: typeof APP_CONFIG_SCHEMA_VERSION;
  lang: string;
  app_settings?: Partial<GlobalSettingsConfig>;
  version_message: string;
  selected_library: string;
  presets: ConversionPreset[];
  libraries: Library[];
}

export interface PresetCatalogEntry {
  id: string;
  name: string;
  argument: string;
}

export interface PresetTrace {
  presetId: string;
  presetName: string;
  ruleId?: string;
  ruleName?: string;
}

export const DEFAULT_PRESET: ConversionPreset = {
  id: DEFAULT_PRESET_ID,
  name: 'Very Fast 1080p30',
  handbrake: { preset: 'Very Fast 1080p30' },
};

export function createLibraryId(): string {
  return `library-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function createFolderId(): string {
  return `folder-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function createPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function createRuleId(): string {
  return `rule-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function presetMatchesEncoder(
  preset: ConversionPreset,
  encoder: EncoderKind,
): boolean {
  return encoder === 'handbrake'
    ? Boolean(preset.handbrake)
    : Boolean(preset.ffmpeg);
}

/** CLI argument consumed by the worker; FFmpeg uses the current input,output pair. */
export function presetArgument(preset: ConversionPreset | undefined): string {
  if (!preset) return '';
  if (preset.handbrake) {
    const args = (preset.handbrake.args ?? '').trim();
    if (args) return args;
    const presetName = (preset.handbrake.preset ?? '').trim();
    return presetName ? `-Z "${presetName}"` : '';
  }
  if (preset.ffmpeg) {
    const input = (preset.ffmpeg.inputArgs ?? '').trim();
    const output = (preset.ffmpeg.outputArgs ?? '').trim();
    if (!input && !output) return '';
    return `${input},${output}`;
  }
  return '';
}

export function presetDisplayName(
  preset: ConversionPreset | undefined,
): string {
  if (!preset) return '';
  const name = preset.name.trim();
  if (name) return name;
  return presetArgument(preset);
}

export function presetCatalog(
  presets: ConversionPreset[],
  encoder: EncoderKind,
): PresetCatalogEntry[] {
  return presets
    .filter((preset) => presetMatchesEncoder(preset, encoder))
    .map((preset) => ({
      id: preset.id,
      name: presetDisplayName(preset),
      argument: presetArgument(preset),
    }))
    .filter((entry) => entry.argument.length > 0);
}

export function libraryToBatchTabConfig(library: Library): BatchTabConfig {
  const sources = library.folders.map((folder) => folder.source.trim());
  const destinations = library.folders.map((folder) =>
    folder.destination.trim(),
  );
  const tempDestinations = library.folders.map((folder) =>
    (folder.temp ?? '').trim(),
  );
  const suffixes = library.folders.map((folder) => folder.suffix ?? '');
  const defaults = library.defaults;

  return {
    path: {
      source_path: sources.join('\n'),
      destination_path: destinations.join('\n'),
      temp_destination_path: tempDestinations.join('\n'),
      temp_toggle: defaults.temp_toggle === 1 ? 1 : 0,
    },
    advanced: {
      included_file_types:
        defaults.included_file_types ?? DEFAULT_INCLUDED_FILE_TYPES,
      temp_marker_toggle:
        defaults.temp_marker_toggle ?? DEFAULT_TEMP_MARKER_TOGGLE,
      copy_srt_files_toggle: defaults.copy_srt_files_toggle ?? 0,
      copy_filtered_files_toggle: defaults.copy_filtered_files_toggle ?? 0,
      include_converted_files_toggle:
        defaults.include_converted_files_toggle ?? 0,
      delete_source_files_toggle: defaults.delete_source_files_toggle ?? 0,
      replace_original_file_if_converted_is_smaller_toggle:
        defaults.replace_original_file_if_converted_is_smaller_toggle ?? 0,
      replace_original_file_always_toggle:
        defaults.replace_original_file_always_toggle ?? 0,
      remove_filename_apostrophes: defaults.remove_filename_apostrophes ?? 0,
      reverse_file_queue: defaults.reverse_file_queue ?? 0,
      custom_bat_path: defaults.custom_bat_path ?? '',
      low_process_priority_toggle: defaults.low_process_priority_toggle ?? 0,
      file_name_suffix: suffixes.join('\n'),
      file_name_suffix_toggle: suffixes.some((suffix) => suffix.trim()) ? 1 : 0,
      filter_expression: library.filters,
    } as BatchTabConfig['advanced'],
    HandBrake_toggle: library.encoder === 'handbrake' ? 1 : 0,
    FFmpeg_toggle: library.encoder === 'ffmpeg' ? 1 : 0,
    custom_preset_toggle: 0,
    preset: '',
    custom_preset_string: '',
    container: library.container,
  };
}

/**
 * Runtime adapter for the existing scanner/worker pipeline. Library data is the
 * source of truth; this derived profile is never persisted.
 */
export function libraryToRuntimeConfig(
  config: AppConfigV2,
  library: Library,
): GlobalAppConfig {
  return {
    lang: config.lang,
    app_settings: config.app_settings,
    selected_config: 0,
    version_message: config.version_message,
    configs: [
      { name: library.name, tab_batch: libraryToBatchTabConfig(library) },
    ],
  };
}

export function emptyLibrary(
  options: { id?: string; name?: string; defaultPresetId?: string } = {},
): Library {
  return {
    id: options.id ?? createLibraryId(),
    name: options.name ?? 'New library',
    folders: [],
    filters: defaultFilterExpression(),
    encoder: 'handbrake',
    container: '.mkv',
    defaultPresetId: options.defaultPresetId ?? DEFAULT_PRESET_ID,
    mappingRules: [],
    defaults: {
      temp_marker_toggle: DEFAULT_TEMP_MARKER_TOGGLE,
      included_file_types: DEFAULT_INCLUDED_FILE_TYPES,
    },
  };
}

/**
 * Temporary library used by Quick convert. It intentionally never carries
 * destructive options into a one-off run.
 */
export function createQuickLibrary(
  presets: ConversionPreset[],
  source?: Library,
): Library {
  const base = source
    ? (JSON.parse(JSON.stringify(source)) as Library)
    : emptyLibrary({
        name: 'Quick conversion',
        defaultPresetId: presets[0]?.id ?? '',
      });
  if (!source && presets[0]?.ffmpeg) {
    base.encoder = 'ffmpeg';
    base.container = '.mp4';
  }
  return {
    ...base,
    id: createLibraryId(),
    name: 'Quick conversion',
    defaults: {
      ...base.defaults,
      delete_source_files_toggle: 0,
      replace_original_file_always_toggle: 0,
      replace_original_file_if_converted_is_smaller_toggle: 0,
    },
  };
}

export function cloneEmptyLibrary(
  source: Library,
  name?: string,
): Library {
  const copy = JSON.parse(JSON.stringify(source)) as Library;
  return {
    ...copy,
    id: createLibraryId(),
    name: name?.trim() || `${source.name} copy`,
  };
}

export function createDefaultAppConfig(version: string): AppConfigV2 {
  const library = emptyLibrary({
    id: DEFAULT_LIBRARY_ID,
    name: 'My Library',
    defaultPresetId: DEFAULT_PRESET_ID,
  });
  return {
    schema_version: APP_CONFIG_SCHEMA_VERSION,
    lang: 'en',
    app_settings: { ...DEFAULT_GLOBAL_SETTINGS },
    version_message: version,
    selected_library: library.id,
    presets: [{ ...DEFAULT_PRESET }],
    libraries: [library],
  };
}

function folderConditionText(ruleValue: unknown): string {
  if (!ruleValue || typeof ruleValue !== 'object') return 'folder';
  const value = ruleValue as { folderId?: unknown; subpath?: unknown };
  return `folder ${String(value.folderId ?? '')}${
    value.subpath ? ` / ${String(value.subpath)}` : ''
  }`;
}

function flattenRules(expression: FilterExpression): FilterRule[] {
  const rows: FilterRule[] = [];
  const walk = (node: FilterNode) => {
    if (node.kind === 'group') {
      node.children.forEach(walk);
      return;
    }
    rows.push(node);
  };
  walk(expression.root);
  return rows;
}

/** Blocking problems for a library; empty means it can be scanned. */
export function validateLibrary(
  library: Library | undefined,
  presets: ConversionPreset[],
): string[] {
  if (!library) return ['Select a library.'];
  const problems: string[] = [];
  if (!library.name.trim()) problems.push('Give the library a name.');

  const folders = library.folders.filter(
    (folder) => folder.source.trim() || folder.destination.trim(),
  );
  if (folders.length === 0) {
    problems.push('Add at least one source folder and its destination.');
  }
  for (const [index, folder] of folders.entries()) {
    const source = folder.source.trim();
    const destination = folder.destination.trim();
    if (!source) {
      problems.push(`Folder ${index + 1}: add a source folder.`);
    }
    if (!destination) {
      problems.push(`Folder ${index + 1}: add a destination folder.`);
    }
    if (source && destination && isPathInside(destination, source)) {
      problems.push(
        `Folder ${index + 1}: destination ${destination} is inside source ${source}; choose a folder outside it.`,
      );
    }
    if (
      library.defaults.temp_toggle === 1 &&
      source &&
      !(folder.temp ?? '').trim()
    ) {
      problems.push(`Folder ${index + 1}: add a temp folder for ${source}.`);
    }
  }

  const compatiblePresets = presets.filter((preset) =>
    presetMatchesEncoder(preset, library.encoder),
  );
  const compatible = new Set(compatiblePresets.map((preset) => preset.id));
  const defaultPreset = compatiblePresets.find(
    (preset) => preset.id === library.defaultPresetId,
  );
  if (!defaultPreset) {
    problems.push(
      library.encoder === 'handbrake'
        ? 'Choose a default HandBrake preset for this library.'
        : 'Choose a default FFmpeg preset for this library.',
    );
  } else if (!presetArgument(defaultPreset)) {
    problems.push('The default preset has no encoding arguments.');
  }

  if (
    library.encoder === 'handbrake' &&
    !(HANDBRAKE_CONTAINERS as readonly string[]).includes(
      outputContainerExtension(library.container),
    )
  ) {
    problems.push(
      `HandBrake cannot write ${library.container} files; choose MP4, M4V, or MKV.`,
    );
  }

  for (const [index, rule] of library.mappingRules.entries()) {
    const label = rule.name?.trim() || `Rule ${index + 1}`;
    const rulePreset = compatiblePresets.find(
      (preset) => preset.id === rule.presetId,
    );
    if (!compatible.has(rule.presetId) || !rulePreset) {
      problems.push(`${label}: choose a preset compatible with this library.`);
    } else if (!presetArgument(rulePreset)) {
      problems.push(`${label}: the selected preset has no encoding arguments.`);
    }
    problems.push(
      ...validateFilterExpression(rule.condition).map(
        (problem) => `${label}: ${problem}`,
      ),
    );
    if (rule.condition.root.children.length === 0) {
      problems.push(`${label}: add at least one condition.`);
    }
    if (expressionHasField(rule.condition, 'outputState')) {
      problems.push(`${label}: output state cannot be used to choose a preset.`);
    }
    for (const condition of flattenRules(rule.condition)) {
      if (condition.field !== 'folder') continue;
      const value = condition.value as
        | { folderId?: unknown; subpath?: unknown }
        | null;
      if (!value || typeof value.folderId !== 'string') continue;
      if (!library.folders.some((folder) => folder.id === value.folderId)) {
        problems.push(
          `${label}: ${folderConditionText(value)} refers to a removed folder.`,
        );
      }
    }
  }

  return problems;
}

export function isPathInside(child: string, parent: string): boolean {
  const normalize = (value: string) => value.replace(/[\\/]+$/, '');
  const childPath = normalize(child);
  const parentPath = normalize(parent);
  if (!parentPath) return false;
  return (
    childPath === parentPath ||
    childPath.startsWith(`${parentPath}/`) ||
    childPath.startsWith(`${parentPath}\\`)
  );
}

/** Presets referenced by a library's default or mapping rules. */
export function libraryPresetIds(library: Library): Set<string> {
  const ids = new Set<string>();
  if (library.defaultPresetId) ids.add(library.defaultPresetId);
  library.mappingRules.forEach((rule) => ids.add(rule.presetId));
  return ids;
}
