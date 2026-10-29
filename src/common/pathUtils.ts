/**
 * Separator- and case-aware path helpers shared by the renderer and the main
 * process. Renderer code cannot import `node:path`, so these helpers stay
 * dependency free while still matching platform behaviour.
 */

const DRIVE_PATH = /^[a-zA-Z]:($|\/)/;
const UNC_PATH = /^\/\//;

/** Unifies separators and drops trailing ones, preserving filesystem roots. */
export function normalizePathForComparison(value: string): string {
  const trimmed = value.trim().replace(/\\/g, '/');
  if (!trimmed) return '';
  if (trimmed === '/') return '/';
  const withoutTrailing = trimmed.replace(/\/+$/, '');
  return withoutTrailing || '/';
}

/** True for drive-letter (`C:\...`) and UNC (`\\server\share`) paths. */
export function isWindowsStylePath(value: string): boolean {
  const normalized = normalizePathForComparison(value);
  return DRIVE_PATH.test(normalized) || UNC_PATH.test(normalized);
}

/** Key used to compare two paths the way the target filesystem would. */
export function pathComparisonKey(value: string): string {
  const normalized = normalizePathForComparison(value);
  return isWindowsStylePath(normalized) ? normalized.toLowerCase() : normalized;
}

/** Whole-path equality with Windows drive/UNC case-insensitivity. */
export function isSamePath(a: string, b: string): boolean {
  const left = pathComparisonKey(a);
  const right = pathComparisonKey(b);
  return left.length > 0 && left === right;
}

/**
 * True when `child` is the same as, or below, `parent`. Segments are compared
 * after normalizing separators, so `C:/Media` also contains `C:\Media\Sub`.
 */
export function isPathInside(child: string, parent: string): boolean {
  const childKey = pathComparisonKey(child);
  const parentKey = pathComparisonKey(parent);
  if (!childKey || !parentKey) return false;
  if (childKey === parentKey) return true;
  const prefix = parentKey === '/' ? '/' : `${parentKey}/`;
  return childKey.startsWith(prefix);
}

/** Last path segment, accepting either separator. */
export function pathBasename(value: string): string {
  const parts = value.trim().split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/**
 * Expands a leading `~` using the supplied home directory. The separator style
 * follows `home`, so Windows callers keep backslashes and POSIX callers keep
 * forward slashes.
 */
export function expandHomePath(value: string, home: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (trimmed === '~') return home;
  if (!trimmed.startsWith('~/') && !trimmed.startsWith('~\\')) return trimmed;

  const rest = trimmed.slice(2).replace(/^[\\/]+/, '');
  if (!rest) return home;
  const separator = home.includes('\\') && !home.includes('/') ? '\\' : '/';
  const normalizedRest = rest.replace(/[\\/]+/g, separator);
  return `${home.replace(/[\\/]+$/, '')}${separator}${normalizedRest}`;
}
