/**
 * Word-level diffs for the review table.
 *
 * The organizer renames files, so the important question is "what changed in
 * this name?". These helpers split names into word/separator tokens and run an
 * LCS so both the old and the new name can be rendered with the changed parts
 * highlighted.
 */

export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface NameDiff {
  before: DiffSegment[];
  after: DiffSegment[];
  /** True when the two names differ in any token. */
  changed: boolean;
}

const TOKEN = /[A-Za-z0-9\u00C0-\u024F]+|[^A-Za-z0-9\u00C0-\u024F]+/g;

export function tokenizeName(value: string): string[] {
  return value.match(TOKEN) ?? [];
}

function mergeSegments(
  tokens: string[],
  changedFlags: boolean[],
): DiffSegment[] {
  const segments: DiffSegment[] = [];
  tokens.forEach((text, index) => {
    const changed = changedFlags[index] ?? false;
    const previous = segments[segments.length - 1];
    if (previous && previous.changed === changed) {
      previous.text += text;
      return;
    }
    segments.push({ text, changed });
  });
  return segments;
}

/** Longest-common-subsequence diff over the tokens of two names. */
export function diffNameSegments(before: string, after: string): NameDiff {
  if (before === after) {
    return {
      before: before ? [{ text: before, changed: false }] : [],
      after: after ? [{ text: after, changed: false }] : [],
      changed: false,
    };
  }
  const left = tokenizeName(before);
  const right = tokenizeName(after);
  const rows = left.length + 1;
  const columns = right.length + 1;
  const lengths: number[][] = Array.from({ length: rows }, () =>
    new Array<number>(columns).fill(0),
  );
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      lengths[row][column] =
        left[row] === right[column]
          ? lengths[row + 1][column + 1] + 1
          : Math.max(lengths[row + 1][column], lengths[row][column + 1]);
    }
  }

  const leftFlags = left.map(() => true);
  const rightFlags = right.map(() => true);
  let row = 0;
  let column = 0;
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      leftFlags[row] = false;
      rightFlags[column] = false;
      row += 1;
      column += 1;
    } else if (lengths[row + 1][column] >= lengths[row][column + 1]) {
      row += 1;
    } else {
      column += 1;
    }
  }

  return {
    before: mergeSegments(left, leftFlags),
    after: mergeSegments(right, rightFlags),
    changed: true,
  };
}

function baseName(value: string): string {
  const separator = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return separator < 0 ? value : value.slice(separator + 1);
}

/** Diffs the file names of a source and target path. */
export function diffTargetName(
  sourcePath: string,
  targetPath: string,
): NameDiff {
  return diffNameSegments(baseName(sourcePath), baseName(targetPath));
}
