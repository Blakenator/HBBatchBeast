// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'react-toastify';
import {
  APP_CONFIG_SCHEMA_VERSION,
  AppConfigV2,
  emptyLibrary,
  createOrganizeSettings,
} from '../src/common';
import { OrganizePage } from '../src/frontend/organize/OrganizePage';
import { useOrganizeSessionStore } from '../src/frontend/organize/organizeSession';
import {
  backendErrorMessage,
  backendFailure,
} from '../src/frontend/helpers/backendResult';

// jsdom reports zero-size elements; the review table virtualizer needs a viewport.
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

const { mockRefetch, asyncScan } = vi.hoisted(() => ({
  mockRefetch: vi.fn(),
  asyncScan: {
    plan: undefined as unknown,
    completeDelay: 0,
    props: undefined as unknown,
  },
}));

vi.mock('../src/frontend/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/frontend/helpers')>()),
  useBackend: () => ({
    loading: false,
    error: undefined,
    data: undefined,
    refetch: mockRefetch,
  }),
  // Mirrors the real async hook: emits discovery/matching progress, then the
  // finished plan. The parent remounts this runner for every scan.
  useBackendAsync: (options: {
    props?: unknown;
    onInit?: (progress: unknown) => void;
    onProgress?: (progress: unknown) => void;
    onComplete?: (plan: unknown) => void;
  }) => {
    asyncScan.props = options.props;
    React.useEffect(() => {
      options.onInit?.({
        phase: 'discovering',
        completed: 0,
        total: 0,
        discovered: 0,
        elapsedMs: 0,
      });
      options.onProgress?.({
        phase: 'matching',
        completed: 1,
        total: 2,
        discovered: 2,
        currentFile: '/media/tv/Blue Planet II/S01E01.mkv',
        currentShow: 'Blue Planet II',
        elapsedMs: 1200,
        etaMs: 1400,
      });
      const timer = setTimeout(
        () => options.onComplete?.(asyncScan.plan),
        asyncScan.completeDelay,
      );
      return () => clearTimeout(timer);
    }, []);
    return {
      loading: true,
      error: undefined,
      completeData: undefined,
      lastProgressData: undefined,
      refetch: vi.fn(),
    };
  },
}));

afterEach(() => {
  cleanup();
  useOrganizeSessionStore.setState({ sessions: {} });
  mockRefetch.mockReset();
  asyncScan.plan = undefined;
  asyncScan.completeDelay = 0;
  asyncScan.props = undefined;
});

function library() {
  const base = emptyLibrary({ id: 'library-1', name: 'TV', mediaType: 'tv' });
  const organize = createOrganizeSettings('tv');
  organize.tvdb = {
    shows: [
      {
        id: 'show-1',
        folderId: 'folder-1',
        subpath: 'Blue Planet II',
        series: {
          id: '1',
          slug: 'blue-planet-ii',
          name: 'Blue Planet II',
          year: 2017,
          image: 'https://artworks.test/blue.jpg',
        },
      },
    ],
  };
  return {
    ...base,
    folders: [{ id: 'folder-1', source: '/media/tv', destination: '' }],
    organize,
  };
}

function config(active: ReturnType<typeof library>): AppConfigV2 {
  return {
    schema_version: APP_CONFIG_SCHEMA_VERSION,
    lang: 'en',
    version_message: 'test',
    selected_library: active.id,
    presets: [
      { id: 'preset-1', name: 'Fast 1080p30', handbrake: { preset: 'Fast 1080p30' } },
    ],
    libraries: [active],
  };
}

const planData = {
  mediaType: 'tv' as const,
  sourceRoots: ['/media/tv'],
  createdAt: '2026-01-01T00:00:00.000Z',
  warnings: [],
  items: [
    {
      id: '/media/tv/Blue Planet II/S01E01.mkv',
      mediaType: 'tv' as const,
      sourcePath: '/media/tv/Blue Planet II/S01E01.mkv',
      sourceRoot: '/media/tv',
      sourceRelativePath: 'Blue Planet II/S01E01.mkv',
      targetPath: '/media/tv/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
      relativeTarget: 'Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
      action: 'rename' as const,
      confidence: 1,
      reason: 'Matched',
      sidecars: [],
      episode: {
        tag: 'S01E01',
        name: 'One Ocean',
        seasonNumber: 1,
        episodeNumber: 1,
      },
      showFolder: 'Blue Planet II',
      seriesName: 'Blue Planet II',
      showSubpath: '',
    },
  ],
};

