import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { OverlayTrigger, Popover } from 'react-bootstrap';
import {
  ColumnDef,
  ColumnOrderState,
  ColumnSizingState,
  ColumnVisibilityState,
  FilterFn,
  Updater,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  columnFilteringFeature,
  columnOrderingFeature,
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  filterFn_equals,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { runMessages } from './messages';
import { mediaMessages } from './mediaMessages';
import { MediaInfoModal } from './MediaInfoModal';
import { Button } from '../ui/Button';
import { normalizePresetName } from '../../common';
import type { RunItemAction } from '../../common';
import type { FilterTrace } from '../../common/filterExpression';
import type { PresetTrace } from '../../common/library';
import { RunItemProgress, parsePercent } from '../../common/runTelemetry';
import { FilterTracePopover } from './FilterTracePopover';
import {
  firstLine,
  formatBytes,
  formatDuration,
  formatNumber,
  formatPercent,
} from './format';

export type QueueRowState =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled'
  | 'excluded'
  | 'skipped';

export interface QueueRow {
  /** Stable queue position; also what CancelRunItem expects. */
  index: number;
  path: string;
  preset?: string;
  state: QueueRowState;
  percent?: string;
  reason?: string;
  /** Scanner action for pre-run rows; distinguishes copied from encoded. */
  action?: RunItemAction;
  worker?: number;
  startedAt?: number;
  finishedAt?: number;
  sourceBytes?: number;
  outputBytes?: number;
  progress?: RunItemProgress;
  logTail?: string[];
  /** Scan-stage trace; present for rows produced by a scan. */
  filterTrace?: FilterTrace;
  /** Which mapping rule chose this row's preset. */
  presetTrace?: PresetTrace;
}

interface QueueTableProps {
  rows: QueueRow[];
  onOpenLog: (row: QueueRow) => void;
  /** Provided only while a run is active; enables the per-row cancel action. */
  onCancel?: (row: QueueRow) => void;
}

const ROW_HEIGHT = 32;
const HEADER_HEIGHT = 34;
const VIEWPORT_HEIGHT = 392;
const OVERSCAN = 6;
const STORAGE_KEY = 'hbb.queueTable.layout.v2';

const FILTERS: (QueueRowState | 'all')[] = [
  'all',
  'running',
  'pending',
  'success',
  'error',
  'cancelled',
  'excluded',
  'skipped',
];

const Viewport = styled.div`
  height: ${VIEWPORT_HEIGHT}px;
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
  line-height: 1;

  &:hover,
  &:active {
    color: var(--hb-accent);
    opacity: 1;
  }

  &:active {
    cursor: grabbing;
  }
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

const BodyRow = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  gap: 0;
  align-items: center;
  height: ${ROW_HEIGHT}px;
  border-bottom: 1px solid var(--hb-border);
  font-size: var(--hb-font-sm);
  font-variant-numeric: tabular-nums;

  &:hover {
    background: var(--hb-surfaceMuted);
  }
`;

const Cell = styled.div<{ $align?: 'left' | 'right' }>`
  min-width: 0;
  padding: 0 var(--hb-space-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: ${({ $align }) => ($align === 'right' ? 'right' : 'left')};
`;

const PathCell = styled.div`
  display: flex;
  align-items: baseline;
  gap: var(--hb-space-xs);
  min-width: 0;
  overflow: hidden;
`;

const Directory = styled.span`
  flex: 0 1 40%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--hb-textMuted);
`;

const FileName = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ProgressCell = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const ProgressTrack = styled.div`
  height: 3px;
  border-radius: 2px;
  background: var(--hb-surfaceMuted);
  overflow: hidden;
`;

const ProgressFill = styled.div<{ $percent: number; $color: string }>`
  height: 100%;
  width: ${({ $percent }) => Math.max(0, Math.min(100, $percent))}%;
  background: ${({ $color }) => $color};
  transition: width 150ms linear;

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`;

const StateLabel = styled.span<{ $color: string }>`
  color: ${({ $color }) => $color};
`;

const Actions = styled.div`
  display: flex;
  gap: var(--hb-space-xs);
  align-items: center;
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
  text-transform: capitalize;
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
    cursor: pointer;
    min-width: 0;
  }
`;

const ColumnsPopover = styled(Popover)`
  min-width: 260px;
`;

const IconButton = styled.button`
  border: 1px solid var(--hb-border);
  background: var(--hb-surface);
  color: var(--hb-text);
  border-radius: var(--hb-radius-sm);
  width: 22px;
  height: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 0;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: 1px;
  }
`;

const stateColor: Record<QueueRowState, string> = {
  pending: 'var(--hb-textMuted)',
  running: 'var(--hb-accent)',
  success: 'var(--hb-success)',
  error: 'var(--hb-danger)',
  cancelled: 'var(--hb-warning)',
  excluded: 'var(--hb-textMuted)',
  skipped: 'var(--hb-textMuted)',
};

const cellAlign: Record<string, 'left' | 'right'> = {
  index: 'right',
  eta: 'right',
  speed: 'right',
  size: 'right',
};

const DEFAULT_COLUMN_SIZES: Record<string, number> = {
  index: 48,
  path: 260,
  preset: 130,
  presetArgs: 220,
  state: 100,
  percent: 88,
  eta: 84,
  speed: 96,
  size: 96,
  filter: 112,
  reason: 180,
  actions: 190,
};

const DEFAULT_VISIBILITY: ColumnVisibilityState = {
  speed: false,
  size: false,
  presetArgs: false,
};

const DEFAULT_ORDER = Object.keys(DEFAULT_COLUMN_SIZES);

interface QueueTableMeta {
  onOpenLog: (row: QueueRow) => void;
  onInspect: (path: string) => void;
  onCancel?: (row: QueueRow) => void;
}

const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  columnVisibilityFeature,
  columnOrderingFeature,
  columnSizingFeature,
  columnResizingFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
  filterFns: { equals: filterFn_equals, includesString: filterFn_includesString },
  tableMeta: {} as QueueTableMeta,
});

