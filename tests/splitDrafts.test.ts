// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { OrganizeSplitPlan } from '../src/common';
import {
  SPLIT_DRAFTS_STORAGE_KEY,
  clearLibrarySplitDrafts,
  clearSplitDrafts,
  pruneSplitDrafts,
  readSplitDraft,
  readSplitDrafts,
  saveSplitDraft,
  saveSplitDrafts,
  type SplitDraft,
} from '../src/frontend/organize/splitDrafts';

const plan: OrganizeSplitPlan = {
  itemId: '/media/tv/a.mkv',
  sourcePath: '/media/tv/a.mkv',
  fileSize: 2048,
  fileDurationSeconds: 3600,
  estimate: { method: 'equal' },
  cutMode: 'copy',
  originalPolicy: 'backup',
  sidecarPolicy: 'leave',
  segments: [
    { index: 0, startSeconds: 0, endSeconds: 1800 },
    { index: 1, startSeconds: 1800, endSeconds: 3600 },
  ],
  edited: true,
  updatedAt: 10,
};

function draft(overrides: Partial<SplitDraft> = {}): SplitDraft {
  return {
    libraryId: 'lib',
    itemId: plan.itemId,
    sourcePath: plan.sourcePath,
    fileSize: plan.fileSize,
    plan,
    approved: false,
    removed: false,
    updatedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('split drafts', () => {
  it('round-trips manual editor state', () => {
    saveSplitDraft(draft());
    const stored = readSplitDraft('lib', plan.itemId);
    expect(stored?.plan.segments.map((segment) => segment.endSeconds)).toEqual([
      1800, 3600,
    ]);
    expect(stored?.approved).toBe(false);
    expect(stored?.removed).toBe(false);
    expect(readSplitDrafts()).toHaveLength(1);
  });

  it('keeps the newest draft per item and prunes expired ones', () => {
    const now = 10_000_000;
    const drafts = pruneSplitDrafts(
      [
        draft({ updatedAt: now - 1, approved: true }),
        draft({ updatedAt: now, approved: false }),
        draft({
          updatedAt: now - 31 * 24 * 60 * 60 * 1000,
          itemId: '/media/tv/old.mkv',
        }),
      ],
      now,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.approved).toBe(false);
  });

  it('writes several drafts in one pass', () => {
    saveSplitDrafts([
      draft(),
      draft({
        itemId: '/media/tv/b.mkv',
        plan: { ...plan, itemId: '/media/tv/b.mkv' },
        removed: true,
      }),
    ]);
    expect(readSplitDrafts()).toHaveLength(2);
    expect(readSplitDraft('lib', '/media/tv/b.mkv')?.removed).toBe(true);
  });

  it('clears only the saved items', () => {
    saveSplitDrafts([
      draft(),
      draft({
        itemId: '/media/tv/b.mkv',
        plan: { ...plan, itemId: '/media/tv/b.mkv' },
      }),
    ]);
    clearSplitDrafts('lib', [plan.itemId]);
    expect(readSplitDrafts().map((entry) => entry.itemId)).toEqual([
      '/media/tv/b.mkv',
    ]);
  });

  it('clears every draft for a library', () => {
    saveSplitDrafts([
      draft(),
      draft({
        libraryId: 'other',
        itemId: '/media/tv/c.mkv',
        plan: { ...plan, itemId: '/media/tv/c.mkv' },
      }),
    ]);
    clearLibrarySplitDrafts('lib');
    expect(readSplitDrafts().map((entry) => entry.libraryId)).toEqual([
      'other',
    ]);
  });

  it('ignores malformed storage', () => {
    window.localStorage.setItem(SPLIT_DRAFTS_STORAGE_KEY, '{not json');
    expect(readSplitDrafts()).toEqual([]);
    window.localStorage.setItem(
      SPLIT_DRAFTS_STORAGE_KEY,
      JSON.stringify([{ libraryId: 'lib' }]),
    );
    expect(readSplitDrafts()).toEqual([]);
  });
});
