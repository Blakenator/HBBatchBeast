// @vitest-environment jsdom
import React, { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  createOrganizeSettings,
  emptyLibrary,
  setOverride,
  type OrganizePlan,
  type OrganizePlanItem,
  type OrganizeSplitPlan,
  type OrganizeSettings,
  type TvdbEpisode,
  type TvdbSeriesRef,
} from '../src/common';
import { SplitModal } from '../src/frontend/organize/SplitModal';

const { refetch, scanControl } = vi.hoisted(() => ({
  refetch: vi.fn(),
  scanControl: {
    percent: undefined as number | undefined,
    release: undefined as (() => void) | undefined,
    errorMessage: undefined as string | undefined,
    errorValue: undefined as Error | undefined,
  },
}));

vi.mock('../src/frontend/helpers', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/frontend/helpers')>();
  return {
    ...actual,
    useBackend: (options: { channel: string }) => ({
      loading: false,
      error: undefined,
      data:
        options.channel === 'ORGANIZE_FFMPEG_STATUS'
          ? { available: true, path: '/usr/bin/ffmpeg', source: 'path' }
          : undefined,
      refetch: (args: unknown) => refetch(options.channel, args),
    }),
    // The black-frame scan is async so the backend can stream progress.
    useBackendAsync: (options: {
      channel: string;
      onInit?: (progress: { percent: number }) => void;
      onProgress?: (progress: { percent: number }) => void;
      onComplete?: (result: {
        intervals: { startSeconds: number; endSeconds: number }[];
      }) => void;
    }) => {
      // Mirror the real hook: a mount starts one request, later renders do
      // not restart it.
      const started = useRef(false);
      if (scanControl.errorMessage) {
        // Keep one Error instance; a fresh one per render would retrigger the
        // error effect forever.
        scanControl.errorValue ??= new Error(scanControl.errorMessage);
        return {
          loading: false,
          error: scanControl.errorValue,
          data: undefined,
        };
      }
      if (!started.current) {
        started.current = true;
        const intervals = [
          { startSeconds: 1805, endSeconds: 1807 },
          { startSeconds: 2400, endSeconds: 2402 },
        ];
        const complete = () => options.onComplete?.({ intervals });
        const percent = scanControl.percent;
        queueMicrotask(() => {
          options.onInit?.({ percent: 0 });
          if (percent === undefined) {
            complete();
            return;
          }
          queueMicrotask(() => {
            options.onProgress?.({ percent });
            // A real scan keeps running; tests drive completion explicitly.
            scanControl.release = complete;
          });
        });
      }
      return { loading: true, error: undefined, data: undefined };
    },
  };
});

afterEach(() => {
  cleanup();
  refetch.mockReset();
  scanControl.percent = undefined;
  scanControl.release = undefined;
  scanControl.errorMessage = undefined;
  scanControl.errorValue = undefined;
});

const ep1: TvdbEpisode = {
  tag: 'S01E01',
  name: 'One Ocean',
  seasonNumber: 1,
  episodeNumber: 1,
};
const ep2: TvdbEpisode = {
  tag: 'S01E02',
  name: 'The Deep',
  seasonNumber: 1,
  episodeNumber: 2,
};
const ep3: TvdbEpisode = {
  tag: 'S01E03',
  name: 'Coral Seas',
  seasonNumber: 1,
  episodeNumber: 3,
};

const series: TvdbSeriesRef = {
  id: 'series-1',
  slug: 'blue-planet-ii',
  name: 'Blue Planet II',
};

const item: OrganizePlanItem = {
  id: '/media/tv/Blue Planet II/S01E01-E02.mkv',
  mediaType: 'tv',
  sourcePath: '/media/tv/Blue Planet II/S01E01-E02.mkv',
  sourceRoot: '/media/tv',
  sourceRelativePath: 'Blue Planet II/S01E01-E02.mkv',
  targetPath: '/media/tv/Blue Planet II/Season 01/S01E01-E02.mkv',
  relativeTarget: 'Blue Planet II/Season 01/S01E01-E02.mkv',
  action: 'skip',
  confidence: 1,
  reason: 'Already named',
  sidecars: [],
  episode: ep1,
  episodes: [ep1, ep2],
  parsed: { title: 'Blue Planet II', cleanTitle: 'blue planet ii' },
  showFolder: 'Blue Planet II',
  seriesName: 'Blue Planet II',
  showSubpath: 'Blue Planet II',
};

const plan: OrganizePlan = {
  mediaType: 'tv',
  sourceRoots: ['/media/tv'],
  items: [item],
  createdAt: '2026-01-01T00:00:00.000Z',
  warnings: [],
};

