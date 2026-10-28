import { parsePercent } from '../../common/runTelemetry';

export type TreeRowState =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled'
  | 'excluded'
  | 'skipped';

/** The subset of a queue row the folder tree needs to aggregate. */
export interface TreeFileLike {
  path: string;
  state: TreeRowState;
  sourceBytes?: number;
  percent?: string;
  progress?: { percent?: number };
}

export interface FolderNode<T extends TreeFileLike = TreeFileLike> {
  /** Normalized absolute folder path; unique within one tree. */
  key: string;
  /** Folder path shown in tooltips. */
  path: string;
  /** Path segment for nested folders; the full path for roots. */
  name: string;
  isRoot: boolean;
  fileCount: number;
  sourceBytes: number;
  hasKnownSize: boolean;
  stateCounts: Record<TreeRowState, number>;
  /** Aggregate completion, or undefined before anything starts. */
  percent?: number;
  children: FolderNode<T>[];
  files: T[];
}

export type VisibleTreeNode<T extends TreeFileLike = TreeFileLike> =
  | { kind: 'folder'; node: FolderNode<T>; depth: number }
  | { kind: 'file'; file: T; depth: number };

export const TREE_STATES: TreeRowState[] = [
  'running',
  'pending',
  'success',
  'error',
  'cancelled',
  'excluded',
  'skipped',
];

const TERMINAL_STATES: TreeRowState[] = ['success', 'error', 'cancelled'];
const NON_WORK_STATES: TreeRowState[] = ['excluded', 'skipped'];

function emptyCounts(): Record<TreeRowState, number> {
  return {
    pending: 0,
    running: 0,
    success: 0,
    error: 0,
    cancelled: 0,
    excluded: 0,
    skipped: 0,
  };
}

/** Normalizes separators and trailing slashes, preserving the filesystem root. */
export function normalizePath(value: string): string {
  const unified = value.trim().replace(/\\/g, '/');
  if (!unified) return '';
  if (unified === '/') return '/';
  return unified.replace(/\/+$/, '') || '/';
}

function isCaseInsensitive(root: string): boolean {
  return /^[a-zA-Z]:($|\/)/.test(root) || root.startsWith('//');
}

function rootMatches(path: string, root: string): boolean {
  if (root === '/') return path.startsWith('/');
  if (isCaseInsensitive(root)) {
    const lowerPath = path.toLowerCase();
    const lowerRoot = root.toLowerCase();
    return lowerPath === lowerRoot || lowerPath.startsWith(`${lowerRoot}/`);
  }
  return path === root || path.startsWith(`${root}/`);
}

/** Returns the path relative to `root`, or undefined when it does not match. */
function stripRoot(path: string, root: string): string | undefined {
  if (!rootMatches(path, root)) return undefined;
  if (root === '/') return path.replace(/^\/+/, '');
  return path.slice(root.length + 1);
}

function joinPath(parent: string, segment: string): string {
  if (!parent || parent === '.') return parent === '.' ? `./${segment}` : segment;
  if (parent === '/') return `/${segment}`;
  return `${parent}/${segment}`;
}

/** Best-effort root when a path is outside every configured source folder. */
function fallbackRoot(path: string): string {
  const segments = path.split('/').filter(Boolean);
  if (path.startsWith('/')) {
    return segments.length > 1 ? `/${segments[0]}` : '/';
  }
  return segments.length > 1 ? segments[0] : '.';
}

function createNode<T extends TreeFileLike>(
  path: string,
  name: string,
  isRoot: boolean,
): FolderNode<T> {
  return {
    key: path || '/',
    path: path || '/',
    name,
    isRoot,
    fileCount: 0,
    sourceBytes: 0,
    hasKnownSize: false,
    stateCounts: emptyCounts(),
    children: [],
    files: [],
  };
}

function sortFolders<T extends TreeFileLike>(nodes: FolderNode<T>[]): void {
  nodes.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  );
  for (const node of nodes) sortFolders(node.children);
}

/**
 * Groups files into a folder tree rooted at the library source folders. Files
 * outside every source folder fall back to their top-level directory so they
 * are never dropped from the view.
 */