const emptyPlan = {
  mediaType: 'tv' as const,
  sourceRoots: ['/media/tv'],
  createdAt: '2026-01-01T00:00:00.000Z',
  warnings: [],
  items: [],
};

function renderPage(
  active = library(),
  plex?: { dbPath: string; updateByDefault: boolean },
  onUpdateLibrary = vi.fn(),
) {
  const appConfig = config(active);
  return render(
    <OrganizePage
      config={
        plex
          ? {
              ...appConfig,
              app_settings: {
                worker_instance_number: '4',
                save_worker_logs_toggle: 0,
                plex,
              },
            }
          : appConfig
      }
      library={active}
      onUpdateLibrary={onUpdateLibrary}
      onBack={vi.fn()}
    />,
  );
}

describe('OrganizePage', () => {
  it('spreads the steps across a stepper and starts on setup', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: /What to organize/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Naming rules/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Review and apply/ })).toBeTruthy();
    expect(screen.getAllByText('/media/tv').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Blue Planet II').length).toBeGreaterThan(0);
    expect(screen.getByText(/Plex database:/)).toBeTruthy();
    expect(screen.getByText(/not configured/)).toBeTruthy();
    // Only the active step's content is mounted.
    expect(screen.queryByRole('button', { name: 'Scan files' })).toBeNull();
  });

  it('shows an example line for the TV folder template', () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Naming rules/ }));
    const examples = screen.getAllByText(/Example:/);
    expect(examples.some((node) => node.textContent?.includes('Season 01'))).toBe(
      true,
    );
  });

  it('scans and reviews the plan in the table', async () => {
    asyncScan.plan = planData;
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));

    expect(await screen.findByRole('grid', { name: 'Organize review' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Apply \(1\)/ })).toBeTruthy();
  });

  it('streams real scan progress with a percentage and current file', async () => {
    asyncScan.plan = emptyPlan;
    asyncScan.completeDelay = 300;
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));

    expect(await screen.findByText(/Matching 1 of 2 files/)).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(
      screen.getByText(/Blue Planet II ·/).textContent,
    ).toContain('S01E01.mkv');
    expect(screen.getByText(/about 1s left/)).toBeTruthy();

    expect(
      await screen.findByRole('grid', { name: 'Organize review' }),
    ).toBeTruthy();
  });

  it('keeps the plan visible after fixing a match', async () => {
    asyncScan.plan = planData;
    mockRefetch.mockImplementation((args: { slug?: string }) => {
      if (args.slug) {
        return Promise.resolve({
          data: [
            {
              tag: 'S01E02',
              name: 'The Deep',
              seasonNumber: 1,
              episodeNumber: 2,
            },
          ],
        });
      }
      return Promise.resolve({ data: planData });
    });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });

    fireEvent.click(
      screen.getByRole('button', { name: /More actions for/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fix match' }));
    fireEvent.click(await screen.findByText('The Deep'));
    fireEvent.click(screen.getByRole('button', { name: 'Save match' }));

    expect(screen.getByRole('grid', { name: 'Organize review' })).toBeTruthy();
    expect(screen.getAllByText(/S01E02/).length).toBeGreaterThan(0);
  });

  it('scans only the selected show and passes the scope', async () => {
    asyncScan.plan = emptyPlan;
    renderPage();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /Include Blue Planet II in the next scan/,
      }),
    );
    expect(screen.getByText(/Scanning/)).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });

    expect(asyncScan.props).toMatchObject({
      scope: [
        {
          folderId: 'folder-1',
          subpath: 'Blue Planet II',
          name: 'Blue Planet II',
        },
      ],
    });
  });

  it('lists limited scan folders as bullets and summarizes the rest', async () => {
    asyncScan.plan = emptyPlan;
    mockRefetch.mockResolvedValue({
      data: {
        folders: Array.from({ length: 9 }, (_, index) => ({
          folderId: 'folder-1',
          root: '/media/tv',
          subpath: `Show ${index + 1}`,
          name: `Show ${index + 1}`,
          mediaCount: 1,
          series: {
            id: String(index + 2),
            slug: `show-${index + 1}`,
            name: `Show ${index + 1}`,
          },
          autoMatched: true,
        })),
        warnings: [],
      },
    });
    renderPage();
    fireEvent.click(
      screen.getByRole('button', { name: /Detect & match shows/ }),
    );

    for (let index = 1; index <= 9; index += 1) {
      fireEvent.click(
        await screen.findByRole('checkbox', {
          name: `Include Show ${index} in the next scan`,
        }),
      );
    }

    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    expect(screen.getByText(/Scan limited to 9 show folders/)).toBeTruthy();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText('and 2 more…')).toBeTruthy();
  });

  it('detects show folders and fills in auto matches', async () => {
    mockRefetch.mockResolvedValue({
      data: {
        folders: [
          {
            folderId: 'folder-1',
            root: '/media/tv',
            subpath: 'Planet Earth',
            name: 'Planet Earth',
            mediaCount: 2,
            series: { id: '2', slug: 'planet-earth', name: 'Planet Earth' },
            autoMatched: true,
          },
        ],
        warnings: [],
      },
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Detect & match shows/ }));

    expect((await screen.findAllByText('Planet Earth')).length).toBeGreaterThan(0);
    expect(screen.getByText('Auto-matched')).toBeTruthy();
    expect(mockRefetch).toHaveBeenCalledWith(
      expect.objectContaining({
        library: expect.objectContaining({ id: 'library-1' }),
      }),
    );
  });

  it('bulk-skips the selected rows and clears the selection', async () => {
    asyncScan.plan = planData;
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });
    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Skip (1)' }));

    expect(screen.queryByText('1 selected')).toBeNull();
    expect(
      screen.getByRole('button', { name: /Apply/ }).textContent,
    ).not.toContain('(1)');
  });

  it('approves a below-threshold row so it can be applied', async () => {
    const onUpdateLibrary = vi.fn();
    asyncScan.plan = {
      ...planData,
      items: [
        {
          ...planData.items[0],
          action: 'skip',
          confidence: 0.4,
          reason: 'Fuzzy match',
        },
      ],
    };
    renderPage(library(), undefined, onUpdateLibrary);
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });
    expect(
      screen.getByRole('button', { name: /Apply/ }),
    ).toHaveProperty('disabled', true);

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select /media/tv/Blue Planet II/S01E01.mkv',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve (1)' }));

    expect(screen.getByRole('button', { name: /Apply \(1\)/ })).toBeTruthy();
    expect(screen.getByLabelText('Match approved')).toBeTruthy();

    await waitFor(
      () => expect(onUpdateLibrary).toHaveBeenCalled(),
      { timeout: 1500 },
    );
    const saved = onUpdateLibrary.mock.calls.at(-1)?.[0] as ReturnType<
      typeof library
    >;
    expect(saved.organize.overrides).toMatchObject({
      '/media/tv/Blue Planet II/S01E01.mkv': {
        series: { name: 'Blue Planet II' },
        episode: { tag: 'S01E01' },
      },
    });
  });

  it('skips only the row chosen in its action menu', async () => {
    const tags = ['S01E01', 'S01E02', 'S01E03'];
    asyncScan.plan = {
      ...planData,
      items: tags.map((tag, index) => ({
        ...planData.items[0],
        id: `/media/tv/Blue Planet II/${tag}.mkv`,
        sourcePath: `/media/tv/Blue Planet II/${tag}.mkv`,
        sourceRelativePath: `Blue Planet II/${tag}.mkv`,
        targetPath: `/media/tv/Blue Planet II/Season 01/${tag} - One Ocean.mkv`,
        relativeTarget: `Blue Planet II/Season 01/${tag} - One Ocean.mkv`,
        episode: {
          tag,
          name: 'One Ocean',
          seasonNumber: 1,
          episodeNumber: index + 1,
        },
      })),
    };
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });

    fireEvent.click(
      screen.getAllByRole('button', { name: /More actions for/ })[1],
    );
    fireEvent.click(screen.getByRole('button', { name: 'Skip file' }));

    expect(screen.getAllByText('Rename')).toHaveLength(2);
    expect(
      screen.getByRole('button', {
        name: 'Include Blue Planet II/S01E02.mkv',
      }),
    ).toBeTruthy();
  });

  it('renames only the folder when asked from the row menu', async () => {
    asyncScan.plan = {
      ...planData,
      items: [{ ...planData.items[0], showSubpath: 'Blue Planet II' }],
    };
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });
    expect(
      screen.getByTitle(
        '/media/tv/Blue Planet II/Season 01/S01E01 - One Ocean.mkv',
      ),
    ).toBeTruthy();

    fireEvent.click(
      screen.getAllByRole('button', { name: /More actions for/ })[0],
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Rename folder only' }),
    );

    expect(
      screen.getByTitle('/media/tv/Blue Planet II/Season 01/S01E01.mkv'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Apply \(1\)/ })).toBeTruthy();
  });

  it('lists failed moves and keeps those rows in the review', async () => {
    asyncScan.plan = planData;
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });

    mockRefetch.mockResolvedValueOnce({
      data: {
        planId: 'plan-1',
        renamed: [],
        skipped: [],
        failed: [
          {
            path: '/media/tv/Blue Planet II/S01E01.mkv',
            message: 'EACCES: permission denied, rename',
          },
        ],
        plexUpdated: 0,
        historyMoved: 0,
        pendingHistoryTransfers: 0,
        warnings: [],
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /Apply \(1\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm apply' }));

    expect(await screen.findByText(/EACCES: permission denied/)).toBeTruthy();
    expect(screen.getByText(/1 move\(s\) failed/)).toBeTruthy();
    // The failed row stays in the plan and selected so it can be retried.
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Apply \(1\)/ }),
    ).toBeTruthy();
  });

  it('bulk use-best-guess unskips the selected rows', async () => {
    asyncScan.plan = {
      ...planData,
      items: [
        {
          ...planData.items[0],
          action: 'skip',
          manualSkip: true,
          reason: 'Skipped manually',
        },
      ],
    };
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select /media/tv/Blue Planet II/S01E01.mkv',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use best guess (1)' }));

    expect(
      screen.getByRole('button', { name: /Apply \(1\)/ }),
    ).toBeTruthy();
  });

  it('bulk best guess promotes a below-threshold row to a rename', async () => {
    const infoToast = vi
      .spyOn(toast, 'info')
      .mockImplementation(() => '' as never);
    asyncScan.plan = {
      ...planData,
      items: [
        {
          ...planData.items[0],
          action: 'skip',
          confidence: 0.2,
          reason: 'Confidence 20% is below the 60% threshold',
        },
      ],
    };
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });
    expect(screen.getByRole('button', { name: /^Apply$/ })).toBeTruthy();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Select /media/tv/Blue Planet II/S01E01.mkv',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use best guess (1)' }));

    expect(screen.getByText('Rename')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Apply \(1\)/ })).toBeTruthy();
    expect(infoToast).not.toHaveBeenCalledWith(
      'No manual matches or skips to clear for the selected file(s).',
    );
    infoToast.mockRestore();
  });

  it('rescans the parent folder of the selected rows', async () => {
    const second = {
      ...planData.items[0],
      id: '/media/tv/Blue Planet II/S01E02.mkv',
      sourcePath: '/media/tv/Blue Planet II/S01E02.mkv',
      sourceRelativePath: 'Blue Planet II/S01E02.mkv',
      targetPath: '/media/tv/Blue Planet II/Season 01/S01E02 - The Deep.mkv',
      relativeTarget: 'Blue Planet II/Season 01/S01E02 - The Deep.mkv',
      episode: {
        tag: 'S01E02',
        name: 'The Deep',
        seasonNumber: 1,
        episodeNumber: 2,
      },
    };
    asyncScan.plan = planData;
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });

    // The freshly scanned row starts selected, so the bulk action is ready.
    // The rescan picks up a file that was added to the same folder.
    asyncScan.plan = { ...planData, items: [planData.items[0], second] };
    fireEvent.click(screen.getByRole('button', { name: 'Rescan (1)' }));

    await waitFor(() =>
      expect(asyncScan.props).toMatchObject({
        rescanFolders: ['/media/tv/Blue Planet II'],
      }),
    );
    expect((await screen.findAllByText(/S01E02/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Apply \(1\)/ })).toBeTruthy();
  });

  it('use best guess in the fix dialog unskips the row too', async () => {
    mockRefetch.mockResolvedValue({ data: [] });
    asyncScan.plan = {
      ...planData,
      items: [
        {
          ...planData.items[0],
          action: 'skip',
          manualSkip: true,
          reason: 'Skipped manually',
        },
      ],
    };
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });

    fireEvent.click(
      screen.getByRole('button', { name: /More actions for/ }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fix match' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use best guess' }));

    expect(screen.getByText('Rename')).toBeTruthy();
  });

  it('restores the review when leaving and returning to the page', async () => {
    asyncScan.plan = planData;
    const first = renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });
    expect(screen.getByRole('button', { name: /Apply \(1\)/ })).toBeTruthy();
    first.unmount();
    renderPage();
    expect(screen.getByRole('grid', { name: 'Organize review' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Apply \(1\)/ })).toBeTruthy();
  });

  it('explains why a Plex update could not start instead of doing nothing', async () => {
    const errorToast = vi
      .spyOn(toast, 'error')
      .mockImplementation(() => '' as never);
    asyncScan.plan = planData;
    mockRefetch.mockImplementation((args: { path?: string }) => {
      if (args?.path) {
        return Promise.resolve({
          error: JSON.stringify({
            message: 'error',
            inner: { message: 'Plex database folder is read-only' },
          }),
        });
      }
      return Promise.resolve({ data: planData });
    });
    renderPage(library(), {
      dbPath: '/var/lib/plex/Plug-in Support/Databases/plex.db',
      updateByDefault: true,
    });
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });

    fireEvent.click(screen.getByRole('button', { name: /Apply \(1\)/ }));

    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(
        'Plex database folder is read-only',
      ),
    );
    errorToast.mockRestore();
  });

  it('caps long warning lists instead of listing every row', async () => {
    asyncScan.plan = {
      ...planData,
      warnings: Array.from(
        { length: 10 },
        (_, index) => `Warning ${index + 1}`,
      ),
    };
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Review and apply/ }));
    fireEvent.click(screen.getByRole('button', { name: /Scan files/ }));
    await screen.findByRole('grid', { name: 'Organize review' });

    expect(screen.getByText('Warning 1')).toBeTruthy();
    expect(screen.getByText('Warning 8')).toBeTruthy();
    expect(screen.queryByText('Warning 9')).toBeNull();
    expect(screen.getByText('2 more warning(s) are hidden.')).toBeTruthy();
  });
});

