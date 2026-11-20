import type { OrganizeSplitPlan } from '../../common/organizer/split';

/**
 * Unsaved split-editor work. The organizer session only keeps queued splits
 * for the lifetime of the window, so manual cuts, episode choices, filename
 * overrides, skipped segments and approvals are kept here per library item.
 * A draft is dropped once its split is saved or the source file changes.
 */
export interface SplitDraft {
  libraryId: string;
  itemId: string;
  sourcePath: string;
  /** Size of the source the plan was measured against. */
  fileSize: number;
  plan: OrganizeSplitPlan;
  approved: boolean;
  /** The user removed this item from the queue and wants that kept. */
  removed: boolean;
  updatedAt: number;
}

export const SPLIT_DRAFTS_STORAGE_KEY = 'hbb.split-drafts.v1';
const MAX_DRAFTS = 40;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function getStorage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    return undefined;
  }
}

function draftKey(draft: { libraryId: string; itemId: string }): string {
  return `${draft.libraryId}\u0000${draft.itemId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSplitDraft(value: unknown): value is SplitDraft {
  if (!isRecord(value)) return false;
  const plan = value.plan;
  if (!isRecord(plan)) return false;
  const segments = plan.segments;
  if (
    !Array.isArray(segments) ||
    !segments.every(
      (segment) =>
        isRecord(segment) &&
        typeof segment.index === 'number' &&
        typeof segment.startSeconds === 'number' &&
        typeof segment.endSeconds === 'number',
    )
  ) {
    return false;
  }
  return (
    typeof value.libraryId === 'string' &&
    typeof value.itemId === 'string' &&
    typeof value.sourcePath === 'string' &&
    typeof value.fileSize === 'number' &&
    Number.isFinite(value.fileSize) &&
    typeof plan.itemId === 'string' &&
    typeof plan.sourcePath === 'string' &&
    typeof plan.fileSize === 'number' &&
    typeof plan.fileDurationSeconds === 'number' &&
    typeof value.approved === 'boolean' &&
    typeof value.removed === 'boolean' &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt)
  );
}

/** Newest first, one per library item, stale drafts dropped. */
export function pruneSplitDrafts(
  drafts: readonly SplitDraft[],
  now = Date.now(),
): SplitDraft[] {
  const newest = new Map<string, SplitDraft>();
  for (const draft of drafts) {
    if (now - draft.updatedAt > MAX_AGE_MS) continue;
    const key = draftKey(draft);
    const current = newest.get(key);
    if (!current || current.updatedAt < draft.updatedAt) {
      newest.set(key, draft);
    }
  }
  return [...newest.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_DRAFTS);
}

function parseDrafts(raw: string | null): SplitDraft[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSplitDraft);
  } catch {
    return [];
  }
}

/** All restorable drafts, newest first. */
export function readSplitDrafts(): SplitDraft[] {
  const storage = getStorage();
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(SPLIT_DRAFTS_STORAGE_KEY);
  } catch {
    return [];
  }
  const drafts = pruneSplitDrafts(parseDrafts(raw));
  // Drop stale or duplicate entries from storage as we read.
  if (drafts.length > 0 || raw) writeDrafts(drafts);
  return drafts;
}

/** The draft for one library item, when it still applies. */
export function readSplitDraft(
  libraryId: string,
  itemId: string,
): SplitDraft | undefined {
  return readSplitDrafts().find(
    (draft) => draft.libraryId === libraryId && draft.itemId === itemId,
  );
}

function writeDrafts(drafts: readonly SplitDraft[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    if (drafts.length === 0) {
      storage.removeItem(SPLIT_DRAFTS_STORAGE_KEY);
      return;
    }
    storage.setItem(SPLIT_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    // Quota or privacy errors leave the in-memory editor untouched.
  }
}

/** Inserts or replaces one draft and prunes the rest. */
export function saveSplitDraft(
  draft: Omit<SplitDraft, 'updatedAt'> & { updatedAt?: number },
): SplitDraft[] {
  return saveSplitDrafts([draft]);
}

/** Inserts or replaces several drafts in one storage write. */
export function saveSplitDrafts(
  drafts: readonly (Omit<SplitDraft, 'updatedAt'> & { updatedAt?: number })[],
): SplitDraft[] {
  if (drafts.length === 0) return readSplitDrafts();
  const next = drafts.map((draft) => ({
    ...draft,
    updatedAt: draft.updatedAt ?? Date.now(),
  }));
  const replaced = new Set(next.map(draftKey));
  const kept = readSplitDrafts().filter(
    (entry) => !replaced.has(draftKey(entry)),
  );
  const merged = pruneSplitDrafts([...next, ...kept]);
  writeDrafts(merged);
  return merged;
}

/** Removes drafts for items that were just saved or are no longer relevant. */
export function clearSplitDrafts(
  libraryId: string,
  itemIds: readonly string[],
): void {
  if (itemIds.length === 0) return;
  const removed = new Set(itemIds);
  const kept = readSplitDrafts().filter(
    (draft) => draft.libraryId !== libraryId || !removed.has(draft.itemId),
  );
  writeDrafts(kept);
}

/** Clears every draft for a library, used when its plan is discarded. */
export function clearLibrarySplitDrafts(libraryId: string): void {
  writeDrafts(
    readSplitDrafts().filter((draft) => draft.libraryId !== libraryId),
  );
}
