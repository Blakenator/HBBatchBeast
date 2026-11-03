// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  createOrganizeSettings,
  emptyLibrary,
  type Library,
  type OrganizeScanScope,
  type OrganizeSettings,
} from '../src/common';
import { ShowMappings } from '../src/frontend/organize/ShowMappings';

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

const series = {
  id: '1',
  slug: 'blue-planet-ii',
  name: 'Blue Planet II',
  year: 2017,
};

function baseLibrary(): Library {
  return {
    ...emptyLibrary({ id: 'lib', name: 'TV', mediaType: 'tv' }),
    folders: [{ id: 'folder-1', source: '/media/tv', destination: '' }],
    organize: createOrganizeSettings('tv'),
  };
}

function Harness({
  initial = baseLibrary(),
  onChange,
  onScopeChange,
}: {
  initial?: Library;
  onChange: (settings: OrganizeSettings) => void;
  onScopeChange?: (scope: OrganizeScanScope[]) => void;
}) {
  const [library, setLibrary] = useState(initial);
  const [scope, setScope] = useState<OrganizeScanScope[]>([]);
  return (
    <ShowMappings
      library={library}
      settings={library.organize!}
      onSettingsChange={(settings) => {
        setLibrary({ ...library, organize: settings });
        onChange(settings);
      }}
      scope={scope}
      onScopeChange={(next) => {
        setScope(next);
        onScopeChange?.(next);
      }}
    />
  );
}

function detectionWithCandidates() {
  return {
    data: {
      folders: [
        {
          folderId: 'folder-1',
          root: '/media/tv',
          subpath: 'Blue Planet II 2017',
          name: 'Blue Planet II 2017',
          mediaCount: 3,
          query: 'Blue Planet II',
          candidates: [series],
        },
      ],
      warnings: [],
    },
  };
}

describe('ShowMappings', () => {
  it('opens the search with the folder query and the failed auto-match results', async () => {
    mockRefetch.mockResolvedValue(detectionWithCandidates());
    render(<Harness onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Detect & match shows/ }));
    expect(await screen.findByText('Needs matching')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Match' }));
    expect(screen.getByDisplayValue('Blue Planet II')).toBeTruthy();
    expect(screen.getByText('2017 · Choose')).toBeTruthy();
    // The stored candidates are shown without another TVDB request.
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('assigns a series from the expanded search', async () => {
    mockRefetch.mockResolvedValue(detectionWithCandidates());
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Detect & match shows/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Match' }));
    fireEvent.click(screen.getByText('Blue Planet II'));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        tvdb: expect.objectContaining({
          shows: [
            expect.objectContaining({
              folderId: 'folder-1',
              subpath: 'Blue Planet II 2017',
              series,
            }),
          ],
        }),
      }),
    );
  });

  it('selects several shows for a scoped scan', async () => {
    mockRefetch.mockResolvedValue({
      data: {
        folders: [
          {
            folderId: 'folder-1',
            root: '/media/tv',
            subpath: 'Show A',
            name: 'Show A',
            mediaCount: 2,
            candidates: [],
          },
          {
            folderId: 'folder-1',
            root: '/media/tv',
            subpath: 'Show B',
            name: 'Show B',
            mediaCount: 3,
            candidates: [],
          },
        ],
        warnings: [],
      },
    });
    const onScopeChange = vi.fn();
    render(<Harness onChange={vi.fn()} onScopeChange={onScopeChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Detect & match shows/ }));

    const boxes = await screen.findAllByRole('checkbox', { name: 'Scan only' });
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[0]);
    expect(onScopeChange).toHaveBeenLastCalledWith([
      { folderId: 'folder-1', subpath: 'Show A', name: 'Show A' },
    ]);

    fireEvent.click(boxes[1]);
    expect(onScopeChange).toHaveBeenLastCalledWith([
      { folderId: 'folder-1', subpath: 'Show A', name: 'Show A' },
      { folderId: 'folder-1', subpath: 'Show B', name: 'Show B' },
    ]);
    expect(screen.getByText(/Show A, Show B/)).toBeTruthy();

    fireEvent.click(boxes[0]);
    expect(onScopeChange).toHaveBeenLastCalledWith([
      { folderId: 'folder-1', subpath: 'Show B', name: 'Show B' },
    ]);

    fireEvent.click(
      screen.getByRole('button', { name: /Scan the whole library/ }),
    );
    expect(onScopeChange).toHaveBeenLastCalledWith([]);
  });

  it('can treat the whole library folder as one show', async () => {
    mockRefetch.mockImplementation((args: { query?: string }) => {
      if (args.query) return Promise.resolve({ data: [series] });
      return Promise.resolve({
        data: {
          folders: [
            {
              folderId: 'folder-1',
              root: '/media/tv',
              subpath: 'Nested Show',
              name: 'Nested Show',
              mediaCount: 1,
            },
          ],
          warnings: [],
        },
      });
    });
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Whole folder is one show' }),
    );
    // The root search opens prefilled from the folder name.
    const input = await screen.findByRole('textbox', {
      name: 'Search TVDB for a series',
    });
    expect((input as HTMLInputElement).value).toBe('tv');
    fireEvent.click(await screen.findByText('Blue Planet II'));

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tvdb: expect.objectContaining({
          shows: [
            expect.objectContaining({
              folderId: 'folder-1',
              subpath: '',
              series,
            }),
          ],
        }),
      }),
    );
  });
});
