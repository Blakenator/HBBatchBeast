import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Spinner } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import {
  ASYNC_CHANNEL,
  BatchTabConfig,
  GlobalAppConfig,
  PROMISE_CHANNEL,
} from '../../common';
import { useBackend, useBackendAsync } from '../helpers';
import { useBatchResult, useSetBatchResultDirect } from '../core/stores';
import { AppStatus } from '../ui/StatusPill';
import { Panel, PanelGrid } from '../ui/Panel';
import { Button } from '../ui/Button';
import { QueueTable, QueueRow } from './QueueTable';
import { runMessages } from './messages';
import { RunStatePayload } from './types';
import { validateBatchConfig } from './validation';

interface RunScreenProps {
  config: GlobalAppConfig;
  onStatusChange: (status: AppStatus) => void;
  onOpenSettings: () => void;
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
  onOpenSettings,
}) => {
  const { formatMessage } = useIntl();
  const [confirming, setConfirming] = useState(false);
  const batchResult = useBatchResult();
  const setBatchResult = useSetBatchResultDirect();
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

  // A queue only describes the folders/presets it was scanned with; drop it when
  // the active profile or those settings change so the table cannot show stale
  // files and Start cannot run them.
  const queueSignature = [
    config.selected_config,
    batch.path?.source_path,
    batch.path?.destination_path,
    batch.path?.temp_destination_path,
    batch.preset,
    batch.custom_preset_string,
    batch.container,
    batch.advanced?.included_file_types,
    batch.advanced?.title_word_filter,
  ].join('|');

  useEffect(() => {
    setBatchResult(undefined);
  }, [queueSignature, setBatchResult]);

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

  // A run only describes the settings it was started with. Keep the signature it
  // ran against so switching profiles or folders cannot show the previous run.
  const [runSignature, setRunSignature] = useState<string | null>(null);
  const liveRunState: RunStatePayload | undefined =
    // The terminal payload wins: the last progress frame still says "running".
    run.completeData ?? run.lastProgressData ?? undefined;
  const runState: RunStatePayload | undefined =
    runSignature !== null && runSignature !== queueSignature
      ? undefined
      : liveRunState;

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

  const startRun = () => {
    setRunSignature(queueSignature);
    void run.refetch();
  };

  const destructive = {
    deleteSource: batch.advanced?.delete_source_files_toggle === 1,
    replaceAlways:
      batch.advanced?.replace_original_file_always_toggle === 1,
    replaceIfSmaller:
      batch.advanced?.replace_original_file_if_converted_is_smaller_toggle === 1,
  };
  const hasDestructive =
    destructive.deleteSource || destructive.replaceAlways || destructive.replaceIfSmaller;

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

  if (sourceCount === 0) {
    return (
      <Panel title={formatMessage(runMessages.emptyTitle)}>
        <p style={{ margin: 0, color: 'var(--hb-textMuted)' }}>
          {formatMessage(runMessages.emptyBody)}
        </p>
        <Button className="mt-3" onClick={onOpenSettings}>
          {formatMessage(runMessages.emptyCta)}
        </Button>
      </Panel>
    );
  }

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
          onClick={() => {
            if (hasDestructive) setConfirming(true);
            else startRun();
          }}
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
          variant="dangerOutline"
          onClick={() => stop.refetch()}
          disabled={!(running || paused)}
        >
          {formatMessage(runMessages.stop)}
        </Button>
        {(scan.loading || run.loading) && <Spinner size="sm" />}
      </div>

      {runState && (
        <div
          style={{ color: 'var(--hb-textMuted)' }}
          aria-live="polite"
          aria-atomic="true"
        >
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

      <Modal show={confirming} onHide={() => setConfirming(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{formatMessage(runMessages.confirmTitle)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>{formatMessage(runMessages.confirmIntro)}</p>
          <ul>
            {destructive.deleteSource && (
              <li>{formatMessage(runMessages.confirmDeleteSource)}</li>
            )}
            {destructive.replaceAlways && (
              <li>{formatMessage(runMessages.confirmReplaceAlways)}</li>
            )}
            {destructive.replaceIfSmaller && !destructive.replaceAlways && (
              <li>{formatMessage(runMessages.confirmReplaceSmaller)}</li>
            )}
          </ul>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            {formatMessage(runMessages.cancel)}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirming(false);
              startRun();
            }}
          >
            {formatMessage(runMessages.confirmStart)}
          </Button>
        </Modal.Footer>
      </Modal>

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
            {!batchResult
              ? formatMessage(runMessages.scanFirst)
              : batchResult.totalCount === 0
                ? formatMessage(runMessages.noMatchingFiles)
                : formatMessage(runMessages.allConverted, {
                    total: batchResult.totalCount,
                  })}
          </div>
        ) : (
          <QueueTable rows={rows} />
        )}
      </Panel>
    </div>
  );
};
