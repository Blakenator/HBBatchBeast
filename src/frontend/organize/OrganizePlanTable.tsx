import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { OverlayTrigger, Popover } from 'react-bootstrap';
import {
  ColumnDef,
  ColumnOrderState,
  ColumnSizingState,
  ColumnVisibilityState,
  Updater,
  createColumnHelper,
  createSortedRowModel,
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'react-toastify';
import {
  PROMISE_CHANNEL,
  diffNameSegments,
  diffTargetName,
  episodeDisplayTag,
  pathDirname,
  type DiffSegment,
  type MediaType,
  type NamingRule,
  type OrganizePlan,
  type OrganizePlanItem,
  type OrganizeSettings,
  titleComparisonKey,
} from '../../common';
import { useBackend } from '../helpers';
import { Button, IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import type { AppIconName } from '../ui/icons';
import { MatchBadge } from './MatchBadge';

type PlanFilter = 'all' | 'rename' | 'skip' | 'conflict' | 'low' | 'review';

const FILTERS: { value: PlanFilter; label: string }[] = [
  { value: 'all', label: 'All files' },
  { value: 'rename', label: 'Will rename' },
  { value: 'skip', label: 'Skipped' },
  { value: 'conflict', label: 'Conflicts' },
  { value: 'low', label: 'Low confidence' },
  { value: 'review', label: 'Match review' },
];

const ROW_HEIGHT = 44;
const HEADER_HEIGHT = 34;
const VIEWPORT_HEIGHT = 420;
const OVERSCAN = 6;
const STORAGE_KEY = 'hbb.organizePlanTable.layout.v2';

const DEFAULT_COLUMN_SIZES: Record<string, number> = {
  select: 36,
  show: 150,
  season: 68,
  folder: 220,
  source: 220,
  target: 260,
  match: 180,
  rule: 92,
  action: 90,
  plex: 84,
  fix: 44,
};

const DEFAULT_VISIBILITY: ColumnVisibilityState = {
  plex: false,
};

const DEFAULT_ORDER = Object.keys(DEFAULT_COLUMN_SIZES);

const actionTone: Record<
  OrganizePlanItem['action'],
  { color: string; icon: AppIconName; label: string }
> = {
  rename: { color: 'var(--hb-success)', icon: 'passed', label: 'Rename' },
  skip: { color: 'var(--hb-textMuted)', icon: 'neutral', label: 'Skip' },
  conflict: { color: 'var(--hb-danger)', icon: 'failed', label: 'Conflict' },
};

const Viewport = styled.div`
  height: ${VIEWPORT_HEIGHT}px;
  max-width: 100%;
  overflow: auto;
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surface);
`;

const TableHeader = styled.div`
  position: sticky;
  top: 0;
  z-index: 1;
  display: grid;
  gap: 0;
  align-items: stretch;
  height: ${HEADER_HEIGHT}px;
  background: var(--hb-surfaceMuted);
  border-bottom: 1px solid var(--hb-border);
  font-size: var(--hb-font-xs);
`;

const HeaderCell = styled.div<{ $align?: 'left' | 'right' }>`
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--hb-space-xs);
  min-width: 0;
  padding: 0 var(--hb-space-sm);
  color: var(--hb-textMuted);
  font-weight: 600;
  user-select: none;
  cursor: pointer;
  justify-content: ${({ $align }) =>
    $align === 'right' ? 'flex-end' : 'flex-start'};
  white-space: nowrap;

  &:hover {
    color: var(--hb-text);
    background: var(--hb-surface);
  }

  &:focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: -2px;
  }
`;

const SortMarker = styled.span`
  font-size: 0.6rem;
  color: var(--hb-accent);
`;

const DragHandle = styled.span`
  cursor: grab;
  color: var(--hb-textMuted);
  opacity: 0.7;
  font-size: var(--hb-font-xs);
`;

const ResizeHandle = styled.span<{ $active: boolean }>`
  position: absolute;
  top: 0;
  right: -3px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 2;
  touch-action: none;
  user-select: none;

  &::after {
    content: '';
    position: absolute;
    top: 15%;
    bottom: 15%;
    left: 3px;
    width: 1px;
    background: ${({ $active }) =>
      $active ? 'var(--hb-accent)' : 'var(--hb-border)'};
  }

  &:hover::after {
    background: var(--hb-accent);
    width: 2px;
  }
`;

const Body = styled.div`
  position: relative;
`;

const BodyRow = styled.div<{ $conflict: boolean }>`
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  gap: 0;
  align-items: center;
  height: ${ROW_HEIGHT}px;
  border-bottom: 1px solid var(--hb-border);
  background: ${({ $conflict }) =>
    $conflict
      ? 'color-mix(in srgb, var(--hb-danger) 12%, var(--hb-surface))'
      : 'transparent'};
  box-shadow: ${({ $conflict }) =>
    $conflict ? 'inset 3px 0 0 var(--hb-danger)' : 'none'};
  font-size: var(--hb-font-sm);

  &:hover {
    background: ${({ $conflict }) =>
      $conflict
        ? 'color-mix(in srgb, var(--hb-danger) 18%, var(--hb-surface))'
        : 'var(--hb-surfaceMuted)'};
  }
`;

const Cell = styled.div<{ $align?: 'left' | 'right' }>`
  min-width: 0;
  padding: 0 var(--hb-space-sm);
  overflow: hidden;
  text-align: ${({ $align }) => ($align === 'right' ? 'right' : 'left')};
`;

const EllipsisText = styled.span`
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const NameText = styled(EllipsisText)`
  font-size: var(--hb-font-sm);
`;

const Removed = styled.span`
  color: var(--hb-danger);
  background: color-mix(in srgb, var(--hb-danger) 16%, transparent);
  border-radius: 2px;
  text-decoration: line-through;
`;

const Added = styled.span`
  color: var(--hb-success);
  background: color-mix(in srgb, var(--hb-success) 18%, transparent);
  border-radius: 2px;
  font-weight: 600;
`;

const Muted = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const StateChip = styled.span<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: ${({ $color }) => $color};
`;

const Toolbar = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  align-items: center;
  margin-bottom: var(--hb-space-sm);
  flex-wrap: wrap;
`;

const FilterButton = styled.button<{ $active: boolean }>`
  border: 1px solid var(--hb-border);
  background: ${({ $active }) =>
    $active ? 'var(--hb-accent)' : 'var(--hb-surface)'};
  color: ${({ $active }) =>
    $active ? 'var(--hb-accentContrast)' : 'var(--hb-text)'};
  border-radius: 999px;
  padding: 0 var(--hb-space-md);
  height: 28px;
  font-size: var(--hb-font-xs);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: 1px;
  }
`;

const MenuRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--hb-space-xs);
  font-size: var(--hb-font-xs);
  padding: 2px 0;

  label {
    display: flex;
    align-items: center;
    gap: var(--hb-space-xs);
  }
`;

const RowActionButton = styled.button`
  display: flex;
  align-items: center;
  width: 100%;
  padding: var(--hb-space-xs) var(--hb-space-sm);
  border: 0;
  border-radius: var(--hb-radius-sm);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--hb-font-xs);
  text-align: left;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--hb-surfaceMuted);
  }

  &:disabled {
    color: var(--hb-textMuted);
    cursor: default;
  }

  &:focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: -2px;
  }
`;

const ColumnsPopover = styled(Popover)`
  min-width: 260px;
`;

const features = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  columnSizingFeature,
  columnResizingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
});

