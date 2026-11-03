// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OrganizePlanTable } from '../src/frontend/organize/OrganizePlanTable';
import {
  createOrganizeSettings,
  type OrganizePlan,
  type OrganizePlanItem,
} from '../src/common';

// jsdom reports zero-size elements; the virtualizer needs a viewport.
Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value() {
    return {
      width: 900,
      height: 420,
      top: 0,
      left: 0,
      right: 900,
      bottom: 420,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  },
});
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get: () => 420,
});
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get: () => 900,
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const baseItem: OrganizePlanItem = {
  id: '/media/tv/Blue Planet II/S01E01.mkv',
  mediaType: 'tv',
  sourcePath: '/media/tv/Blue Planet II/S01E01.mkv',
  sourceRoot: '/media/tv',
  sourceRelativePath: 'Blue Planet II/S01E01.mkv',
  targetPath: '/media/tv/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
  relativeTarget: 'Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
  action: 'rename',
  confidence: 0.98,
  reason: 'Tag and filename title match S01E01 - One Ocean',
  sidecars: [],
  episode: { tag: 'S01E01', name: 'One Ocean', seasonNumber: 1, episodeNumber: 1 },
  parsed: { title: 'Blue Planet', cleanTitle: 'blue planet' },
  showFolder: 'Blue Planet II',
  seriesName: 'Blue Planet II',
  showSubpath: 'Blue Planet II',
  episodeMatch: {
    tag: 'correct',
    name: 'correct',
    nameSimilarity: 1,
    nameText: 'one ocean',
    airDateMatch: false,
    coverage: 0.9,
    rawScore: 1,
    confidenceBeforeCap: 0.98,
    conflict: false,
    components: [
      {
        kind: 'tag',
        weight: 0.4,
        present: true,
        state: 'correct',
        componentScore: 1,
        contribution: 0.4,
        detail: 'Matches S01E01',
      },
      {
        kind: 'name',
        weight: 0.5,
        present: true,
        state: 'correct',
        similarity: 1,
        componentScore: 1,
        contribution: 0.5,
        detail: 'Matches "one ocean" (100%)',
      },
      {
        kind: 'airDate',
        weight: 0.1,
        present: false,
        state: 'missing',
        contribution: 0,
        detail: 'No air date',
      },
    ],
  },
};

const conflictItem: OrganizePlanItem = {
  ...baseItem,
  id: '/media/tv/Copy/S01E01.mkv',
  sourcePath: '/media/tv/Copy/S01E01.mkv',
  sourceRelativePath: 'Copy/S01E01.mkv',
  targetPath: '/media/tv/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
  relativeTarget: 'Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
  action: 'conflict',
  confidence: 0.3,
  reason: 'Target already exists',
};

const plan: OrganizePlan = {
  mediaType: 'tv',
  sourceRoots: ['/media/tv'],
  items: [baseItem, conflictItem],
  createdAt: '2026-01-01T00:00:00.000Z',
  warnings: [],
};

function renderTable(
  onFixMatch = vi.fn(),
  mediaType: 'tv' | 'movies' = 'tv',
  tablePlan: OrganizePlan = plan,
) {
  return render(
    <OrganizePlanTable
      plan={tablePlan}
      settings={createOrganizeSettings(mediaType)}
      mediaType={mediaType}
      selected={new Set([baseItem.id])}
      onSelectedChange={vi.fn()}
      onFixMatch={onFixMatch}
    />,
  );
}

