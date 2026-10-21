/**
 * Parsing and serialising for the config fields that the UI edits as lists.
 *
 * The persisted file format has to stay stable: paths, per-folder presets and
 * suffixes are newline separated, while file types and property filters are
 * comma separated. These helpers keep that format in one place instead of every
 * editor and validator re-implementing `split`/`join` slightly differently.
 */

/** Splits a newline-aligned field, keeping interior blank rows as placeholders. */
export function parseMappedRows(value?: string): string[] {
  const rows = (value ?? '').split('\n').map((row) => row.trim());
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}

/** Joins aligned rows, trimming trailing blanks but preserving interior gaps. */
export function serializeMappedRows(rows: string[]): string {
  const trimmed = rows.map((row) => row.trim());
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return trimmed.join('\n');
}

/** Accepts both a displayed preset name and its legacy `-Z` argument form. */
export function normalizePresetName(value: string): string {
  const trimmed = value.trim();
  const match = /^-Z\s+(.+)$/i.exec(trimmed);
  const name = (match?.[1] ?? trimmed).trim();
  if (
    (name.startsWith('"') && name.endsWith('"')) ||
    (name.startsWith("'") && name.endsWith("'"))
  ) {
    return name.slice(1, -1);
  }
  return name;
}

/** Splits a comma/newline separated token list (file types, title words). */
export function parseTokenList(value?: string): string[] {
  return (value ?? '')
    .split(/[,\n]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function serializeTokenList(tokens: string[]): string {
  return tokens
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .join(',');
}

/** Extensions are stored without a leading dot and compared case-insensitively. */
export function normalizeFileType(token: string): string {
  return token.trim().replace(/^\.+/, '').toLowerCase();
}

export interface PropertyFilterRow {
  key: string;
  value: string;
}

/**
 * The worker compares `key: 'value'` strings, but older help text advertised
 * `key=value`. Accept both so existing configs keep working.
 */
export function parsePropertyFilters(value?: string): PropertyFilterRow[] {
  return (value ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .flatMap((token) => {
      const match = /^([^:=]+?)\s*[:=]\s*(.*)$/.exec(token);
      if (!match) return [];
      let filterValue = match[2].trim();
      if (
        (filterValue.startsWith("'") && filterValue.endsWith("'")) ||
        (filterValue.startsWith('"') && filterValue.endsWith('"'))
      ) {
        filterValue = filterValue.slice(1, -1);
      }
      return [{ key: match[1].trim(), value: filterValue }];
    });
}

export function serializePropertyFilters(rows: PropertyFilterRow[]): string {
  return rows
    .filter((row) => row.key.trim().length > 0)
    .map((row) => `${row.key.trim()}: '${row.value.trim()}'`)
    .join(',');
}

export interface CommandPair {
  /** Arguments placed before `-i <source>` (FFmpeg input options). */
  input: string;
  /** Arguments placed after the source and before the output path. */
  output: string;
}

/** Worker code splits custom FFmpeg presets on the first comma. */
export function parseCommandPair(value: string): CommandPair {
  const comma = value.indexOf(',');
  if (comma === -1) return { input: value.trim(), output: '' };
  return {
    input: value.slice(0, comma).trim(),
    output: value.slice(comma + 1).trim(),
  };
}

export function serializeCommandPair(pair: CommandPair): string {
  const input = pair.input.trim();
  const output = pair.output.trim();
  if (!input && !output) return '';
  return `${input},${output}`;
}

/** Non-empty row count used by summaries and validation. */
export function countConfiguredRows(value?: string): number {
  return parseMappedRows(value).filter((row) => row.length > 0).length;
}

/** Containers HandBrakeCLI can write, as file extensions. */
export const HANDBRAKE_CONTAINERS = ['.mp4', '.m4v', '.mkv'] as const;

/** Normalizes a container config value to a lowercase dotted extension. */
export function normalizeContainerExtension(value?: string): string {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}
