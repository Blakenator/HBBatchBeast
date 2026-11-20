import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Alert, Form, Modal, ProgressBar, Spinner } from 'react-bootstrap';
import {
  ASYNC_CHANNEL,
  PROMISE_CHANNEL,
  activeSplitSegments,
  blackBatchEtaSeconds,
  blackDividerCuts,
  estimateSplitBoundaries,
  nearestBlackDivider,
  nearestSplitCandidates,
  organizerComparisonKey,
  parseMediaFilename,
  pathBasename,
  reservedPathsForSplit,
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
  type SplitSegment,
  type SplitTargetReport,
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
import {
  clearSplitDrafts,
  readSplitDrafts,
  saveSplitDrafts,
  type SplitDraft,
} from './splitDrafts';
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
  blackAction?: 'snap' | 'add' | 'scan';
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

const Card = styled.div<{ $assigned: boolean }>`
  display: grid;
  gap: var(--hb-space-xs);
  padding: var(--hb-space-sm);
  border: 1px solid
    ${(props) =>
      props.$assigned
        ? 'color-mix(in srgb, var(--hb-accent) 35%, var(--hb-border))'
        : 'var(--hb-border)'};
  border-radius: var(--hb-radius-sm);
  background: ${(props) =>
    props.$assigned
      ? 'color-mix(in srgb, var(--hb-accent) 7%, var(--hb-surface))'
      : 'var(--hb-surface)'};

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

const CardDetails = styled.details`
  margin-top: 2px;

  summary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 2px;
    color: var(--hb-textMuted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    cursor: pointer;
    list-style: none;
  }

  summary::-webkit-details-marker {
    display: none;
  }

  summary::before {
    content: '▸';
    font-size: 10px;
    transition: transform 120ms ease;
  }

  &[open] summary::before {
    transform: rotate(90deg);
  }

  summary:hover {
    color: var(--hb-text);
  }

  > div {
    display: grid;
    gap: var(--hb-space-xs);
    padding-top: var(--hb-space-xs);
  }
`;

const MergePreview = styled.div`
  display: flex;
  height: 30px;
  overflow: hidden;
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surface);
`;

const MergePreviewBlock = styled.div<{ $merged: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 10px;
  padding: 0 4px;
  overflow: hidden;
  border-right: 1px solid color-mix(in srgb, var(--hb-border) 70%, transparent);
  background: ${({ $merged }) =>
    $merged
      ? 'color-mix(in srgb, var(--hb-accent) 45%, transparent)'
      : 'color-mix(in srgb, var(--hb-textMuted) 10%, transparent)'};
  color: ${({ $merged }) =>
    $merged ? 'var(--hb-accentContrast, #fff)' : 'var(--hb-textMuted)'};
  font-size: 9px;
  font-weight: 700;
  white-space: nowrap;

  &:last-child {
    border-right: 0;
  }
`;

const MergeLegend = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: var(--hb-space-sm);
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const MergeSwatch = styled.span<{ $merged: boolean }>`
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 4px;
  border-radius: 2px;
  background: ${({ $merged }) =>
    $merged
      ? 'color-mix(in srgb, var(--hb-accent) 45%, transparent)'
      : 'color-mix(in srgb, var(--hb-textMuted) 10%, transparent)'};
  vertical-align: -1px;
`;

const ConflictPanel = styled.section`
  display: grid;
  gap: var(--hb-space-xs);
  padding: var(--hb-space-sm);
  border: 1px solid var(--hb-danger);
  border-radius: var(--hb-radius-sm);
  background: color-mix(in srgb, var(--hb-danger) 10%, var(--hb-surface));
  font-size: var(--hb-font-xs);

  strong {
    color: var(--hb-danger);
  }

  ul {
    margin: 0;
    padding-left: 1.2rem;
  }
`;

const SegmentWarning = styled.div<{ $muted?: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--hb-space-xs);
  flex-wrap: wrap;
  padding: var(--hb-space-xs);
  border-radius: var(--hb-radius-sm);
  background: ${({ $muted }) =>
    $muted
      ? 'var(--hb-surfaceMuted)'
      : 'color-mix(in srgb, var(--hb-danger) 10%, transparent)'};
  color: ${({ $muted }) =>
    $muted ? 'var(--hb-textMuted)' : 'var(--hb-danger)'};
  font-size: var(--hb-font-xs);

  .hb-segment-message {
    flex: 1 1 160px;
  }
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-xs);
  flex-wrap: wrap;
  font-size: var(--hb-font-xs);
`;

const CardActions = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--hb-space-xs);
  padding-top: var(--hb-space-xs);
  border-top: 1px solid var(--hb-border);
`;

const CutRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--hb-space-xs);
  font-size: var(--hb-font-xs);

  label {
    color: var(--hb-textMuted);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }
`;

const NudgeGroup = styled.div`
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);

  > button {
    min-width: 38px;
    padding: 0 4px;
    border: 0;
    border-right: 1px solid var(--hb-border);
    border-radius: 0;
  }

  > button:last-child {
    border-right: 0;
  }
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
  action: 'snap' | 'add' | 'scan';
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

interface ConflictPreviewOptions {
  settings: OrganizeSettings;
  mediaType: MediaType;
  caseInsensitive: boolean;
}

/** Rendered targets of a plan's active segments, with skipped ones removed. */
function segmentDurationSeconds(segment: SplitSegment): number {
  return Math.max(0, segment.endSeconds - segment.startSeconds);
}

/**
 * Picks how many following segments to absorb so the combined length stays
 * within the matched episode's metadata runtime. The first segment is always
 * merged with at least one following segment, matching the button's action.
 */
export function suggestedMergeCount(
  segments: readonly SplitSegment[],
  index: number,
  maxCount: number,
  fallbackRuntimeSeconds = 0,
): number {
  if (maxCount < 1 || !segments[index] || !segments[index + 1]) return 0;
  const runtimeSeconds =
    (segments[index]?.episode?.runtimeMinutes ?? 0) * 60 ||
    fallbackRuntimeSeconds;
  if (!(runtimeSeconds > 0)) return 1;
  let count = 1;
  let total =
    segmentDurationSeconds(segments[index]) +
    segmentDurationSeconds(segments[index + 1]);
  const tolerance = 1;
  for (let next = 2; next <= maxCount; next += 1) {
    const candidate = total + segmentDurationSeconds(segments[index + next]);
    if (candidate > runtimeSeconds + tolerance) break;
    total = candidate;
    count = next;
  }
  return count;
}

function activeRenderedTargets(
  item: OrganizePlanItem,
  candidate: OrganizeSplitPlan,
  options: ConflictPreviewOptions,
): string[] {
  const report = withSplitTargets(item, candidate.segments, {
    settings: options.settings,
    mediaType: options.mediaType,
    caseInsensitive: options.caseInsensitive,
    skippedSegments: candidate.skippedSegments,
  });
  const skipped = new Set(candidate.skippedSegments ?? []);
  return report.targets.filter(
    (target, index): target is string =>
      Boolean(target) &&
      !skipped.has(candidate.segments[index]?.index ?? index),
  );
}

/**
 * Renders one plan's targets and conflicts against every other row's paths and
 * every other split's outputs, so collisions are visible while editing.
 */
