import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Alert, Form, Modal, ProgressBar, Spinner } from 'react-bootstrap';
import {
  ASYNC_CHANNEL,
  PROMISE_CHANNEL,
  blackBatchEtaSeconds,
  blackDividerCuts,
  estimateSplitBoundaries,
  nearestBlackDivider,
  nearestSplitCandidates,
  parseMediaFilename,
  segmentsForEpisodes,
  seriesForPlanItem,
  validateSplitPlan,
  withSplitTargets,
  formatSplitTimecode,
  type Library,
  type MediaType,
  type OrganizeMatchOverride,
  type OrganizePlan,
  type OrganizePlanItem,
  type OrganizeSettings,
  type OrganizeSplitPlan,
  type OrganizeSplitProbe,
  type OrganizeSplitThumbnailFrame,
  type SplitBlackInterval,
  type SplitKeyframeCut,
  type TvdbEpisode,
} from '../../common';
import { useBackend, useBackendAsync } from '../helpers';
import { formatDuration } from '../run/format';
import { SegmentedControl } from '../settings/SegmentedControl';
import { Button } from '../ui/Button';
import { ControlTip } from '../ui/ControlTip';
import { Icon } from '../ui/Icon';
import { Filmstrip } from './Filmstrip';
import { MatchFixModal } from './MatchFixModal';
import { WideDialog } from './WideDialog';

interface SplitModalProps {
  plan: OrganizePlan;
  items: OrganizePlanItem[];
  splits: OrganizeSplitPlan[];
  settings: OrganizeSettings;
  library: Library;
  mediaType: MediaType;
  onClose: () => void;
  onSave: (upserts: OrganizeSplitPlan[], removedIds: string[]) => void;
}

interface FileState {
  probe?: OrganizeSplitProbe;
  slug?: string;
  loading: boolean;
  error?: string;
  plan?: OrganizeSplitPlan;
  /** The user must approve a split before Save writes it. */
  approved: boolean;
  frames: OrganizeSplitThumbnailFrame[];
  framesLoading: boolean;
  /** Exact frame at the playhead, fetched separately from the filmstrip tiles. */
  preview?: OrganizeSplitThumbnailFrame;
  previewLoading: boolean;
  /** Frame at the copy-mode keyframe the active cut will actually land on. */
  cutPreview?: OrganizeSplitThumbnailFrame;
  cutPreviewLoading: boolean;
  windowStart: number;
  windowSeconds: number;
  playhead: number;
  keyframes?: SplitKeyframeCut[];
  snapping?: boolean;
  /** Black runs from the last scan; both black-frame tools share the result. */
  blackIntervals?: SplitBlackInterval[];
  blackLoading?: boolean;
  /** 0–99 while the black-frame scan runs. */
  blackProgress?: number;
  /** Which button started the scan, so only it shows the percentage. */
  blackAction?: 'snap' | 'add';
  /** Short status line after a black-frame or split-editing action. */
  toolNote?: string;
}

const ZOOM_OPTIONS: { value: string; label: string; seconds: number }[] = [
  { value: 'full', label: 'Full', seconds: 0 },
  { value: '1800', label: '30m', seconds: 1800 },
  { value: '600', label: '10m', seconds: 600 },
  { value: '300', label: '5m', seconds: 300 },
  { value: '60', label: '1m', seconds: 60 },
];

const Layout = styled.div`
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 320px;
  gap: var(--hb-space-md);
  min-height: 52vh;
  max-height: 72vh;
`;

const Rail = styled.div`
  display: grid;
  align-content: start;
  gap: var(--hb-space-xs);
  overflow: auto;
  padding-right: 2px;
`;

const RailFile = styled.button<{ $active: boolean; $approved: boolean }>`
  display: grid;
  gap: 2px;
  text-align: left;
  padding: var(--hb-space-xs) var(--hb-space-sm);
  border-radius: var(--hb-radius-sm);
  border: 1px solid
    ${({ $approved, $active }) =>
      $approved
        ? 'var(--hb-success)'
        : $active
          ? 'var(--hb-accent)'
          : 'var(--hb-border)'};
  background: ${({ $approved, $active }) =>
    $approved
      ? 'color-mix(in srgb, var(--hb-success) 14%, transparent)'
      : $active
        ? 'var(--hb-surfaceMuted)'
        : 'transparent'};
  color: var(--hb-text);
  font: inherit;
  font-size: var(--hb-font-xs);
  cursor: pointer;

  span {
    color: var(--hb-textMuted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const Editor = styled.div`
  display: grid;
  align-content: start;
  gap: var(--hb-space-sm);
  min-width: 0;
  overflow: auto;
`;

const Cards = styled.div`
  display: grid;
  align-content: start;
  gap: var(--hb-space-xs);
  overflow: auto;
  padding-right: 2px;
`;

const Card = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
  padding: var(--hb-space-sm);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surface);

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--hb-space-xs);
    font-size: var(--hb-font-xs);
    font-weight: 600;
  }

  small {
    color: var(--hb-textMuted);
    font-size: 10px;
    overflow-wrap: anywhere;
  }
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-xs);
  flex-wrap: wrap;
  font-size: var(--hb-font-xs);
`;

const Control = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

const Muted = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const PreviewFrame = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  align-items: stretch;
  min-height: 96px;
  padding: var(--hb-space-xs);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surface);

  img {
    width: 170px;
    height: 96px;
    object-fit: cover;
    border-radius: var(--hb-radius-sm);
    background: #101014;
  }
`;

const PreviewPlaceholder = styled.div`
  width: 170px;
  height: 96px;
  display: grid;
  place-items: center;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  border: 1px dashed var(--hb-border);
  border-radius: var(--hb-radius-sm);
