import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import { Panel } from '../ui/Panel';
import { Button } from '../ui/Button';
import { copyText } from '../core/utils';
import { runMessages } from './messages';
import { QueueRow } from './QueueTable';
import { firstLine } from './format';

const Summary = styled.div`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  margin-bottom: var(--hb-space-sm);
`;

const Group = styled.details`
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  padding: var(--hb-space-sm);
  margin-bottom: var(--hb-space-xs);
  background: var(--hb-surface);

  &[open] > summary {
    margin-bottom: var(--hb-space-xs);
  }
`;

const GroupSummary = styled.summary`
  cursor: pointer;
  font-size: var(--hb-font-sm);
  font-weight: 500;
  overflow-wrap: anywhere;
`;

const Count = styled.span`
  display: inline-block;
  min-width: 1.75rem;
  padding: 0 var(--hb-space-xs);
  margin-right: var(--hb-space-sm);
  border-radius: 999px;
  background: var(--hb-danger);
  color: var(--hb-accentContrast);
  font-size: var(--hb-font-xs);
  font-weight: 600;
  text-align: center;
  font-variant-numeric: tabular-nums;
`;

const FileList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0 0 0 var(--hb-space-md);
  display: grid;
  gap: 2px;
  font-size: var(--hb-font-xs);
`;

const FileButton = styled.button`
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--hb-accent);
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;

  &:hover {
    text-decoration: underline;
  }
`;

/** Groups failures by their first non-empty line so 40 similar errors read as one. */
interface FailureGroup {
  message: string;
  rows: QueueRow[];
}

interface FailuresPanelProps {
  rows: QueueRow[];
  onOpenLog: (row: QueueRow) => void;
}

export const FailuresPanel: React.FC<FailuresPanelProps> = ({
  rows,
  onOpenLog,
}) => {
  const { formatMessage } = useIntl();
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  const groups = useMemo<FailureGroup[]>(() => {
    const byMessage = new Map<string, QueueRow[]>();
    for (const row of rows) {
      if (row.state !== 'error') continue;
      const message = firstLine(row.reason) ?? formatMessage(runMessages.errorGroupUnknown);
      const bucket = byMessage.get(message);
      if (bucket) bucket.push(row);
      else byMessage.set(message, [row]);
    }
    return [...byMessage.entries()]
      .map(([message, groupRows]) => ({ message, rows: groupRows }))
      .sort((a, b) => b.rows.length - a.rows.length);
  }, [rows, formatMessage]);

  if (groups.length === 0) return null;

  const failures = groups.reduce((sum, group) => sum + group.rows.length, 0);

  const copyAll = async () => {
    const text = [
      `${failures} of ${rows.length} failed`,
      '',
      ...groups.flatMap((group) => [
        `${group.rows.length}× ${group.message}`,
        ...group.rows.map((row) => `  ${row.path}`),
        '',
      ]),
    ].join('\n');
    const ok = await copyText(text);
    setCopied(ok ? 'copied' : 'failed');
  };

  return (
    <Panel
      title={formatMessage(runMessages.failuresTitle)}
      icon="failures"
      actions={
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--hb-space-sm)' }}>
          {copied !== 'idle' && (
            <span
              role="status"
              style={{
                fontSize: 'var(--hb-font-xs)',
                color:
                  copied === 'copied'
                    ? 'var(--hb-success)'
                    : 'var(--hb-danger)',
              }}
            >
              {formatMessage(
                copied === 'copied'
                  ? runMessages.copied
                  : runMessages.copyFailed,
              )}
            </span>
          )}
          <Button compact variant="ghost" icon="copy" onClick={copyAll}>
            {formatMessage(runMessages.copyAllErrors)}
          </Button>
        </span>
      }
    >
      <Summary>
        {formatMessage(runMessages.failuresSummary, {
          failed: failures,
          total: rows.length,
        })}
      </Summary>
      {groups.map((group, index) => (
        <Group key={group.message} open={index === 0}>
          <GroupSummary>
            <Count>{group.rows.length}</Count>
            {group.message}
          </GroupSummary>
          <FileList>
            {group.rows.slice(0, 100).map((row) => (
              <li key={row.index}>
                <FileButton
                  type="button"
                  onClick={() => onOpenLog(row)}
                  title={formatMessage(runMessages.openLog)}
                >
                  {row.path}
                </FileButton>
              </li>
            ))}
            {group.rows.length > 100 && (
              <li style={{ color: 'var(--hb-textMuted)' }}>
                {formatMessage(runMessages.moreFiles, {
                  count: group.rows.length - 100,
                })}
              </li>
            )}
          </FileList>
        </Group>
      ))}
    </Panel>
  );
};