function previewForItem(
  plan: OrganizePlan,
  item: OrganizePlanItem,
  candidate: OrganizeSplitPlan,
  planById: ReadonlyMap<string, OrganizeSplitPlan | undefined>,
  splitItemIds: ReadonlySet<string>,
  existingPaths: string[],
  options: ConflictPreviewOptions,
): SplitTargetReport & { segments: SplitSegment[] } {
  const reserved = [
    ...reservedPathsForSplit(plan.items, item.id, splitItemIds),
    ...[...planById.entries()]
      .filter(([id]) => id !== item.id)
      .flatMap(([id, otherPlan]) => {
        if (!otherPlan) return [];
        const otherItem = plan.items.find((row) => row.id === id);
        return otherItem
          ? activeRenderedTargets(otherItem, otherPlan, options)
          : [];
      }),
  ];
  return withSplitTargets(item, candidate.segments, {
    settings: options.settings,
    mediaType: options.mediaType,
    caseInsensitive: options.caseInsensitive,
    reservedPaths: reserved,
    existingPaths: candidate.overwrite ? [] : existingPaths,
    skippedSegments: candidate.skippedSegments,
  });
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
  /** Open merge confirmation; the index is the first segment to keep. */
  const [mergeRequest, setMergeRequest] = useState<{
    itemId: string;
    index: number;
  }>();
  const [mergeCount, setMergeCount] = useState(1);
  /** Files already on disk at a rendered split target, checked by the backend. */
  const [existingTargets, setExistingTargets] = useState<string[]>([]);
  const blackScanToken = useRef(0);
  const frameGeneration = useRef(0);
  const previewInFlight = useRef(false);
  const previewPending = useRef<
    { id: string; path: string; seconds: number } | undefined
  >(undefined);
  const cutPreviewGeneration = useRef(0);
  const initializedKey = useRef<string | undefined>(undefined);
  /** Drafts restored on open, checked against the probed file before keeping. */
  const restoredDrafts = useRef(new Map<string, SplitDraft>());

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
  const checkTargets = useBackend({
    channel: PROMISE_CHANNEL.OrganizeCheckTargets,
    skip: true,
  });
  const loadBlackFrames = useBackend({
    channel: PROMISE_CHANNEL.OrganizeBlackFrames,
    skip: true,
  });
  const ffmpeg = useBackend({
    channel: PROMISE_CHANNEL.OrganizeFfmpegStatus,
    skip: false,
  });
  const checkTargetsRef = useRef(checkTargets);
  checkTargetsRef.current = checkTargets;

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
    // Any edit invalidates the problems from the last save attempt.
    setProblems([]);
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

  /** Grants or revokes permission to replace existing target files. */
  const setOverwrite = (id: string, overwrite: boolean) => {
    updatePlan(id, (current) => ({
      ...current,
      overwrite,
      updatedAt: Date.now(),
    }));
  };

  /**
   * Leaves a segment in the plan but writes no file for it, so the cut order,
   * time ranges and episode range stay intact. The split's original-file
   * policy still applies to the source afterward.
   */
  const skipSegments = (id: string, indexes: number[]) => {
    if (indexes.length === 0) return;
    updatePlan(
      id,
      (current) => {
        const skipped = new Set(current.skippedSegments ?? []);
        for (const index of indexes) skipped.add(index);
        return {
          ...current,
          skippedSegments: [...skipped].sort((left, right) => left - right),
          edited: true,
          updatedAt: Date.now(),
        };
      },
      { approved: false },
    );
  };

  const restoreSegment = (id: string, index: number) => {
    updatePlan(
      id,
      (current) => {
        const skipped = (current.skippedSegments ?? []).filter(
          (candidate) => candidate !== index,
        );
        return {
          ...current,
          skippedSegments: skipped.length > 0 ? skipped : undefined,
          edited: true,
          updatedAt: Date.now(),
        };
      },
      { approved: false },
    );
  };

  const skipSplit = (id: string) => {
    setProblems([]);
    setRemoved((current) => new Set(current).add(id));
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
    const runtimeMinutesByIndex: (number | undefined)[] = [];
    const durations = episodes.map((episode, index) => {
      if (!episode) {
        methods.add('equal');
        return undefined;
      }
      const minutes = episode.id ? runtimeById[episode.id] : undefined;
      if (minutes) {
        methods.add('tvdb');
        runtimeMinutesByIndex[index] = minutes;
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
        const plexMinutes = association.durationMs / 60000;
        runtimeMinutesByIndex[index] = plexMinutes;
        return association.durationMs / 1000;
      }
      methods.add('equal');
      return undefined;
    });
    // The merge confirmation reads the runtime from the matched episode, so
    // carry the resolved TVDB/Plex runtime on the episode itself.
    const matchedEpisodes = episodes.map((episode, index) =>
      episode && runtimeMinutesByIndex[index]
        ? { ...episode, runtimeMinutes: runtimeMinutesByIndex[index] }
        : episode,
    );
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
      segments: segmentsForEpisodes(matchedEpisodes, estimate.boundaries),
      updatedAt: Date.now(),
    };
  };

  useEffect(() => {
    if (initializedKey.current === itemsKey) return;
    initializedKey.current = itemsKey;
    let cancelled = false;
    const existing = new Map(splits.map((split) => [split.itemId, split]));
    const drafts = new Map(
      readSplitDrafts()
        .filter((draft) => draft.libraryId === library.id)
        .map((draft) => [draft.itemId, draft]),
    );
    const restorable = new Map(
      [...drafts].filter(([id, draft]) => {
        const item = items.find((candidate) => candidate.id === id);
        return Boolean(item) && item?.sourcePath === draft.sourcePath;
      }),
    );
    restoredDrafts.current = restorable;
    const draftRemoved = [...restorable.values()]
      .filter((draft) => draft.removed)
      .map((draft) => draft.itemId);
    if (draftRemoved.length > 0) {
      setRemoved((current) => new Set([...current, ...draftRemoved]));
    }
    void Promise.all(
      items.map(async (item) => {
        const draft = restorable.get(item.id);
        const state = draft?.plan ?? existing.get(item.id);
        const stateSpan = state ? Math.min(600, state.fileDurationSeconds) : 0;
        const stateCut = state?.segments[1]?.startSeconds ?? 0;
        const initial: FileState = {
          ...emptyState(),
          ...(state
            ? {
                plan: state,
                approved: draft ? draft.approved : true,
                windowSeconds: stateSpan,
                windowStart: centeredWindowStart(
                  stateCut,
                  stateSpan,
                  state.fileDurationSeconds,
                ),
                playhead: stateCut,
                ...(draft
                  ? {
                      toolNote:
                        'Restored the unsaved split edits from your last session.',
                    }
                  : {}),
              }
            : {}),
        };
        updateState(item.id, initial);
        // Reuse a saved scan so reopening the editor does not decode the file
        // again. A scan started meanwhile wins over the cached result.
        void loadBlackFrames
          .refetch({ path: item.sourcePath })
          .then((result) => {
            if (cancelled) return;
            const intervals = result?.data?.intervals;
            if (!intervals) return;
            setStates((current) => {
              const state = current[item.id];
              if (!state || state.blackIntervals || state.blackLoading) {
                return current;
              }
              return {
                ...current,
                [item.id]: {
                  ...state,
                  blackIntervals: intervals,
                  ...(intervals.length > 0 && state.toolNote === undefined
                    ? {
                        toolNote: `Loaded the saved black-frame scan (${intervals.length} black run${
                          intervals.length === 1 ? '' : 's'
                        }). Use Restore black frame splits to apply it.`,
                      }
                    : {}),
                },
              };
            });
          })
          .catch(() => {
            // The cache is optional; the scan buttons still work.
          });
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
            const draft = restoredDrafts.current.get(item.id);
            if (draft && draft.fileSize !== probe.size) {
              // The file changed, so the saved cuts no longer apply.
              clearSplitDrafts(library.id, [item.id]);
              restoredDrafts.current.delete(item.id);
              updateState(item.id, {
                plan: undefined,
                approved: false,
                toolNote:
                  'The source file changed since the draft was saved; the cuts were estimated again.',
              });
            } else {
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
                  approved: draft ? draft.approved : true,
                });
              }
              return;
            }
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

  /**
   * Persists every manual decision so closing the dialog, an app restart or a
   * failed save does not throw the work away. Only plans the user touched (or
   * approved, or removed) are written, so simply opening an estimate does not
   * leave a stale draft that could overwrite a later match fix.
   */
  const draftRevision = items
    .map((item) => {
      const state = states[item.id];
      const isRemoved = removed.has(item.id);
      if (!state?.plan) return `${item.id}|${isRemoved ? 'r' : '-'}`;
      return `${item.id}|${isRemoved ? 'r' : '-'}|${
        state.approved ? 'a' : 'u'
      }|${JSON.stringify(state.plan)}`;
    })
    .join('\n');

  useEffect(() => {
    const drafts: (Omit<SplitDraft, 'updatedAt'> & { updatedAt?: number })[] =
      [];
    for (const item of items) {
      const state = states[item.id];
      const plan = state?.plan;
      if (!state || !plan || plan.fileSize <= 0) continue;
      const isRemoved = removed.has(item.id);
      const touched = Boolean(plan.edited) || state.approved || isRemoved;
      if (!touched) continue;
      drafts.push({
        libraryId: library.id,
        itemId: item.id,
        sourcePath: plan.sourcePath,
        fileSize: plan.fileSize,
        plan,
        approved: state.approved,
        removed: isRemoved,
      });
    }
    if (drafts.length > 0) saveSplitDrafts(drafts);
    // Re-run only when a plan, approval or removal changes, not on scrubbing.
  }, [draftRevision]);

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

  const caseInsensitive = settings.caseInsensitive ?? false;
  const previewOptions = useMemo<ConflictPreviewOptions>(
    () => ({ settings, mediaType, caseInsensitive }),
    [settings, mediaType, caseInsensitive],
  );

  const planById = useMemo(() => {
    const map = new Map<string, OrganizeSplitPlan>();
    for (const item of items) {
      const candidate = states[item.id]?.plan;
      if (candidate && !removed.has(item.id)) map.set(item.id, candidate);
    }
    return map;
  }, [items, states, removed]);

  const splitIds = useMemo(() => {
    const ids = new Set<string>(planById.keys());
    for (const split of splits) {
      if (!removed.has(split.itemId)) ids.add(split.itemId);
    }
    return ids;
  }, [planById, splits, removed]);

  const conflictReports = useMemo(() => {
    const reports = new Map<
      string,
      SplitTargetReport & { segments: SplitSegment[] }
    >();
    for (const item of items) {
      const candidate = planById.get(item.id);
      if (!candidate) continue;
      reports.set(
        item.id,
        previewForItem(
          plan,
          item,
          candidate,
          planById,
          splitIds,
          existingTargets,
          previewOptions,
        ),
      );
    }
    return reports;
  }, [items, planById, splitIds, plan, existingTargets, previewOptions]);

  const selectedReport = selectedItem
    ? conflictReports.get(selectedItem.id)
    : undefined;
  const selectedConflicts = selectedReport?.targetConflicts ?? [];
  const selectedSkipped = new Set(selectedPlan?.skippedSegments ?? []);
  const existingTargetKeys = useMemo(
    () =>
      new Set(
        existingTargets.map((path) =>
          organizerComparisonKey(path, { caseInsensitive }),
        ),
      ),
    [existingTargets, caseInsensitive],
  );

  // Only active targets are worth checking; a skipped segment never writes.
  const targetCheckKey = useMemo(() => {
    const paths = new Set<string>();
    for (const item of items) {
      const candidate = planById.get(item.id);
      if (!candidate) continue;
      for (const target of activeRenderedTargets(
        item,
        candidate,
        previewOptions,
      )) {
        paths.add(target);
      }
    }
    return [...paths].sort().join('\n');
  }, [items, planById, previewOptions]);

  useEffect(() => {
    const paths = targetCheckKey ? targetCheckKey.split('\n') : [];
    if (paths.length === 0) {
      setExistingTargets([]);
      return;
    }
    let cancelled = false;
    void checkTargetsRef.current
      .refetch({ paths })
      .then((result) => {
        if (cancelled) return;
        const existing = result?.data?.existing;
        if (Array.isArray(existing)) setExistingTargets(existing);
      })
      .catch(() => {
        // The inline conflict list simply stays without disk conflicts.
      });
    return () => {
      cancelled = true;
    };
  }, [targetCheckKey]);

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

  /** Centers the filmstrip on a segment's first frame. */
  const jumpToSegmentStart = (id: string, seconds: number) => {
    setStates((current) => {
      const state = current[id];
      if (!state?.plan) return current;
      const duration =
        state.probe?.durationSeconds ?? state.plan.fileDurationSeconds;
      const span = Math.max(1, Math.min(duration, state.windowSeconds));
      return {
        ...current,
        [id]: {
          ...state,
          playhead: seconds,
          windowStart: centeredWindowStart(seconds, span, duration),
        },
      };
    });
  };

  /** Centers the filmstrip on a segment's last frame. */
  const jumpToSegmentEnd = (id: string, seconds: number) => {
    setStates((current) => {
      const state = current[id];
      if (!state?.plan) return current;
      const duration =
        state.probe?.durationSeconds ?? state.plan.fileDurationSeconds;
      const span = Math.max(1, Math.min(duration, state.windowSeconds));
      return {
        ...current,
        [id]: {
          ...state,
          playhead: seconds,
          windowStart: centeredWindowStart(seconds, span, duration),
        },
      };
    });
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
        const clamped =
          Math.round(Math.max(previous + 1, Math.min(next - 1, seconds)) * 10) /
          10;
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

  /**
   * Fetches the runtime of a newly selected episode so the merge suggestion
   * still has a metadata length to work with. Enriches only the chosen segment,
   * and never marks the split as edited.
   */
  const attachEpisodeRuntime = (
    id: string,
    index: number,
    episode: TvdbEpisode,
  ) => {
    const episodeId = episode.id;
    const slug = states[id]?.slug;
    if (!episodeId || !slug) return;
    void loadRuntimes
      .refetch({ slug, episodeIds: [episodeId] })
      .then((result) => {
        const minutes = result?.data?.[episodeId];
        if (!minutes) return;
        setStates((current) => {
          const state = current[id];
          if (!state?.plan) return current;
          const target = state.plan.segments[index];
          if (target?.episode?.id !== episodeId) return current;
          const segments = state.plan.segments.map((segment, segmentIndex) =>
            segmentIndex === index
              ? {
                  ...segment,
                  episode: { ...segment.episode, runtimeMinutes: minutes },
                }
              : segment,
          );
          const episodeDurationsSeconds = [
            ...(state.plan.episodeDurationsSeconds ?? []),
          ];
          episodeDurationsSeconds[index] = minutes * 60;
          return {
            ...current,
            [id]: {
              ...state,
              plan: {
                ...state.plan,
                segments,
                episodeDurationsSeconds,
              },
            },
          };
        });
      })
      .catch(() => {
        // The runtime is a convenience; merging still works without it.
      });
  };

  const changeEpisode = (id: string, index: number, episode: TvdbEpisode) => {
    updatePlan(
      id,
      (current) => ({
        ...current,
        overwrite: false,
        segments: current.segments.map((segment, segmentIndex) =>
          segmentIndex === index ? { ...segment, episode } : segment,
        ),
        edited: true,
        updatedAt: Date.now(),
      }),
      { approved: false },
    );
    attachEpisodeRuntime(id, index, episode);
  };

  /**
   * Stores a manual output filename for one segment. Clearing it (or typing
   * the default name back) removes the override and restores the naming rule.
   */
  const setOutputName = (
    id: string,
    index: number,
    value: string,
    defaultValue: string | undefined,
  ) => {
    const typed = value.trim();
    const override =
      typed && typed !== (defaultValue ? pathBasename(defaultValue) : '')
        ? typed
        : undefined;
    updatePlan(
      id,
      (current) => ({
        ...current,
        segments: current.segments.map((segment, segmentIndex) => {
          if (segmentIndex !== index) return segment;
          if (override) return { ...segment, outputName: override };
          const { outputName: _removed, ...rest } = segment;
          return rest;
        }),
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
    setProblems([]);
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
            overwrite: false,
            segments: state.plan.segments.map((segment, segmentIndex) =>
              segmentIndex === target.index ? { ...segment, episode } : segment,
            ),
            edited: true,
            updatedAt: Date.now(),
          },
        },
      };
    });
    attachEpisodeRuntime(target.itemId, target.index, episode);
  };

  const reestimate = (id: string) => {
    setProblems([]);
    const state = states[id];
    if (!state?.plan) return;
    const episodes = state.plan.segments.map((segment) => segment.episode);
    const outputNames = state.plan.segments.map(
      (segment) => segment.outputName,
    );
    const estimate = estimateSplitBoundaries({
      fileDurationSeconds:
        state.probe?.durationSeconds ?? state.plan.fileDurationSeconds,
      episodeDurationsSeconds: state.plan.episodeDurationsSeconds,
    });
    const plan: OrganizeSplitPlan = {
      ...state.plan,
      segments: segmentsForEpisodes(episodes, estimate.boundaries).map(
        (segment, index) => ({
          ...segment,
          ...(outputNames[index] ? { outputName: outputNames[index] } : {}),
        }),
      ),
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
    const outputNames = state.plan.segments.map(
      (segment) => segment.outputName,
    );
    const segments = Array.from({ length: unique.length + 1 }, (_, index) => ({
      index,
      startSeconds: index === 0 ? 0 : unique[index - 1],
      endSeconds: index === unique.length ? duration : unique[index],
      ...(episodes[index] ? { episode: episodes[index] } : {}),
      ...(outputNames[index] ? { outputName: outputNames[index] } : {}),
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

  const addSplitAt = (id: string, at: number) => {
    setProblems([]);
    setStates((current) => {
      const state = current[id];
      if (!state?.plan) return current;
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
      const skippedBefore = new Set(state.plan.skippedSegments ?? []);
      const segments = state.plan.segments.map((segment) => ({ ...segment }));
      const skippedObjects = new Set(
        segments.filter((_, segmentIndex) => skippedBefore.has(segmentIndex)),
      );
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
      const skippedSegments = segments
        .map((entry, entryIndex) =>
          skippedObjects.has(entry) ? entryIndex : -1,
        )
        .filter((entryIndex) => entryIndex >= 0);
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
            ...(skippedSegments.length > 0 ? { skippedSegments } : {}),
            edited: true,
            updatedAt: Date.now(),
          },
        },
      };
    });
  };

  const addSplitAtPlayhead = (id: string) => {
    const state = states[id];
    if (!state?.plan) return;
    addSplitAt(id, state.playhead);
  };

  /** Inserts a cut halfway through one segment. */
  const addSplitBetween = (id: string, index: number) => {
    const segment = states[id]?.plan?.segments[index];
    if (!segment) return;
    addSplitAt(
      id,
      segment.startSeconds + (segment.endSeconds - segment.startSeconds) / 2,
    );
  };

  const removeSplitAt = (id: string, index: number) => {
    setProblems([]);
    setStates((current) => {
      const state = current[id];
      if (!state?.plan || index < 1 || index >= state.plan.segments.length) {
        return current;
      }
      const skippedBefore = new Set(state.plan.skippedSegments ?? []);
      const segments = state.plan.segments.map((segment) => ({ ...segment }));
      const skippedObjects = new Set(
        segments.filter((_, segmentIndex) => skippedBefore.has(segmentIndex)),
      );
      const [removed] = segments.splice(index, 1);
      if (segments[index - 1]) {
        segments[index - 1].endSeconds = removed.endSeconds;
      }
      segments.forEach((entry, entryIndex) => {
        entry.index = entryIndex;
      });
      // The removed segment is gone, so its skipped marker goes with it; the
      // remaining dropped segments shift down with their own objects.
      const skippedSegments = segments
        .map((entry, entryIndex) =>
          skippedObjects.has(entry) ? entryIndex : -1,
        )
        .filter((entryIndex) => entryIndex >= 0);
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
            ...(skippedSegments.length > 0 ? { skippedSegments } : {}),
            edited: true,
            updatedAt: Date.now(),
          },
        },
      };
    });
  };

  /**
   * Absorbs one or more following segments into the segment at `index`, which
   * removes their cuts and keeps the first segment's episode and filename. The
   * result is active unless every merged segment was already dropped.
   */
  const mergeSegments = (id: string, index: number, count: number) => {
    setProblems([]);
    setStates((current) => {
      const state = current[id];
      if (!state?.plan) return current;
      const segments = state.plan.segments.map((segment) => ({ ...segment }));
      const absorbed = Math.max(
        1,
        Math.min(count, segments.length - index - 1),
      );
      if (
        index < 0 ||
        index >= segments.length - 1 ||
        segments.length - absorbed < 2
      ) {
        return current;
      }
      const skippedBefore = new Set(state.plan.skippedSegments ?? []);
      const skippedObjects = new Set(
        segments.filter((_, segmentIndex) => skippedBefore.has(segmentIndex)),
      );
      const merged = segments.slice(index, index + absorbed + 1);
      const survivor = segments[index];
      const last = segments[index + absorbed];
      survivor.endSeconds = last.endSeconds;
      if (!survivor.episode) {
        const inherited = merged.find((segment) => segment.episode)?.episode;
        if (inherited) survivor.episode = inherited;
      }
      const mergedSkipped = merged.every((segment) =>
        skippedObjects.has(segment),
      );
      segments.splice(index + 1, absorbed);
      segments.forEach((entry, entryIndex) => {
        entry.index = entryIndex;
      });
      const skippedSegments = segments
        .map((entry, entryIndex) =>
          entry === survivor
            ? mergedSkipped
              ? entryIndex
              : -1
            : skippedObjects.has(entry)
              ? entryIndex
              : -1,
        )
        .filter((entryIndex) => entryIndex >= 0);
      return {
        ...current,
        [id]: {
          ...state,
          approved: false,
          keyframes: undefined,
          toolNote: `Merged ${absorbed + 1} segments into one. Check the episode and output filename, then snap to keyframes for copy mode.`,
          plan: {
            ...state.plan,
            segments,
            ...(skippedSegments.length > 0 ? { skippedSegments } : {}),
            edited: true,
            updatedAt: Date.now(),
          },
        },
      };
    });
    setMergeRequest(undefined);
  };

  /** Applies a black-frame tool to the intervals from the shared scan. */
  const applyBlackAction = (
    id: string,
    action: 'snap' | 'add',
    intervals: SplitBlackInterval[],
  ) => {
    setProblems([]);
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

  const markBlackLoading = (id: string, action: 'snap' | 'add' | 'scan') => {
    updateState(id, {
      blackLoading: true,
      blackProgress: 0,
      blackAction: action,
      toolNote: undefined,
    });
  };

  const blackResultNote = (
    action: 'snap' | 'add' | 'scan',
    applied: number,
    failures: number,
  ) => {
    const files = applied === 1 ? 'file' : 'files';
    const prefix =
      action === 'snap'
        ? `Snapped cuts to black in ${applied} ${files}.`
        : action === 'add'
          ? `Added black-gap splits in ${applied} ${files}.`
          : `Scanned ${applied} ${files} for black frames; the saved result is ready to restore.`;
    if (failures <= 0) return prefix;
    return `${prefix} ${failures} scan${failures === 1 ? '' : 's'} failed.`;
  };

  /**
   * Starts a black-frame tool for one file or a batch. Cached scans are
   * applied immediately; the rest are scanned one at a time so a batch does
   * not decode several files at once.
   */
  const startBlackRun = (action: 'snap' | 'add' | 'scan', ids: string[]) => {
    if (blackRun) return;
    const targets: BlackScanTarget[] = [];
    let applied = 0;
    for (const id of ids) {
      const state = states[id];
      if (!state?.plan || state.loading || state.error) continue;
      if (action !== 'scan' && state.blackIntervals) {
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

  /** Applies saved black runs immediately, without another ffmpeg scan. */
  const restoreBlackSplits = (id: string) => {
    const state = states[id];
    if (!state?.plan || state.blackLoading) return;
    if (!state.blackIntervals || state.blackIntervals.length === 0) return;
    applyBlackAction(id, 'add', state.blackIntervals);
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
    const id = run.targets[run.index].id;
    if (run.action === 'scan') {
      updateState(id, {
        blackIntervals: intervals,
        blackLoading: false,
        blackProgress: undefined,
        blackAction: undefined,
        toolNote: `Scanned ${intervals.length} black run${intervals.length === 1 ? '' : 's'}. Use Restore black frame splits to apply them.`,
      });
      advanceBlackRun(run, 1, 0);
      return;
    }
    applyBlackAction(id, run.action, intervals);
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
    setProblems([]);
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
  const approvedConflictCount = items.filter(
    (item) =>
      !removed.has(item.id) &&
      states[item.id]?.approved &&
      (conflictReports.get(item.id)?.targetConflicts.length ?? 0) > 0,
  ).length;

  /**
   * Checks targets and saves the approved splits. With `skipConflicts`, every
   * path that would be written over, is claimed by another row or duplicated
   * is dropped instead of blocking the save, and splits with nothing left are
   * skipped entirely.
   */
  const save = async (skipConflicts = false) => {
    const planNow = new Map<string, OrganizeSplitPlan>();
    for (const item of items) {
      const candidate = states[item.id]?.plan;
      if (candidate && !removed.has(item.id)) planNow.set(item.id, candidate);
    }
    const pathsToCheck = new Set<string>();
    for (const item of items) {
      const candidate = planNow.get(item.id);
      if (!candidate || !states[item.id]?.approved) continue;
      for (const target of activeRenderedTargets(
        item,
        candidate,
        previewOptions,
      )) {
        pathsToCheck.add(target);
      }
    }
    let existingPaths = existingTargets;
    if (pathsToCheck.size > 0) {
      try {
        const result = await checkTargets.refetch({
          paths: [...pathsToCheck],
        });
        const existing = result?.data?.existing;
        if (Array.isArray(existing)) {
          existingPaths = existing;
          setExistingTargets(existing);
        }
      } catch {
        // Keep the result of the last background check.
      }
    }

    const upserts: OrganizeSplitPlan[] = [];
    const nextProblems: string[] = [];
    const skippedIds = new Set<string>();
    for (const item of items) {
      if (removed.has(item.id)) continue;
      const state = states[item.id];
      if (!state?.plan) {
        if (state?.approved && !state.error) {
          if (skipConflicts) {
            skippedIds.add(item.id);
            continue;
          }
          nextProblems.push(
            `${item.sourceRelativePath}: no split was prepared.`,
          );
        }
        continue;
      }
      // Unapproved edits are discarded; a queued split stays queued unchanged.
      if (!state.approved) continue;
      let planToSave: OrganizeSplitPlan = {
        ...state.plan,
        updatedAt: Date.now(),
      };
      const preview = () =>
        previewForItem(
          plan,
          item,
          planToSave,
          planNow,
          splitIds,
          existingPaths,
          previewOptions,
        );
      let report = preview();
      let found = [...validateSplitPlan(planToSave), ...report.conflicts];
      if (found.length > 0 && skipConflicts) {
        const conflictIndexes = new Set(
          report.targetConflicts.map((conflict) => conflict.segmentIndex),
        );
        if (conflictIndexes.size === 0) {
          // These are plan problems, not target conflicts; dropping segments
          // would hide them, so keep reporting and let the user fix the split.
          nextProblems.push(
            ...found.map((problem) => `${item.sourceRelativePath}: ${problem}`),
          );
          continue;
        }
        const skipped = new Set([
          ...(planToSave.skippedSegments ?? []),
          ...conflictIndexes,
        ]);
        if (
          planToSave.segments.every((segment) => skipped.has(segment.index))
        ) {
          skippedIds.add(item.id);
          continue;
        }
        planToSave = {
          ...planToSave,
          skippedSegments: [...skipped].sort((left, right) => left - right),
        };
        report = preview();
        found = [...validateSplitPlan(planToSave), ...report.conflicts];
      }
      if (found.length > 0) {
        if (skipConflicts) {
          skippedIds.add(item.id);
          continue;
        }
        nextProblems.push(
          ...found.map((problem) => `${item.sourceRelativePath}: ${problem}`),
        );
        continue;
      }
      upserts.push(planToSave);
    }
    if (nextProblems.length > 0) {
      setProblems([...new Set(nextProblems)]);
      return;
    }
    const queued = new Set(splits.map((split) => split.itemId));
    const removedIds = new Set(removedQueuedIds);
    for (const id of skippedIds) {
      if (queued.has(id)) removedIds.add(id);
    }
    // Saving makes these drafts canonical (or drops them); unsaved items keep
    // their draft so the next open still restores the work in progress.
    clearSplitDrafts(library.id, [
      ...upserts.map((upsert) => upsert.itemId),
      ...removedIds,
    ]);
    onSave(upserts, [...removedIds]);
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
                const conflicts =
                  conflictReports.get(item.id)?.targetConflicts.length ?? 0;
                const activeSegments = state?.plan
                  ? activeSplitSegments(state.plan).length
                  : 0;
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
                      {conflicts > 0 && !removed.has(item.id) ? (
                        <Icon
                          name="failures"
                          size="xs"
                          tone="danger"
                          label="Target conflicts"
                        />
                      ) : state?.approved && !removed.has(item.id) ? (
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
                              ? conflicts > 0
                                ? `${conflicts} target conflict${
                                    conflicts === 1 ? '' : 's'
                                  } · needs a decision`
                                : `${activeSegments} of ${
                                    state.plan.segments.length
                                  } segment${
                                    state.plan.segments.length === 1 ? '' : 's'
                                  } · ${methodLabel(
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
                          Results are saved under the app cache and reloaded
                          when the editor opens again.{' '}
                          {selectedState.blackIntervals === undefined
                            ? 'No saved scan is available for this file yet.'
                            : selectedState.blackIntervals.length === 0
                              ? 'The saved scan found no black runs.'
                              : `${selectedState.blackIntervals.length} saved black run${
                                  selectedState.blackIntervals.length === 1
                                    ? ''
                                    : 's'
                                } can be restored without scanning.`}
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
                        <Button
                          compact
                          variant="secondary"
                          icon="reset"
                          disabled={
                            selectedState.blackLoading ||
                            Boolean(blackRun) ||
                            !selectedState.blackIntervals?.length
                          }
                          title={
                            selectedState.blackIntervals === undefined
                              ? 'No saved black-frame scan yet; rescan the file first.'
                              : selectedState.blackIntervals.length === 0
                                ? 'The saved scan found no black runs to restore.'
                                : undefined
                          }
                          onClick={() => restoreBlackSplits(selectedItem.id)}
                        >
                          Restore black frame splits
                        </Button>
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
                              : 'Decodes the whole file again and replaces the saved result.'
                          }
                          onClick={() =>
                            startBlackRun('scan', [selectedItem.id])
                          }
                        >
                          {selectedState.blackLoading &&
                          selectedState.blackAction === 'scan'
                            ? `Scanning for black… ${selectedState.blackProgress ?? 0}%`
                            : 'Rescan black frames'}
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
                  {(() => {
                    const conflictIndexes = new Set(
                      selectedConflicts.map(
                        (conflict) => conflict.segmentIndex,
                      ),
                    );
                    const remaining = selectedPlan.segments.filter(
                      (segment) =>
                        !selectedSkipped.has(segment.index) &&
                        !conflictIndexes.has(segment.index),
                    );
                    const overwriteable = selectedConflicts.some(
                      (conflict) => conflict.overwriteable,
                    );
                    if (
                      selectedConflicts.length === 0 &&
                      selectedSkipped.size === 0 &&
                      !selectedPlan.overwrite
                    ) {
                      return null;
                    }
                    return (
                      <ConflictPanel aria-label="Target conflicts">
                        {selectedConflicts.length > 0 && (
                          <>
                            <strong>Target conflicts</strong>
                            <ul>
                              {selectedConflicts.map((conflict) => (
                                <li
                                  key={`${conflict.segmentIndex}-${conflict.kind}`}
                                >
                                  Segment {conflict.segmentIndex + 1}:{' '}
                                  {conflict.message}
                                </li>
                              ))}
                            </ul>
                            <Row>
                              {overwriteable && (
                                <Button
                                  compact
                                  variant="secondary"
                                  icon="edit"
                                  onClick={() =>
                                    setOverwrite(selectedItem.id, true)
                                  }
                                >
                                  Overwrite existing files
                                </Button>
                              )}
                              <Button
                                compact
                                variant="secondary"
                                icon="delete"
                                disabled={
                                  conflictIndexes.size === 0 ||
                                  remaining.length === 0
                                }
                                title={
                                  remaining.length === 0
                                    ? 'Dropping every conflicting segment would skip this split; use Skip this split.'
                                    : undefined
                                }
                                onClick={() =>
                                  skipSegments(selectedItem.id, [
                                    ...conflictIndexes,
                                  ])
                                }
                              >
                                Drop conflicting segment
                                {conflictIndexes.size === 1 ? '' : 's'} (
                                {conflictIndexes.size})
                              </Button>
                              <Button
                                compact
                                variant="ghost"
                                icon="close"
                                onClick={() => skipSplit(selectedItem.id)}
                              >
                                Skip this split
                              </Button>
                            </Row>
                          </>
                        )}
                        {selectedPlan.overwrite && (
                          <Row>
                            <Muted>
                              Existing files at these targets will be replaced
                              when you Apply.
                            </Muted>
                            <Button
                              compact
                              variant="ghost"
                              onClick={() =>
                                setOverwrite(selectedItem.id, false)
                              }
                            >
                              Undo overwrite
                            </Button>
                          </Row>
                        )}
                        {selectedSkipped.size > 0 && (
                          <Muted>
                            {selectedSkipped.size} segment
                            {selectedSkipped.size === 1 ? '' : 's'} will not be
                            written. The split's original-file setting still
                            applies to the source afterward.
                          </Muted>
                        )}
                      </ConflictPanel>
                    );
                  })()}
                  {selectedPlan.segments.map((segment, index) => {
                    const target = selectedReport?.segments[index]?.targetPath;
                    const defaultTarget =
                      selectedReport?.defaultTargets?.[index];
                    const defaultOutputName = defaultTarget
                      ? pathBasename(defaultTarget)
                      : '';
                    const skippedSegment = selectedSkipped.has(segment.index);
                    const segmentConflicts = selectedConflicts.filter(
                      (conflict) => conflict.segmentIndex === segment.index,
                    );
                    const targetExists = Boolean(
                      target &&
                        existingTargetKeys.has(
                          organizerComparisonKey(target, { caseInsensitive }),
                        ),
                    );
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
                      <Card
                        key={`${selectedItem.id}-${index}`}
                        $assigned={Boolean(segment.episode) && !skippedSegment}
                      >
                        <header>
                          <span>Segment {index + 1}</span>
                          <Muted>
                            {formatDuration(
                              segment.endSeconds - segment.startSeconds,
                            )}{' '}
                            · {formatSplitTimecode(segment.startSeconds, true)}{' '}
                            – {formatSplitTimecode(segment.endSeconds, true)}
                          </Muted>
                        </header>
                        {skippedSegment ? (
                          <SegmentWarning $muted>
                            <Icon name="pending" size="xs" tone="warning" />
                            <span className="hb-segment-message">
                              Skipped — no file is written for this segment. The
                              split's original-file setting still applies
                              afterward.
                            </span>
                            <Button
                              compact
                              variant="ghost"
                              onClick={() =>
                                restoreSegment(selectedItem.id, segment.index)
                              }
                            >
                              Restore segment
                            </Button>
                          </SegmentWarning>
                        ) : segmentConflicts.length > 0 ? (
                          <SegmentWarning role="alert">
                            <Icon name="failures" size="xs" tone="danger" />
                            <span className="hb-segment-message">
                              {segmentConflicts
                                .map((conflict) => conflict.message)
                                .join(' ')}
                            </span>
                            {segmentConflicts.some(
                              (conflict) => conflict.overwriteable,
                            ) &&
                              !selectedPlan.overwrite && (
                                <Button
                                  compact
                                  variant="ghost"
                                  onClick={() =>
                                    setOverwrite(selectedItem.id, true)
                                  }
                                >
                                  Overwrite file
                                </Button>
                              )}
                            <Button
                              compact
                              variant="ghost"
                              onClick={() =>
                                skipSegments(selectedItem.id, [segment.index])
                              }
                            >
                              Drop segment
                            </Button>
                          </SegmentWarning>
                        ) : null}
                        {!skippedSegment &&
                          selectedPlan.overwrite &&
                          targetExists && (
                            <Muted>
                              This existing file will be replaced on Apply.
                            </Muted>
                          )}
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
                              title="Choose an episode outside this file's detected range"
                              aria-label={`Select other episode for segment ${index + 1}`}
                              onClick={() =>
                                openOtherEpisode(
                                  selectedItem,
                                  index,
                                  segment.episode,
                                )
                              }
                            >
                              Other episode
                            </Button>
                          </ControlTip>
                        </Row>
                        <CardActions>
                          {index < selectedPlan.segments.length - 1 && (
                            <ControlTip
                              label="Merge with next"
                              content={
                                <>
                                  Removes the cut after this segment, joining it
                                  with the next one. The confirmation dialog can
                                  merge several following segments at once.
                                  Merging keeps this segment's episode and
                                  filename.
                                </>
                              }
                            >
                              <Button
                                compact
                                variant="secondary"
                                icon="moveDown"
                                disabled={selectedPlan.segments.length <= 2}
                                title={
                                  selectedPlan.segments.length <= 2
                                    ? 'Merging the last two segments leaves no split; use Remove this split.'
                                    : undefined
                                }
                                onClick={() => {
                                  const remaining =
                                    selectedPlan.segments.length - index - 1;
                                  const mergeMax = Math.min(
                                    remaining,
                                    selectedPlan.segments.length - 2,
                                  );
                                  setMergeCount(
                                    suggestedMergeCount(
                                      selectedPlan.segments,
                                      index,
                                      mergeMax,
                                      selectedPlan.episodeDurationsSeconds?.[
                                        index
                                      ] ?? 0,
                                    ) || 1,
                                  );
                                  setMergeRequest({
                                    itemId: selectedItem.id,
                                    index,
                                  });
                                }}
                              >
                                Merge with next (
                                {formatDuration(
                                  selectedPlan.segments[index + 1].endSeconds -
                                    selectedPlan.segments[index + 1]
                                      .startSeconds,
                                )}
                                )
                              </Button>
                            </ControlTip>
                          )}
                          <ControlTip
                            label="Jump to segment start"
                            content={
                              <>
                                Pans the filmstrip so this segment's first frame
                                is centered and moves the playhead there, ready
                                to inspect.
                              </>
                            }
                          >
                            <Button
                              compact
                              variant="ghost"
                              icon="jumpStart"
                              aria-label={`Jump to start of segment ${index + 1}`}
                              onClick={() =>
                                jumpToSegmentStart(
                                  selectedItem.id,
                                  segment.startSeconds,
                                )
                              }
                            >
                              Jump start
                            </Button>
                          </ControlTip>
                          <ControlTip
                            label="Jump to segment end"
                            content={
                              <>
                                Pans the filmstrip so this segment's last frame
                                is centered and moves the playhead there, ready
                                to inspect the cut that ends it.
                              </>
                            }
                          >
                            <Button
                              compact
                              variant="ghost"
                              icon="jumpEnd"
                              aria-label={`Jump to end of segment ${index + 1}`}
                              onClick={() =>
                                jumpToSegmentEnd(
                                  selectedItem.id,
                                  segment.endSeconds,
                                )
                              }
                            >
                              Jump end
                            </Button>
                          </ControlTip>
                        </CardActions>
                        <CardDetails>
                          <summary
                            aria-label={`Segment ${index + 1} cut, filename and more`}
                          >
                            Cut, filename &amp; more
                          </summary>
                          <div>
                            <Row>
                              <ControlTip
                                label="Output filename"
                                style={{ flex: '1 1 220px' }}
                                content={
                                  <>
                                    Overrides the filename the naming rule
                                    produced for this segment. The folder still
                                    comes from the rule. Leave it empty, or use
                                    the default name, to go back. A name without
                                    an extension keeps the source extension.
                                  </>
                                }
                              >
                                <Form.Control
                                  size="sm"
                                  aria-label={`Output filename for segment ${index + 1}`}
                                  defaultValue={
                                    segment.outputName ?? defaultOutputName
                                  }
                                  key={`${selectedItem.id}-${index}-${segment.outputName ?? ''}-${defaultOutputName}`}
                                  placeholder={
                                    defaultOutputName || 'Output filename'
                                  }
                                  style={{ minWidth: 0 }}
                                  onBlur={(event) =>
                                    setOutputName(
                                      selectedItem.id,
                                      index,
                                      event.target.value,
                                      defaultTarget,
                                    )
                                  }
                                  onKeyDown={(event) => {
                                    if (event.key !== 'Enter') return;
                                    setOutputName(
                                      selectedItem.id,
                                      index,
                                      (event.target as HTMLInputElement).value,
                                      defaultTarget,
                                    );
                                  }}
                                />
                              </ControlTip>
                              {segment.outputName && (
                                <Button
                                  compact
                                  variant="ghost"
                                  icon="reset"
                                  iconOnly
                                  title="Use the default filename"
                                  aria-label={`Use the default filename for segment ${index + 1}`}
                                  onClick={() =>
                                    setOutputName(
                                      selectedItem.id,
                                      index,
                                      '',
                                      defaultTarget,
                                    )
                                  }
                                />
                              )}
                            </Row>
                            {index > 0 && (
                              <CutRow>
                                <label htmlFor={`cut-time-${index}`}>Cut</label>
                                <input
                                  id={`cut-time-${index}`}
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
                                      moveMarker(
                                        selectedItem.id,
                                        index,
                                        parsed,
                                      );
                                    }
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key !== 'Enter') return;
                                    const parsed = parseTimecode(
                                      (event.target as HTMLInputElement).value,
                                    );
                                    if (parsed !== undefined) {
                                      moveMarker(
                                        selectedItem.id,
                                        index,
                                        parsed,
                                      );
                                    }
                                  }}
                                />
                                <NudgeGroup
                                  role="group"
                                  aria-label={`Nudge the cut before segment ${index + 1}`}
                                >
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
                                </NudgeGroup>
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
                              </CutRow>
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
                            <CardActions>
                              <ControlTip
                                label="Split segment"
                                content={
                                  <>
                                    Inserts a cut halfway through this segment,
                                    creating a new segment between its start and
                                    end. Assign an episode to the new segment
                                    before saving.
                                  </>
                                }
                              >
                                <Button
                                  compact
                                  variant="ghost"
                                  icon="split"
                                  aria-label={`Split segment ${index + 1}`}
                                  onClick={() =>
                                    addSplitBetween(selectedItem.id, index)
                                  }
                                >
                                  Split Segment
                                </Button>
                              </ControlTip>
                              {index > 0 && (
                                <ControlTip
                                  label="Remove split"
                                  content={
                                    <>
                                      Removes the cut before this segment and
                                      joins it back onto the previous one. The
                                      previous segment keeps its episode and
                                      filename.
                                    </>
                                  }
                                >
                                  <Button
                                    compact
                                    variant="ghost"
                                    icon="delete"
                                    aria-label={`Remove split before segment ${index + 1}`}
                                    onClick={() =>
                                      removeSplitAt(selectedItem.id, index)
                                    }
                                  >
                                    Remove split
                                  </Button>
                                </ControlTip>
                              )}
                            </CardActions>
                          </div>
                        </CardDetails>
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
              {approvedConflictCount > 0 && (
                <Button
                  compact
                  variant="danger"
                  icon="delete"
                  style={{ marginTop: 'var(--hb-space-xs)' }}
                  onClick={() => void save(true)}
                >
                  Skip conflicts and save approved
                </Button>
              )}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Muted style={{ marginRight: 'auto' }}>
            Only approved splits are queued. Unapproved edits stay here as a
            draft and a queued split stays queued; nothing changes on disk until
            Apply.
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
            onClick={() => void save()}
            disabled={!hasWork}
          >
            Save approved ({approvedCount})
          </Button>
        </Modal.Footer>
      </Modal>
      {mergeRequest &&
        (() => {
          const mergePlan = states[mergeRequest.itemId]?.plan;
          if (!mergePlan) return null;
          const { itemId, index } = mergeRequest;
          const segments = mergePlan.segments;
          const remaining = segments.length - index - 1;
          const maxCount = Math.min(remaining, segments.length - 2);
          if (maxCount < 1) return null;
          const count = Math.min(Math.max(1, mergeCount), maxCount);
          const survivor = segments[index];
          const last = segments[index + count];
          const suggested = suggestedMergeCount(
            segments,
            index,
            maxCount,
            mergePlan.episodeDurationsSeconds?.[index] ?? 0,
          );
          const runtimeMinutes =
            survivor.episode?.runtimeMinutes ??
            (mergePlan.episodeDurationsSeconds?.[index]
              ? mergePlan.episodeDurationsSeconds[index]! / 60
              : undefined);
          const mergedRange = segments.slice(index, index + count + 1);
          const followingRange = segments.slice(
            index + count + 1,
            index + count + 5,
          );
          const mergedSeconds = mergedRange.reduce(
            (total, segment) => total + segmentDurationSeconds(segment),
            0,
          );
          const followingSeconds = followingRange.reduce(
            (total, segment) => total + segmentDurationSeconds(segment),
            0,
          );
          const previewScale =
            mergedSeconds + followingSeconds > 0
              ? 100 / (mergedSeconds + followingSeconds)
              : 0;
          const mergedEpisodes = segments
            .slice(index, index + count + 1)
            .map((segment) => segment.episode?.tag)
            .filter((tag): tag is string => Boolean(tag));
          const skippedIndexes = new Set(mergePlan.skippedSegments ?? []);
          const survivorSkipped = skippedIndexes.has(survivor.index);
          const anyActive = segments
            .slice(index, index + count + 1)
            .some((segment) => !skippedIndexes.has(segment.index));
          return (
            <Modal
              show
              onHide={() => setMergeRequest(undefined)}
              centered
              size="sm"
            >
              <Modal.Header closeButton>
                <Modal.Title style={{ fontSize: 'var(--hb-font-md)' }}>
                  Merge segments
                </Modal.Title>
              </Modal.Header>
              <Modal.Body
                style={{ display: 'grid', gap: 'var(--hb-space-sm)' }}
              >
                <strong>
                  Merge segment {index + 1} with the next {count} segment
                  {count === 1 ? '' : 's'}?
                </strong>
                <Muted style={{ whiteSpace: 'normal' }}>
                  This removes {count} cut{count === 1 ? '' : 's'} after{' '}
                  {formatSplitTimecode(survivor.startSeconds, true)}. The
                  combined segment runs{' '}
                  {formatSplitTimecode(survivor.startSeconds, true)} –{' '}
                  {formatSplitTimecode(last.endSeconds, true)} (
                  {formatDuration(last.endSeconds - survivor.startSeconds)}).
                </Muted>
                <MergePreview role="img" aria-label="Merge preview">
                  {mergedRange.map((segment, offset) => (
                    <MergePreviewBlock
                      key={`merged-${segment.index}`}
                      $merged
                      style={{
                        flexGrow: Math.max(
                          1,
                          segmentDurationSeconds(segment) * previewScale,
                        ),
                      }}
                      title={`Segment ${index + offset + 1} merges in (${formatDuration(
                        segmentDurationSeconds(segment),
                      )})`}
                    >
                      {index + offset + 1}
                    </MergePreviewBlock>
                  ))}
                  {followingRange.map((segment, offset) => (
                    <MergePreviewBlock
                      key={`following-${segment.index}`}
                      $merged={false}
                      style={{
                        flexGrow: Math.max(
                          1,
                          segmentDurationSeconds(segment) * previewScale,
                        ),
                      }}
                      title={`Segment ${index + count + offset + 2} stays separate (${formatDuration(
                        segmentDurationSeconds(segment),
                      )})`}
                    >
                      {index + count + offset + 2}
                    </MergePreviewBlock>
                  ))}
                </MergePreview>
                <MergeLegend>
                  <span>
                    <MergeSwatch $merged /> Merged into one output (
                    {formatDuration(mergedSeconds)})
                  </span>
                  <span>
                    <MergeSwatch $merged={false} /> Stays separate
                    {followingRange.length > 0
                      ? ` (${formatDuration(followingSeconds)})`
                      : ''}
                  </span>
                </MergeLegend>
                {runtimeMinutes ? (
                  <Muted style={{ whiteSpace: 'normal' }}>
                    {survivor.episode?.tag} is listed at{' '}
                    {formatDuration(runtimeMinutes * 60)}. Merging{' '}
                    {suggested + 1} segments fits that runtime
                    {suggested === count ? ' and is selected' : ''}.
                  </Muted>
                ) : (
                  <Muted style={{ whiteSpace: 'normal' }}>
                    No runtime is listed for this episode, so the merge length
                    is not suggested.
                  </Muted>
                )}
                <Form.Label
                  htmlFor={`merge-count-${itemId}`}
                  style={{ margin: 0, fontSize: 'var(--hb-font-sm)' }}
                >
                  Segments to merge
                </Form.Label>
                <Form.Control
                  id={`merge-count-${itemId}`}
                  type="number"
                  min={1}
                  max={maxCount}
                  value={count}
                  onChange={(event) =>
                    setMergeCount(
                      Math.min(
                        maxCount,
                        Math.max(1, Number(event.target.value) || 1),
                      ),
                    )
                  }
                  style={{ width: 110 }}
                />
                <Muted style={{ whiteSpace: 'normal' }}>
                  Segment {index + 1} keeps{' '}
                  {survivor.episode ? survivor.episode.tag : 'no episode'}.
                  {mergedEpisodes.length > 1
                    ? ` The merged episodes (${mergedEpisodes.join(', ')}) become one output.`
                    : ''}{' '}
                  You can merge up to {maxCount} following segment
                  {maxCount === 1 ? '' : 's'}.
                </Muted>
                {survivorSkipped && anyActive && (
                  <Muted style={{ whiteSpace: 'normal' }}>
                    Segment {index + 1} is currently dropped. Merging it with an
                    active segment makes the combined segment active again.
                  </Muted>
                )}
              </Modal.Body>
              <Modal.Footer>
                <Button
                  variant="ghost"
                  onClick={() => setMergeRequest(undefined)}
                >
                  Cancel
                </Button>
                <Button
                  variant="success"
                  icon="moveDown"
                  onClick={() => mergeSegments(itemId, index, count)}
                >
                  Merge {count + 1} segments
                </Button>
              </Modal.Footer>
            </Modal>
          );
        })()}
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