const columnHelper = createColumnHelper<typeof features, OrganizePlanItem>();

interface StoredLayout {
  visibility?: ColumnVisibilityState;
  order?: ColumnOrderState;
  sizing?: ColumnSizingState;
}

function loadLayout(): StoredLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredLayout;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const visibility: ColumnVisibilityState = { ...DEFAULT_VISIBILITY };
    if (parsed.visibility && typeof parsed.visibility === 'object') {
      for (const [key, value] of Object.entries(parsed.visibility)) {
        if (typeof value === 'boolean') visibility[key] = value;
      }
    }
    const requested = Array.isArray(parsed.order)
      ? parsed.order.filter((id): id is string => typeof id === 'string')
      : [];
    const order = [
      ...requested.filter((id) => DEFAULT_ORDER.includes(id)),
      ...DEFAULT_ORDER.filter((id) => !requested.includes(id)),
    ];
    const sizing: ColumnSizingState = {};
    if (parsed.sizing && typeof parsed.sizing === 'object') {
      for (const [key, value] of Object.entries(parsed.sizing)) {
        if (typeof value === 'number' && Number.isFinite(value)) sizing[key] = value;
      }
    }
    return { visibility, order, sizing };
  } catch {
    return {};
  }
}

function saveLayout(layout: StoredLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Layout persistence is optional.
  }
}

