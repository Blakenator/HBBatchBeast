// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  createOrganizeSettings,
  emptyLibrary,
  parseMediaFilename,
  type OrganizePlanItem,
  type TvdbEpisode,
} from '../src/common';
import { MultiEpisodeModal } from '../src/frontend/organize/MultiEpisodeModal';

const { mockRefetch } = vi.hoisted(() => ({ mockRefetch: vi.fn() }));

vi.mock('../src/frontend/helpers', () => ({
  useBackend: () => ({
    loading: false,
    error: undefined,
    data: undefined,
    refetch: mockRefetch,
  }),
}));

afterEach(() => {
  cleanup();
  mockRefetch.mockReset();
});

const blueEpisodes: TvdbEpisode[] = [
  { tag: 'S01E01', name: 'One Ocean', seasonNumber: 1, episodeNumber: 1 },
  { tag: 'S01E02', name: 'The Deep', seasonNumber: 1, episodeNumber: 2 },
  { tag: 'S01E03', name: 'Coral Reefs', seasonNumber: 1, episodeNumber: 3 },
  { tag: 'S01E04', name: 'Big Blue', seasonNumber: 1, episodeNumber: 4 },
  { tag: 'S01E05', name: 'Open Water', seasonNumber: 1, episodeNumber: 5 },
  { tag: 'S01E06', name: 'Frozen Seas', seasonNumber: 1, episodeNumber: 6 },
  { tag: 'S01E07', name: 'The Deep Blue', seasonNumber: 1, episodeNumber: 7 },
  { tag: 'S01E08', name: 'Coral Cities', seasonNumber: 1, episodeNumber: 8 },
  { tag: 'S01E09', name: 'Tidal Seas', seasonNumber: 1, episodeNumber: 9 },
  { tag: 'S01E10', name: 'Coasts', seasonNumber: 1, episodeNumber: 10 },
  { tag: 'S01E11', name: 'Seasonal Seas', seasonNumber: 1, episodeNumber: 11 },
];

const planetEpisodes: TvdbEpisode[] = [
  { tag: 'S01E01', name: 'From Pole to Pole', seasonNumber: 1, episodeNumber: 1 },
  { tag: 'S01E02', name: 'Mountains', seasonNumber: 1, episodeNumber: 2 },
  { tag: 'S01E03', name: 'Fresh Water', seasonNumber: 1, episodeNumber: 3 },
  { tag: 'S01E04', name: 'Caves', seasonNumber: 1, episodeNumber: 4 },
];

