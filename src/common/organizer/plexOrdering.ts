import type { PlexLibraryOrdering } from './types';

/**
 * Plex stores library and per-show preferences in `user_fields`, either as a
 * JSON object (new agent) or as a URL-encoded query string (older databases).
 */
export function parsePlexUserFields(
  value: string | null | undefined,
): Record<string, string> {
  if (!value) return {};
  const trimmed = value.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const fields: Record<string, string> = {};
      for (const [key, entry] of Object.entries(parsed)) {
        if (entry === null || entry === undefined) continue;
        fields[key] = String(entry);
      }
      return fields;
    } catch {
      return {};
    }
  }
  try {
    return Object.fromEntries(new URLSearchParams(trimmed).entries());
  } catch {
    return {};
  }
}

/** The show ordering Plex uses for a library or a single show. */
export function plexShowOrdering(
  value: string | null | undefined,
): string | undefined {
  return parsePlexUserFields(value)['pr:showOrdering'];
}

/**
 * Plex can order episodes by TheTVDB (aired/DVD/absolute) or TheMovieDB.
 * The organizer's TVDB lookup only matches the TheTVDB variants.
 */
export function isTmdbShowOrdering(value: string | undefined): boolean {
  return /^tmdb/i.test((value ?? '').trim());
}

/**
 * A review warning when Plex is configured to use TMDB episode ordering, which
 * can assign a renamed `SxxEyy` file to a different episode than TVDB.
 */
export function plexOrderingWarning(
  orderings: readonly PlexLibraryOrdering[] | undefined,
): string | undefined {
  const tmdb = (orderings ?? []).filter((entry) =>
    isTmdbShowOrdering(entry.showOrdering),
  );
  if (tmdb.length === 0) return undefined;
  const sections = tmdb
    .map((entry) => (entry.name ? `"${entry.name}"` : `section ${entry.sectionId}`))
    .join(', ');
  return `Plex is using TMDB episode ordering for ${sections}. The organizer renames from TVDB's Aired order, so Plex may show a different episode after renaming. Switch the Plex TV library's Episode ordering to TheTVDB (Aired) (Manage Library → Edit → Advanced) before organizing.`;
}