const columnHelper = createColumnHelper<typeof features, QueueRow>();

const pathFilter: FilterFn<typeof features, QueueRow> = (row, _columnId, value) => {
  const needle = String(value ?? '').trim().toLowerCase();
  return needle.length === 0 || row.original.path.toLowerCase().includes(needle);
};

/** Splits a queue path so the file name stays visible when space runs out. */
function splitPath(filePath: string): { directory: string; name: string } {
  const separator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (separator < 0) return { directory: '', name: filePath };
  return {
    directory: filePath.slice(0, separator + 1),
    name: filePath.slice(separator + 1),
  };
}

/** The queue stores CLI arguments; the preset column shows the name inside them. */
function presetNameFromArgs(preset?: string): string {
  const trimmed = (preset ?? '').trim();
  if (!trimmed) return '';
  const match = /^-Z\s+("[^"]*"|'[^']*'|\S+)/i.exec(trimmed);
  if (match) return normalizePresetName(`-Z ${match[1]}`);
  return trimmed.startsWith('-') ? '' : trimmed;
}

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

    const hasVisibility =
      parsed.visibility !== null && typeof parsed.visibility === 'object';
    const visibility: ColumnVisibilityState = { ...DEFAULT_VISIBILITY };
    if (hasVisibility) {
      for (const [key, value] of Object.entries(parsed.visibility!)) {
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

    return {
      visibility: hasVisibility ? visibility : undefined,
      order,
      sizing,
    };
  } catch {
    return {};
  }
}

function saveLayout(layout: StoredLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // layout persistence is optional
  }
}

function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === 'function'
    ? (updater as (value: T) => T)(current)
    : updater;
}

