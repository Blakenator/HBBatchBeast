// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  APP_CONFIG_SCHEMA_VERSION,
  AppConfigV2,
  emptyLibrary,
  createOrganizeSettings,
} from '../src/common';
import { OrganizePage } from '../src/frontend/organize/OrganizePage';

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

vi.mock('../src/frontend/helpers', () => ({
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

function renderPage(active = library()) {
  return render(
    <OrganizePage
      config={config(active)}
      library={active}
      onUpdateLibrary={vi.fn()}
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
    fireEvent.click(screen.getByRole('checkbox', { name: 'Scan only' }));
    expect(screen.getByText(/Scanning only/)).toBeTruthy();

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
});
