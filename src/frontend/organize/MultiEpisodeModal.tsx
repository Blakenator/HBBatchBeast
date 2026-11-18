import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import styled from 'styled-components';
import { Alert, Form, Modal, Spinner } from 'react-bootstrap';
import {
  PROMISE_CHANNEL,
  detectEpisodeRunFromName,
  diffTargetName,
  episodeRangeTag,
  episodeSelectionTag,
  episodesForStart,
  groupItemsForSequence,
  parseMediaFilename,
  planItemSeason,
  planItemStartEpisode,
  previewTargetForItem,
  rebaseSequenceBase,
  sequenceStarts,
  seriesForPlanItem,
  type Library,
  type MediaType,
  type OrganizeMatchOverride,
  type OrganizePlanItem,
  type OrganizeSettings,
  type ParsedMediaName,
  type TvdbEpisode,
  type TvdbSeriesRef,
} from '../../common';
import { useBackend } from '../helpers';
import { SegmentedControl } from '../settings/SegmentedControl';
import { Button, IconButton } from '../ui/Button';
import { MatchBadge } from './MatchBadge';
import { DiffSegments } from './NameDiff';
import { WideDialog } from './WideDialog';

type MultiEpisodeMode = 'detect' | 'sequential' | 'existing';

const MODES: { value: MultiEpisodeMode; label: string; description: string }[] = [
  {
    value: 'detect',
    label: 'Detect from filename',
    description:
      'Uses the episode tag plus the episode titles in the filename. When the title names several consecutive episodes, the whole run is filled in.',
  },
  {
    value: 'sequential',
    label: 'Sequential',
    description:
      'Renumbers the selected files in order. Every file takes the same number of episodes, and each show/season starts at E01 unless you change it below.',
  },
  {
    value: 'existing',
    label: 'Keep current numbering',
    description:
      'Keeps each file’s current episode number and adds the following episodes to the end of the range.',
  },
];

const MIN_EPISODES = 2;
const MAX_EPISODES = 10;

type ResizableColumn = 'current' | 'next' | 'match';

const RESIZABLE_COLUMNS: { key: ResizableColumn; label: string }[] = [
  { key: 'current', label: 'Current name' },
  { key: 'next', label: 'New name' },
  { key: 'match', label: 'Match' },
];

const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumn, number> = {
  current: 340,
  next: 400,
  match: 260,
};
const MIN_COLUMN_WIDTH = 120;
const MAX_COLUMN_WIDTH = 900;
const FIXED_CHECK_WIDTH = 22;
const FIXED_ACTION_WIDTH = 84;
/** Matches `var(--hb-space-sm)`; used only to seed the column widths. */
const COLUMN_GAP = 8;
/** The header's `var(--hb-space-sm)` left and right padding. */
const PREVIEW_SIDE_PADDING = 16;

function clampColumnWidth(width: number): number {
  return Math.round(
    Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)),
  );
}

const Preview = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
  max-height: 58vh;
  overflow: auto;
  padding-right: 2px;
`;

const PreviewHead = styled.div`
  position: sticky;
  top: 0;
  z-index: 1;
  display: grid;
  gap: var(--hb-space-sm);
  align-items: center;
  padding: var(--hb-space-xs) var(--hb-space-sm);
  background: var(--hb-surface);
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

const HeaderCell = styled.span`
  position: relative;
  min-width: 0;
  padding-right: var(--hb-space-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ColumnResizer = styled.span`
  position: absolute;
  top: 50%;
  right: calc(var(--hb-space-xs) * -1);
  width: 9px;
  height: 18px;
  transform: translateY(-50%);
  border-radius: 2px;
  cursor: col-resize;
  touch-action: none;

  &::after {
    content: '';
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 4px;
    width: 1px;
    background: var(--hb-border);
  }

  &:hover::after,
  &:focus-visible::after {
    width: 2px;
    background: var(--hb-accent);
  }