function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === 'function'
    ? (updater as (value: T) => T)(current)
    : updater;
}

function normalizeOrder(current: ColumnOrderState, ids: string[]): string[] {
  const order = current.filter((id) => ids.includes(id));
  for (const id of ids) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

function splitPath(value: string): { directory: string; name: string } {
  const separator = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  if (separator < 0) return { directory: '', name: value };
  return {
    directory: value.slice(0, separator + 1),
    name: value.slice(separator + 1),
  };
}

function DiffSegments({
  segments,
  changedStyle,
}: {
  segments: DiffSegment[];
  changedStyle: 'removed' | 'added';
}) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.changed ? (
          changedStyle === 'removed' ? (
            <Removed key={index} data-diff="removed">
              {segment.text}
            </Removed>
          ) : (
            <Added key={index} data-diff="added">
              {segment.text}
            </Added>
          )
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </>
  );
}

function ruleLabel(
  item: OrganizePlanItem,
  rules: NamingRule[],
): string {
  const index = rules.findIndex((rule) => rule.id === item.ruleId);
  if (index < 0) return '—';
  const rule = rules[index];
  return index === rules.length - 1 ? 'Default' : rule.name || `Rule ${index + 1}`;
}

const RowActionsMenu: React.FC<{
  item: OrganizePlanItem;
  onFixMatch: (item: OrganizePlanItem) => void;
}> = ({ item, onFixMatch }) => {
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const openFolder = useBackend({
    channel: PROMISE_CHANNEL.OpenFolder,
    skip: true,
  });
  const folder = pathDirname(item.sourcePath);

  const openContainingFolder = async () => {
    setOpen(false);
    if (!folder) {
      toast.error('Could not open folder: the file has no parent folder.');
      return;
    }
    try {
      const result = await openFolder.refetch({ path: folder });
      if (!result || result.error) {
        toast.error(
          result?.error?.message
            ? `Could not open folder: ${result.error.message}`
            : 'Could not open folder.',
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? `Could not open folder: ${error.message}`
          : 'Could not open folder.',
      );
    }
  };

  return (
    <OverlayTrigger
      trigger="click"
      placement="bottom-end"
      show={open}
      onToggle={setOpen}
      rootClose
      overlay={
        <Popover id={popoverId}>
          <Popover.Body style={{ padding: 'var(--hb-space-xs)', minWidth: 150 }}>
            <RowActionButton
              type="button"
              onClick={() => {
                setOpen(false);
                onFixMatch(item);
              }}
            >
              Fix match
            </RowActionButton>
            <RowActionButton
              type="button"
              disabled={!folder}
              onClick={() => void openContainingFolder()}
            >
              Open folder
            </RowActionButton>
          </Popover.Body>
        </Popover>
      }
    >
      <IconButton
        icon="more"
        label={`More actions for ${item.sourceRelativePath}`}
      />
    </OverlayTrigger>
  );
};

interface OrganizePlanTableProps {
  plan: OrganizePlan;
  settings: OrganizeSettings;
  mediaType: MediaType;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  onFixMatch: (item: OrganizePlanItem) => void;
}

/**
 * Review table for an organize plan. Sorting, column sizing/order/visibility
 * and the layout persist the same way as the conversion queue, and long paths
 * are split instead of wrapping.
 */
export const OrganizePlanTable: React.FC<OrganizePlanTableProps> = ({
  plan,
  settings,
  mediaType,
  selected,
  onSelectedChange,
  onFixMatch,
}) => {
  const columnsPopoverId = useId();
  const [filter, setFilter] = useState<PlanFilter>('all');
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  const didDrag = useRef(false);
  const resizingRef = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);

  /**
   * Starts a column resize. Header cells are drag sources for reordering, so
   * the press has to block the native drag the resize gesture would trigger.
   */
  const resizeColumn = (
    event: React.MouseEvent | React.TouchEvent,
    handler: (event: unknown) => void,
  ) => {
    resizingRef.current = true;
    const release = () => {
      resizingRef.current = false;
    };
    window.addEventListener('mouseup', release, { once: true });
    window.addEventListener('touchend', release, { once: true });
    handler(event);
  };

  const defaultVisibility = useMemo<ColumnVisibilityState>(
    () =>
      mediaType === 'tv'
        ? { ...DEFAULT_VISIBILITY }
        : { ...DEFAULT_VISIBILITY, show: false, season: false },
    [mediaType],
  );
  const [initialLayout] = useState(loadLayout);
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(
    initialLayout.visibility ?? defaultVisibility,
  );
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(
    initialLayout.order ?? DEFAULT_ORDER,
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    initialLayout.sizing ?? {},
  );

  useEffect(() => {
    const timer = setTimeout(
      () => saveLayout({ visibility: columnVisibility, order: columnOrder, sizing: columnSizing }),
      250,
    );
    return () => clearTimeout(timer);
  }, [columnVisibility, columnOrder, columnSizing]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const normalizedNeedle = titleComparisonKey(search);
    return plan.items.filter((item) => {
      if (filter === 'rename' && item.action !== 'rename') return false;
      if (filter === 'skip' && item.action !== 'skip') return false;
      if (filter === 'conflict' && item.action !== 'conflict') return false;
      if (
        filter === 'review' &&
        (!item.episodeMatch?.conflict || item.folderOnly || item.noChange)
      ) {
        return false;
      }
      if (
        filter === 'low' &&
        !(
          !item.folderOnly &&
          !item.noChange &&
          item.confidence !== undefined &&
          item.confidence < settings.confidenceThreshold
        )
      ) {
        return false;
      }
      if (!needle) return true;
      return [
        item.sourcePath,
        item.targetPath,
        item.relativeTarget,
        item.showFolder,
        item.seriesName,
        item.episode?.name,
        item.movie?.title,
        item.reason,
      ]
        .filter(Boolean)
        .some((value) => {
          const text = String(value);
          if (text.toLowerCase().includes(needle)) return true;
          return (
            normalizedNeedle.length > 0 &&
            titleComparisonKey(text).includes(normalizedNeedle)
          );
        });
    });
  }, [filter, plan.items, search, settings.confidenceThreshold]);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.display({
          id: 'select',
          header: '',
          size: DEFAULT_COLUMN_SIZES.select,
          enableSorting: false,
          enableHiding: false,
          cell: (info) => {
            const item = info.row.original;
            return (
              <input
                type="checkbox"
                aria-label={`Select ${item.sourcePath}`}
                checked={selected.has(item.id)}
                disabled={item.action !== 'rename'}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(item.id);
                  else next.delete(item.id);
                  onSelectedChange(next);
                }}
              />
            );
          },
        }),
        columnHelper.accessor(
          (row) => row.showFolder ?? row.seriesName ?? '',
          {
            id: 'show',
            header: 'Show',
            size: DEFAULT_COLUMN_SIZES.show,
            sortFn: 'text',
            cell: (info) => (
              <EllipsisText
                title={info.row.original.seriesName ?? info.getValue()}
              >
                {info.getValue() || '—'}
              </EllipsisText>
            ),
          },
        ),
        columnHelper.accessor(
          (row) => row.episode?.seasonNumber ?? row.parsed?.seasonNumber ?? -1,
          {
            id: 'season',
            header: 'Season',
            size: DEFAULT_COLUMN_SIZES.season,
            sortFn: 'basic',
            cell: (info) => {
              const season = info.getValue();
              return season >= 0
                ? `S${String(season).padStart(2, '0')}`
                : '—';
            },
          },
        ),
        columnHelper.accessor(
          (row) =>
            splitPath(row.relativeTarget).directory.replace(/[\\/]+$/, ''),
          {
            id: 'folder',
            header: 'Folder',
            size: DEFAULT_COLUMN_SIZES.folder,
            sortFn: 'text',
            cell: (info) => {
              const item = info.row.original;
              const before = splitPath(item.sourceRelativePath).directory.replace(
                /[\\/]+$/,
                '',
              );
              const after = info.getValue();
              if (!after && !before) return '—';
              const diff = diffNameSegments(before, after);
              if (!diff.changed) {
                return (
                  <EllipsisText
                    title={before || after}
                    style={{
                      color: 'var(--hb-textMuted)',
                      fontSize: 'var(--hb-font-xs)',
                    }}
                  >
                    {after || before}
                  </EllipsisText>
                );
              }
              return (
                <NameText
                  title={`${before || '—'} → ${after || '—'}`}
                  style={{ fontSize: 'var(--hb-font-xs)' }}
                >
                  <DiffSegments segments={diff.before} changedStyle="removed" />
                  {' → '}
                  <DiffSegments segments={diff.after} changedStyle="added" />
                </NameText>
              );
            },
          },
        ),
        columnHelper.accessor((row) => splitPath(row.sourcePath).name, {
          id: 'source',
          header: 'Current name',
          size: DEFAULT_COLUMN_SIZES.source,
          minSize: 120,
          maxSize: 900,
          sortFn: 'text',
          cell: (info) => {
            const item = info.row.original;
            const diff = diffTargetName(item.sourcePath, item.targetPath);
            return (
              <NameText title={item.sourcePath}>
                <DiffSegments segments={diff.before} changedStyle="removed" />
              </NameText>
            );
          },
        }),
        columnHelper.accessor((row) => splitPath(row.relativeTarget).name, {
          id: 'target',
          header: 'New name',
          size: DEFAULT_COLUMN_SIZES.target,
          minSize: 140,
          maxSize: 900,
          sortFn: 'text',
          cell: (info) => {
            const item = info.row.original;
            const diff = diffTargetName(item.sourcePath, item.targetPath);
            return (
              <NameText title={item.targetPath}>
                <DiffSegments segments={diff.after} changedStyle="added" />
              </NameText>
            );
          },
        }),
        columnHelper.accessor((row) => row.confidence ?? 0, {
          id: 'match',
          header: 'Match',
          size: DEFAULT_COLUMN_SIZES.match,
          sortFn: 'basic',
          cell: (info) => {
            const item = info.row.original;
            return (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--hb-space-xs)',
                  minWidth: 0,
                }}
              >
                {item.folderOnly || item.noChange ? (
                  <EllipsisText
                    title={item.reason}
                    style={{
                      color: 'var(--hb-textMuted)',
                      fontSize: 'var(--hb-font-xs)',
                    }}
                  >
                    {item.folderOnly ? 'folder only' : 'unchanged'}
                  </EllipsisText>
                ) : (
                  <MatchBadge
                    confidence={item.confidence}
                    threshold={settings.confidenceThreshold}
                    summary={item.episodeMatch}
                    reason={item.reason}
                    label={
                      item.episode
                        ? episodeDisplayTag(item.episode)
                        : (item.movie?.title ?? 'Match')
                    }
                  />
                )}
                <EllipsisText
                  title={
                    item.episode
                      ? episodeDisplayTag(item.episode)
                      : (item.movie?.title ?? '')
                  }
                  style={{
                    color: 'var(--hb-textMuted)',
                    fontSize: 'var(--hb-font-xs)',
                  }}
                >
                  {item.episode
                    ? episodeDisplayTag(item.episode)
                    : (item.movie?.title ?? '')}
                </EllipsisText>
              </div>
            );
          },
        }),
        columnHelper.accessor((row) => row.ruleId ?? '', {
          id: 'rule',
          header: 'Rule',
          size: DEFAULT_COLUMN_SIZES.rule,
          sortFn: 'text',
          cell: (info) => ruleLabel(info.row.original, settings.namingRules),
        }),
        columnHelper.accessor((row) => row.action, {
          id: 'action',
          header: 'Action',
          size: DEFAULT_COLUMN_SIZES.action,
          sortFn: 'text',
          cell: (info) => {
            const tone = actionTone[info.getValue()];
            return (
              <StateChip $color={tone.color}>
                <Icon name={tone.icon} size="xs" />
                {tone.label}
              </StateChip>
            );
          },
        }),
        columnHelper.accessor((row) => row.plex?.watchCount ?? -1, {
          id: 'plex',
          header: 'Plex',
          size: DEFAULT_COLUMN_SIZES.plex,
          sortFn: 'basic',
          cell: (info) =>
            info.row.original.plex
              ? `${info.row.original.plex.watchCount} view(s)`
              : 'not in Plex',
        }),
        columnHelper.display({
          id: 'fix',
          header: '',
          size: DEFAULT_COLUMN_SIZES.fix,
          enableSorting: false,
          cell: (info) => (
            <RowActionsMenu
              item={info.row.original}
              onFixMatch={onFixMatch}
            />
          ),
        }),
      ]),
    [
      mediaType,
      onFixMatch,
      onSelectedChange,
      selected,
      settings.confidenceThreshold,
      settings.namingRules,
    ],
  );

  const table = useTable({
    features,
    columns: columns as Array<ColumnDef<typeof features, OrganizePlanItem, unknown>>,
    data: rows,
    state: { columnVisibility, columnOrder, columnSizing },
    onColumnVisibilityChange: (updater) =>
      setColumnVisibility((current) => resolveUpdater(updater, current)),
    onColumnOrderChange: (updater) =>
      setColumnOrder((current) => resolveUpdater(updater, current)),
    onColumnSizingChange: (updater) =>
      setColumnSizing((current) => resolveUpdater(updater, current)),
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    enableMultiSort: false,
    enableSortingRemoval: true,
    enableHiding: true,
    getRowId: (row) => row.id,
    defaultColumn: { minSize: 40, maxSize: 900 },
  });

  const tableRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => tableRows[index]?.id ?? index,
    scrollMargin: HEADER_HEIGHT,
  });

  const visibleColumns = table.getVisibleLeafColumns();
  const totalWidth = visibleColumns.reduce(
    (sum, column) => sum + column.getSize(),
    0,
  );
  const gridTemplate = visibleColumns
    .map((column) =>
      column.id === 'source' || column.id === 'target'
        ? `minmax(${column.getSize()}px, 1fr)`
        : `${column.getSize()}px`,
    )
    .join(' ');

  const moveColumn = (id: string, delta: number) => {
    setColumnOrder((current) => {
      const order = normalizeOrder(
        current,
        table.getAllLeafColumns().map((column) => column.id),
      );
      const index = order.indexOf(id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= order.length) return order;
      const [moved] = order.splice(index, 1);
      order.splice(target, 0, moved);
      return order;
    });
  };

  const dropColumn = (targetId: string) => {
    const source = draggingRef.current;
    draggingRef.current = null;
    setDragging(null);
    setDragOver(null);
    if (!source || source === targetId) return;
    setColumnOrder((current) => {
      const order = normalizeOrder(
        current,
        table.getAllLeafColumns().map((column) => column.id),
      );
      const from = order.indexOf(source);
      const to = order.indexOf(targetId);
      if (from < 0 || to < 0) return order;
      const [moved] = order.splice(from, 1);
      order.splice(to, 0, moved);
      return order;
    });
  };

  const resetLayout = () => {
    setColumnVisibility(defaultVisibility);
    setColumnOrder(DEFAULT_ORDER);
    setColumnSizing({});
  };

  return (
    <div style={{ minWidth: 0, maxWidth: '100%' }}>
      <Toolbar role="group" aria-label="Review filters">
        {FILTERS.map((option) => (
          <FilterButton
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            $active={filter === option.value}
            onClick={() => setFilter(option.value)}
          >
            {option.label}
          </FilterButton>
        ))}
        <input
          className="form-control form-control-sm"
          style={{ maxWidth: 220 }}
          placeholder="Search files, shows, episodes…"
          aria-label="Search the review table"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--hb-space-sm)',
          }}
        >
          <Muted>
            {tableRows.length} of {plan.items.length} file(s)
          </Muted>
          <OverlayTrigger
            trigger="click"
            placement="bottom-end"
            rootClose
            overlay={
              <ColumnsPopover id={columnsPopoverId}>
                <Popover.Header as="h3">Columns</Popover.Header>
                <Popover.Body>
                  <div role="group" aria-label="Columns">
                    {table.getAllLeafColumns().map((column, index, all) => {
                      const label =
                        typeof column.columnDef.header === 'string'
                          ? column.columnDef.header
                          : column.id;
                      return (
                        <MenuRow key={column.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={column.getIsVisible()}
                              disabled={!column.getCanHide()}
                              onChange={column.getToggleVisibilityHandler()}
                            />
                            {label || column.id}
                          </label>
                          <IconButton
                            icon="moveLeft"
                            label={`Move ${label || column.id} left`}
                            disabled={index === 0}
                            onClick={() => moveColumn(column.id, -1)}
                          />
                          <IconButton
                            icon="moveRight"
                            label={`Move ${label || column.id} right`}
                            disabled={index === all.length - 1}
                            onClick={() => moveColumn(column.id, 1)}
                          />
                        </MenuRow>
                      );
                    })}
                  </div>
                  <div
                    style={{
                      marginTop: 'var(--hb-space-sm)',
                      textAlign: 'right',
                    }}
                  >
                    <Button
                      compact
                      variant="ghost"
                      icon="reset"
                      onClick={resetLayout}
                    >
                      Reset columns
                    </Button>
                  </div>
                </Popover.Body>
              </ColumnsPopover>
            }
          >
            <span style={{ display: 'inline-flex' }}>
              <Button
                compact
                variant="ghost"
                icon="columns"
                aria-label="Columns"
              >
                Columns
              </Button>
            </span>
          </OverlayTrigger>
        </span>
      </Toolbar>

      <Viewport
        ref={viewport}
        role="grid"
        aria-rowcount={tableRows.length + 1}
        aria-colcount={visibleColumns.length}
        aria-label="Organize review"
        tabIndex={0}
      >
        <TableHeader
          role="row"
          style={{ gridTemplateColumns: gridTemplate, minWidth: totalWidth }}
        >
          {table.getHeaderGroups().flatMap((group) =>
            group.headers.map((header) => {
              const column = header.column;
              const sorted = column.getIsSorted();
              const canSort = column.getCanSort();
              const label =
                typeof column.columnDef.header === 'string'
                  ? column.columnDef.header
                  : column.id;
              return (
                <HeaderCell
                  key={header.id}
                  role="columnheader"
                  tabIndex={canSort ? 0 : -1}
                  aria-sort={
                    sorted === 'asc'
                      ? 'ascending'
                      : sorted === 'desc'
                        ? 'descending'
                        : 'none'
                  }
                  aria-label={label || column.id}
                  title={canSort ? `Sort by ${label}` : label}
                  draggable
                  onDragStart={(event) => {
                    // A press on the resize handle must resize, not reorder.
                    if (resizingRef.current) {
                      resizingRef.current = false;
                      event.preventDefault();
                      return;
                    }
                    didDrag.current = true;
                    draggingRef.current = column.id;
                    setDragging(column.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', column.id);
                  }}
                  onDragEnd={() => {
                    draggingRef.current = null;
                    setDragging(null);
                    setDragOver(null);
                    setTimeout(() => {
                      didDrag.current = false;
                    }, 0);
                  }}
                  onDragEnter={(event) => {
                    if (!draggingRef.current) return;
                    event.preventDefault();
                    setDragOver(column.id);
                  }}
                  onDragLeave={() =>
                    setDragOver((current) =>
                      current === column.id ? null : current,
                    )
                  }
                  onDragOver={(event) => {
                    if (!draggingRef.current) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    if (dragOver !== column.id) setDragOver(column.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    dropColumn(column.id);
                  }}
                  onClick={(event) => {
                    if (didDrag.current) {
                      didDrag.current = false;
                      return;
                    }
                    if (canSort) column.getToggleSortingHandler()?.(event);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      column.getToggleSortingHandler()?.(event);
                    }
                    if (event.altKey && event.key === 'ArrowLeft') {
                      event.preventDefault();
                      moveColumn(column.id, -1);
                    }
                    if (event.altKey && event.key === 'ArrowRight') {
                      event.preventDefault();
                      moveColumn(column.id, 1);
                    }
                  }}
                  style={{
                    opacity: dragging === column.id ? 0.5 : 1,
                    boxShadow:
                      dragOver === column.id && dragging !== column.id
                        ? 'inset 2px 0 0 var(--hb-accent)'
                        : undefined,
                  }}
                >
                  <DragHandle aria-hidden="true">
                    <Icon name="drag" size="xs" />
                  </DragHandle>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {header.isPlaceholder ? null : (
                      <table.FlexRender header={header} />
                    )}
                  </span>
                  {sorted && (
                    <SortMarker aria-hidden="true">
                      <Icon
                        name={sorted === 'asc' ? 'sortAsc' : 'sortDesc'}
                        size="xs"
                      />
                    </SortMarker>
                  )}
                  {column.getCanResize() && (
                    <ResizeHandle
                      $active={column.getIsResizing()}
                      onMouseDown={(event) =>
                        resizeColumn(event, header.getResizeHandler())
                      }
                      onTouchStart={(event) =>
                        resizeColumn(event, header.getResizeHandler())
                      }
                      aria-hidden="true"
                    />
                  )}
                </HeaderCell>
              );
            }),
          )}
        </TableHeader>

        <Body
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            minWidth: totalWidth,
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = tableRows[virtualRow.index];
            if (!row) return null;
            const item = row.original;
            return (
              <BodyRow
                key={row.id}
                role="row"
                $conflict={item.action === 'conflict'}
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  gridTemplateColumns: gridTemplate,
                  width: '100%',
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <Cell key={cell.id} role="gridcell">
                    <table.FlexRender cell={cell} />
                  </Cell>
                ))}
              </BodyRow>
            );
          })}
        </Body>
      </Viewport>

      {tableRows.length === 0 && (
        <Muted style={{ display: 'block', marginTop: 'var(--hb-space-xs)' }}>
          No files match this filter.
        </Muted>
      )}
    </div>
  );
};