describe('OrganizePlanTable', () => {
  it('never wraps long paths and keeps the full path in the tooltip', () => {
    renderTable();
    expect(screen.getAllByTitle(baseItem.sourcePath).length).toBeGreaterThan(0);
    expect(screen.getAllByTitle(baseItem.targetPath).length).toBeGreaterThan(0);
  });

  it('uses structured columns instead of full path strings', () => {
    const { container } = renderTable();
    for (const header of ['Show', 'Season', 'Current name', 'New name']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy();
    }
    const text = container.textContent ?? '';
    // Only file names are rendered as text; the full path lives in the tooltip.
    expect(text).not.toContain('/media/tv/Blue Planet II/Season 01/');
    expect(text).toContain('S01E01.mkv');
    expect(text).toContain('S01E01 - One Ocean.mkv');
    expect(text).toContain('S01');
    expect(text).toContain('Blue Planet II');
  });

  it('suppresses drag-to-reorder while a column is being resized', () => {
    renderTable();
    const header = screen.getByRole('columnheader', { name: 'Season' });
    const handle = header.lastElementChild as HTMLElement;
    fireEvent.mouseDown(handle);

    const started = fireEvent.dragStart(header, {
      dataTransfer: { effectAllowed: '', setData: vi.fn() },
    });
    expect(started).toBe(false);
  });

  it('resizes a column when the handle is dragged', () => {
    renderTable();
    const header = screen.getByRole('columnheader', { name: 'Season' });
    const template = header.parentElement?.style.gridTemplateColumns;

    fireEvent.mouseDown(header.lastElementChild as HTMLElement, {
      clientX: 300,
    });
    fireEvent.mouseMove(document, { clientX: 380 });
    fireEvent.mouseUp(document, { clientX: 380 });

    expect(header.parentElement?.style.gridTemplateColumns).not.toBe(template);
  });

  it('still reorders when the header itself is dragged', () => {
    renderTable();
    const header = screen.getByRole('columnheader', { name: 'Season' });

    const started = fireEvent.dragStart(header, {
      dataTransfer: { effectAllowed: '', setData: vi.fn() },
    });
    expect(started).toBe(true);
  });

  it('shows folder before/after and highlights removed and added parts', () => {
    const folderItem = {
      ...baseItem,
      id: 'folder-rename',
      sourcePath: '/media/tv/Blue.Planet.II.2017/S01E01.mkv',
      sourceRelativePath: 'Blue.Planet.II.2017/S01E01.mkv',
      targetPath:
        '/media/tv/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
      relativeTarget: 'Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
    };
    const { container } = renderTable(vi.fn(), 'tv', {
      ...plan,
      items: [folderItem],
    });

    const removed = container.querySelectorAll('[data-diff="removed"]');
    const added = container.querySelectorAll('[data-diff="added"]');
    expect(removed.length).toBeGreaterThan(0);
    expect(added.length).toBeGreaterThan(0);

    const text = container.textContent ?? '';
    expect(text).toContain('→');
    expect(text).toContain('Blue.Planet.II.2017');
    expect(text).toContain('Blue Planet II/Season 01');
  });

  it('hides TV-only columns by default for movie libraries', () => {
    renderTable(vi.fn(), 'movies');
    expect(screen.queryByRole('columnheader', { name: 'Show' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Season' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Current name' })).toBeTruthy();
  });

  it('highlights the changed name tokens', () => {
    const { container } = renderTable();
    const added = [...container.querySelectorAll('[data-diff="added"]')].map(
      (node) => node.textContent,
    );
    expect(added.join('')).toContain('One Ocean');
  });

  it('sorts by a column header', () => {
    renderTable();
    const header = screen.getByRole('columnheader', { name: 'Match' });
    expect(header.getAttribute('aria-sort')).toBe('none');
    fireEvent.click(header);
    expect(['ascending', 'descending']).toContain(
      header.getAttribute('aria-sort'),
    );
    fireEvent.click(header);
    expect(['ascending', 'descending']).toContain(
      header.getAttribute('aria-sort'),
    );
  });

  it('filters with the search box and the status chips', () => {
    renderTable();
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Search the review table' }),
      { target: { value: 'Copy' } },
    );
    expect(screen.getByText('1 of 2 file(s)')).toBeTruthy();

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Search the review table' }),
      { target: { value: '' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Conflicts' }));
    expect(screen.getByText('1 of 2 file(s)')).toBeTruthy();
  });

  it('matches the search box against normalized file and episode names', () => {
    const hyphenItem: OrganizePlanItem = {
      ...baseItem,
      id: 'hyphen',
      sourcePath: '/media/tv/Family Guy/Season 10/S10E20 - Leggo My Meg-O.mkv',
      sourceRelativePath: 'Family Guy/Season 10/S10E20 - Leggo My Meg-O.mkv',
      relativeTarget:
        'Family Guy/Season 10/S10E20 - Leggo My Meg-O.mkv',
      targetPath:
        '/media/tv/Family Guy/Season 10/S10E20 - Leggo My Meg-O.mkv',
      episode: {
        tag: 'S10E20',
        name: 'Leggo My Meg-O',
        seasonNumber: 10,
        episodeNumber: 20,
      },
    };
    renderTable(vi.fn(), 'tv', { ...plan, items: [hyphenItem] });

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Search the review table' }),
      { target: { value: 'leggo my meg o' } },
    );
    expect(screen.getByText('1 of 1 file(s)')).toBeTruthy();
  });

  it('shows folder-only and unchanged rows without a match badge', () => {
    const folderOnly: OrganizePlanItem = {
      ...baseItem,
      id: 'folder-only',
      action: 'rename',
      folderOnly: true,
      reason: 'Folder name updated; file name already correct',
    };
    const noChange: OrganizePlanItem = {
      ...baseItem,
      id: 'no-change',
      action: 'skip',
      noChange: true,
      reason: 'Already named',
    };
    renderTable(vi.fn(), 'tv', {
      ...plan,
      items: [folderOnly, noChange],
    });

    expect(screen.getByText('folder only')).toBeTruthy();
    expect(screen.getByText('unchanged')).toBeTruthy();
    expect(
      screen.queryAllByRole('button', { name: /strong|weak|conflict/ }),
    ).toHaveLength(0);
  });

  it('shows a split match badge with the weighted breakdown', async () => {
    renderTable();
    const badge = screen.getByRole('button', {
      name: 'S01E01 strong 98%',
    });
    fireEvent.focus(badge);

    expect(await screen.findByText('Match evidence')).toBeTruthy();
    expect(screen.getByText('Tag')).toBeTruthy();
    expect(screen.getByText('Title')).toBeTruthy();
    expect(screen.getByText('Air date')).toBeTruthy();
    expect(screen.getByText(/Coverage 90%/)).toBeTruthy();
    expect(
      screen.getByText(/Tag and filename title match S01E01 - One Ocean/),
    ).toBeTruthy();
  });

  it('filters rows with conflicting match evidence', () => {
    const matchConflict: OrganizePlanItem = {
      ...baseItem,
      id: 'match-conflict',
      sourcePath: '/media/tv/Blue Planet II/S01E02.mkv',
      sourceRelativePath: 'Blue Planet II/S01E02.mkv',
      episode: {
        tag: 'S01E05',
        name: 'Big Blue',
        seasonNumber: 1,
        episodeNumber: 5,
      },
      confidence: 0.8,
      episodeMatch: {
        ...baseItem.episodeMatch!,
        conflict: true,
        conflictKind: 'tag-vs-name',
        conflictReason: 'Tag conflicts with the filename title.',
      },
    };
    renderTable(vi.fn(), 'tv', {
      ...plan,
      items: [baseItem, matchConflict],
    });

    expect(
      screen.getByRole('button', { name: 'S01E05 conflict 80%' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Match review' }));
    expect(screen.getByText('1 of 2 file(s)')).toBeTruthy();
  });

  it('does not render a separate Why column after merging it into Match', () => {
    renderTable();
    expect(screen.queryByRole('columnheader', { name: 'Why' })).toBeNull();
  });

  it('opens the fix dialog from the row actions menu', () => {
    const onFixMatch = vi.fn();
    renderTable(onFixMatch);
    fireEvent.click(
      screen.getAllByRole('button', { name: /More actions for/ })[0],
    );
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fix match' }));
    expect(onFixMatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: baseItem.id }),
    );
  });

  it('hides a column and persists the layout', async () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show' }));
    expect(screen.queryByRole('columnheader', { name: 'Show' })).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 320));
    expect(localStorage.getItem('hbb.organizePlanTable.layout.v2')).toContain(
      '"show":false',
    );
  });
});