`;

const GroupHeader = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
  padding: var(--hb-space-xs) var(--hb-space-sm) 0;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  font-weight: 600;

  label {
    display: inline-flex;
    align-items: center;
    gap: var(--hb-space-xs);
    font-weight: 400;
  }

  input {
    width: 64px;
  }
`;

const PreviewRow = styled.div<{
  $problem: boolean;
  $disabled: boolean;
}>`
  display: grid;
  gap: var(--hb-space-sm);
  align-items: start;
  padding: var(--hb-space-xs) var(--hb-space-sm);
  border: 1px solid
    ${({ $problem }) =>
      $problem ? 'var(--hb-danger)' : 'var(--hb-border)'};
  border-radius: var(--hb-radius-sm);
  background: ${({ $problem, $disabled }) =>
    $problem
      ? 'color-mix(in srgb, var(--hb-danger) 10%, var(--hb-surface))'
      : $disabled
        ? 'var(--hb-surfaceMuted)'
        : 'var(--hb-surface)'};
  font-size: var(--hb-font-sm);
  opacity: ${({ $disabled }) => ($disabled ? 0.75 : 1)};
`;

const NameCell = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
`;

const NameLine = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowTag = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const NewTag = styled.strong`
  color: var(--hb-accent);
`;

const MatchCell = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
  min-width: 0;
  justify-items: start;
`;

const Status = styled.span<{ $color: string }>`
  color: ${({ $color }) => $color};
  font-size: var(--hb-font-xs);
  overflow-wrap: anywhere;
`;

const CountRow = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;

  input {
    width: 84px;
  }