const probe = {
  path: item.sourcePath,
  size: 1024,
  durationSeconds: 3600,
  startTimeSeconds: 0,
  videoCodecs: ['h264'],
  audioCodecs: ['aac'],
  subtitleCodecs: [],
  streams: [],
};

const existingSplit: OrganizeSplitPlan = {
  itemId: item.id,
  sourcePath: item.sourcePath,
  fileSize: probe.size,
  fileDurationSeconds: probe.durationSeconds,
  estimate: { method: 'equal' },
  cutMode: 'copy',
  originalPolicy: 'backup',
  sidecarPolicy: 'leave',
  segments: [
    { index: 0, startSeconds: 0, endSeconds: 1800, episode: ep1 },
    { index: 1, startSeconds: 1800, endSeconds: 3600, episode: ep2 },
  ],
  updatedAt: 1,
};

function mockBackend() {
  refetch.mockImplementation((channel: string, args: unknown) => {
    const request = args as {
      markerTimes?: number[];
      times?: number[];
      path?: string;
    };
    if (channel === 'ORGANIZE_PROBE_SPLIT') {
      if (request.markerTimes?.length) {
        return Promise.resolve({
          data: {
            ...probe,
            keyframes: request.markerTimes.map((seconds) => ({
              requestedSeconds: seconds,
              keyframeSeconds: seconds - 2,
              deltaSeconds: -2,
              candidates: [seconds - 40, seconds - 2, seconds + 5],
            })),
          },
        });
      }
      return Promise.resolve({ data: probe });
    }
    if (channel === 'ORGANIZE_SPLIT_THUMBNAILS') {
      const times = request.times ?? [];
      return Promise.resolve({
        data: {
          frames: times.map((seconds) => ({
            seconds,
            dataUrl: 'data:image/jpeg;base64,AA==',
          })),
        },
      });
    }
    if (channel === 'ORGANIZE_LOAD_EPISODES') {
      return Promise.resolve({ data: [ep1, ep2, ep3] });
    }
    if (channel === 'ORGANIZE_EPISODE_RUNTIMES') {
      return Promise.resolve({ data: {} });
    }
    return Promise.resolve({ data: undefined });
  });
}

function renderModal(
  onSave = vi.fn(),
  splits: OrganizeSplitPlan[] = [],
  settings: OrganizeSettings = createOrganizeSettings('tv'),
  items: OrganizePlanItem[] = [item],
) {
  mockBackend();
  const library = emptyLibrary({ id: 'lib', name: 'TV', mediaType: 'tv' });
  render(
    <SplitModal
      plan={{ ...plan, items }}
      items={items}
      splits={splits}
      settings={settings}
      library={library}
      mediaType="tv"
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );
  return onSave;
}

describe('SplitModal approval', () => {
  it('starts a new estimate unapproved and saves nothing until it is approved', async () => {
    const onSave = renderModal();

    const approve = await screen.findByRole('button', {
      name: 'Approve split',
    });
    const save = screen.getByRole('button', { name: 'Save approved (0)' });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(approve);
    expect(
      screen.getByRole('button', { name: 'Save approved (1)' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save approved (1)' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const [upserts, removed] = onSave.mock.calls[0] as [
      OrganizeSplitPlan[],
      string[],
    ];
    expect(removed).toEqual([]);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].segments.map((segment) => segment.startSeconds)).toEqual([
      0, 1800,
    ]);
  });

  it('opens queued splits approved and supports approve/unapprove all', async () => {
    renderModal(vi.fn(), [existingSplit]);

    expect(
      await screen.findByRole('button', { name: 'Unapprove split' }),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Approved split' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Unapprove all' }));
    expect(
      (
        screen.getByRole('button', {
          name: 'Save approved (0)',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByRole('img', { name: 'Approved split' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(
      screen.getByRole('button', { name: 'Save approved (1)' }),
    ).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Approved split' })).toBeTruthy();
  });
});

describe('SplitModal timeline helpers', () => {
  it('centers the pan on the nearest split', async () => {
    renderModal();
    await screen.findByRole('button', { name: 'Approve split' });

    const slider = screen.getByRole('slider', {
      name: 'Timeline position',
    }) as HTMLInputElement;

    // The editor opens centered on the first cut; pan away before recentering.
    fireEvent.change(slider, { target: { value: '0' } });
    expect(slider.value).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: 'Center on split' }));
    await waitFor(() => expect(slider.value).toBe('1500'));
  });

  it('previews the actual copy cut and lets a candidate keyframe replace it', async () => {
    renderModal();
    await screen.findByRole('button', { name: 'Approve split' });

    expect(await screen.findByAltText('Copy cut at 29:58.0')).toBeTruthy();
    expect(screen.getByTitle('Copy cut lands at 29:58.0')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Use 29:20.0 for the cut before S01E02',
      }),
    );

    expect(
      (screen.getByLabelText('Start time for segment 2') as HTMLInputElement)
        .value,
    ).toBe('29:20.0');
    expect(screen.getByText(/Copy cut lands at 29:20\.0/)).toBeTruthy();
    expect(await screen.findByAltText('Copy cut at 29:20.0')).toBeTruthy();
  });
});