/** Merges persisted/current order with every current column id. */
function normalizeOrder(current: ColumnOrderState, ids: string[]): string[] {
  const order = current.filter((id) => ids.includes(id));
  for (const id of ids) {
    if (!order.includes(id)) order.push(id);
  }
  return order;
}

export const QueueTable: React.FC<QueueTableProps> = ({
  rows,
  onOpenLog,
  onCancel,
}) => {
  const { formatMessage } = useIntl();
  const columnsPopoverId = useId();
  const [filter, setFilter] = useState<QueueRowState | 'all'>('all');
  const [search, setSearch] = useState('');
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  const didDrag = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);

  const [initialLayout] = useState(loadLayout);
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>(
    initialLayout.visibility ?? DEFAULT_VISIBILITY,
  );
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(
    initialLayout.order ?? DEFAULT_ORDER,
  );
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(
    initialLayout.sizing ?? {},
  );

  // Resizing commits on every pointer move; persist once the drag settles.
  useEffect(() => {
    const timer = setTimeout(
      () =>
        saveLayout({
          visibility: columnVisibility,
          order: columnOrder,
          sizing: columnSizing,
        }),
      250,
    );
    return () => clearTimeout(timer);
  }, [columnVisibility, columnOrder, columnSizing]);

  const columns = useMemo(() => {
    const label = (key: keyof typeof runMessages) => formatMessage(runMessages[key]);
    return columnHelper.columns([
      columnHelper.accessor((row) => row.index, {
        id: 'index',
        header: label('colIndex'),
        size: DEFAULT_COLUMN_SIZES.index,
        minSize: 40,
        maxSize: 120,
        sortFn: 'basic',
        sortUndefined: 'last',
        cell: (info) => (
          <span style={{ color: 'var(--hb-textMuted)' }}>
            {info.getValue() + 1}
          </span>
        ),
      }),
      columnHelper.accessor((row) => row.path, {
        id: 'path',
        header: label('colPath'),
        size: DEFAULT_COLUMN_SIZES.path,
        minSize: 120,
        maxSize: 900,
        sortFn: 'text',
        cell: (info) => {
          const { directory, name } = splitPath(info.getValue());
          return (
            <PathCell title={info.getValue()}>
              <Directory>{directory}</Directory>
              <FileName>{name}</FileName>
            </PathCell>
          );
        },
      }),
      columnHelper.accessor((row) => row.preset ?? '', {
        id: 'preset',
        header: label('colPreset'),
        size: DEFAULT_COLUMN_SIZES.preset,
        minSize: 80,
        maxSize: 400,
        sortFn: 'text',
        cell: (info) => {
          const raw = (info.getValue() ?? '').trim();
          const name = presetNameFromArgs(raw);
          const text = name || (raw ? formatMessage(runMessages.customArguments) : '—');
          const trace = info.row.original.presetTrace;
          const title = trace
            ? `${raw}${trace.ruleName ? `\nSelected by ${trace.ruleName}` : ''}`
            : raw;
          return <span title={title || undefined}>{text}</span>;
        },
      }),
      columnHelper.accessor((row) => row.preset ?? '', {
        id: 'presetArgs',
        header: label('colPresetArgs'),
        size: DEFAULT_COLUMN_SIZES.presetArgs,
        minSize: 80,
        maxSize: 600,
        sortFn: 'text',
        cell: (info) => (
          <span title={info.getValue() || undefined}>
            {info.getValue() || '—'}
          </span>
        ),
      }),
      columnHelper.accessor((row) => row.state, {
        id: 'state',
        header: label('colState'),
        size: DEFAULT_COLUMN_SIZES.state,
        minSize: 70,
        maxSize: 180,
        sortFn: 'text',
        filterFn: 'equals',
        cell: (info) => (
          <StateLabel $color={stateColor[info.getValue()]}>
            {formatMessage(
              runMessages[info.getValue() as keyof typeof runMessages] ??
                runMessages.all,
            )}
          </StateLabel>
        ),
      }),
      columnHelper.accessor(
        (row) => row.progress?.percent ?? parsePercent(row.percent),
        {
          id: 'percent',
          header: label('colPercent'),
          size: DEFAULT_COLUMN_SIZES.percent,
          minSize: 64,
          maxSize: 180,
          sortFn: 'basic',
          sortUndefined: 'last',
          cell: (info) => {
            const percent = info.getValue();
            return (
              <ProgressCell>
                <span>{percent === undefined ? '—' : formatPercent(percent, 1)}</span>
                <ProgressTrack aria-hidden="true">
                  <ProgressFill
                    $percent={percent ?? 0}
                    $color={stateColor[info.row.original.state]}
                  />
                </ProgressTrack>
              </ProgressCell>
            );
          },
        },
      ),
      columnHelper.accessor((row) => row.progress?.etaSeconds, {
        id: 'eta',
        header: label('colEta'),
        size: DEFAULT_COLUMN_SIZES.eta,
        minSize: 64,
        maxSize: 160,
        sortFn: 'basic',
        sortUndefined: 'last',
        cell: (info) =>
          info.getValue() === undefined ? '—' : formatDuration(info.getValue()),
      }),
      columnHelper.accessor(
        (row) => row.progress?.fps ?? row.progress?.speed,
        {
          id: 'speed',
          header: label('colSpeed'),
          size: DEFAULT_COLUMN_SIZES.speed,
          minSize: 64,
          maxSize: 180,
          sortFn: 'basic',
          sortUndefined: 'last',
          cell: (info) => {
            const { fps, speed } = info.row.original.progress ?? {};
            if (fps !== undefined) return `${formatNumber(fps, 1)} fps`;
            if (speed !== undefined) return `${formatNumber(speed, 2)}×`;
            return '—';
          },
        },
      ),
      columnHelper.accessor((row) => row.sourceBytes, {
        id: 'size',
        header: label('colSize'),
        size: DEFAULT_COLUMN_SIZES.size,
        minSize: 64,
        maxSize: 180,
        sortFn: 'basic',
        sortUndefined: 'last',
        cell: (info) => (
          <span
            title={
              info.row.original.outputBytes
                ? `→ ${formatBytes(info.row.original.outputBytes)}`
                : undefined
            }
          >
            {formatBytes(info.getValue())}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'filter',
        header: label('colFilter'),
        size: DEFAULT_COLUMN_SIZES.filter,
        minSize: 88,
        maxSize: 180,
        cell: (info) => {
          const row = info.row.original;
          return (
            <FilterTracePopover
              trace={row.filterTrace}
              state={row.state}
              action={row.action}
              path={row.path}
              reason={row.reason}
            />
          );
        },
      }),
      columnHelper.accessor((row) => firstLine(row.reason) ?? '', {
        id: 'reason',
        header: label('colReason'),
        size: DEFAULT_COLUMN_SIZES.reason,
        minSize: 80,
        maxSize: 600,
        sortFn: 'text',
        cell: (info) => (
          <span
            title={info.getValue() || undefined}
            style={{
              color:
                info.row.original.state === 'error'
                  ? 'var(--hb-danger)'
                  : 'var(--hb-textMuted)',
            }}
          >
            {info.getValue() || '—'}
          </span>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: label('colActions'),
        size: DEFAULT_COLUMN_SIZES.actions,
        minSize: 120,
        maxSize: 320,
        enableSorting: false,
        enableHiding: false,
        cell: (info) => {
          const row = info.row.original;
          const meta = info.table.options.meta;
          return (
            <Actions>
              <Button
                compact
                variant="ghost"
                onClick={() => meta?.onOpenLog(row)}
                title={formatMessage(runMessages.openLog)}
                aria-label={`${formatMessage(runMessages.openLog)}: ${row.path}`}
              >
                {formatMessage(runMessages.log)}
              </Button>
              <Button
                compact
                variant="ghost"
                onClick={() => meta?.onInspect(row.path)}
                title={formatMessage(mediaMessages.inspectTitle)}
                aria-label={`${formatMessage(mediaMessages.inspectTitle)}: ${row.path}`}
              >
                {formatMessage(mediaMessages.inspect)}
              </Button>
              {meta?.onCancel &&
                (row.state === 'running' || row.state === 'pending') && (
                  <Button
                    compact
                    variant="ghost"
                    onClick={() => meta.onCancel?.(row)}
                    title={formatMessage(runMessages.stopItemTitle)}
                    aria-label={`${formatMessage(runMessages.stopItemTitle)}: ${row.path}`}
                  >
                    {formatMessage(runMessages.stopItem)}
                  </Button>
                )}
            </Actions>
          );
        },
      }),
    ]);
  }, [formatMessage]);

  const columnFilters = useMemo(
    () => (filter === 'all' ? [] : [{ id: 'state', value: filter }]),
    [filter],
  );

  const table = useTable({
    features,
    columns: columns as Array<ColumnDef<typeof features, QueueRow, unknown>>,
    data: rows,
    state: {
      columnVisibility,
      columnOrder,
      columnSizing,
      globalFilter: search,
      columnFilters,
    },
    onColumnVisibilityChange: (updater) =>
      setColumnVisibility((current) => resolveUpdater(updater, current)),
    onColumnOrderChange: (updater) =>
      setColumnOrder((current) => resolveUpdater(updater, current)),
    onColumnSizingChange: (updater) =>
      setColumnSizing((current) => resolveUpdater(updater, current)),
    onGlobalFilterChange: setSearch,
    onColumnFiltersChange: () => undefined,
    globalFilterFn: pathFilter,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    enableMultiSort: false,
    enableSortingRemoval: true,
    enableHiding: true,
    getRowId: (row) => String(row.index),
    defaultColumn: { minSize: 40, maxSize: 900 },
    meta: {
      onOpenLog,
      onInspect: setInspecting,
      onCancel,
    },
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
      column.id === 'path'
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

  const nudgeColumnSize = (id: string, delta: number) => {
    const column = table.getColumn(id);
    if (!column) return;
    const min = column.columnDef.minSize ?? 40;
    const max = column.columnDef.maxSize ?? 900;
    const width = Math.min(max, Math.max(min, column.getSize() + delta));
    table.setColumnSizing((current) => ({ ...current, [id]: width }));
  };

  const resetLayout = () => {
    setColumnVisibility(DEFAULT_VISIBILITY);
    setColumnOrder(DEFAULT_ORDER);
    setColumnSizing({});
  };

  return (
    <div>
      <Toolbar role="group" aria-label={formatMessage(runMessages.filters)}>
        {FILTERS.map((value) => (
          <FilterButton
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            $active={filter === value}
          >
            {formatMessage(
              runMessages[value as keyof typeof runMessages] ?? runMessages.all,
            )}
          </FilterButton>
        ))}
        <input
          className="form-control form-control-sm"
          style={{ maxWidth: 220 }}
          placeholder={formatMessage(runMessages.search)}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label={formatMessage(runMessages.search)}
        />
        <span style={{ marginLeft: 'auto' }}>
          <OverlayTrigger
            trigger="click"
            placement="bottom-end"
            rootClose
            overlay={
              <ColumnsPopover id={columnsPopoverId}>
                <Popover.Header as="h3">
                  {formatMessage(runMessages.columns)}
                </Popover.Header>
                <Popover.Body>
                  <div
                    role="group"
                    aria-label={formatMessage(runMessages.columns)}
                  >
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
                            {label}
                          </label>
                          <IconButton
                            type="button"
                            aria-label={formatMessage(
                              runMessages.moveColumnLeft,
                              { column: label },
                            )}
                            disabled={index === 0}
                            onClick={() => moveColumn(column.id, -1)}
                          >
                            ‹
                          </IconButton>
                          <IconButton
                            type="button"
                            aria-label={formatMessage(
                              runMessages.moveColumnRight,
                              { column: label },
                            )}
                            disabled={index === all.length - 1}
                            onClick={() => moveColumn(column.id, 1)}
                          >
                            ›
                          </IconButton>
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
                    <Button compact variant="ghost" onClick={resetLayout}>
                      {formatMessage(runMessages.resetColumns)}
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
                aria-label={formatMessage(runMessages.columns)}
              >
                {formatMessage(runMessages.columns)}
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
        aria-label={formatMessage(runMessages.queue)}
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
                  $align={cellAlign[column.id]}
                  tabIndex={canSort ? 0 : -1}
                  aria-sort={
                    sorted === 'asc'
                      ? 'ascending'
                      : sorted === 'desc'
                        ? 'descending'
                        : 'none'
                  }
                  aria-label={label}
                  title={
                    canSort
                      ? formatMessage(runMessages.sortBy, { column: label })
                      : label
                  }
                  draggable
                  onDragStart={(event) => {
                    didDrag.current = true;
                    draggingRef.current = column.id;
                    setDragging(column.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', column.id);
                  }}
                  onDragEnd={() => {
                    draggingRef.current = null;
                    setDragging(null);
                    // Some platforms fire click after dragend; ignore that one.
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
                  <DragHandle
                    aria-hidden="true"
                    title={formatMessage(runMessages.dragColumn)}
                    onClick={(event) => event.stopPropagation()}
                  >
                    ⠿
                  </DragHandle>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </span>
                  {sorted && (
                    <SortMarker aria-hidden="true">
                      {sorted === 'asc' ? '▲' : '▼'}
                    </SortMarker>
                  )}
                  {column.getCanResize() && (
                    <ResizeHandle
                      $active={column.getIsResizing()}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={formatMessage(runMessages.resizeColumn, {
                        column: label,
                      })}
                      tabIndex={0}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        column.resetSize();
                      }}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'ArrowLeft') {
                          event.preventDefault();
                          nudgeColumnSize(column.id, -16);
                        }
                        if (event.key === 'ArrowRight') {
                          event.preventDefault();
                          nudgeColumnSize(column.id, 16);
                        }
                        if (event.key === 'Home') {
                          event.preventDefault();
                          column.resetSize();
                        }
                      }}
                      draggable={false}
                      onDragStart={(event) => event.preventDefault()}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        header.getResizeHandler()(event);
                      }}
                      onTouchStart={header.getResizeHandler()}
                    />
                  )}
                </HeaderCell>
              );
            }),
          )}
        </TableHeader>

        {tableRows.length === 0 && (
          <div
            style={{
              padding: 'var(--hb-space-lg)',
              color: 'var(--hb-textMuted)',
              fontSize: 'var(--hb-font-sm)',
            }}
          >
            {formatMessage(runMessages.noRows)}
          </div>
        )}

        <Body
          style={{
            height: rowVirtualizer.getTotalSize(),
            minWidth: totalWidth,
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = tableRows[virtualRow.index];
            return (
              <BodyRow
                key={row.id}
                data-index={virtualRow.index}
                role="row"
                aria-rowindex={virtualRow.index + 2}
                style={{
                  transform: `translateY(${virtualRow.start - HEADER_HEIGHT}px)`,
                  gridTemplateColumns: gridTemplate,
                  width: '100%',
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <Cell
                    key={cell.id}
                    role="gridcell"
                    $align={cellAlign[cell.column.id]}
                  >
                    <table.FlexRender cell={cell} />
                  </Cell>
                ))}
              </BodyRow>
            );
          })}
        </Body>
      </Viewport>

      <MediaInfoModal path={inspecting} onClose={() => setInspecting(null)} />
    </div>
  );
};