`;

interface PreviewRowModel {
  item: OrganizePlanItem;
  series?: TvdbSeriesRef;
  seasonNumber?: number;
  startNumber?: number;
  episodes?: TvdbEpisode[];
  tag?: string;
  problem?: string;
  alreadyMatches: boolean;
  targetPath?: string;
  rowIndex?: number;
  groupKey?: string;
}

interface PreparedRow {
  item: OrganizePlanItem;
  series?: TvdbSeriesRef;
  catalog: TvdbEpisode[];
  parsed: ParsedMediaName;
  problem?: string;
}

interface MultiEpisodeModalProps {
  items: OrganizePlanItem[];
  mediaType: MediaType;
  settings: OrganizeSettings;
  library: Library;
  onClose: () => void;
  onApply: (overrides: Map<string, OrganizeMatchOverride>) => void;
  /** Opens the shared Fix match dialog for one row. */
  onFixMatch: (item: OrganizePlanItem) => void;
}

function fileNameOf(item: OrganizePlanItem): string {
  const value = item.sourceRelativePath || item.sourcePath;
  return value.split(/[\\/]+/).pop() ?? value;
}

function pad(value: number | undefined): string {
  return value === undefined ? '' : String(value).padStart(2, '0');
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return MIN_EPISODES;
  return Math.min(MAX_EPISODES, Math.max(MIN_EPISODES, Math.trunc(value)));
}

/**
 * Batch multi-episode editor. It never touches the filesystem: it derives the
 * episode run for each selected row and hands the resulting match overrides to
 * the review page, which persists them and re-plans locally.
 */
export const MultiEpisodeModal: React.FC<MultiEpisodeModalProps> = ({
  items,
  mediaType,
  settings,
  library,
  onClose,
  onApply,
  onFixMatch,
}) => {
  const [mode, setMode] = useState<MultiEpisodeMode>('detect');
  const [episodesPerFile, setEpisodesPerFile] = useState(MIN_EPISODES);
  const [baseByGroup, setBaseByGroup] = useState<Record<string, number>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [columnWidths, setColumnWidths] =
    useState<Record<ResizableColumn, number>>(DEFAULT_COLUMN_WIDTHS);
  const previewRef = useRef<HTMLDivElement>(null);
  const autoSizedColumns = useRef(false);
  const resizeState = useRef<{
    column: ResizableColumn;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [episodesBySlug, setEpisodesBySlug] = useState<
    Record<string, TvdbEpisode[]>
  >({});
  const [episodeErrors, setEpisodeErrors] = useState<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const loadEpisodes = useBackend({
    channel: PROMISE_CHANNEL.OrganizeLoadEpisodes,
    skip: true,
  });

  const seriesByItem = useMemo(
    () =>
      new Map(
        items.map((item) => [item.id, seriesForPlanItem(item, settings, library)]),
      ),
    [items, library, settings],
  );
  const slugs = useMemo(
    () => [...new Set([...seriesByItem.values()].flatMap((series) => series ? [series.slug] : []))],
    [seriesByItem],
  );
  const slugKey = slugs.join('\n');

  useEffect(() => {
    let cancelled = false;
    if (slugs.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setEpisodeErrors({});
    void Promise.all(
      slugs.map(async (slug) => {
        try {
          const result = await loadEpisodes.refetch({ slug });
          if (cancelled) return;
          if (result?.error) {
            setEpisodeErrors((current) => ({
              ...current,
              [slug]: result.error?.message ?? 'Episode lookup failed',
            }));
            return;
          }
          setEpisodesBySlug((current) => ({
            ...current,
            [slug]: result?.data ?? [],
          }));
        } catch (error) {
          if (cancelled) return;
          setEpisodeErrors((current) => ({
            ...current,
            [slug]: error instanceof Error ? error.message : String(error),
          }));
        }
      }),
    ).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // The slug list decides what has to be loaded.
  }, [slugKey]);

  const prepared = useMemo<PreparedRow[]>(
    () =>
      items.map((item) => {
        const series = seriesByItem.get(item.id);
        const catalog = series ? (episodesBySlug[series.slug] ?? []) : [];
        const parsed =
          item.parsed ??
          parseMediaFilename(fileNameOf(item), item.sourceRelativePath);
        let problem: string | undefined;
        if (!series) {
          problem = 'No show matched — set one with Fix match first.';
        } else if (episodeErrors[series.slug]) {
          problem = `Could not load episodes for ${series.name}.`;
        } else if (!loading && catalog.length === 0) {
          problem = `No TVDB episodes were found for ${series.name}.`;
        }
        return {
          item,
          ...(series ? { series } : {}),
          catalog,
          parsed,
          ...(problem ? { problem } : {}),
        };
      }),
    [episodeErrors, episodesBySlug, items, loading, seriesByItem],
  );

  const buildRow = (
    row: PreparedRow,
    options: {
      seasonNumber?: number;
      startNumber?: number;
      episodes?: TvdbEpisode[];
      problem?: string;
      rowIndex?: number;
      groupKey?: string;
    } = {},
  ): PreviewRowModel => {
    const { item } = row;
    const problem = row.problem ?? options.problem;
    if (problem) return { item, series: row.series, problem, alreadyMatches: false };

    const episodes =
      options.episodes ??
      (() => {
        const season =
          options.seasonNumber ?? row.parsed.seasonNumber ?? planItemSeason(item);
        const start = options.startNumber ?? planItemStartEpisode(item);
        if (start === undefined) {
          return undefined;
        }
        const result = episodesForStart(
          row.catalog,
          season,
          start,
          episodesPerFile,
        );
        if (result.problem) {
          return { problem: result.problem.message };
        }
        return result.episodes;
      })();

    if (!episodes) {
      return {
        item,
        series: row.series,
        problem: 'No episode number in the filename — use Sequential instead.',
        alreadyMatches: false,
      };
    }
    if ('problem' in episodes) {
      return {
        item,
        series: row.series,
        problem: episodes.problem,
        alreadyMatches: false,
      };
    }
    if (episodes.length === 0) {
      return {
        item,
        series: row.series,
        problem: 'No episodes were resolved for this file.',
        alreadyMatches: false,
      };
    }

    const seasonNumber = episodes[0].seasonNumber;
    const tag = episodeRangeTag(
      seasonNumber,
      episodes.map((episode) => episode.episodeNumber),
    );
    const currentTag = episodeSelectionTag(item.episode, item.parsed, item.episodes);
    const alreadyMatches = Boolean(tag) && tag === currentTag;
    const override: OrganizeMatchOverride = {
      ...(row.series ? { series: row.series } : {}),
      episode: episodes[0],
      episodes,
    };
    const target = previewTargetForItem(item, override, {
      settings,
      mediaType,
      caseInsensitive: settings.caseInsensitive ?? false,
    });
    return {
      item,
      series: row.series,
      seasonNumber,
      startNumber: episodes[0].episodeNumber,
      episodes,
      tag,
      alreadyMatches,
      ...(options.rowIndex !== undefined ? { rowIndex: options.rowIndex } : {}),
      ...(options.groupKey ? { groupKey: options.groupKey } : {}),
      ...(target ? { targetPath: target } : {}),
    };
  };

  const detectedRows = useMemo<PreviewRowModel[]>(() => {
    if (mode !== 'detect') return [];
    return prepared.map((row) => {
      if (row.problem) return buildRow(row);
      const season =
        row.parsed.seasonNumber ?? planItemSeason(row.item);
      const run =
        season === undefined
          ? undefined
          : detectEpisodeRunFromName(
              season === row.parsed.seasonNumber
                ? row.parsed
                : { ...row.parsed, seasonNumber: season },
              row.catalog,
              {
                seriesName: row.series?.name,
                preferredEpisodeNumber: planItemStartEpisode(row.item),
              },
            );
      if (!run) {
        return {
          item: row.item,
          series: row.series,
          problem: 'No multi-episode title detected.',
          alreadyMatches: false,
        };
      }
      return buildRow(row, {
        seasonNumber: run.seasonNumber,
        episodes: run.episodes,
      });
    });
    // The builder is pure over the inputs listed here.
  }, [episodeErrors, episodesBySlug, episodesPerFile, mode, prepared, settings]);

  const existingRows = useMemo<PreviewRowModel[]>(() => {
    if (mode !== 'existing') return [];
    return prepared.map((row) =>
      buildRow(row, {
        seasonNumber: planItemSeason(row.item) ?? row.parsed.seasonNumber,
        startNumber: planItemStartEpisode(row.item),
      }),
    );
    // The builder is pure over the inputs listed here.
  }, [episodeErrors, episodesBySlug, episodesPerFile, mode, prepared, settings]);

  const sequence = useMemo(() => {
    if (mode !== 'sequential') return undefined;
    const grouping = groupItemsForSequence(items);
    const starts = sequenceStarts(grouping.groups, episodesPerFile, baseByGroup);
    const byId = new Map(prepared.map((row) => [row.item.id, row]));
    const groups = grouping.groups.map((group) => ({
      key: group.key,
      seriesName: group.seriesName,
      seasonNumber: group.seasonNumber,
      rows: group.items.map((item, rowIndex) => {
        const row = byId.get(item.id);
        return row
          ? buildRow(row, {
              seasonNumber: group.seasonNumber,
              startNumber: starts.get(item.id),
              rowIndex,
              groupKey: group.key,
            })
          : {
              item,
              problem: 'Could not prepare this file.',
              alreadyMatches: false,
            };
      }),
    }));
    const ungrouped = grouping.ungrouped.map((item) => {
      const row = byId.get(item.id);
      return row
        ? buildRow(row, {
            problem:
              'No show or season is known — set them with Fix match first.',
          })
        : {
            item,
            problem: 'Could not prepare this file.',
            alreadyMatches: false,
          };
    });
    return { groups, ungrouped };
    // The builder is pure over the inputs listed here.
  }, [
    baseByGroup,
    episodeErrors,
    episodesBySlug,
    episodesPerFile,
    items,
    mode,
    prepared,
    settings,
  ]);

  const rows = useMemo<PreviewRowModel[]>(() => {
    if (mode === 'detect') return detectedRows;
    if (mode === 'existing') return existingRows;
    if (!sequence) return [];
    return [
      ...sequence.groups.flatMap((group) => group.rows),
      ...sequence.ungrouped,
    ];
  }, [detectedRows, existingRows, mode, sequence]);

  const gridTemplate = `${FIXED_CHECK_WIDTH}px ${columnWidths.current}px ${columnWidths.next}px ${columnWidths.match}px ${FIXED_ACTION_WIDTH}px`;

  // Spread the default widths across the modal's real width once the preview
  // exists, so columns start readable without a horizontal scrollbar.
  useEffect(() => {
    if (autoSizedColumns.current || rows.length === 0) return;
    const width = previewRef.current?.clientWidth ?? 0;
    if (width <= 0) return;
    autoSizedColumns.current = true;
    const available =
      width -
      FIXED_CHECK_WIDTH -
      FIXED_ACTION_WIDTH -
      COLUMN_GAP * 4 -
      PREVIEW_SIDE_PADDING;
    const total =
      DEFAULT_COLUMN_WIDTHS.current +
      DEFAULT_COLUMN_WIDTHS.next +
      DEFAULT_COLUMN_WIDTHS.match;
    if (available < MIN_COLUMN_WIDTH * 3 || total <= 0) return;
    const scale = available / total;
    setColumnWidths({
      current: clampColumnWidth(DEFAULT_COLUMN_WIDTHS.current * scale),
      next: clampColumnWidth(DEFAULT_COLUMN_WIDTHS.next * scale),
      match: clampColumnWidth(DEFAULT_COLUMN_WIDTHS.match * scale),
    });
  }, [rows.length]);

  const beginResize = (
    column: ResizableColumn,
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    resizeState.current = {
      column,
      startX: event.clientX,
      startWidth: columnWidths[column],
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveResize = (event: ReactPointerEvent<HTMLElement>) => {
    const state = resizeState.current;
    if (!state) return;
    const width = clampColumnWidth(
      state.startWidth + event.clientX - state.startX,
    );
    setColumnWidths((current) => ({ ...current, [state.column]: width }));
  };

  const endResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (!resizeState.current) return;
    resizeState.current = null;
    const target = event.currentTarget;
    if (target.hasPointerCapture?.(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
  };

  const nudgeColumn = (column: ResizableColumn, delta: number) => {
    setColumnWidths((current) => ({
      ...current,
      [column]: clampColumnWidth(current[column] + delta),
    }));
  };

  const isChecked = (row: PreviewRowModel): boolean => {
    if (row.problem || !row.episodes) return false;
    if (row.alreadyMatches) return included.has(row.item.id);
    return !excluded.has(row.item.id);
  };

  const toggleRow = (row: PreviewRowModel) => {
    if (row.problem || !row.episodes) return;
    const checked = isChecked(row);
    if (row.alreadyMatches) {
      setIncluded((current) => {
        const next = new Set(current);
        if (checked) next.delete(row.item.id);
        else next.add(row.item.id);
        return next;
      });
      return;
    }
    setExcluded((current) => {
      const next = new Set(current);
      if (checked) next.add(row.item.id);
      else next.delete(row.item.id);
      return next;
    });
  };

  const checkedRows = rows.filter(
    (row) => !row.problem && row.episodes && row.series && isChecked(row),
  );
  const problemRows = rows.filter((row) => Boolean(row.problem)).length;

  const rebaseRow = (
    groupKey: string,
    rowIndex: number,
    desiredStart: number,
  ) => {
    const base = rebaseSequenceBase(episodesPerFile, rowIndex, desiredStart);
    setBaseByGroup((current) => ({ ...current, [groupKey]: base }));
  };

  const apply = () => {
    const overrides = new Map<string, OrganizeMatchOverride>();
    for (const row of checkedRows) {
      if (!row.episodes || !row.series) continue;
      overrides.set(row.item.id, {
        series: row.series,
        episode: row.episodes[0],
        episodes: row.episodes,
      });
    }
    if (overrides.size === 0) return;
    onApply(overrides);
  };

  const modeInfo = MODES.find((entry) => entry.value === mode) ?? MODES[0];

  const renderRow = (row: PreviewRowModel) => {
    const checked = isChecked(row);
    const disabled = Boolean(row.problem) || !row.episodes;
    const currentTag =
      episodeSelectionTag(row.item.episode, row.item.parsed, row.item.episodes) ||
      '—';
    const hasTarget = !row.problem && Boolean(row.targetPath);
    const diff = hasTarget
      ? diffTargetName(row.item.sourcePath, row.targetPath ?? row.item.targetPath)
      : undefined;
    const showStart =
      mode === 'sequential' && row.groupKey && row.rowIndex !== undefined;
    return (
      <PreviewRow
        key={row.item.id}
        $problem={Boolean(row.problem)}
        $disabled={disabled && !row.problem}
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <input
          type="checkbox"
          aria-label={`Include ${row.item.sourceRelativePath}`}
          checked={checked}
          disabled={disabled}
          onChange={() => toggleRow(row)}
        />
        <NameCell>
          <NameLine title={row.item.sourcePath}>
            {diff ? (
              <DiffSegments segments={diff.before} changedStyle="removed" />
            ) : (
              fileNameOf(row.item)
            )}
          </NameLine>
        </NameCell>
        <NameCell>
          {diff ? (
            <NameLine title={row.targetPath}>
              <DiffSegments segments={diff.after} changedStyle="added" />
            </NameLine>
          ) : (
            <NameLine style={{ color: 'var(--hb-textMuted)' }}>—</NameLine>
          )}
          {showStart ? (
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--hb-space-xs)',
                fontSize: 'var(--hb-font-xs)',
                color: 'var(--hb-textMuted)',
              }}
            >
              Starts at E
              <input
                className="form-control form-control-sm"
                type="number"
                min={1 + (row.rowIndex ?? 0) * episodesPerFile}
                step={1}
                inputMode="numeric"
                aria-label={`Start episode for ${row.item.sourceRelativePath}`}
                value={row.startNumber ?? 1}
                style={{ width: 64, height: 24, padding: '0 4px' }}
                onChange={(event) =>
                  rebaseRow(
                    row.groupKey!,
                    row.rowIndex!,
                    Number(event.target.value),
                  )
                }
              />
            </label>
          ) : null}
        </NameCell>
        <MatchCell>
          <RowTag title={`${currentTag}${row.tag ? ` → ${row.tag}` : ''}`}>
            {currentTag}
            {row.tag && row.tag !== currentTag ? (
              <>
                {' → '}
                <NewTag>{row.tag}</NewTag>
              </>
            ) : null}
          </RowTag>
          <MatchBadge
            confidence={row.item.confidence}
            threshold={settings.confidenceThreshold}
            summary={row.item.episodeMatch}
            reason={row.item.reason}
            label={currentTag === '—' ? 'Match' : currentTag}
          />
          {row.problem ? (
            <Status $color="var(--hb-danger)">{row.problem}</Status>
          ) : row.alreadyMatches ? (
            <Status $color="var(--hb-textMuted)">Already matches</Status>
          ) : null}
        </MatchCell>
        <IconButton
          icon="edit"
          label={`Fix match for ${row.item.sourceRelativePath}`}
          onClick={() => onFixMatch(row.item)}
        />
      </PreviewRow>
    );
  };

  return (
    <Modal show onHide={onClose} centered dialogAs={WideDialog}>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: 'var(--hb-font-md)' }}>
          Multi-episode files ({items.length} selected)
        </Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ display: 'grid', gap: 'var(--hb-space-md)' }}>
        <SegmentedControl
          label="Multi-episode mode"
          value={mode}
          onChange={(value) =>
            setMode(
              value === 'sequential'
                ? 'sequential'
                : value === 'existing'
                  ? 'existing'
                  : 'detect',
            )
          }
          options={MODES.map((entry) => ({
            value: entry.value,
            label: entry.label,
            title: entry.description,
          }))}
        />
        <span
          style={{
            color: 'var(--hb-textMuted)',
            fontSize: 'var(--hb-font-sm)',
            whiteSpace: 'normal',
          }}
        >
          {modeInfo.description} The ranges are saved on this library, like a
          Fix match, so later scans keep them.
        </span>

        {mode !== 'detect' && (
          <CountRow>
            <Form.Label className="mb-0" htmlFor="multi-episode-count">
              Episodes per file
            </Form.Label>
            <Form.Control
              id="multi-episode-count"
              type="number"
              min={MIN_EPISODES}
              max={MAX_EPISODES}
              step={1}
              inputMode="numeric"
              value={episodesPerFile}
              onChange={(event) =>
                setEpisodesPerFile(clampCount(Number(event.target.value)))
              }
            />
            {mode === 'sequential' && (
              <span
                style={{
                  color: 'var(--hb-textMuted)',
                  fontSize: 'var(--hb-font-xs)',
                }}
              >
                Each show/season starts at E01; editing a start number cascades
                to the files after it.
              </span>
            )}
          </CountRow>
        )}

        {loading && (
          <span role="status" aria-live="polite" style={{ color: 'var(--hb-textMuted)' }}>
            <Spinner size="sm" animation="border" /> Loading episodes for{' '}
            {slugs.length} show(s)…
          </span>
        )}

        {!loading && slugs.length === 0 && (
          <Alert variant="warning" className="mb-0">
            None of the selected files has a matched show. Set the show with Fix
            match first.
          </Alert>
        )}

        {!loading && rows.length > 0 && (
          <Preview ref={previewRef} aria-label="Multi-episode preview">
            <PreviewHead style={{ gridTemplateColumns: gridTemplate }}>
              <span />
              {RESIZABLE_COLUMNS.map(({ key, label }) => (
                <HeaderCell key={key}>
                  {label}
                  <ColumnResizer
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${label} column`}
                    tabIndex={0}
                    onPointerDown={(event) => beginResize(key, event)}
                    onPointerMove={moveResize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        nudgeColumn(key, -16);
                      } else if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        nudgeColumn(key, 16);
                      }
                    }}
                  />
                </HeaderCell>
              ))}
              <span />
            </PreviewHead>
            {mode === 'sequential' && sequence
              ? sequence.groups.map((group) => (
                  <React.Fragment key={group.key}>
                    <GroupHeader>
                      <span>
                        {group.seriesName} · Season {pad(group.seasonNumber)}
                      </span>
                      <label>
                        Start at E
                        <input
                          className="form-control form-control-sm"
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          aria-label={`Start episode for ${group.seriesName} Season ${pad(
                            group.seasonNumber,
                          )}`}
                          value={baseByGroup[group.key] ?? 1}
                          style={{ height: 24, padding: '0 4px' }}
                          onChange={(event) =>
                            setBaseByGroup((current) => ({
                              ...current,
                              [group.key]: Math.max(
                                1,
                                Math.trunc(Number(event.target.value) || 1),
                              ),
                            }))
                          }
                        />
                      </label>
                    </GroupHeader>
                    {group.rows.map(renderRow)}
                  </React.Fragment>
                ))
              : rows.map(renderRow)}
            {mode === 'sequential' &&
              sequence?.ungrouped.map(renderRow)}
          </Preview>
        )}

        {rows.length > 0 && checkedRows.length === 0 && (
          <Alert variant="info" className="mb-0">
            {rows.some((row) => row.alreadyMatches && !row.problem)
              ? 'The detected ranges already match the selected files.'
              : 'No file has a usable range yet. Pick another mode or fix the flagged files first.'}
          </Alert>
        )}
        {problemRows > 0 && (
          <span
            style={{
              color: 'var(--hb-textMuted)',
              fontSize: 'var(--hb-font-xs)',
            }}
          >
            {problemRows} file(s) need attention and will be left unchanged.
          </span>
        )}
      </Modal.Body>
      <Modal.Footer style={{ flexWrap: 'wrap', gap: 'var(--hb-space-xs)' }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="success"
          icon="passed"
          onClick={apply}
          disabled={checkedRows.length === 0}
        >
          Apply to {checkedRows.length} file(s)
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
