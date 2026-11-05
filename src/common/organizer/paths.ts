/**
 * Renderer-safe path and template helpers for the Organize mode.
 *
 * Everything here is pure: the backend and the renderer must produce the same
 * preview path. Actual filesystem operations belong in the backend.
 */

import {
  isPathInside,
  normalizePathForComparison,
  pathComparisonKey,
} from '../pathUtils';
import { formatTemplateValue } from './templateTokens';

const WINDOWS_RESERVED =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID_SEGMENT_CHARS = /[<>:"/\\|?*]/g;
const DRIVE_PATH = /^[a-zA-Z]:($|[/\\])/;
const UNC_PATH = /^[/\\]{2}/;
const TOKEN_PATTERN = /\{([a-zA-Z][a-zA-Z0-9_]*)(?::([a-zA-Z0-9_]+(?::[a-zA-Z0-9_]+)?))?\}/g;
const utf8 = new TextEncoder();

export class OrganizePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrganizePathError';
  }
}

export function isCaseInsensitivePlatform(platform: string): boolean {
  return platform === 'win32' || platform === 'darwin';
}

/**
 * Comparison key used for collisions and Plex path matching. macOS volumes are
 * case-insensitive by default even though their paths are POSIX-shaped.
 */
export function organizerComparisonKey(
  value: string,
  options: { caseInsensitive?: boolean } = {},
): string {
  const normalized = normalizePathForComparison(value.normalize('NFC'));
  return options.caseInsensitive ? normalized.toLowerCase() : pathComparisonKey(normalized);
}

export function organizerIsPathInside(
  child: string,
  parent: string,
  options: { caseInsensitive?: boolean } = {},
): boolean {
  if (!options.caseInsensitive) return isPathInside(child, parent);
  const childKey = organizerComparisonKey(child, options);
  const parentKey = organizerComparisonKey(parent, options);
  if (!childKey || !parentKey) return false;
  if (childKey === parentKey) return true;
  const prefix = parentKey === '/' ? '/' : `${parentKey}/`;
  return childKey.startsWith(prefix);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8.encode(value).length <= maxBytes) return value;
  let result = '';
  for (const character of value) {
    if (utf8.encode(result + character).length > maxBytes) break;
    result += character;
  }
  return result;
}

/**
 * Produces one cross-platform-safe path segment. Windows is the restrictive
 * target: invalid characters, reserved device names and trailing dots/spaces
 * are removed or rewritten; the byte limit keeps macOS/Linux happy too.
 */
export function sanitizePathSegment(
  value: string,
  options: { replacement?: string; maxBytes?: number } = {},
): string {
  const replacement = options.replacement ?? ' - ';
  const withoutControls = Array.from(value.normalize('NFC'))
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('');
  let result = withoutControls
    .replace(INVALID_SEGMENT_CHARS, (character) =>
      character === ':' ? replacement : '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .replace(/[. ]+$/, '')
    .trim();

  if (!result || result === '.' || result === '..') return '';
  if (WINDOWS_RESERVED.test(result)) result = `_${result}`;
  result = truncateUtf8(result, options.maxBytes ?? 255);
  return result.replace(/[. ]+$/, '').trim();
}

export type TemplateTokens = Record<string, string | number | undefined>;

/** Renders `{token}`, `{token:02}` and `{token:variant}` placeholders. */
export function renderTemplate(
  template: string,
  tokens: TemplateTokens,
): string {
  return template.replace(
    TOKEN_PATTERN,
    (_match, token: string, format: string | undefined) => {
      if (!(token in tokens)) {
        throw new OrganizePathError(`Unknown template token "{${token}}"`);
      }
      const rendered = formatTemplateValue(token, format, tokens[token]);
      if (rendered === undefined) {
        throw new OrganizePathError(
          `Unknown template token variant "{${token}:${format}}"`,
        );
      }
      return rendered;
    },
  );
}

export function splitFolderTemplate(template: string): string[] {
  const trimmed = template.trim();
  if (!trimmed) return [];
  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\') ||
    DRIVE_PATH.test(trimmed) ||
    UNC_PATH.test(trimmed)
  ) {
    throw new OrganizePathError('Folder template must be a relative path');
  }
  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new OrganizePathError('Folder template cannot contain "." or ".."');
    }
  }
  return segments;
}

export function renderFileTemplate(
  template: string,
  tokens: TemplateTokens,
): string {
  const rendered = sanitizePathSegment(renderTemplate(template, tokens));
  if (!rendered) {
    throw new OrganizePathError('File template rendered an empty filename');
  }
  return rendered;
}

export function renderFolderTemplate(
  template: string,
  tokens: TemplateTokens,
): string[] {
  const segments = splitFolderTemplate(template);
  return segments.map((segment) => {
    const rendered = sanitizePathSegment(renderTemplate(segment, tokens));
    if (!rendered) {
      throw new OrganizePathError(
        `Folder template segment "${segment}" rendered empty`,
      );
    }
    return rendered;
  });
}

/** Joins segments using the separator style of `root`. */
export function joinPathLike(root: string, ...segments: string[]): string {
  const trimmedRoot = root.trim().replace(/[\\/]+$/, '');
  const usesBackslash =
    trimmedRoot.includes('\\') && !trimmedRoot.includes('/');
  const separator = usesBackslash ? '\\' : '/';
  const parts = segments
    .flatMap((segment) => segment.split(/[\\/]+/))
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!trimmedRoot) return parts.join(separator);
  return [trimmedRoot, ...parts].join(separator);
}

export function relativePathSegments(relativePath: string): string[] {
  return relativePath.split(/[\\/]+/).filter(Boolean);
}

/** Directory segments for a relative file path. */
export function relativeDirSegments(relativePath: string): string[] {
  const segments = relativePathSegments(relativePath);
  return segments.slice(0, -1);
}

/** Display form; the planner stores relative paths with forward slashes. */
export function joinRelativeSegments(segments: string[]): string {
  return segments.filter(Boolean).join('/');
}

/** True when two paths are equal apart from their casing. */
export function isCaseOnlyDifference(
  source: string,
  target: string,
  options: { caseInsensitive?: boolean } = {},
): boolean {
  const sourceKey = organizerComparisonKey(source, options);
  const targetKey = organizerComparisonKey(target, options);
  return (
    sourceKey === targetKey &&
    normalizePathForComparison(source) !== normalizePathForComparison(target)
  );
}
