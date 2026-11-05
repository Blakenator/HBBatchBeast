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
  type OrganizePlanItem,
} from '../src/common';
import { MatchFixModal } from '../src/frontend/organize/MatchFixModal';

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

const item: OrganizePlanItem = {
  id: '/media/tv/Blue Planet II/S01E01.mkv',
  mediaType: 'tv',
  sourcePath: '/media/tv/Blue Planet II/S01E01.mkv',
  sourceRoot: '/media/tv',
  sourceRelativePath: 'Blue Planet II/S01E01.mkv',
  targetPath: '/media/tv/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
  relativeTarget: 'Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
  action: 'skip',
  confidence: 0.1,
  reason: 'No matching TVDB episode',
  sidecars: [],
};

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
    ],
  };
  return {
    ...base,
    folders: [{ id: 'folder-1', source: '/media/tv', destination: '' }],
    organize,
  };
}

function renderModal(onSave = vi.fn()) {
  const lib = library();
  render(
    <MatchFixModal
      item={item}
      mediaType="tv"
      settings={lib.organize!}
      library={lib}
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );
  return onSave;
}

describe('MatchFixModal', () => {
  it('lists episodes for the matched show and saves a chosen one', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        { tag: 'S01E01', name: 'One Ocean', seasonNumber: 1, episodeNumber: 1 },
        { tag: 'S01E02', name: 'The Deep', seasonNumber: 1, episodeNumber: 2 },
      ],
    });
    const onSave = renderModal();

    expect(await screen.findByText('The Deep')).toBeTruthy();
    fireEvent.click(screen.getByText('The Deep'));
    expect(screen.getByText(/New filename:/)).toBeTruthy();
    expect(screen.getByText('S01E02 - The Deep.mkv')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save match' }));

    expect(onSave).toHaveBeenCalledWith({
      series: expect.objectContaining({ slug: 'blue-planet-ii' }),
      episode: expect.objectContaining({ tag: 'S01E02' }),
      episodes: [expect.objectContaining({ tag: 'S01E02' })],
    });
  });

  it('prefills the show search from the file name when nothing is matched', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        { id: '1', slug: 'blue-planet-ii', name: 'Blue Planet II', year: 2017 },
      ],
    });
    const lib = library();
    lib.organize = { ...lib.organize!, tvdb: { shows: [] } };
    render(
      <MatchFixModal
        item={{
          ...item,
          parsed: { title: 'Blue Planet II', cleanTitle: 'blue planet ii' },
        }}
        mediaType="tv"
        settings={lib.organize}
        library={lib}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(await screen.findByDisplayValue('Blue Planet II')).toBeTruthy();
    expect(mockRefetch).toHaveBeenCalledWith({ query: 'Blue Planet II' });
    expect(await screen.findByText('Blue Planet II')).toBeTruthy();
  });

  it('marks the selected episode with a checkmark', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        { tag: 'S01E01', name: 'One Ocean', seasonNumber: 1, episodeNumber: 1 },
        { tag: 'S01E02', name: 'The Deep', seasonNumber: 1, episodeNumber: 2 },
      ],
    });
    renderModal();
    fireEvent.click(await screen.findByText('The Deep'));
    expect(screen.getByLabelText('Selected')).toBeTruthy();
  });

  it('fills the episode search with the file name without its extension', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        { tag: 'S01E01', name: 'One Ocean', seasonNumber: 1, episodeNumber: 1 },
        { tag: 'S01E02', name: 'The Deep', seasonNumber: 1, episodeNumber: 2 },
      ],
    });
    const lib = library();
    render(
      <MatchFixModal
        item={{
          ...item,
          sourcePath:
            '/media/tv/Blue Planet II/Blue.Planet.II.S01E02.1080p.mkv',
          sourceRelativePath: 'Blue Planet II/Blue.Planet.II.S01E02.1080p.mkv',
        }}
        mediaType="tv"
        settings={lib.organize!}
        library={lib}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(await screen.findByText('One Ocean')).toBeTruthy();
    expect(screen.getByText('The Deep')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Use file name/ }));

    const filter = screen.getByRole('textbox', { name: 'Find episode' });
    expect((filter as HTMLInputElement).value).toBe(
      'Blue.Planet.II.S01E02.1080p',
    );
    // The file name picks out its own episode tag.
    expect(screen.getByText('The Deep')).toBeTruthy();
    expect(screen.queryByText('One Ocean')).toBeNull();
  });

  it('expands and collapses a card without changing the selection', async () => {
    const description =
      'The ocean floor is the least explored place on Earth, and this episode follows the creatures that live there.';
    mockRefetch.mockResolvedValue({
      data: [
        {
          tag: 'S01E01',
          name: 'One Ocean',
          seasonNumber: 1,
          episodeNumber: 1,
          description,
        },
      ],
    });
    renderModal();

    expect(await screen.findByText('One Ocean')).toBeTruthy();
    expect(
      screen.queryByRole('region', { name: 'Full description' }),
    ).toBeNull();

    const expand = screen.getByRole('button', { name: 'Expand description' });
    fireEvent.click(expand);
    expect(
      screen.getByRole('region', { name: 'Full description' }).textContent,
    ).toContain(description);
    // Expanding the card does not select it.
    expect(screen.queryByLabelText('Selected')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Collapse description' }),
    ).toBeTruthy();

    fireEvent.click(expand);
    expect(
      screen.queryByRole('region', { name: 'Full description' }),
    ).toBeNull();
  });

  it('matches the episode filter against normalized titles', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        {
          tag: 'S10E20',
          name: 'Leggo My Meg-O',
          seasonNumber: 10,
          episodeNumber: 20,
        },
        {
          tag: 'S10E01',
          name: 'Lottery Fever',
          seasonNumber: 10,
          episodeNumber: 1,
        },
      ],
    });
    renderModal();
    await screen.findByText('Leggo My Meg-O');

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Find episode' }),
      { target: { value: 'leggo my meg o' } },
    );

    expect(screen.getByText('Leggo My Meg-O')).toBeTruthy();
    expect(screen.queryByText('Lottery Fever')).toBeNull();
  });

  it('shows ranked match evidence badges and the extracted title', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        {
          tag: 'S01E02',
          name: 'The Deep',
          seasonNumber: 1,
          episodeNumber: 2,
        },
        {
          tag: 'S01E01',
          name: 'One Ocean',
          seasonNumber: 1,
          episodeNumber: 1,
        },
      ],
    });
    const lib = library();
    render(
      <MatchFixModal
        item={{
          ...item,
          parsed: {
            title: 'Blue Planet II One Ocean',
            cleanTitle: 'blue planet ii one ocean',
            episodeTitle: 'One Ocean',
            seasonNumber: 1,
            episodeNumber: 1,
            episodeNumbers: [1],
          },
        }}
        mediaType="tv"
        settings={lib.organize!}
        library={lib}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(
      await screen.findByText('Matching filename title: “One Ocean”'),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'S01E01 strong 98%' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /S01E02 weak/ }),
    ).toBeTruthy();
  });

  it('uses the resolved conflict confidence for the best episode', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        {
          tag: 'S01E02',
          name: 'The Deep',
          seasonNumber: 1,
          episodeNumber: 2,
        },
        {
          tag: 'S01E05',
          name: 'Big Blue',
          seasonNumber: 1,
          episodeNumber: 5,
        },
      ],
    });
    const lib = library();
    render(
      <MatchFixModal
        item={{
          ...item,
          parsed: {
            title: 'Blue Planet II Big Blue',
            cleanTitle: 'blue planet ii big blue',
            episodeTitle: 'Big Blue',
            seasonNumber: 1,
            episodeNumber: 2,
            episodeNumbers: [2],
          },
        }}
        mediaType="tv"
        settings={lib.organize!}
        library={lib}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    // The row would be conflict-capped at 80%; the modal must agree instead of
    // showing the candidate's uncapped base confidence.
    expect(
      await screen.findByRole('button', { name: 'S01E05 mixed signals 80%' }),
    ).toBeTruthy();
  });

  it('saves a consecutive multi-episode range from the switch', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        { tag: 'S01E01', name: 'One Ocean', seasonNumber: 1, episodeNumber: 1 },
        { tag: 'S01E02', name: 'The Deep', seasonNumber: 1, episodeNumber: 2 },
        { tag: 'S01E03', name: 'Coral Reefs', seasonNumber: 1, episodeNumber: 3 },
      ],
    });
    const onSave = renderModal();
    await screen.findByText('The Deep');

    fireEvent.click(
      screen.getByLabelText('This file contains multiple episodes'),
    );
    fireEvent.click(screen.getByText('The Deep'));
    fireEvent.click(screen.getByText('Coral Reefs'));

    expect(
      screen.getByText('S01E02-E03 - The Deep, Coral Reefs.mkv'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save match' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        episode: expect.objectContaining({ tag: 'S01E02' }),
        episodes: [
          expect.objectContaining({ tag: 'S01E02' }),
          expect.objectContaining({ tag: 'S01E03' }),
        ],
      }),
    );
  });

  it('auto-selects a range already named by the filename', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        { tag: 'S02E03', name: 'Coral Reefs', seasonNumber: 2, episodeNumber: 3 },
        { tag: 'S02E04', name: 'Big Blue', seasonNumber: 2, episodeNumber: 4 },
      ],
    });
    const lib = library();
    render(
      <MatchFixModal
        item={{
          ...item,
          parsed: {
            title: 'Show',
            cleanTitle: 'show',
            seasonNumber: 2,
            episodeNumber: 3,
            episodeNumbers: [3, 4],
          },
          episode: {
            tag: 'S02E03',
            name: 'Coral Reefs',
            seasonNumber: 2,
            episodeNumber: 3,
          },
        }}
        mediaType="tv"
        settings={lib.organize!}
        library={lib}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(
      await screen.findByText('S02E03-E04 - Coral Reefs, Big Blue.mkv'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        (
          screen.getByRole('checkbox', {
            name: 'Include Coral Reefs',
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
      expect(
        (
          screen.getByRole('checkbox', {
            name: 'Include Big Blue',
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
    });
  });

  it('keeps an explicitly saved single episode even when the name has a range', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        { tag: 'S02E03', name: 'Coral Reefs', seasonNumber: 2, episodeNumber: 3 },
        { tag: 'S02E04', name: 'Big Blue', seasonNumber: 2, episodeNumber: 4 },
      ],
    });
    const lib = library();
    const single = {
      tag: 'S02E03',
      name: 'Coral Reefs',
      seasonNumber: 2,
      episodeNumber: 3,
    };
    render(
      <MatchFixModal
        item={{
          ...item,
          parsed: {
            title: 'Show',
            cleanTitle: 'show',
            seasonNumber: 2,
            episodeNumber: 3,
            episodeNumbers: [3, 4],
          },
          episode: single,
          episodes: [single],
        }}
        mediaType="tv"
        settings={lib.organize!}
        library={lib}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByLabelText(
          'This file contains multiple episodes',
        ) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(await screen.findByText('S02E03 - Coral Reefs.mkv')).toBeTruthy();
  });

  it('auto-selects spaced and shorthand ranges from the filename', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        { tag: 'S01E02', name: 'The Deep', seasonNumber: 1, episodeNumber: 2 },
        { tag: 'S01E03', name: 'Coral Reefs', seasonNumber: 1, episodeNumber: 3 },
      ],
    });
    const lib = library();
    render(
      <MatchFixModal
        item={{
          ...item,
          parsed: {
            title: 'Show',
            cleanTitle: 'show',
            seasonNumber: 1,
            episodeNumber: 2,
            episodeNumbers: [2, 3],
          },
          episode: {
            tag: 'S01E02',
            name: 'The Deep',
            seasonNumber: 1,
            episodeNumber: 2,
          },
        }}
        mediaType="tv"
        settings={lib.organize!}
        library={lib}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(
      await screen.findByText('S01E02-E03 - The Deep, Coral Reefs.mkv'),
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        (
          screen.getByRole('checkbox', {
            name: 'Include Coral Reefs',
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
    });
  });

  it('rejects a gap in a multi-episode selection', async () => {
    mockRefetch.mockResolvedValue({
      data: [
        { tag: 'S01E02', name: 'The Deep', seasonNumber: 1, episodeNumber: 2 },
        { tag: 'S01E04', name: 'Big Blue', seasonNumber: 1, episodeNumber: 4 },
      ],
    });
    renderModal();
    await screen.findByText('The Deep');

    fireEvent.click(
      screen.getByLabelText('This file contains multiple episodes'),
    );
    fireEvent.click(screen.getByText('The Deep'));
    fireEvent.click(screen.getByText('Big Blue'));

    expect(
      screen.getByRole('alert').textContent,
    ).toContain('Select consecutive episodes from the same season.');
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Include Big Blue',
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it('clears the fix with Use best guess', async () => {
    mockRefetch.mockResolvedValue({ data: [] });
    const onSave = renderModal();
    await screen.findByText(/No episode matches/);
    fireEvent.click(screen.getByRole('button', { name: 'Use best guess' }));
    expect(onSave).toHaveBeenCalledWith(undefined);
  });

  it('reports episode load failures inline', async () => {
    mockRefetch.mockResolvedValue({ error: { message: 'tvdb is down' } });
    renderModal();
    expect(await screen.findByText(/Could not load episodes: tvdb is down/)).toBeTruthy();
  });
});
