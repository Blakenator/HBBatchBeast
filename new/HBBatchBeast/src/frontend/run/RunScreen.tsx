import React, { useEffect, useMemo } from 'react';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import {
  ASYNC_CHANNEL,
  BatchTabConfig,
  GlobalAppConfig,
  PROMISE_CHANNEL,
} from '../../common';
import { useBackend, useBackendAsync } from '../helpers';
import { useBatchResult, useSetBatchResult } from '../core/stores';
import { AppStatus } from '../ui/StatusPill';
import { Panel, PanelGrid } from '../ui/Panel';
import { QueueTable, QueueRow } from './QueueTable';
import { runMessages } from './messages';
import { RunStatePayload } from './types';
import { validateBatchConfig } from './validation';

interface RunScreenProps {
  config: GlobalAppConfig;
  onStatusChange: (status: AppStatus) => void;
}

function splitCount(value?: string, enabled?: boolean): number {
  if (!enabled) return 0;
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;
}

export const RunScreen: React.FC<RunScreenProps> = ({
  config,
  onStatusChange,
}) => {
  const { formatMessage } = useIntl();
  const batchResult = useBatchResult();
  const setBatchResult = useSetBatchResult();
  const current = config.configs[config.selected_config];
  const batch: Partial<BatchTabConfig> = current?.tab_batch ?? {};

  const problems = useMemo(
    () => validateBatchConfig(current.tab_batch),
    [current.tab_batch],
  );

  const scan = useBackendAsync({
    channel: ASYNC_CHANNEL.RunBatchOperation,
    props: { config },
    skip: true,
    onComplete: (result) => setBatchResult(result),
  });

  const scanItems = batchResult?.fileList ?? [];

  const run = useBackendAsync({
    channel: ASYNC_CHANNEL.RunConversion,
    props: {
      config,
      items: scanItems.map((item) => ({
        path: item.path,
        preset: item.preset ?? '',
        destinationPath: item.destinationPath,
      })),
    },
    skip: true,
  });

  const pause = useBackend({ channel: PROMISE_CHANNEL.PauseRun, skip: true });
  const resume = useBackend({ channel: PROMISE_CHANNEL.ResumeRun, skip: true });
  const stop = useBackend({ channel: PROMISE_CHANNEL.StopRun, skip: true });

  const runState: RunStatePayload | undefined =
    run.lastProgressData ?? run.completeData ?? undefined;

  const status: AppStatus = useMemo(() => {
    if (runState) {
      if (runState.status === 'paused') return 'paused';
      if (runState.status === 'stopping') return 'stopping';
      if (runState.status === 'running') return 'running';
      if (runState.status === 'completed') {
        return runState.counts.error > 0 ? 'error' : 'completed';
      }
    }
    if (scan.loading || run.loading) return 'running';
    if (scan.error || run.error) return 'error';
    return 'idle';
  }, [runState, scan.loading, run.loading, scan.error, run.error]);

  useEffect(() => {
    onStatusChange(status);
  }, [status, onStatusChange]);

  const rows: QueueRow[] = runState
    ? runState.items.map((item) => ({
        path: item.path,
        preset: item.preset,
        state: item.state,
        percent: item.percent,
        reason: item.reason,
      }))
    : scanItems.map((item) => ({
        path: item.path,
        preset: item.preset,
        state: 'pending' as const,
      }));

  const running = runState?.status === 'running';
  const paused = runState?.status === 'paused';
  const sourceCount = splitCount(
    batch.path?.source_path,
    true,
  );
  const destinationCount = splitCount(batch.path?.destination_path, true);
  const presetCount = (batch.preset ?? '')
    .split('\n')
    .filter((line: string) => line.trim().length > 0).length;

  return (
    <div style={{ display: 'grid', gap: 'var(--hb-space-lg)' }}>
      <PanelGrid>
        <Panel title={formatMessage(runMessages.folders)}>
          <strong>{sourceCount}</strong> source →{' '}
          <strong>{destinationCount}</strong> destination
          {batch.path?.temp_toggle === 1 ? ' · temp staging' : ''}
        </Panel>
        <Panel title={formatMessage(runMessages.encoding)}>
          {batch.FFmpeg_toggle === 1 ? 'FFmpeg' : 'HandBrake'} ·{' '}
          {presetCount > 0
            ? `${presetCount} preset${presetCount === 1 ? '' : 's'}`
            : formatMessage(runMessages.noPreset)}{' '}
          · {batch.container ?? '.mp4'}
        </Panel>
        <Panel title={formatMessage(runMessages.filters)}>
          {batch.advanced?.included_file_types || '—'}
        </Panel>
      </PanelGrid>

      {problems.length > 0 && (
        <Alert variant="warning" className="mb-0">
          <strong>{formatMessage(runMessages.blockingIssues)}</strong>
          <ul className="mb-0">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div style={{ display: 'flex', gap: 'var(--hb-space-sm)' }}>
        <Button
          onClick={() => scan.refetch({ config })}
          disabled={scan.loading || running}
        >
          {formatMessage(runMessages.scan)}
        </Button>
        <Button
          variant="success"
          onClick={() => run.refetch()}
          disabled={
            run.loading ||
            running ||
            paused ||
            scanItems.length === 0 ||
            problems.length > 0
          }
        >
          {formatMessage(runMessages.startConversion)}
        </Button>
        <Button
          variant="secondary"
          onClick={() => pause.refetch()}
          disabled={!running}
        >
          {formatMessage(runMessages.pause)}
        </Button>
        <Button
          variant="secondary"
          onClick={() => resume.refetch()}
          disabled={!paused}
        >
          {formatMessage(runMessages.resume)}
        </Button>
        <Button
          variant="outline-danger"
          onClick={() => stop.refetch()}
          disabled={!(running || paused)}
        >
          {formatMessage(runMessages.stop)}
        </Button>
        {(scan.loading || run.loading) && <Spinner size="sm" />}
      </div>

      {runState && (
        <div style={{ color: 'var(--hb-textMuted)' }}>
          {formatMessage(runMessages.progress, {
            done: runState.counts.success,
            total: runState.counts.total,
            failed: runState.counts.error,
            cancelled: runState.counts.cancelled,
          })}
        </div>
      )}

      {scan.error && <Alert variant="danger">{scan.error.message}</Alert>}
      {run.error && <Alert variant="danger">{run.error.message}</Alert>}

      <Panel
        title={formatMessage(runMessages.queue)}
        actions={
          <span style={{ color: 'var(--hb-textMuted)' }}>
            {formatMessage(runMessages.queueCount, { count: rows.length })}
          </span>
        }
      >
        {rows.length === 0 ? (
          <div style={{ color: 'var(--hb-textMuted)' }}>
            {formatMessage(runMessages.noQueue)}
          </div>
        ) : (
          <QueueTable rows={rows} />
        )}
      </Panel>
    </div>
  );
};
