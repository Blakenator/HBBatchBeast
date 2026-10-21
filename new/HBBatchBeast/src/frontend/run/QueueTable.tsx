import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { runMessages } from './messages';

export type QueueRowState =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'cancelled'
  | 'skipped';

export interface QueueRow {
  path: string;
  preset?: string;
  state: QueueRowState;
  percent?: string;
  reason?: string;
}

interface QueueTableProps {
  rows: QueueRow[];
}

const ROW_HEIGHT = 32;
const VIEWPORT_HEIGHT = 360;
const OVERSCAN = 6;

const FILTERS: (QueueRowState | 'all')[] = [
  'all',
  'running',
  'pending',
  'success',
  'error',
  'cancelled',
  'skipped',
];

const Viewport = styled.div`
  height: ${VIEWPORT_HEIGHT}px;
  overflow: auto;
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surface);
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 3rem minmax(0, 1fr) 12rem 6rem;
  gap: var(--hb-space-sm);
  align-items: center;
  height: ${ROW_HEIGHT}px;
  padding: 0 var(--hb-space-sm);
  border-bottom: 1px solid var(--hb-border);
  font-size: var(--hb-font-sm);
`;

const PathCell = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
`;

const stateColor: Record<QueueRowState, string> = {
  pending: 'var(--hb-textMuted)',
  running: 'var(--hb-accent)',
  success: 'var(--hb-success)',
  error: 'var(--hb-danger)',
  cancelled: 'var(--hb-warning)',
  skipped: 'var(--hb-textMuted)',
};

export const QueueTable: React.FC<QueueTableProps> = ({ rows }) => {
  const { formatMessage } = useIntl();
  const [filter, setFilter] = useState<QueueRowState | 'all'>('all');
  const [search, setSearch] = useState('');
  const [scrollTop, setScrollTop] = useState(0);

  const filtered = useMemo(
    () =>
      rows.filter((row) => {
        if (filter !== 'all' && row.state !== filter) return false;
        if (search && !row.path.toLowerCase().includes(search.toLowerCase())) {
          return false;
        }
        return true;
      }),
    [rows, filter, search],
  );

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    filtered.length,
    start + Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2,
  );
  const visible = filtered.slice(start, end);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 'var(--hb-space-sm)',
          alignItems: 'center',
          marginBottom: 'var(--hb-space-sm)',
          flexWrap: 'wrap',
        }}
      >
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setFilter(value);
              setScrollTop(0);
            }}
            aria-pressed={filter === value}
            style={{
              border: '1px solid var(--hb-border)',
              background:
                filter === value ? 'var(--hb-accent)' : 'var(--hb-surface)',
              color:
                filter === value
                  ? 'var(--hb-accentContrast)'
                  : 'var(--hb-text)',
              borderRadius: 999,
              padding: '0 var(--hb-space-md)',
              height: 28,
              fontSize: 'var(--hb-font-xs)',
              textTransform: 'capitalize',
              cursor: 'pointer',
            }}
          >
            {formatMessage(
              runMessages[value as keyof typeof runMessages] ?? runMessages.all,
            )}
          </button>
        ))}
        <input
          className="form-control form-control-sm"
          style={{ maxWidth: 260, marginLeft: 'auto' }}
          placeholder={formatMessage(runMessages.search)}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setScrollTop(0);
          }}
          aria-label={formatMessage(runMessages.search)}
        />
      </div>

      <Viewport
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        role="grid"
        aria-rowcount={filtered.length}
      >
        <div style={{ height: filtered.length * ROW_HEIGHT, position: 'relative' }}>
          <div
            style={{
              transform: `translateY(${start * ROW_HEIGHT}px)`,
            }}
          >
            {visible.map((row, index) => (
              <Row
                key={`${row.path}-${start + index}`}
                role="row"
                title={row.reason ?? row.path}
              >
                <span style={{ color: 'var(--hb-textMuted)' }}>
                  {start + index + 1}
                </span>
                <PathCell>{row.path}</PathCell>
                <span style={{ color: 'var(--hb-textMuted)' }}>
                  {row.percent ?? ''}
                </span>
                <span
                  style={{
                    color: stateColor[row.state],
                    textTransform: 'capitalize',
                  }}
                >
                  {row.state}
                </span>
              </Row>
            ))}
          </div>
        </div>
      </Viewport>
    </div>
  );
};