`;

function centeredWindowStart(
  seconds: number,
  span: number,
  duration: number,
): number {
  return Math.max(
    0,
    Math.min(Math.max(0, duration - span), seconds - span / 2),
  );
}

function emptyState(): FileState {
  return {
    loading: true,
    approved: false,
    frames: [],
    framesLoading: false,
    previewLoading: false,
    cutPreviewLoading: false,
    windowStart: 0,
    windowSeconds: 600,
    playhead: 0,
  };
}

interface BlackScanTarget {
  id: string;
  path: string;
  startTimeSeconds?: number;
  durationSeconds: number;
}

/** One black-frame tool run, over a single file or every ready file. */
interface BlackScanRun {
  action: 'snap' | 'add';
  targets: BlackScanTarget[];
  /** Index of the target currently scanning. */
  index: number;
  /** Targets finished so far. */
  done: number;
  /** Targets whose cuts were already changed, including cached scans. */
  applied: number;
  /** Failed scans; the run keeps going through the rest. */
  failures: number;
  /** Batch runs also show overall progress above the file editor. */
  batch: boolean;
  /** When the run started, used for the batch ETA. */
  startedAt: number;
  /** Remount token so a second run starts cleanly. */
  token: number;
}

/**
 * Runs one black-frame scan as an async backend request so ffmpeg's progress
 * can drive the button percentage. It mounts only while a scan is requested.
 */
const BlackScanRunner: React.FC<{
  target: BlackScanTarget;
  onProgress: (percent: number) => void;
  onComplete: (intervals: SplitBlackInterval[]) => void;
  onError: (message: string) => void;
}> = ({ target, onProgress, onComplete, onError }) => {
  const handlers = useRef({ onProgress, onComplete, onError });
  handlers.current = { onProgress, onComplete, onError };
  const props = useMemo(
    () => ({
      path: target.path,
      durationSeconds: target.durationSeconds,
      ...(target.startTimeSeconds !== undefined
        ? { startTimeSeconds: target.startTimeSeconds }
        : {}),
    }),
    [target],
  );
  const scan = useBackendAsync({
    channel: ASYNC_CHANNEL.OrganizeDetectBlackFrames,
    props,
    skip: false,
    onInit: (progress) => handlers.current.onProgress(progress.percent),
    onProgress: (progress) => handlers.current.onProgress(progress.percent),
    onComplete: (result) => handlers.current.onComplete(result.intervals),
  });

  useEffect(() => {
    if (!scan.error) return;
    handlers.current.onError(
      scan.error.message || 'The black-frame scan failed.',
    );
  }, [scan.error]);

  return null;
};

function parseTimecode(value: string): number | undefined {
  const parts = value.split(':').map((part) => Number(part.trim()));
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts.length === 1 ? parts[0] : undefined;
}

function reservedPathsFor(
  plan: OrganizePlan,
  item: OrganizePlanItem,
): string[] {
  return plan.items
    .filter((candidate) => candidate.id !== item.id)
    .flatMap((candidate) => [
      candidate.sourcePath,
      candidate.targetPath,
      ...candidate.sidecars.flatMap((sidecar) => [
        sidecar.sourcePath,
        sidecar.targetPath,
      ]),
    ]);
}

/**
 * Bulk split editor. Estimates cut points from TVDB runtimes and the real file
 * duration, shows a frame filmstrip to find title cards, and hands the queued
 * splits back to the review page.
 */
export const SplitModal: React.FC<SplitModalProps> = ({
  plan,
  items,
  splits,
  settings,
  library,
  mediaType,
  onClose,
  onSave,
}) => {
  const defaults = settings.splitting;
  const [states, setStates] = useState<Record<string, FileState>>({});
  const [selectedId, setSelectedId] = useState<string>(items[0]?.id ?? '');
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [problems, setProblems] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [otherEpisode, setOtherEpisode] = useState<{
    itemId: string;
    index: number;
    matchItem: OrganizePlanItem;
  }>();
  const [blackRun, setBlackRun] = useState<BlackScanRun>();
  const [blackRunPercent, setBlackRunPercent] = useState(0);
  const [blackRunNote, setBlackRunNote] = useState<string>();
  /** Ticks once a second so the batch ETA keeps moving between progress events. */
  const [blackRunNow, setBlackRunNow] = useState(0);
  const blackScanToken = useRef(0);
  const frameGeneration = useRef(0);
  const previewInFlight = useRef(false);
  const previewPending = useRef<
    { id: string; path: string; seconds: number } | undefined
  >(undefined);
  const cutPreviewGeneration = useRef(0);
  const initializedKey = useRef<string | undefined>(undefined);

  const probeSplit = useBackend({
    channel: PROMISE_CHANNEL.OrganizeProbeSplit,
    skip: true,
  });
  const loadRuntimes = useBackend({
    channel: PROMISE_CHANNEL.OrganizeEpisodeRuntimes,
    skip: true,
  });
  const loadThumbnails = useBackend({
    channel: PROMISE_CHANNEL.OrganizeSplitThumbnails,
    skip: true,
  });
  const ffmpeg = useBackend({
    channel: PROMISE_CHANNEL.OrganizeFfmpegStatus,
    skip: false,
  });

  const itemsKey = items
    .map((item) => `${item.id}:${item.episodes?.length ?? 0}`)
    .join('|');

  const updateState = (id: string, patch: Partial<FileState>) => {
    setStates((current) => ({
      ...current,
      [id]: { ...(current[id] ?? emptyState()), ...patch },
    }));
  };

  const updatePlan = (
    id: string,
    updater: (plan: OrganizeSplitPlan, state: FileState) => OrganizeSplitPlan,
    patch?: Partial<FileState>,
  ) => {
    setStates((current) => {
      const state = current[id];
      if (!state?.plan) return current;
      return {
        ...current,
        [id]: {
          ...state,
          ...patch,
          plan: updater(state.plan, state),
        },
      };
    });
  };

  /**
   * Fetches the frame at the exact playhead. Requests are coalesced: while one
   * is running, only the newest scrub position is kept, so dragging never
   * queues a burst of ffmpeg processes and always ends on the final frame.
   */
  const loadPreview = (id: string, path: string, seconds: number) => {
    previewPending.current = { id, path, seconds };
    if (previewInFlight.current) return;
    const run = () => {
      const next = previewPending.current;
      if (!next) {
        previewInFlight.current = false;
        return;
      }
      previewPending.current = undefined;
      previewInFlight.current = true;
      updateState(next.id, { previewLoading: true });
      void loadThumbnails
        .refetch({
          path: next.path,
          times: [next.seconds],
          maxWidth: 320,
          exact: true,
        })
        .then((result) => {
          const frame = result?.data?.frames[0];
          updateState(next.id, {
            previewLoading: false,
            ...(frame ? { preview: frame } : {}),
          });
        })
        .catch(() => {
          updateState(next.id, { previewLoading: false });
        })
        .finally(() => {
          previewInFlight.current = false;
          run();
        });
    };
    run();
  };

  const snapCutsFor = async (id: string, state: FileState) => {
    if (!state.probe || !state.plan) return;
    const markers = state.plan.segments
      .slice(1)
      .map((segment) => segment.startSeconds);
    if (markers.length === 0) return;
    updateState(id, { snapping: true });
    try {
      const result = await probeSplit.refetch({
        path: state.plan.sourcePath,
        markerTimes: markers,
        keyframeWindowSeconds: 10,
      });
      const keyframes = result?.data?.keyframes;
      if (!keyframes) {
        updateState(id, { snapping: false });
        return;
      }
      updateState(id, { keyframes, snapping: false });
      updatePlan(id, (current) => ({
        ...current,
        segments: current.segments.map((segment, index) => {
          if (index === 0) return segment;
          const cut = keyframes[index - 1];
          return {
            ...segment,
            ...(cut?.keyframeSeconds !== undefined
              ? { cutSeconds: cut.keyframeSeconds }
              : { cutSeconds: undefined }),
          };
        }),
      }));
    } catch {
      updateState(id, { snapping: false });
    }
  };

  const estimateFor = async (
    item: OrganizePlanItem,
    probe: OrganizeSplitProbe,
    slug: string | undefined,
  ): Promise<OrganizeSplitPlan | undefined> => {
    const known = item.episodes?.length
      ? item.episodes
      : item.episode
        ? [item.episode]
        : [];
    if (known.length === 0) return undefined;
    // A single matched episode still opens a two-segment plan so a file whose
    // episodes are non-contiguous in TVDB can be split and fixed per segment.
    const episodes: (TvdbEpisode | undefined)[] =
      known.length >= 2 ? known : [...known, undefined];
    let runtimeById: Record<string, number | undefined> = {};
    if (slug) {
      const ids = known
        .map((episode) => episode.id)
        .filter((id): id is string => Boolean(id));
      if (ids.length > 0) {
        const result = await loadRuntimes.refetch({ slug, episodeIds: ids });
        runtimeById = result?.data ?? {};
      }
    }
    const methods = new Set<'tvdb' | 'plex' | 'equal'>();
    const durations = episodes.map((episode) => {
      if (!episode) {
        methods.add('equal');
        return undefined;
      }
      const minutes = episode.id ? runtimeById[episode.id] : undefined;
      if (minutes) {
        methods.add('tvdb');
        return minutes * 60;
      }
      const association =
        item.plexEpisodes?.find(
          (entry) =>
            entry.seasonNumber === episode.seasonNumber &&
            entry.episodeNumber === episode.episodeNumber,
        ) ?? item.plex;
      if (association?.durationMs) {
        methods.add('plex');
        return association.durationMs / 1000;
      }
      methods.add('equal');
      return undefined;
    });
    const estimate = estimateSplitBoundaries({
      fileDurationSeconds: probe.durationSeconds,
      episodeDurationsSeconds: durations,
    });
    const method =
      methods.size === 1 && methods.has('tvdb')
        ? 'tvdb'
        : methods.size === 1 && methods.has('plex')
          ? 'plex'
          : methods.size === 1
            ? 'equal'
            : 'mixed';
    const singleNote =
      known.length === 1
        ? 'Only one episode is matched; use Select other episode to assign the other segment before saving.'
        : undefined;
    const note = [estimate.note, singleNote].filter(Boolean).join(' ');
    return {
      itemId: item.id,
      sourcePath: item.sourcePath,
      fileSize: probe.size,
      fileDurationSeconds: probe.durationSeconds,
      episodeDurationsSeconds: durations,
      estimate: {
        method,
        ...(estimate.slackSeconds
          ? { slackSeconds: estimate.slackSeconds }
          : {}),
        ...(note ? { note } : {}),
      },
      cutMode: defaults?.cutMode ?? 'copy',
      originalPolicy: defaults?.originalPolicy ?? 'backup',
      sidecarPolicy: defaults?.sidecarPolicy ?? 'leave',
      segments: segmentsForEpisodes(episodes, estimate.boundaries),
      updatedAt: Date.now(),
    };
  };

  useEffect(() => {
    if (initializedKey.current === itemsKey) return;
    initializedKey.current = itemsKey;
    let cancelled = false;
    const existing = new Map(splits.map((split) => [split.itemId, split]));
    void Promise.all(
      items.map(async (item) => {
        const state = existing.get(item.id);
        const stateSpan = state ? Math.min(600, state.fileDurationSeconds) : 0;
        const stateCut = state?.segments[1]?.startSeconds ?? 0;
        const initial: FileState = {
          ...emptyState(),
          ...(state
            ? {
                plan: state,
                approved: true,
                windowSeconds: stateSpan,
                windowStart: centeredWindowStart(
                  stateCut,
                  stateSpan,
                  state.fileDurationSeconds,
                ),
                playhead: stateCut,
              }
            : {}),
        };
        updateState(item.id, initial);
        const knownEpisodes = item.episodes?.length
          ? item.episodes
          : item.episode
            ? [item.episode]
            : [];
        if (knownEpisodes.length === 0) {
          updateState(item.id, {
            loading: false,
            error:
              'Match at least one episode with Fix match, then split this file.',
          });
          return;
        }
        try {
          const series = seriesForPlanItem(item, settings, library);
          const probed = await probeSplit.refetch({ path: item.sourcePath });
          const probe = probed?.data;
          if (!probe) throw new Error('Could not probe the video file.');
          if (state) {
            updateState(item.id, {
              probe,
              loading: false,
              slug: series?.slug,
              windowSeconds: Math.min(600, probe.durationSeconds),
            });
            if (state.cutMode === 'copy') {
              void snapCutsFor(item.id, {
                ...initial,
                probe,
                plan: state,
                approved: true,
              });
            }
            return;
          }
          const estimated = await estimateFor(item, probe, series?.slug);
          if (!estimated) throw new Error('No episode is available.');
          const estimateSpan = Math.min(600, probe.durationSeconds);
          const firstCut = estimated.segments[1]?.startSeconds ?? 0;
          updateState(item.id, {
            probe,
            loading: false,
            slug: series?.slug,
            plan: estimated,
            windowSeconds: estimateSpan,
            windowStart: centeredWindowStart(
              firstCut,
              estimateSpan,
              probe.durationSeconds,
            ),
            playhead: firstCut,
          });
          if (estimated.cutMode === 'copy') {
            void snapCutsFor(item.id, {
              ...initial,
              probe,
              plan: estimated,
            });
          }
        } catch (error) {
          updateState(item.id, {
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
    ).then(() => {
      if (!cancelled) setLoadError(undefined);
    });
    return () => {
      cancelled = true;
    };
    // Data is loaded once per opened selection; edits must not re-trigger it.
  }, [itemsKey]);

  const selectedItem = items.find((item) => item.id === selectedId) ?? items[0];
  const selectedState = selectedItem ? states[selectedItem.id] : undefined;
  const selectedPlan = selectedState?.plan;

  const windowKey = selectedItem
    ? `${selectedItem.id}|${selectedState?.windowStart ?? 0}|${selectedState?.windowSeconds ?? 0}`
    : '';

  useEffect(() => {
    if (!selectedItem || !selectedState?.probe) return;
    const duration = selectedState.probe.durationSeconds;
    const span = Math.max(1, Math.min(duration, selectedState.windowSeconds));
    const start = Math.max(
      0,
      Math.min(duration - span, selectedState.windowStart),
    );
    const count = 9;
    const times = Array.from(
      { length: count },
      (_, index) => start + ((index + 0.5) * span) / count,
    );
    const generation = ++frameGeneration.current;
    updateState(selectedItem.id, { framesLoading: true });
    void loadThumbnails
      .refetch({ path: selectedItem.sourcePath, times, maxWidth: 160 })
      .then((result) => {
        if (generation !== frameGeneration.current) return;
        updateState(selectedItem.id, {
          frames: result?.data?.frames ?? [],
          framesLoading: false,
        });
      })
      .catch(() => {
        if (generation !== frameGeneration.current) return;
        updateState(selectedItem.id, {
          frames: [],
          framesLoading: false,
        });
      });
    // Window changes drive the sampling; state object identity must not.
  }, [windowKey, selectedState?.probe?.path]);

  const previewId = selectedItem?.id;
  const previewPath = selectedItem?.sourcePath;
  const previewProbedPath = selectedState?.probe?.path;
  const playhead = selectedState?.playhead;
  useEffect(() => {
    if (!previewId || !previewPath || !previewProbedPath) return;
    if (playhead === undefined) return;
    loadPreview(previewId, previewPath, playhead);
    // Every playhead change replaces the preview with the frame exactly there.
  }, [previewId, previewPath, previewProbedPath, playhead]);

  const activeCutIndex = useMemo(() => {
    if (!selectedPlan || selectedPlan.segments.length < 2) return undefined;
    const target = selectedState?.playhead ?? 0;
    let best = 1;
    for (let index = 1; index < selectedPlan.segments.length; index += 1) {
      if (
        Math.abs(selectedPlan.segments[index].startSeconds - target) <
        Math.abs(selectedPlan.segments[best].startSeconds - target)
      ) {
        best = index;
      }
    }
    return best;
  }, [selectedPlan, selectedState?.playhead]);

  const activeCutSeconds =
    selectedPlan?.cutMode === 'copy' && activeCutIndex !== undefined
      ? selectedPlan.segments[activeCutIndex]?.cutSeconds
      : undefined;
  const activeCutPreview =
    selectedState?.cutPreview &&
    activeCutSeconds !== undefined &&
    Math.abs(selectedState.cutPreview.seconds - activeCutSeconds) < 0.05
      ? selectedState.cutPreview
      : undefined;

  useEffect(() => {
    if (!previewId || !previewPath || activeCutSeconds === undefined) return;
    const generation = ++cutPreviewGeneration.current;
    updateState(previewId, { cutPreviewLoading: true });
    void loadThumbnails
      .refetch({
        path: previewPath,
        times: [activeCutSeconds],
        maxWidth: 320,
        exact: true,
      })
      .then((result) => {
        if (generation !== cutPreviewGeneration.current) return;
        updateState(previewId, {
          cutPreview: result?.data?.frames[0],
          cutPreviewLoading: false,
        });
      })
      .catch(() => {
        if (generation !== cutPreviewGeneration.current) return;
        updateState(previewId, { cutPreviewLoading: false });
      });
    // The copy-mode landing point drives the cut preview.
  }, [activeCutSeconds, previewId, previewPath]);

  const blackRunToken = blackRun?.token;
  useEffect(() => {
    if (blackRunToken === undefined) return;
    const timer = window.setInterval(() => setBlackRunNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [blackRunToken]);

  const candidateCuts = useMemo(() => {
    if (
      !selectedPlan ||
      !selectedState?.keyframes ||
      selectedPlan.cutMode !== 'copy'
    ) {
      return [];
    }
    const duration =
      selectedState.probe?.durationSeconds ?? selectedPlan.fileDurationSeconds;
    const segments = selectedPlan.segments;
    return segments.slice(1).flatMap((segment, offset) => {
      const index = offset + 1;
      if (segment.cutSeconds === undefined) return [];
      const keyframe = selectedState.keyframes?.[index - 1];
      const lower = segments[index - 1].startSeconds + 1;
      const upper =
        index < segments.length - 1
          ? segments[index + 1].startSeconds - 1
          : duration - 1;
      const seconds = nearestSplitCandidates(
        (keyframe?.candidates ?? []).filter(
          (candidate) => candidate > lower && candidate < upper,
        ),
        segment.cutSeconds ?? segment.startSeconds,
      );
      return [
        {
          index,
          label: segment.episode?.tag ?? `segment ${index + 1}`,
          seconds,
          actualSeconds: segment.cutSeconds,
          active: index === activeCutIndex,
        },
      ];
    });
  }, [activeCutIndex, selectedPlan, selectedState]);

  const targetPreview = useMemo(() => {
    if (!selectedItem || !selectedPlan) return undefined;
    return withSplitTargets(selectedItem, selectedPlan.segments, {
      settings,
      mediaType,
      caseInsensitive: settings.caseInsensitive ?? false,
      reservedPaths: reservedPathsFor(plan, selectedItem),
    });
  }, [selectedItem, selectedPlan, settings, mediaType, plan]);

  const setWindow = (id: string, start: number) => {
    setStates((current) => {
      const state = current[id];
      if (!state?.probe) return current;
      const span = Math.max(
        1,
        Math.min(state.probe.durationSeconds, state.windowSeconds),
      );
      return {
        ...current,
        [id]: {
          ...state,
          windowStart: Math.max(
            0,
            Math.min(state.probe.durationSeconds - span, start),
          ),
        },
      };
    });
  };

  /** Places the visible window so the nearest cut sits in its middle. */
  const centerOnSplit = (id: string) => {
    const state = states[id];
    if (!state?.plan) return;
    const cuts = state.plan.segments
      .slice(1)
      .map((segment) => segment.startSeconds);
    const target =
      cuts.length === 0
        ? state.playhead
        : cuts.reduce((best, cut) =>
            Math.abs(cut - state.playhead) < Math.abs(best - state.playhead)
              ? cut
              : best,
          );
    setWindow(id, target - state.windowSeconds / 2);
  };

  const setZoom = (id: string, value: string) => {
    const option = ZOOM_OPTIONS.find((entry) => entry.value === value);
    setStates((current) => {
      const state = current[id];
      if (!state?.probe || !option) return current;
      const duration = state.probe.durationSeconds;
      const span =
        option.seconds > 0 ? Math.min(duration, option.seconds) : duration;
      const center = state.windowStart + state.windowSeconds / 2;
      const start = Math.max(0, Math.min(duration - span, center - span / 2));
      return {
        ...current,
        [id]: { ...state, windowSeconds: span, windowStart: start },
      };
    });
  };

  const moveMarker = (id: string, index: number, seconds: number) => {
    updatePlan(
      id,
      (current, state) => {
        const duration =
          state.probe?.durationSeconds ?? current.fileDurationSeconds;
        const segments = current.segments.map((segment) => ({ ...segment }));
        if (index < 1 || index >= segments.length) return current;
        const previous = segments[index - 1].startSeconds;
        const next =
          index < segments.length - 1
            ? segments[index + 1].startSeconds
            : duration;
        const clamped = Math.max(previous + 1, Math.min(next - 1, seconds));
        segments[index - 1].endSeconds = clamped;
        segments[index].startSeconds = clamped;
        segments[index].cutSeconds = undefined;
        return {
          ...current,
          segments,
          edited: true,
          updatedAt: Date.now(),
        };
      },
      { approved: false },
    );
  };

  /**
   * Copy mode can only cut on a keyframe. Choosing one from the strip moves the
   * marker and the playhead there and records the actual landing time.
   */
  const chooseCutKeyframe = (id: string, index: number, seconds: number) => {
    setStates((current) => {
      const state = current[id];
      if (!state?.plan) return current;
      const duration =
        state.probe?.durationSeconds ?? state.plan.fileDurationSeconds;
      const segments = state.plan.segments.map((segment) => ({ ...segment }));
      if (index < 1 || index >= segments.length) return current;
      const previous = segments[index - 1].startSeconds;
      const next =
        index < segments.length - 1
          ? segments[index + 1].startSeconds
          : duration;
      const clamped = Math.max(previous + 1, Math.min(next - 1, seconds));
      segments[index - 1].endSeconds = clamped;
      segments[index].startSeconds = clamped;
      segments[index].cutSeconds = clamped;
      const keyframes = state.keyframes?.map((cut, cutIndex) =>
        cutIndex === index - 1
          ? {
              ...cut,
              requestedSeconds: clamped,
              keyframeSeconds: clamped,
              deltaSeconds: 0,
            }
          : cut,
      );
      return {
        ...current,
        [id]: {
          ...state,
          approved: false,
          playhead: clamped,
          ...(keyframes ? { keyframes } : {}),
          plan: {
            ...state.plan,
            segments,
            edited: true,
            updatedAt: Date.now(),
          },
        },
      };
    });
  };

  const changeEpisode = (id: string, index: number, episode: TvdbEpisode) => {
    updatePlan(
      id,
      (current) => ({
        ...current,
        segments: current.segments.map((segment, segmentIndex) =>
          segmentIndex === index ? { ...segment, episode } : segment,
        ),
        edited: true,
        updatedAt: Date.now(),
      }),
      { approved: false },
    );
  };

  /**
   * Opens the same Fix match dialog used by the review table and the
   * multi-episode editor, seeded with this segment's episode. The saved episode
   * replaces only the segment the user clicked, leaving the other cuts alone.
   */
  const openOtherEpisode = (
    item: OrganizePlanItem,
    index: number,
    episode: TvdbEpisode | undefined,
  ) => {
    const fileName =
      item.sourceRelativePath.split(/[\\/]+/).pop() ?? item.sourcePath;
    const parsed =
      item.parsed ?? parseMediaFilename(fileName, item.sourceRelativePath);
    setOtherEpisode({
      itemId: item.id,
      index,
      matchItem: {
        ...item,
        episode,
        episodes: undefined,
        parsed: {
          ...parsed,
          ...(episode
            ? {
                seasonNumber: episode.seasonNumber,
                episodeNumber: episode.episodeNumber,
                episodeNumbers: [episode.episodeNumber],
              }
            : { episodeNumbers: [] }),
        },
      },
    });
  };

  const applyOtherEpisode = (override: OrganizeMatchOverride | undefined) => {
    const target = otherEpisode;
    setOtherEpisode(undefined);
    const episode = override?.episodes?.[0] ?? override?.episode;
    if (!target || !episode) return;
    setStates((current) => {
      const state = current[target.itemId];
      if (!state?.plan) return current;
      return {
        ...current,
        [target.itemId]: {
          ...state,
          approved: false,
          plan: {
            ...state.plan,
            segments: state.plan.segments.map((segment, segmentIndex) =>
              segmentIndex === target.index ? { ...segment, episode } : segment,
            ),
            edited: true,
            updatedAt: Date.now(),
          },
        },
      };
    });
  };

  const reestimate = (id: string) => {
    const state = states[id];
    if (!state?.plan) return;
    const episodes = state.plan.segments.map((segment) => segment.episode);
    const estimate = estimateSplitBoundaries({
      fileDurationSeconds:
        state.probe?.durationSeconds ?? state.plan.fileDurationSeconds,
      episodeDurationsSeconds: state.plan.episodeDurationsSeconds,
    });
    const plan: OrganizeSplitPlan = {
      ...state.plan,
      segments: segmentsForEpisodes(episodes, estimate.boundaries),
      estimate: {
        ...state.plan.estimate,
        ...(estimate.slackSeconds
          ? { slackSeconds: estimate.slackSeconds }
          : {}),
        ...(estimate.note ? { note: estimate.note } : {}),
      },
      edited: false,
      updatedAt: Date.now(),
    };
    updateState(id, { plan, approved: false });
    // Snap the new cut markers, not the ones that were just replaced.
    if (plan.cutMode === 'copy') void snapCutsFor(id, { ...state, plan });
  };

  /** Rebuilds a plan from divider times, keeping known episodes in order. */
  const planWithCuts = (
    state: FileState,
    cuts: number[],
    note: string,
  ): FileState => {
    if (!state.plan) return state;
    const duration =
      state.probe?.durationSeconds ?? state.plan.fileDurationSeconds;
    const ordered = [
      ...new Set(cuts.map((cut) => Math.round(cut * 1000) / 1000)),
    ]
      .filter((cut) => cut > 1 && cut < duration - 1)
      .sort((left, right) => left - right);
    const unique: number[] = [];
    for (const cut of ordered) {
      if (unique.length === 0 || cut - unique[unique.length - 1] >= 1) {
        unique.push(cut);
      }
    }
    const episodes = state.plan.segments.map((segment) => segment.episode);
    const segments = Array.from({ length: unique.length + 1 }, (_, index) => ({
      index,
      startSeconds: index === 0 ? 0 : unique[index - 1],
      endSeconds: index === unique.length ? duration : unique[index],
      ...(episodes[index] ? { episode: episodes[index] } : {}),
    }));
    return {
      ...state,
      keyframes: undefined,
      toolNote: note,
      plan: {
        ...state.plan,
        segments,
        edited: true,
        updatedAt: Date.now(),
      },
    };
  };

  const addSplitAtPlayhead = (id: string) => {
    setStates((current) => {
      const state = current[id];
      if (!state?.plan) return current;
      const at = state.playhead;
      const index = state.plan.segments.findIndex(
        (segment) =>
          at > segment.startSeconds + 1 && at < segment.endSeconds - 1,
      );
      if (index < 0) {
        return {
          ...current,
          [id]: {
            ...state,
            toolNote:
              'Move the playhead inside a segment, at least one second from its edges.',
          },
        };
      }
      const segments = state.plan.segments.map((segment) => ({ ...segment }));
      const segment = segments[index];
      const newSegment = {
        index: index + 1,
        startSeconds: at,
        endSeconds: segment.endSeconds,
      };
      segment.endSeconds = at;
      segments.splice(index + 1, 0, newSegment);
      segments.forEach((entry, entryIndex) => {
        entry.index = entryIndex;
      });
      return {
        ...current,
        [id]: {
          ...state,
          approved: false,
          keyframes: undefined,
          toolNote: `Added a split at ${formatSplitTimecode(at, true)}. Snap to keyframes for copy mode.`,
          plan: {
            ...state.plan,
            segments,
            edited: true,
            updatedAt: Date.now(),
          },
        },
      };
    });
  };

  const removeSplitAt = (id: string, index: number) => {
    setStates((current) => {
      const state = current[id];
      if (!state?.plan || index < 1 || index >= state.plan.segments.length) {
        return current;
      }
      const segments = state.plan.segments.map((segment) => ({ ...segment }));
      const [removed] = segments.splice(index, 1);
      if (segments[index - 1]) {
        segments[index - 1].endSeconds = removed.endSeconds;
      }
      segments.forEach((entry, entryIndex) => {
        entry.index = entryIndex;
      });
      return {
        ...current,
        [id]: {
          ...state,
          approved: false,
          keyframes: undefined,
          toolNote:
            'Removed the split and merged its episode range into the previous segment.',
          plan: {
            ...state.plan,
            segments,
            edited: true,
            updatedAt: Date.now(),
          },
        },
      };
    });
  };

  /** Applies a black-frame tool to the intervals from the shared scan. */
  const applyBlackAction = (
    id: string,
    action: 'snap' | 'add',
    intervals: SplitBlackInterval[],
  ) => {
    setStates((current) => {
      const state = current[id];
      if (!state?.plan) return current;
      if (action === 'snap') {
        let snapped = 0;
        let missed = 0;
        const cuts = state.plan.segments.slice(1).map((segment) => {
          const target = nearestBlackDivider(intervals, segment.startSeconds);
          if (target === undefined) {
            missed += 1;
            return segment.startSeconds;
          }
          if (Math.abs(target - segment.startSeconds) > 0.05) snapped += 1;
          return target;
        });
        const note =
          missed > 0
            ? `Snapped ${snapped} cut(s) to black; ${missed} had no black frame within 60 seconds. Snap to keyframes for copy mode.`
            : `Snapped ${snapped} cut(s) to black. Snap to keyframes for copy mode.`;
        return {
          ...current,
          [id]: {
            ...planWithCuts(state, cuts, note),
            approved: false,
            blackIntervals: intervals,
            blackLoading: false,
            blackProgress: undefined,
            blackAction: undefined,
          },
        };
      }
      const dividers = blackDividerCuts(intervals);
      const cuts = state.plan.segments
        .slice(1)
        .map(
          (segment) =>
            nearestBlackDivider(intervals, segment.startSeconds) ??
            segment.startSeconds,
        );
      let added = 0;
      for (const divider of dividers) {
        if (cuts.every((cut) => Math.abs(cut - divider) >= 1)) {
          cuts.push(divider);
          added += 1;
        }
      }
      const note =
        added > 0
          ? `Added ${added} split(s) at black gaps. Assign any new segments, then snap to keyframes for copy mode.`
          : 'Every black gap already has a split. Snap to keyframes for copy mode.';
      return {
        ...current,
        [id]: {
          ...planWithCuts(state, cuts, note),
          approved: false,
          blackIntervals: intervals,
          blackLoading: false,
          blackProgress: undefined,
          blackAction: undefined,
        },
      };
    });
  };

  const markBlackLoading = (id: string, action: 'snap' | 'add') => {
    updateState(id, {
      blackLoading: true,
      blackProgress: 0,
      blackAction: action,
      toolNote: undefined,
    });
  };

  const blackResultNote = (
    action: 'snap' | 'add',
    applied: number,
    failures: number,
  ) => {
    const files = applied === 1 ? 'file' : 'files';
    const prefix =
      action === 'snap'
        ? `Snapped cuts to black in ${applied} ${files}.`
        : `Added black-gap splits in ${applied} ${files}.`;
    if (failures <= 0) return prefix;
    return `${prefix} ${failures} scan${failures === 1 ? '' : 's'} failed.`;
  };

  /**
   * Starts a black-frame tool for one file or a batch. Cached scans are
   * applied immediately; the rest are scanned one at a time so a batch does
   * not decode several files at once.
   */
  const startBlackRun = (action: 'snap' | 'add', ids: string[]) => {
    if (blackRun) return;
    const targets: BlackScanTarget[] = [];
    let applied = 0;
    for (const id of ids) {
      const state = states[id];
      if (!state?.plan || state.loading || state.error) continue;
      if (state.blackIntervals) {
        applyBlackAction(id, action, state.blackIntervals);
        applied += 1;
        continue;
      }
      targets.push({
        id,
        path: state.plan.sourcePath,
        ...(state.probe?.startTimeSeconds !== undefined
          ? { startTimeSeconds: state.probe.startTimeSeconds }
          : {}),
        durationSeconds:
          state.probe?.durationSeconds ?? state.plan.fileDurationSeconds,
      });
    }
    if (targets.length === 0) {
      setBlackRunNote(
        applied > 0
          ? blackResultNote(action, applied, 0)
          : 'No file is ready to scan yet.',
      );
      return;
    }
    const first = targets[0];
    markBlackLoading(first.id, action);
    blackScanToken.current += 1;
    setBlackRunNote(undefined);
    setBlackRunPercent(0);
    setBlackRunNow(Date.now());
    setBlackRun({
      action,
      targets,
      index: 0,
      done: 0,
      applied,
      failures: 0,
      batch: ids.length > 1,
      startedAt: Date.now(),
      token: blackScanToken.current,
    });
  };

  const updateBlackProgress = (id: string, percent: number) => {
    setStates((current) => {
      const state = current[id];
      if (!state?.blackLoading) return current;
      if (state.blackProgress === percent) return current;
      return { ...current, [id]: { ...state, blackProgress: percent } };
    });
  };

  /** Moves to the next target, or finishes the run and summarizes it. */
  const advanceBlackRun = (
    run: BlackScanRun,
    applied: number,
    failures: number,
  ) => {
    const nextIndex = run.index + 1;
    if (nextIndex >= run.targets.length) {
      setBlackRun(undefined);
      setBlackRunPercent(0);
      if (run.batch) {
        setBlackRunNote(
          blackResultNote(
            run.action,
            run.applied + applied,
            run.failures + failures,
          ),
        );
      }
      return;
    }
    const next = run.targets[nextIndex];
    markBlackLoading(next.id, run.action);
    setBlackRunPercent(0);
    setBlackRun({
      ...run,
      index: nextIndex,
      done: run.done + 1,
      applied: run.applied + applied,
      failures: run.failures + failures,
    });
  };

  const finishBlackTarget = (
    run: BlackScanRun,
    intervals: SplitBlackInterval[],
  ) => {
    applyBlackAction(run.targets[run.index].id, run.action, intervals);
    advanceBlackRun(run, 1, 0);
  };

  const failBlackTarget = (run: BlackScanRun, message: string) => {
    updateState(run.targets[run.index].id, {
      blackLoading: false,
      blackProgress: undefined,
      blackAction: undefined,
      toolNote: `Black-frame scan failed: ${message}`,
    });
    advanceBlackRun(run, 0, 1);
  };

  const setAllApproved = (approved: boolean) => {
    setStates((current) => {
      const next = { ...current };
      for (const item of items) {
        const state = next[item.id];
        if (state?.plan && !removed.has(item.id)) {
          next[item.id] = { ...state, approved };
        }
      }
      return next;
    });
  };

  const approvedCount = items.filter(
    (item) =>
      !removed.has(item.id) &&
      states[item.id]?.approved &&
      Boolean(states[item.id]?.plan),
  ).length;
  const removedQueuedIds = [...removed].filter((id) =>
    splits.some((split) => split.itemId === id),
  );
  const hasWork = approvedCount > 0 || removedQueuedIds.length > 0;

  const save = () => {
    const upserts: OrganizeSplitPlan[] = [];
    const nextProblems: string[] = [];
    for (const item of items) {
      if (removed.has(item.id)) continue;
      const state = states[item.id];
      if (!state?.plan) {
        if (state?.approved && !state.error) {
          nextProblems.push(
            `${item.sourceRelativePath}: no split was prepared.`,
          );
        }
        continue;
      }
      // Unapproved edits are discarded; a queued split stays queued unchanged.
      if (!state.approved) continue;
      const planToSave: OrganizeSplitPlan = {
        ...state.plan,
        updatedAt: Date.now(),
      };
      const found = validateSplitPlan(planToSave);
      const targets = withSplitTargets(item, planToSave.segments, {
        settings,
        mediaType,
        caseInsensitive: settings.caseInsensitive ?? false,
        reservedPaths: reservedPathsFor(plan, item),
      });
      const all = [...found, ...targets.conflicts];
      if (all.length > 0) {
        nextProblems.push(
          ...all.map((problem) => `${item.sourceRelativePath}: ${problem}`),
        );
        continue;
      }
      upserts.push(planToSave);
    }
    if (nextProblems.length > 0) {
      setProblems([...new Set(nextProblems)]);
      return;
    }
    onSave(upserts, removedQueuedIds);
  };

  const methodLabel = (method?: OrganizeSplitPlan['estimate']['method']) => {
    switch (method) {
      case 'tvdb':
        return 'TVDB runtimes';
      case 'plex':
        return 'Plex runtimes';
      case 'mixed':
        return 'Mixed runtimes';
      case 'manual':
        return 'Manual cuts';
      default:
        return 'Evenly divided';
    }
  };

  const ffmpegWarning = ffmpeg.data && !ffmpeg.data.available;
  const selectedDuration =
    selectedState?.probe?.durationSeconds ??
    selectedPlan?.fileDurationSeconds ??
    0;
  const multiOnly = items.every((item) => (item.episodes?.length ?? 0) >= 2);
  const blackReadyIds = items
    .filter((item) => {
      const state = states[item.id];
      return (
        Boolean(state?.plan) &&
        !state?.loading &&
        !state?.error &&
        !removed.has(item.id)
      );
    })
    .map((item) => item.id);
  const blackRunWork = blackRun
    ? blackRun.targets.reduce(
        (sum, target) => sum + Math.max(0, target.durationSeconds),
        0,
      )
    : 0;
  const blackRunDoneWork = blackRun
    ? blackRun.targets.reduce((sum, target, index) => {
        const seconds = Math.max(0, target.durationSeconds);
        if (index < blackRun.index) return sum + seconds;
        if (index === blackRun.index) {
          return sum + seconds * (blackRunPercent / 100);
        }
        return sum;
      }, 0)
    : 0;
  const blackBatchPercent = blackRun
    ? blackRunWork > 0
      ? Math.round((blackRunDoneWork / blackRunWork) * 100)
      : Math.round(
          ((blackRun.done + blackRunPercent / 100) / blackRun.targets.length) *
            100,
        )
    : 0;
  // Work-weighted ETA from the elapsed time and the decoded share so far.
  const blackBatchEta =
    blackRun && blackRunNow > blackRun.startedAt
      ? blackBatchEtaSeconds(
          blackRunWork,
          blackRunDoneWork,
          (blackRunNow - blackRun.startedAt) / 1000,
        )
      : undefined;
  const blackBatchLabel = blackRun
    ? `${Math.min(blackRun.done + 1, blackRun.targets.length)}/${blackRun.targets.length} files · ${blackBatchPercent}%${
        blackBatchEta !== undefined
          ? ` · ETA ${formatDuration(blackBatchEta)}`
          : ''
      }`
    : '';

  return (
    <>
      <Modal show onHide={onClose} centered dialogAs={WideDialog}>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: 'var(--hb-font-md)' }}>
            {multiOnly ? 'Split episodes' : 'Split files'} ({items.length} file
            {items.length === 1 ? '' : 's'})
          </Modal.Title>
        </Modal.Header>
        <Modal.Body style={{ display: 'grid', gap: 'var(--hb-space-sm)' }}>
          {ffmpegWarning && (
            <Alert variant="warning" className="mb-0">
              FFmpeg could not be started ({ffmpeg.data?.path}). The filmstrip
              and estimates still work, but Apply will refuse to split until
              FFmpeg is available.
            </Alert>
          )}
          {loadError && (
            <Alert variant="danger" className="mb-0">
              {loadError}
            </Alert>
          )}
          {items.length > 1 && (
            <>
              <Row>
                <ControlTip
                  label="Snap all files to black"
                  content={
                    <>
                      Scans every file with a split plan and moves its cuts to
                      the middle of the nearest all-black run within 60 seconds.
                      Files already scanned reuse their result; the rest are
                      scanned one at a time with progress below.
                    </>
                  }
                >
                  <Button
                    compact
                    variant="ghost"
                    icon="scan"
                    disabled={
                      Boolean(blackRun) ||
                      blackReadyIds.length === 0 ||
                      Boolean(ffmpegWarning)
                    }
                    title={
                      ffmpegWarning ? 'FFmpeg is not available.' : undefined
                    }
                    onClick={() => startBlackRun('snap', blackReadyIds)}
                  >
                    Snap all files to black
                  </Button>
                </ControlTip>
                <ControlTip
                  label="Add black gaps to all files"
                  content={
                    <>
                      Adds a cut at every all-black run in every file with a
                      split plan. New segments need an episode assigned before
                      saving. Only one scan runs at a time; the rest queue
                      behind it.
                    </>
                  }
                >
                  <Button
                    compact
                    variant="ghost"
                    icon="add"
                    disabled={
                      Boolean(blackRun) ||
                      blackReadyIds.length === 0 ||
                      Boolean(ffmpegWarning)
                    }
                    title={
                      ffmpegWarning ? 'FFmpeg is not available.' : undefined
                    }
                    onClick={() => startBlackRun('add', blackReadyIds)}
                  >
                    Add black gaps to all files
                  </Button>
                </ControlTip>
                {blackRunNote && (
                  <Muted style={{ whiteSpace: 'normal' }}>{blackRunNote}</Muted>
                )}
              </Row>
              {blackRun?.batch && (
                <ProgressBar
                  now={blackBatchPercent}
                  label={blackBatchLabel}
                  animated
                  striped
                  aria-label="All-files black-frame scan progress"
                  style={{ height: 14, fontSize: 'var(--hb-font-xs)' }}
                />
              )}
            </>
          )}
          <Layout>
            <Rail>
              {items.map((item) => {
                const state = states[item.id];
                const tag = item.episodes
                  ?.map((episode) => episode.tag)
                  .join(' + ');
                return (
                  <RailFile
                    key={item.id}
                    type="button"
                    $active={item.id === selectedItem?.id}
                    $approved={Boolean(
                      state?.approved && !removed.has(item.id),
                    )}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <strong
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      {state?.approved && !removed.has(item.id) ? (
                        <Icon
                          name="passed"
                          size="xs"
                          tone="success"
                          label="Approved split"
                        />
                      ) : state?.plan?.edited && !removed.has(item.id) ? (
                        <Icon
                          name="pending"
                          size="xs"
                          tone="warning"
                          label="Ready for review"
                        />
                      ) : null}
                      {tag ?? item.sourceRelativePath}
                    </strong>
                    <span>{item.sourceRelativePath}</span>
                    <span>
                      {state?.error
                        ? state.error
                        : state?.loading
                          ? 'Probing…'
                          : removed.has(item.id)
                            ? 'Split removed'
                            : state?.plan
                              ? `${state.plan.segments.length} segments · ${methodLabel(
                                  state.plan.estimate.method,
                                )} · ${
                                  state.approved
                                    ? 'approved'
                                    : state.plan.edited
                                      ? 'ready for review'
                                      : 'needs approval'
                                }`
                              : 'Not ready'}
                    </span>
                  </RailFile>
                );
              })}
            </Rail>

            <Editor>
              {!selectedItem || !selectedState ? (
                <Muted>Select a file.</Muted>
              ) : selectedState.error ? (
                <Alert variant="warning" className="mb-0">
                  {selectedState.error}
                </Alert>
              ) : selectedState.loading || !selectedPlan ? (
                <Row>
                  <Spinner size="sm" animation="border" />
                  <Muted>Probing the file and loading episodes…</Muted>
                </Row>
              ) : (
                <>
                  <Row>
                    <strong style={{ fontSize: 'var(--hb-font-sm)' }}>
                      {selectedItem.sourceRelativePath}
                    </strong>
                    <span style={{ flex: 1 }} />
                    <ControlTip
                      label="Approve split"
                      content={
                        <>
                          Only approved splits are saved. Editing does not
                          approve automatically: a new estimate is discarded
                          unless you approve it, while a previously queued split
                          stays queued.
                        </>
                      }
                    >
                      <Button
                        compact
                        variant={selectedState.approved ? 'ghost' : 'success'}
                        icon={selectedState.approved ? 'close' : 'passed'}
                        onClick={() =>
                          updateState(selectedItem.id, {
                            approved: !selectedState.approved,
                          })
                        }
                      >
                        {selectedState.approved
                          ? 'Unapprove split'
                          : 'Approve split'}
                      </Button>
                    </ControlTip>
                    <Muted>
                      {formatSplitTimecode(selectedDuration, true)} ·{' '}
                      {methodLabel(selectedPlan.estimate.method)}
                    </Muted>
                  </Row>
                  <Row>
                    <ControlTip
                      label="Cut mode"
                      content={
                        <>
                          <strong>Copy</strong> keeps the original video streams
                          and can only cut on a keyframe. <strong>Exact</strong>{' '}
                          re-encodes video so the cut lands on the frame you
                          chose, but it is slower and not bit-identical.
                        </>
                      }
                    >
                      <SegmentedControl
                        label="Cut mode"
                        value={selectedPlan.cutMode}
                        onChange={(value) =>
                          updatePlan(selectedItem.id, (current) => ({
                            ...current,
                            cutMode: value === 'exact' ? 'exact' : 'copy',
                            updatedAt: Date.now(),
                          }))
                        }
                        options={[
                          {
                            value: 'copy',
                            label: 'Copy (lossless)',
                            title: 'Keyframe-aligned stream copy',
                          },
                          {
                            value: 'exact',
                            label: 'Exact (re-encode)',
                            title: 'Frame-accurate cuts; re-encodes the video',
                          },
                        ]}
                      />
                    </ControlTip>
                    <ControlTip
                      label="Original file policy"
                      content={
                        <>
                          <strong>Backup</strong> moves the source into the
                          organize backup folder after every segment succeeds.{' '}
                          <strong>Delete</strong> removes it, and{' '}
                          <strong>Leave</strong> keeps it where it is. Nothing
                          is touched until Apply.
                        </>
                      }
                    >
                      <Form.Select
                        size="sm"
                        style={{ width: 'auto' }}
                        aria-label="Original file policy"
                        value={selectedPlan.originalPolicy}
                        onChange={(event) =>
                          updatePlan(selectedItem.id, (current) => ({
                            ...current,
                            originalPolicy:
                              event.target.value === 'delete' ||
                              event.target.value === 'keep'
                                ? event.target.value
                                : 'backup',
                            updatedAt: Date.now(),
                          }))
                        }
                      >
                        <option value="backup">Keep original in backup</option>
                        <option value="delete">Delete original</option>
                        <option value="keep">Leave original</option>
                      </Form.Select>
                    </ControlTip>
                    <ControlTip
                      label="Subtitle sidecars"
                      content={
                        <>
                          External subtitle files can stay with the original, be
                          retimed for each segment, or be copied unchanged to
                          every segment. Embedded subtitle streams follow the
                          cut mode automatically.
                        </>
                      }
                    >
                      <Form.Select
                        size="sm"
                        style={{ width: 'auto' }}
                        aria-label="Subtitle sidecar policy"
                        value={selectedPlan.sidecarPolicy}
                        onChange={(event) =>
                          updatePlan(selectedItem.id, (current) => ({
                            ...current,
                            sidecarPolicy:
                              event.target.value === 'split' ||
                              event.target.value === 'copy'
                                ? event.target.value
                                : 'leave',
                            updatedAt: Date.now(),
                          }))
                        }
                      >
                        <option value="leave">
                          Subtitles: leave with original
                        </option>
                        <option value="split">
                          Subtitles: split text tracks
                        </option>
                        <option value="copy">
                          Subtitles: copy to every segment
                        </option>
                      </Form.Select>
                    </ControlTip>
                  </Row>
                  <Row>
                    <Muted>
                      {selectedPlan.cutMode === 'exact'
                        ? 'Exact cuts re-encode each segment (slower, not bit-identical).'
                        : 'Copy cuts land on the nearest keyframe; see the offsets on each segment.'}
                    </Muted>
                    <span style={{ flex: 1 }} />
                    <ControlTip
                      label="Re-estimate"
                      content={
                        <>
                          Recalculates evenly spaced cuts from the TVDB runtimes
                          of the currently assigned episodes. Manual cut moves
                          are discarded.
                        </>
                      }
                    >
                      <Button
                        compact
                        variant="ghost"
                        icon="rescan"
                        onClick={() => reestimate(selectedItem.id)}
                      >
                        Re-estimate
                      </Button>
                    </ControlTip>
                    <ControlTip
                      label="Snap to keyframes"
                      content={
                        <>
                          Finds the nearest video keyframe for every cut in copy
                          mode. The segment card shows the time the copy will
                          actually land on.
                        </>
                      }
                    >
                      <Button
                        compact
                        variant="ghost"
                        icon="scan"
                        disabled={
                          selectedPlan.cutMode !== 'copy' ||
                          selectedState.snapping
                        }
                        onClick={() =>
                          void snapCutsFor(selectedItem.id, selectedState)
                        }
                      >
                        {selectedState.snapping
                          ? 'Snapping…'
                          : 'Snap to keyframes'}
                      </Button>
                    </ControlTip>
                    <ControlTip
                      label="Add split at playhead"
                      content={
                        <>
                          Inserts a new cut where the playhead is. Put the
                          playhead inside the segment you want to divide, then
                          assign an episode to the new segment.
                        </>
                      }
                    >
                      <Button
                        compact
                        variant="ghost"
                        icon="split"
                        onClick={() => addSplitAtPlayhead(selectedItem.id)}
                      >
                        Add split at playhead
                      </Button>
                    </ControlTip>
                  </Row>
                  <Row>
                    <ControlTip
                      label="Black frame tools"
                      content={
                        <>
                          Scans the whole file with ffmpeg's black detection.
                          Snapping moves each cut to the middle of the nearest
                          all-black run within 60 seconds. Adding gaps puts a
                          cut at every black run, then keeps the known episodes
                          in order. The scan decodes the whole file, so its
                          progress is shown on the button and a bar below.
                        </>
                      }
                    >
                      <Control>
                        <Button
                          compact
                          variant="ghost"
                          icon="scan"
                          disabled={
                            selectedState.blackLoading || Boolean(blackRun)
                          }
                          title={
                            blackRun && !selectedState.blackLoading
                              ? 'A black-frame scan is already running.'
                              : undefined
                          }
                          onClick={() =>
                            startBlackRun('snap', [selectedItem.id])
                          }
                        >
                          {selectedState.blackLoading &&
                          selectedState.blackAction === 'snap'
                            ? `Scanning for black… ${selectedState.blackProgress ?? 0}%`
                            : 'Snap to black frames'}
                        </Button>
                        <Button
                          compact
                          variant="ghost"
                          icon="add"
                          disabled={
                            selectedState.blackLoading || Boolean(blackRun)
                          }
                          title={
                            blackRun && !selectedState.blackLoading
                              ? 'A black-frame scan is already running.'
                              : undefined
                          }
                          onClick={() =>
                            startBlackRun('add', [selectedItem.id])
                          }
                        >
                          {selectedState.blackLoading &&
                          selectedState.blackAction === 'add'
                            ? `Scanning for black… ${selectedState.blackProgress ?? 0}%`
                            : 'Add all black gaps'}
                        </Button>
                      </Control>
                    </ControlTip>
                    {selectedState.toolNote && (
                      <Muted style={{ whiteSpace: 'normal' }}>
                        {selectedState.toolNote}
                      </Muted>
                    )}
                  </Row>
                  {selectedState.blackLoading && (
                    <ProgressBar
                      now={selectedState.blackProgress ?? 0}
                      label={`${selectedState.blackProgress ?? 0}%`}
                      animated
                      striped
                      aria-label="Black-frame scan progress"
                      style={{ height: 14, fontSize: 'var(--hb-font-xs)' }}
                    />
                  )}
                  {selectedPlan.estimate.note && (
                    <Muted>{selectedPlan.estimate.note}</Muted>
                  )}
                  <PreviewFrame>
                    <div
                      style={{ display: 'grid', gap: 2, alignContent: 'start' }}
                    >
                      {selectedState.preview ? (
                        <img
                          src={selectedState.preview.dataUrl}
                          alt={`Frame at ${formatSplitTimecode(selectedState.preview.seconds)}`}
                        />
                      ) : (
                        <PreviewPlaceholder>
                          {selectedState.previewLoading
                            ? 'Loading…'
                            : 'No frame'}
                        </PreviewPlaceholder>
                      )}
                      <Muted style={{ fontSize: 10 }}>
                        Playhead{' '}
                        {formatSplitTimecode(selectedState.playhead, true)}
                      </Muted>
                    </div>
                    {selectedPlan.cutMode === 'copy' &&
                      activeCutSeconds !== undefined && (
                        <div
                          style={{
                            display: 'grid',
                            gap: 2,
                            alignContent: 'start',
                          }}
                        >
                          {activeCutPreview ? (
                            <img
                              src={activeCutPreview.dataUrl}
                              alt={`Copy cut at ${formatSplitTimecode(activeCutSeconds, true)}`}
                            />
                          ) : (
                            <PreviewPlaceholder>
                              {selectedState.cutPreviewLoading
                                ? 'Loading…'
                                : 'No frame'}
                            </PreviewPlaceholder>
                          )}
                          <Muted style={{ fontSize: 10 }}>
                            Actual cut{' '}
                            {formatSplitTimecode(activeCutSeconds, true)}
                            {selectedState.cutPreviewLoading
                              ? ' · loading…'
                              : ''}
                          </Muted>
                        </div>
                      )}
                    <div
                      style={{
                        display: 'grid',
                        gap: 2,
                        alignContent: 'center',
                      }}
                    >
                      <strong style={{ fontSize: 'var(--hb-font-sm)' }}>
                        {formatSplitTimecode(selectedState.playhead, true)}
                      </strong>
                      <Muted>
                        {selectedState.previewLoading
                          ? 'Loading the exact frame…'
                          : 'Exact frame at the playhead. Click or drag the strip to scrub.'}
                      </Muted>
                      {selectedPlan.cutMode === 'copy' && (
                        <Muted>
                          The dashed line is where the copy cut lands; the ticks
                          are the five nearest keyframes you can use.
                        </Muted>
                      )}
                      <Muted>
                        {selectedPlan.episodeDurationsSeconds?.some(Boolean)
                          ? `Episode runtimes: ${selectedPlan.episodeDurationsSeconds
                              .map((value) =>
                                value ? `${Math.round(value / 60)}m` : '—',
                              )
                              .join(' + ')}`
                          : 'No episode runtimes were available.'}
                        {selectedPlan.estimate.slackSeconds
                          ? ` · ${Math.round(selectedPlan.estimate.slackSeconds / 60)}m leftover spread across the cuts.`
                          : ''}
                      </Muted>
                    </div>
                  </PreviewFrame>
                  <Filmstrip
                    duration={selectedDuration}
                    windowStart={selectedState.windowStart}
                    windowSeconds={Math.min(
                      selectedState.windowSeconds,
                      selectedDuration || selectedState.windowSeconds,
                    )}
                    segments={selectedPlan.segments}
                    frames={selectedState.frames}
                    loading={selectedState.framesLoading}
                    playhead={selectedState.playhead}
                    onPlayheadChange={(seconds) =>
                      updateState(selectedItem.id, { playhead: seconds })
                    }
                    onMarkerChange={(index, seconds) =>
                      moveMarker(selectedItem.id, index, seconds)
                    }
                    onMarkerCommit={() => {
                      if (selectedPlan.cutMode === 'copy') {
                        void snapCutsFor(
                          selectedItem.id,
                          states[selectedItem.id] ?? selectedState,
                        );
                      }
                    }}
                    cutCandidates={candidateCuts}
                    onCandidateSelect={(index, seconds) =>
                      chooseCutKeyframe(selectedItem.id, index, seconds)
                    }
                  />
                  <Row>
                    <Muted>Pan</Muted>
                    <ControlTip
                      label="Timeline pan"
                      style={{ flex: '1 1 auto' }}
                      content={
                        <>
                          Slides the visible filmstrip window through the file.
                          Drag the strip itself to scrub; drag a cut marker to
                          move it.
                        </>
                      }
                    >
                      <input
                        type="range"
                        style={{ flex: 1, width: '100%' }}
                        aria-label="Timeline position"
                        min={0}
                        max={Math.max(
                          0,
                          selectedDuration -
                            Math.min(
                              selectedState.windowSeconds,
                              selectedDuration || selectedState.windowSeconds,
                            ),
                        )}
                        step={1}
                        value={selectedState.windowStart}
                        onChange={(event) =>
                          setWindow(selectedItem.id, Number(event.target.value))
                        }
                      />
                    </ControlTip>
                    <ControlTip
                      label="Center on split"
                      content={
                        <>
                          Pans the filmstrip to the cut nearest the playhead so
                          you can inspect the frame around it at the current
                          zoom.
                        </>
                      }
                    >
                      <Button
                        compact
                        variant="ghost"
                        icon="split"
                        onClick={() => centerOnSplit(selectedItem.id)}
                      >
                        Center on split
                      </Button>
                    </ControlTip>
                    <ControlTip
                      label="Zoom"
                      content={
                        <>
                          Changes how much of the file the filmstrip shows. Zoom
                          in to place a cut precisely; the tiles are sampled, so
                          the large preview above the strip is the exact frame.
                        </>
                      }
                    >
                      <SegmentedControl
                        label="Zoom"
                        value={
                          ZOOM_OPTIONS.find(
                            (option) =>
                              option.seconds > 0 &&
                              Math.abs(
                                option.seconds - selectedState.windowSeconds,
                              ) < 1,
                          )?.value ??
                          (Math.abs(
                            selectedState.windowSeconds - selectedDuration,
                          ) < 1
                            ? 'full'
                            : 'custom')
                        }
                        onChange={(value) => setZoom(selectedItem.id, value)}
                        options={ZOOM_OPTIONS}
                      />
                    </ControlTip>
                  </Row>
                </>
              )}
            </Editor>

            <Cards>
              {selectedPlan && selectedItem ? (
                <>
                  {selectedPlan.segments.map((segment, index) => {
                    const target = targetPreview?.segments[index]?.targetPath;
                    const keyframe =
                      segment.cutSeconds !== undefined
                        ? selectedState?.keyframes?.[index - 1]
                        : undefined;
                    // Quick switches stay inside the detected episode range; the
                    // Fix match dialog is the way to pick anything outside it.
                    const rangeEpisodes = selectedItem.episodes?.length
                      ? selectedItem.episodes
                      : selectedPlan.segments
                          .map((entry) => entry.episode)
                          .filter((entry): entry is TvdbEpisode =>
                            Boolean(entry),
                          );
                    const episodeOptions =
                      segment.episode &&
                      !rangeEpisodes.some(
                        (entry) =>
                          entry.seasonNumber ===
                            segment.episode?.seasonNumber &&
                          entry.episodeNumber ===
                            segment.episode?.episodeNumber,
                      )
                        ? [...rangeEpisodes, segment.episode]
                        : rangeEpisodes;
                    return (
                      <Card key={`${selectedItem.id}-${index}`}>
                        <header>
                          <span>Segment {index + 1}</span>
                          <Muted>
                            {formatSplitTimecode(segment.startSeconds, true)} –{' '}
                            {formatSplitTimecode(segment.endSeconds, true)}
                          </Muted>
                        </header>
                        <Row>
                          <Form.Select
                            size="sm"
                            style={{ flex: '1 1 150px', minWidth: 0 }}
                            aria-label={`Episode for segment ${index + 1}`}
                            value={
                              segment.episode
                                ? `${segment.episode.seasonNumber}:${segment.episode.episodeNumber}`
                                : ''
                            }
                            onChange={(event) => {
                              const episode = episodeOptions.find(
                                (entry) =>
                                  `${entry.seasonNumber}:${entry.episodeNumber}` ===
                                  event.target.value,
                              );
                              if (episode) {
                                changeEpisode(selectedItem.id, index, episode);
                              }
                            }}
                          >
                            {!segment.episode && (
                              <option value="">Choose an episode…</option>
                            )}
                            {episodeOptions.map((episode) => (
                              <option
                                key={`${episode.seasonNumber}:${episode.episodeNumber}`}
                                value={`${episode.seasonNumber}:${episode.episodeNumber}`}
                              >
                                {episode.tag} · {episode.name}
                              </option>
                            ))}
                          </Form.Select>
                          <ControlTip
                            label="Select other episode"
                            content={
                              <>
                                Opens the shared Fix match dialog for this
                                segment. Use it when the episode is outside the
                                file's detected range, including non-contiguous
                                episodes.
                              </>
                            }
                          >
                            <Button
                              compact
                              variant="ghost"
                              icon="edit"
                              aria-label={`Select other episode for segment ${index + 1}`}
                              onClick={() =>
                                openOtherEpisode(
                                  selectedItem,
                                  index,
                                  segment.episode,
                                )
                              }
                            >
                              Select other episode
                            </Button>
                          </ControlTip>
                        </Row>
                        {index > 0 && (
                          <Row>
                            <input
                              className="form-control form-control-sm"
                              style={{ width: 92 }}
                              aria-label={`Start time for segment ${index + 1}`}
                              defaultValue={formatSplitTimecode(
                                segment.startSeconds,
                                true,
                              )}
                              key={`${index}-${segment.startSeconds}`}
                              onBlur={(event) => {
                                const parsed = parseTimecode(
                                  event.target.value,
                                );
                                if (parsed !== undefined) {
                                  moveMarker(selectedItem.id, index, parsed);
                                }
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter') return;
                                const parsed = parseTimecode(
                                  (event.target as HTMLInputElement).value,
                                );
                                if (parsed !== undefined) {
                                  moveMarker(selectedItem.id, index, parsed);
                                }
                              }}
                            />
                            <Button
                              compact
                              variant="ghost"
                              onClick={() =>
                                moveMarker(
                                  selectedItem.id,
                                  index,
                                  segment.startSeconds - 1,
                                )
                              }
                            >
                              −1s
                            </Button>
                            <Button
                              compact
                              variant="ghost"
                              onClick={() =>
                                moveMarker(
                                  selectedItem.id,
                                  index,
                                  segment.startSeconds - 0.1,
                                )
                              }
                            >
                              −0.1s
                            </Button>
                            <Button
                              compact
                              variant="ghost"
                              onClick={() =>
                                moveMarker(
                                  selectedItem.id,
                                  index,
                                  segment.startSeconds + 0.1,
                                )
                              }
                            >
                              +0.1s
                            </Button>
                            <Button
                              compact
                              variant="ghost"
                              onClick={() =>
                                moveMarker(
                                  selectedItem.id,
                                  index,
                                  segment.startSeconds + 1,
                                )
                              }
                            >
                              +1s
                            </Button>
                            <Button
                              compact
                              variant="secondary"
                              onClick={() =>
                                moveMarker(
                                  selectedItem.id,
                                  index,
                                  selectedState?.playhead ??
                                    segment.startSeconds,
                                )
                              }
                            >
                              Use playhead
                            </Button>
                            <Button
                              compact
                              variant="ghost"
                              icon="delete"
                              onClick={() =>
                                removeSplitAt(selectedItem.id, index)
                              }
                            >
                              Remove split
                            </Button>
                          </Row>
                        )}
                        {selectedPlan.cutMode === 'copy' && index > 0 && (
                          <Muted>
                            {segment.cutSeconds !== undefined
                              ? `Copy cut lands at ${formatSplitTimecode(segment.cutSeconds, true)}${
                                  keyframe?.deltaSeconds
                                    ? ` (${keyframe.deltaSeconds > 0 ? '+' : ''}${keyframe.deltaSeconds.toFixed(2)}s)`
                                    : ''
                                }. Use a tick on the strip to choose another keyframe.`
                              : 'Drag the cut, then press Snap to keyframes to see where it lands and view the alternatives.'}
                          </Muted>
                        )}
                        <small title={target}>
                          {target
                            ? target
                            : 'The naming rule produced no target for this episode.'}
                        </small>
                      </Card>
                    );
                  })}
                  <Row>
                    <Button
                      compact
                      variant="ghost"
                      icon="delete"
                      onClick={() => {
                        setRemoved((current) =>
                          new Set(current).add(selectedItem.id),
                        );
                      }}
                    >
                      Remove this split
                    </Button>
                  </Row>
                </>
              ) : null}
            </Cards>
          </Layout>
          {problems.length > 0 && (
            <Alert variant="danger" className="mb-0">
              <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                {problems.slice(0, 8).map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Muted style={{ marginRight: 'auto' }}>
            Only approved splits are saved. Unapproved edits are discarded and a
            queued split stays queued; nothing changes on disk until Apply.
          </Muted>
          <Button
            compact
            variant="ghost"
            icon="passed"
            onClick={() => setAllApproved(true)}
          >
            Approve all
          </Button>
          <Button
            compact
            variant="ghost"
            icon="close"
            onClick={() => setAllApproved(false)}
          >
            Unapprove all
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="success"
            icon="split"
            onClick={save}
            disabled={!hasWork}
          >
            Save approved ({approvedCount})
          </Button>
        </Modal.Footer>
      </Modal>
      {blackRun && (
        <BlackScanRunner
          key={`${blackRun.token}:${blackRun.index}`}
          target={blackRun.targets[blackRun.index]}
          onProgress={(percent) => {
            setBlackRunPercent(percent);
            updateBlackProgress(blackRun.targets[blackRun.index].id, percent);
          }}
          onComplete={(intervals) => finishBlackTarget(blackRun, intervals)}
          onError={(message) => failBlackTarget(blackRun, message)}
        />
      )}
      {otherEpisode && (
        <MatchFixModal
          item={otherEpisode.matchItem}
          mediaType={mediaType}
          settings={settings}
          library={library}
          onClose={() => setOtherEpisode(undefined)}
          onSave={applyOtherEpisode}
        />
      )}
    </>
  );
};
