import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Modal } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { Button } from '../ui/Button';
import { copyText } from '../core/utils';
import { runMessages } from './messages';
import { QueueRow } from './QueueTable';
import { formatBytes, formatDuration, formatPercent } from './format';

const Summary = styled.dl`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--hb-space-xs) var(--hb-space-lg);
  margin: 0 0 var(--hb-space-md);
  font-size: var(--hb-font-sm);

  dt {
    color: var(--hb-textMuted);
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
`;

const SectionTitle = styled.h4`
  margin: var(--hb-space-md) 0 var(--hb-space-xs);
  font-size: var(--hb-font-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--hb-textMuted);
`;

const Pre = styled.pre`
  margin: 0;
  max-height: 40vh;
  overflow: auto;
  padding: var(--hb-space-sm);
  background: var(--hb-surfaceMuted);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  font-size: var(--hb-font-xs);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const stateColor: Record<QueueRow['state'], string> = {
  pending: 'var(--hb-textMuted)',
  running: 'var(--hb-accent)',
  success: 'var(--hb-success)',
  error: 'var(--hb-danger)',
  cancelled: 'var(--hb-warning)',
  skipped: 'var(--hb-textMuted)',
};

function buildLogText(row: QueueRow, stateLabels: Record<string, string>): string {
  const lines = [
    row.path,
    `State: ${stateLabels[row.state] ?? row.state}`,
    row.preset ? `Preset: ${row.preset}` : undefined,
    row.startedAt && row.finishedAt
      ? `Duration: ${formatDuration((row.finishedAt - row.startedAt) / 1000)}`
      : undefined,
    row.progress?.percent !== undefined
      ? `Progress: ${formatPercent(row.progress.percent, 2)}`
      : undefined,
    row.sourceBytes ? `Source size: ${formatBytes(row.sourceBytes)}` : undefined,
    row.outputBytes ? `Output size: ${formatBytes(row.outputBytes)}` : undefined,
  ].filter(Boolean);

  if (row.reason) {
    lines.push('', 'Error details:', row.reason);
  }
  if (row.logTail && row.logTail.length > 0) {
    lines.push('', 'Worker console:', ...row.logTail);
  }
  return lines.join('\n');
}

export const ItemLogModal: React.FC<{
  row: QueueRow | null;
  onClose: () => void;
}> = ({ row, onClose }) => {
  const { formatMessage } = useIntl();
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    setCopied('idle');
  }, [row?.index]);

  const stateLabels: Record<string, string> = {
    pending: formatMessage(runMessages.pending),
    running: formatMessage(runMessages.running),
    success: formatMessage(runMessages.success),
    error: formatMessage(runMessages.error),
    cancelled: formatMessage(runMessages.cancelled),
    skipped: formatMessage(runMessages.skipped),
  };

  const copy = async () => {
    if (!row) return;
    const ok = await copyText(buildLogText(row, stateLabels));
    setCopied(ok ? 'copied' : 'failed');
  };

  const hasLog =
    Boolean(row?.reason) || (row?.logTail !== undefined && row.logTail.length > 0);

  return (
    <Modal show={row !== null} onHide={onClose} centered size="lg">
      <Modal.Header closeButton>
        <Modal.Title>{formatMessage(runMessages.logTitle)}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {row && (
          <>
            <Summary>
              <dt>{formatMessage(runMessages.colPath)}</dt>
              <dd>{row.path}</dd>
              <dt>{formatMessage(runMessages.colState)}</dt>
              <dd style={{ color: stateColor[row.state] }}>
                {stateLabels[row.state]}
              </dd>
              <dt>{formatMessage(runMessages.colPreset)}</dt>
              <dd>{row.preset || '—'}</dd>
              <dt>{formatMessage(runMessages.duration)}</dt>
              <dd>
                {row.startedAt && row.finishedAt
                  ? formatDuration((row.finishedAt - row.startedAt) / 1000)
                  : '—'}
              </dd>
              <dt>{formatMessage(runMessages.colPercent)}</dt>
              <dd>
                {row.progress?.percent !== undefined
                  ? formatPercent(row.progress.percent, 2)
                  : row.percent ?? '—'}
              </dd>
              <dt>{formatMessage(runMessages.colSize)}</dt>
              <dd>
                {formatBytes(row.sourceBytes)}
                {row.outputBytes ? ` → ${formatBytes(row.outputBytes)}` : ''}
              </dd>
              {row.worker !== undefined && (
                <>
                  <dt>{formatMessage(runMessages.workerLabel)}</dt>
                  <dd>{row.worker}</dd>
                </>
              )}
            </Summary>

            {row.reason && (
              <>
                <SectionTitle>{formatMessage(runMessages.errorDetails)}</SectionTitle>
                <Pre>{row.reason}</Pre>
              </>
            )}

            {row.logTail && row.logTail.length > 0 && (
              <>
                <SectionTitle>{formatMessage(runMessages.workerConsole)}</SectionTitle>
                <Pre>{row.logTail.join('\n')}</Pre>
              </>
            )}

            {!hasLog && (
              <p style={{ margin: 0, color: 'var(--hb-textMuted)' }}>
                {formatMessage(runMessages.noLogOutput)}
              </p>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        {copied !== 'idle' && (
          <span
            role="status"
            style={{
              marginRight: 'auto',
              fontSize: 'var(--hb-font-xs)',
              color:
                copied === 'copied'
                  ? 'var(--hb-success)'
                  : 'var(--hb-danger)',
            }}
          >
            {formatMessage(
              copied === 'copied' ? runMessages.copied : runMessages.copyFailed,
            )}
          </span>
        )}
        <Button variant="secondary" onClick={copy} disabled={!row}>
          {formatMessage(runMessages.copy)}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {formatMessage(runMessages.cancel)}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