export function buildFolderTree<T extends TreeFileLike>(
  files: T[],
  roots: string[] = [],
): FolderNode<T>[] {
  const normalizedRoots = Array.from(
    new Set(roots.map(normalizePath).filter(Boolean)),
  ).sort((left, right) => right.length - left.length);

  const rootsByKey = new Map<string, FolderNode<T>>();
  const nodesByKey = new Map<string, FolderNode<T>>();

  const ensureRoot = (rootPath: string): FolderNode<T> => {
    const key = rootPath || '/';
    let node = rootsByKey.get(key);
    if (!node) {
      node = createNode(key, rootPath || '/', true);
      rootsByKey.set(key, node);
      nodesByKey.set(key, node);
    }
    return node;
  };

  for (const file of files) {
    const filePath = normalizePath(file.path);
    if (!filePath) continue;

    let rootPath: string | undefined;
    let relative: string | undefined;
    for (const candidate of normalizedRoots) {
      const stripped = stripRoot(filePath, candidate);
      if (stripped !== undefined) {
        rootPath = candidate;
        relative = stripped;
        break;
      }
    }

    if (rootPath === undefined || relative === undefined) {
      rootPath = fallbackRoot(filePath);
      relative = stripRoot(filePath, rootPath) ?? filePath;
    }

    const segments = relative.split('/').filter(Boolean);
    if (segments.length === 0) continue;
    segments.pop();

    let current = ensureRoot(rootPath);
    let currentPath = rootPath;
    for (const segment of segments) {
      currentPath = joinPath(currentPath, segment);
      let child = nodesByKey.get(currentPath);
      if (!child) {
        child = createNode(currentPath, segment, false);
        nodesByKey.set(currentPath, child);
        current.children.push(child);
      }
      current = child;
    }
    current.files.push(file);
  }

  const rootNodes = Array.from(rootsByKey.values());
  for (const root of rootNodes) aggregateNode(root);
  sortFolders(rootNodes);
  return rootNodes;
}

interface AggregateProgress {
  runnable: number;
  started: number;
  percentSum: number;
}

function summarizeFile<T extends TreeFileLike>(
  file: T,
  aggregate: AggregateProgress,
): void {
  if (NON_WORK_STATES.includes(file.state)) return;
  aggregate.runnable += 1;

  if (TERMINAL_STATES.includes(file.state)) {
    aggregate.started += 1;
    aggregate.percentSum += 100;
    return;
  }

  if (file.state === 'running') {
    aggregate.started += 1;
    aggregate.percentSum +=
      file.progress?.percent ?? parsePercent(file.percent) ?? 0;
  }
}

function aggregateNode<T extends TreeFileLike>(
  node: FolderNode<T>,
): AggregateProgress {
  const aggregate: AggregateProgress = {
    runnable: 0,
    started: 0,
    percentSum: 0,
  };
  const counts = emptyCounts();
  let sourceBytes = 0;
  let hasKnownSize = false;

  for (const child of node.children) {
    const childAggregate = aggregateNode(child);
    aggregate.runnable += childAggregate.runnable;
    aggregate.started += childAggregate.started;
    aggregate.percentSum += childAggregate.percentSum;

    for (const state of TREE_STATES) {
      counts[state] += child.stateCounts[state];
    }
    sourceBytes += child.sourceBytes;
    hasKnownSize = hasKnownSize || child.hasKnownSize;
  }

  for (const file of node.files) {
    counts[file.state] += 1;
    if (file.sourceBytes !== undefined && Number.isFinite(file.sourceBytes)) {
      sourceBytes += file.sourceBytes;
      hasKnownSize = true;
    }
    summarizeFile(file, aggregate);
  }

  node.stateCounts = counts;
  node.sourceBytes = sourceBytes;
  node.hasKnownSize = hasKnownSize;
  node.fileCount = TREE_STATES.reduce((sum, state) => sum + counts[state], 0);
  node.percent =
    aggregate.runnable > 0 && aggregate.started > 0
      ? aggregate.percentSum / aggregate.runnable
      : undefined;

  return aggregate;
}

/**
 * Flattens a tree into the rows currently visible. Folders are emitted before
 * their children; a folder's children only appear when its key is expanded.
 */
export function flattenFolderTree<T extends TreeFileLike>(
  nodes: FolderNode<T>[],
  expanded: ReadonlySet<string>,
): VisibleTreeNode<T>[] {
  const result: VisibleTreeNode<T>[] = [];

  const visit = (node: FolderNode<T>, depth: number): void => {
    result.push({ kind: 'folder', node, depth });
    if (!expanded.has(node.key)) return;
    for (const child of node.children) visit(child, depth + 1);
    for (const file of node.files) result.push({ kind: 'file', file, depth: depth + 1 });
  };

  for (const node of nodes) visit(node, 0);
  return result;
}
