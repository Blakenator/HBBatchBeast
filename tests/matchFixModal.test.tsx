// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    fireEvent.click(screen.getByRole('button', { name: 'Save match' }));

    expect(onSave).toHaveBeenCalledWith({
      series: expect.objectContaining({ slug: 'blue-planet-ii' }),
      episode: expect.objectContaining({ tag: 'S01E02' }),
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
