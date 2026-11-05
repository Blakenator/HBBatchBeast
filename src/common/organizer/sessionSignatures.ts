import type { Library } from '../library';
import type { OrganizeSettings } from './settings';

function stableObject(value: Record<string, unknown> | undefined): string {
  if (!value) return '';
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
}

/**
 * Inputs that decide which series/episode/movie a file matches. A change here
 * requires re-matching from cached discovery data.
 */
export function organizeMatchSignature(settings: OrganizeSettings): string {
  return JSON.stringify({
    movieMetadata: settings.movieMetadata,
    caseInsensitive: settings.caseInsensitive ?? false,
    tvdb: {
      shows: (settings.tvdb?.shows ?? []).map((show) => ({
        folderId: show.folderId,
        subpath: show.subpath,
        series: show.series,
      })),
    },
    nameReplacements: settings.nameReplacements ?? [],
    overrides: stableObject(settings.overrides),
  });
}

/**
 * Inputs that only decide how a matched file is renamed. A change here can be
 * applied by re-planning the existing review items locally.
 */
export function organizePlanSignature(settings: OrganizeSettings): string {
  return JSON.stringify({
    namingRules: settings.namingRules.map(({ id: _id, ...rule }) => rule),
    confidenceThreshold: settings.confidenceThreshold,
    sidecars: settings.sidecars,
    collisions: settings.collisions,
    caseInsensitive: settings.caseInsensitive ?? false,
    renameMovieFolders: settings.renameMovieFolders,
  });
}

/** Inputs that determine which files are discovered. */
export function organizeLibrarySignature(library: Library): string {
  return JSON.stringify({
    mediaType: library.mediaType,
    folders: library.folders.map((folder) => ({
      id: folder.id,
      source: folder.source,
    })),
  });
}