function library() {
  const base = emptyLibrary({ id: 'lib', name: 'TV', mediaType: 'tv' });
  const organize = createOrganizeSettings('tv');
  organize.tvdb = {
    shows: [
      {
        id: 'show-1',
        folderId: 'folder-1',
        subpath: 'Blue Planet II',
        series: { id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II' },
      },
      {
        id: 'show-2',
        folderId: 'folder-1',
        subpath: 'Planet Earth',
        series: { id: '2', slug: 'planet-earth', name: 'Planet Earth' },
      },
    ],
  };
  return {
    ...base,
    folders: [{ id: 'folder-1', source: '/media/tv', destination: '' }],
    organize,
  };
}

function item(
  show: string,
  filename: string,
  overrides: Partial<OrganizePlanItem> = {},
): OrganizePlanItem {
  const relativePath = `${show}/${filename}`;
  return {
    id: `/media/tv/${relativePath}`,
    mediaType: 'tv',
    sourcePath: `/media/tv/${relativePath}`,
    sourceRoot: '/media/tv',
    sourceRelativePath: relativePath,
    targetPath: `/media/tv/${relativePath}`,
    relativeTarget: relativePath,
    action: 'rename',
    confidence: 1,
    reason: 'Matched',
    sidecars: [],
    parsed: parseMediaFilename(filename, relativePath),
    seriesName: show,
    showFolder: show,
    showSubpath: show,
    ...overrides,
  };
}

function episodesFor(slug: string): TvdbEpisode[] {
  return slug === 'planet-earth' ? planetEpisodes : blueEpisodes;
}

function renderModal(
  items: OrganizePlanItem[],
  onApply = vi.fn(),
  onFixMatch = vi.fn(),
) {
  const lib = library();
  const view = render(
    <MultiEpisodeModal
      items={items}
      mediaType="tv"
      settings={lib.organize!}
      library={lib}
      onClose={vi.fn()}
      onApply={onApply}
      onFixMatch={onFixMatch}
    />,
  );
  return { onApply, onFixMatch, container: view.container };
}

describe('MultiEpisodeModal', () => {
  it('detects a run from joined episode titles and applies it', async () => {
    mockRefetch.mockImplementation(async ({ slug }: { slug: string }) => ({
      data: episodesFor(slug),
    }));
    const { onApply } = renderModal([
      item(
        'Blue Planet II',
        'Blue.Planet.II.S01E01.One.Ocean.and.The.Deep.mkv',
      ),
    ]);

    expect(await screen.findByText('S01E01-E02')).toBeTruthy();
    const apply = screen.getByRole('button', {
      name: /Apply to 1 file/,
    }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);

    expect(onApply).toHaveBeenCalledTimes(1);
    const overrides = onApply.mock.calls[0][0] as Map<
      string,
      { episodes?: TvdbEpisode[] }
    >;
    expect([...overrides.values()][0].episodes?.map((episode) => episode.tag)).toEqual([
      'S01E01',
      'S01E02',
    ]);
  });

  it('numbers sequentially and cascades when a start changes', async () => {
    mockRefetch.mockImplementation(async ({ slug }: { slug: string }) => ({
      data: episodesFor(slug),
    }));
    const { onApply } = renderModal([
      item('Blue Planet II', 'Blue.Planet.II.S01E01.mkv'),
      item('Blue Planet II', 'Blue.Planet.II.S01E03.mkv'),
      item('Planet Earth', 'Planet.Earth.S01E01.mkv'),
    ]);

    fireEvent.click(await screen.findByRole('radio', { name: 'Sequential' }));

    await waitFor(() => {
      expect(screen.getAllByText('S01E01-E02').length).toBe(2);
      expect(screen.getByText('S01E03-E04')).toBeTruthy();
    });

    // Each show/season group starts at E01.
    expect(screen.getAllByText('S01E01-E02').length).toBe(2);

    const count = screen.getByLabelText('Episodes per file');
    fireEvent.change(count, { target: { value: '2' } });

    const secondStart = screen.getByLabelText(
      'Start episode for Blue Planet II/Blue.Planet.II.S01E03.mkv',
    );
    fireEvent.change(secondStart, { target: { value: '9' } });
    await waitFor(() => {
      expect(screen.getByText('S01E09-E10')).toBeTruthy();
    });

    // Editing the first row re-bases every later row in the same group.
    const firstStart = screen.getByLabelText(
      'Start episode for Blue Planet II/Blue.Planet.II.S01E01.mkv',
    );
    fireEvent.change(firstStart, { target: { value: '5' } });
    await waitFor(() => {
      expect(screen.getByText('S01E05-E06')).toBeTruthy();
      expect(screen.getByText('S01E07-E08')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /Apply to 3 file/ }));
    const overrides = onApply.mock.calls[0][0] as Map<
      string,
      { episodes?: TvdbEpisode[] }
    >;
    expect(overrides.size).toBe(3);
  });

  it('appends episodes to the current number and flags unusable rows', async () => {
    mockRefetch.mockImplementation(async ({ slug }: { slug: string }) => ({
      data: episodesFor(slug),
    }));
    const { onApply } = renderModal([
      item('Blue Planet II', 'Blue.Planet.II.S01E03.mkv'),
      item('Unknown Show', 'Unknown.Show.S01E01.mkv', {
        seriesName: 'Unknown Show',
        showFolder: 'Unknown Show',
        showSubpath: 'Unknown Show',
      }),
    ]);

    fireEvent.click(await screen.findByRole('radio', { name: 'Keep current numbering' }));

    expect(await screen.findByText('S01E03-E04')).toBeTruthy();
    expect(
      screen.getByText(/No show matched/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Apply to 1 file/ }));
    const overrides = onApply.mock.calls[0][0] as Map<
      string,
      { episodes?: TvdbEpisode[] }
    >;
    expect(overrides.size).toBe(1);
  });

  it('highlights name changes, shows confidence, and can fix a match', async () => {
    mockRefetch.mockImplementation(async ({ slug }: { slug: string }) => ({
      data: episodesFor(slug),
    }));
    const row = item(
      'Blue Planet II',
      'Blue.Planet.II.S01E01.One.Ocean.and.The.Deep.mkv',
      { confidence: 0.42 },
    );
    const { onFixMatch } = renderModal([row]);

    expect(await screen.findByText('S01E01-E02')).toBeTruthy();
    // The dialog is 80% of the window and keeps Bootstrap's modal surface.
    const dialog = document.querySelector('.modal-dialog') as HTMLElement;
    expect(dialog.style.width).toBe('80vw');
    expect(dialog.querySelector('.modal-content')).toBeTruthy();
    // The new filename is diffed against the old one, like the review table.
    expect(
      document.querySelector('[data-diff="added"]')?.textContent,
    ).toBeTruthy();
    // The current match confidence is shown as a badge.
    expect(screen.getByRole('button', { name: /42%/ })).toBeTruthy();

    // Columns resize by dragging the header separator.
    const resizer = screen.getByRole('separator', {
      name: 'Resize Current name column',
    });
    const head = document.querySelector(
      '.modal-dialog [aria-label="Multi-episode preview"] > div',
    ) as HTMLElement;
    const before = head.style.gridTemplateColumns;
    fireEvent.pointerDown(resizer, { clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(resizer, { clientX: 360, pointerId: 1 });
    fireEvent.pointerUp(resizer, { clientX: 360, pointerId: 1 });
    expect(head.style.gridTemplateColumns).not.toBe(before);
    expect(head.style.gridTemplateColumns).toContain('400px');

    fireEvent.click(
      screen.getByRole('button', {
        name: `Fix match for ${row.sourceRelativePath}`,
      }),
    );
    expect(onFixMatch).toHaveBeenCalledTimes(1);
    expect(onFixMatch.mock.calls[0][0]).toMatchObject({ id: row.id });
  });
});