describe('SplitModal episode selection', () => {
  it('lists only the detected range and picks another episode with Fix match', async () => {
    const settings = setOverride(
      createOrganizeSettings('tv'),
      item.sourcePath,
      { series },
      false,
    );
    renderModal(vi.fn(), [], settings);
    await screen.findByRole('button', { name: 'Approve split' });

    const segment = screen.getByLabelText(
      'Episode for segment 1',
    ) as HTMLSelectElement;
    expect([...segment.options].map((option) => option.textContent)).toEqual([
      'S01E01 · One Ocean',
      'S01E02 · The Deep',
    ]);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Select other episode for segment 1',
      }),
    );

    // The shared Fix match dialog opens with the whole show available.
    await screen.findByText('Fix match');
    fireEvent.click(await screen.findByText('Coral Seas'));
    fireEvent.click(screen.getByRole('button', { name: 'Save match' }));

    await waitFor(() => expect(segment.value).toBe('1:3'));
    expect(segment.options[2]?.textContent).toBe('S01E03 · Coral Seas');
  });
});

describe('SplitModal general file splitting', () => {
  const singleItem: OrganizePlanItem = {
    ...item,
    id: '/media/tv/Blue Planet II/S01E01.mkv',
    sourcePath: '/media/tv/Blue Planet II/S01E01.mkv',
    sourceRelativePath: 'Blue Planet II/S01E01.mkv',
    targetPath: '/media/tv/Blue Planet II/S01E01.mkv',
    relativeTarget: 'Blue Planet II/S01E01.mkv',
    episode: ep1,
    episodes: undefined,
  };

  it('opens a two-segment plan for a single-episode file', async () => {
    renderModal(vi.fn(), [], createOrganizeSettings('tv'), [singleItem]);
    await screen.findByRole('button', { name: 'Approve split' });

    expect(screen.getByText('Split files (1 file)')).toBeTruthy();
    expect(screen.getAllByLabelText(/^Episode for segment/)).toHaveLength(2);
    expect(
      (screen.getByLabelText('Episode for segment 2') as HTMLSelectElement)
        .value,
    ).toBe('');
    // Explanations hang off the controls themselves; there is no icon.
    expect(screen.queryByRole('button', { name: /^About / })).toBeNull();
    expect(document.querySelector('[data-tip="Cut mode"]')).not.toBeNull();
    expect(document.querySelector('[data-tip="Approve split"]')).not.toBeNull();

    fireEvent.mouseOver(document.querySelector('[data-tip="Cut mode"]')!);
    expect(
      await screen.findByText(/keeps the original video streams/),
    ).toBeTruthy();
  });

  it('snaps the cuts to the nearest black run', async () => {
    renderModal();
    await screen.findByRole('button', { name: 'Approve split' });

    fireEvent.click(
      screen.getByRole('button', { name: 'Snap to black frames' }),
    );

    await waitFor(() =>
      expect(
        (screen.getByLabelText('Start time for segment 2') as HTMLInputElement)
          .value,
      ).toBe('30:06.0'),
    );

    // A snapped split is ready for review until it is approved.
    expect(screen.getByLabelText('Ready for review')).toBeTruthy();
    expect(screen.getByText(/ready for review/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve split' }));
    expect(screen.getByLabelText('Approved split')).toBeTruthy();
    expect(screen.queryByLabelText('Ready for review')).toBeNull();
  });

  it('adds one split for every black gap', async () => {
    renderModal();
    await screen.findByRole('button', { name: 'Approve split' });

    fireEvent.click(screen.getByRole('button', { name: 'Add all black gaps' }));

    await waitFor(() =>
      expect(screen.getAllByLabelText(/^Episode for segment/)).toHaveLength(3),
    );
  });

  it('returns an approved split to review after editing', async () => {
    renderModal(vi.fn(), [existingSplit]);
    await screen.findByRole('button', { name: 'Unapprove split' });
    expect(screen.getByLabelText('Approved split')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Snap to black frames' }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Ready for review')).toBeTruthy(),
    );
    expect(screen.queryByLabelText('Approved split')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve split' })).toBeTruthy();
  });

  it('shows scan progress on the button and in a bar', async () => {
    scanControl.percent = 40;
    renderModal();
    await screen.findByRole('button', { name: 'Approve split' });

    fireEvent.click(
      screen.getByRole('button', { name: 'Snap to black frames' }),
    );

    const scanning = await screen.findByRole('button', {
      name: 'Scanning for black… 40%',
    });
    expect((scanning as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('progressbar').textContent).toContain('40%');

    await act(async () => {
      scanControl.release?.();
    });

    await waitFor(() =>
      expect(
        (screen.getByLabelText('Start time for segment 2') as HTMLInputElement)
          .value,
      ).toBe('30:06.0'),
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Snap to black frames' }),
    ).toBeTruthy();
  });

  it('reports a failed scan and re-enables the tools', async () => {
    scanControl.errorMessage = 'ffmpeg exploded';
    renderModal();
    await screen.findByRole('button', { name: 'Approve split' });

    fireEvent.click(
      screen.getByRole('button', { name: 'Snap to black frames' }),
    );

    await screen.findByText('Black-frame scan failed: ffmpeg exploded');
    const snap = screen.getByRole('button', { name: 'Snap to black frames' });
    expect((snap as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('SplitModal batch black-frame tools', () => {
  const secondItem: OrganizePlanItem = {
    ...item,
    id: '/media/tv/Blue Planet II/S01E02-E03.mkv',
    sourcePath: '/media/tv/Blue Planet II/S01E02-E03.mkv',
    sourceRelativePath: 'Blue Planet II/S01E02-E03.mkv',
    targetPath: '/media/tv/Blue Planet II/S01E02-E03.mkv',
    relativeTarget: 'Blue Planet II/S01E02-E03.mkv',
    episode: ep2,
    episodes: [ep2, ep3],
  };

  async function waitForBatchReady() {
    // Both files must finish probing before a batch run counts as a batch.
    await waitFor(() =>
      expect(screen.getAllByText(/needs approval/)).toHaveLength(2),
    );
    const snapAll = screen.getByRole('button', {
      name: 'Snap all files to black',
    });
    await waitFor(() =>
      expect((snapAll as HTMLButtonElement).disabled).toBe(false),
    );
    return snapAll;
  }

  it('snaps every ready file and reports the batch result', async () => {
    renderModal(vi.fn(), [], createOrganizeSettings('tv'), [item, secondItem]);
    await screen.findByRole('button', { name: 'Approve split' });
    fireEvent.click(await waitForBatchReady());

    await screen.findByText('Snapped cuts to black in 2 files.');
    expect(screen.getAllByLabelText('Ready for review')).toHaveLength(2);
    expect(
      (screen.getByLabelText('Start time for segment 2') as HTMLInputElement)
        .value,
    ).toBe('30:06.0');

    // The second file was snapped too.
    fireEvent.click(screen.getAllByRole('button', { name: /S01E02-E03/ })[0]);
    expect(
      (screen.getByLabelText('Start time for segment 2') as HTMLInputElement)
        .value,
    ).toBe('30:06.0');
  });

  it('shows overall progress while scanning the batch', async () => {
    scanControl.percent = 40;
    renderModal(vi.fn(), [], createOrganizeSettings('tv'), [item, secondItem]);
    await screen.findByRole('button', { name: 'Approve split' });
    fireEvent.click(await waitForBatchReady());

    const firstBar = await screen.findByLabelText(
      'All-files black-frame scan progress',
    );
    await waitFor(() =>
      expect(firstBar.textContent).toContain('1/2 files · 20%'),
    );

    await act(async () => {
      scanControl.release?.();
    });
    await waitFor(() =>
      expect(
        screen.getByLabelText('All-files black-frame scan progress')
          .textContent,
      ).toContain('2/2 files · 70%'),
    );

    await act(async () => {
      scanControl.release?.();
    });
    await screen.findByText('Snapped cuts to black in 2 files.');
    expect(
      screen.queryByLabelText('All-files black-frame scan progress'),
    ).toBeNull();
  });

  it('keeps scanning the batch after a failure and reports it', async () => {
    scanControl.errorMessage = 'ffmpeg exploded';
    renderModal(vi.fn(), [], createOrganizeSettings('tv'), [item, secondItem]);
    await screen.findByRole('button', { name: 'Approve split' });
    fireEvent.click(await waitForBatchReady());

    await screen.findByText(
      'Snapped cuts to black in 0 files. 2 scans failed.',
    );
    expect(
      screen.queryByLabelText('All-files black-frame scan progress'),
    ).toBeNull();
  });
});
