import { parseMediaFilename } from './filename';
import type { OrganizeNameReplacement } from './settings';
import type { ParsedMediaName } from './types';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Applies the configured literal name replacements in order. Matching is
 * case-insensitive; the replacement text is used exactly as entered.
 */
export function applyNameReplacements(
  value: string,
  replacements: readonly OrganizeNameReplacement[] | undefined,
): string {
  let result = value;
  for (const rule of replacements ?? []) {
    if (!rule.find) continue;
    result = result
      .split(new RegExp(escapeRegExp(rule.find), 'gi'))
      .join(rule.replace);
  }
  return result;
}

/** Applies replacements to the parsed title fields used by matching. */
export function applyParsedNameReplacements(
  parsed: ParsedMediaName,
  replacements: readonly OrganizeNameReplacement[] | undefined,
): ParsedMediaName {
  if (!replacements || replacements.length === 0) return parsed;
  const episodeTitle = parsed.episodeTitle
    ? applyNameReplacements(parsed.episodeTitle, replacements)
    : undefined;
  return {
    ...parsed,
    title: applyNameReplacements(parsed.title, replacements),
    cleanTitle: applyNameReplacements(parsed.cleanTitle, replacements),
    ...(episodeTitle !== undefined ? { episodeTitle } : {}),
  };
}

/**
 * Parses a filename with the library's replacement list applied both to the
 * raw name (so separator rules work) and to the parsed title fields (so
 * multi-word rules work after dots/underscores become spaces).
 */
export function parseMediaFilenameWithReplacements(
  filename: string,
  relativePath: string,
  replacements: readonly OrganizeNameReplacement[] | undefined,
): ParsedMediaName {
  const parsed = parseMediaFilename(
    applyNameReplacements(filename, replacements),
    relativePath,
  );
  return applyParsedNameReplacements(parsed, replacements);
}