/** Mirrors `backendResultFromError` in @superflag/super-ipc-backend. */
function serializedError(message: string): string {
  return JSON.stringify({
    message: 'error',
    inner: { message, name: 'Error', stack: 'Error: at test' },
  });
}

describe('backend error messages', () => {
  it('unwraps the serialized AppError the hooks return', () => {
    expect(backendErrorMessage(serializedError('attempt to write a readonly database'))).toBe(
      'attempt to write a readonly database',
    );
  });

  it('reads plain strings, Error instances and message objects', () => {
    expect(backendErrorMessage('No handler registered')).toBe(
      'No handler registered',
    );
    expect(backendErrorMessage(new Error('boom'))).toBe('boom');
    expect(backendErrorMessage({ message: 'object message' })).toBe(
      'object message',
    );
    expect(backendErrorMessage(undefined)).toBeUndefined();
    expect(backendErrorMessage(null)).toBeUndefined();
  });

  it('reports a missing result as a failure because rejections are swallowed', () => {
    expect(backendFailure(undefined, 'fallback')).toBe('fallback');
    expect(backendFailure({}, 'fallback')).toBeUndefined();
    expect(
      backendFailure({ error: serializedError('disk full') }, 'fallback'),
    ).toBe('disk full');
    expect(backendFailure({ error: '' }, 'fallback')).toBeUndefined();
  });

  it('falls back when the payload has no usable message', () => {
    expect(backendFailure({ error: { code: 'ENOENT' } }, 'fallback')).toBe(
      'fallback',
    );
  });
});
