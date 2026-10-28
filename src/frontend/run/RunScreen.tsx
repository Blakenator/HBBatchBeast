import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Spinner } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import {
  ASYNC_CHANNEL,
  BatchTabConfig,
  GlobalAppConfig,
  PROMISE_CHANNEL,
  RunBatchOperationResult,
  countConfiguredRows,
  resolveFilterExpression,
} from '../../common';
import { useBackend, useBackendAsync } from '../helpers';
import { useBatchResult, useSetBatchResultDirect } from '../core/stores';
import { AppStatus } from '../ui/StatusPill';
import { Panel, PanelGrid } from '../ui/Panel';
import { Button } from '../ui/Button';
import { FilterChips } from '../ui/filterBuilder/FilterChips';
import { scanFilterFields } from '../settings/scanFilterFields';
import { QueueTable, QueueRow } from './QueueTable';
import { FailuresPanel } from './FailuresPanel';
import { FolderPairs } from './FolderPairs';
import { ItemLogModal } from './ItemLogModal';
import { RunCharts } from './RunCharts';
import { useRunTelemetry } from './useRunTelemetry';
import { runMessages } from './messages';
import { RunStatePayload } from './types';
import { validateBatchConfig } from './validation';

interface RunScreenProps {
  config: GlobalAppConfig;
  onStatusChange: (status: AppStatus) => void;
  onOpenSettings: () => void;
}

function splitCount(value?: string, enabled?: boolean): number {
  return enabled ? countConfiguredRows(value) : 0;
}

interface ScanRunnerProps {
  config: GlobalAppConfig;
  onResult: (result: RunBatchOperationResult) => void;
  onStateChange: (state: { loading: boolean; error?: { message: string } }) => void;
}

/**
 * Mounted fresh for each scan. The async hook throws if a new message arrives
 * while its previous complete payload is still set, so remounting is how a
 * rescan guarantees clean hook state.
 */
const ScanRunner: React.FC<ScanRunnerProps> = ({
  config,
  onResult,
  onStateChange,
}) => {
  const scan = useBackendAsync({
    channel: ASYNC_CHANNEL.RunBatchOperation,
    props: { config },
    skip: false,
    onComplete: onResult,
  });

  useEffect(() => {
    onStateChange({ loading: scan.loading, error: scan.error ?? undefined });
  }, [scan.loading, scan.error, onStateChange]);

  return null;
};

export const RunScreen: React.FC<RunScreenProps> = ({
  config,
  onStatusChange,
  onOpenSettings,
}) => {
  const { formatMessage } = useIntl();
  const [confirming, setConfirming] = useState(false);
  const [confirmingRescan, setConfirmingRescan] = useState(false);
  const [scanRequest, setScanRequest] = useState(0);
  const [scanState, setScanState] = useState<{
    loading: boolean;
    error?: { message: string };
  }>({ loading: false });
  const batchResult = useBatchResult();
  const setBatchResult = useSetBatchResultDirect();
  const current = config.configs[config.selected_config];
  const batch: Partial<BatchTabConfig> = current?.tab_batch ?? {};

  const problems = useMemo(
    () => validateBatchConfig(current.tab_batch),
    [current.tab_batch],
  );

  const scanItems = batchResult?.fileList ?? [];
  // Excluded rows are visible in the queue but never need a worker.
  const runnableItems = scanItems.filter(
    (item) => (item.action ?? 'encode') !== 'skip',
  );

  const filterExpression = resolveFilterExpression(batch.advanced);

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
    JSON.stringify(filterExpression),
    batch.advanced?.copy_srt_files_toggle,
    batch.advanced?.copy_filtered_files_toggle,
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
        destinationFinalPath: item.destinationFinalPath,
        action: item.action,
        excludedReason: item.excludedReason,
      })),
    },
    skip: true,
  });

  const pause = useBackend({ channel: PROMISE_CHANNEL.PauseRun, skip: true });
  const resume = useBackend({ channel: PROMISE_CHANNEL.ResumeRun, skip: true });
  const stop = useBackend({ channel: PROMISE_CHANNEL.StopRun, skip: true });
  const cancelItem = useBackend({
    channel: PROMISE_CHANNEL.CancelRunItem,
    skip: true,
  });
  const [logRow, setLogRow] = useState<QueueRow | null>(null);
  const [runHidden, setRunHidden] = useState(false);

  // A run only describes the settings it was started with. Keep the signature it
  // ran against so switching profiles or folders cannot show the previous run.
  const [runSignature, setRunSignature] = useState<string | null>(null);
  const liveRunState: RunStatePayload | undefined =
    // The terminal payload wins: the last progress frame still says "running".
    run.completeData ?? run.lastProgressData ?? undefined;
  const runState: RunStatePayload | undefined =
    runHidden || (runSignature !== null && runSignature !== queueSignature)
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
    if (scanState.loading || run.loading) return 'running';
    if (scanState.error || run.error) return 'error';
    return 'idle';
  }, [runState, scanState.loading, run.loading, scanState.error, run.error]);

  useEffect(() => {
    onStatusChange(status);
  }, [status, onStatusChange]);

  const rows: QueueRow[] = useMemo(
    () =>
      runState
        ? runState.items.map((item, index) => ({
            index,
            path: item.path,
            preset: item.preset,
            state: item.state,
            percent: item.percent,
            reason: item.reason,
            worker: item.worker,
            startedAt: item.startedAt,
            finishedAt: item.finishedAt,
            sourceBytes: item.sourceBytes,
            outputBytes: item.outputBytes,
            progress: item.progress,
            logTail: item.logTail,
            filterTrace: scanItems[index]?.filterTrace,
          }))
        : scanItems.map((item, index) => ({
            index,
            path: item.path,
            preset: item.preset,
            state:
              item.action === 'skip'
                ? ('excluded' as const)
                : ('pending' as const),
            reason: item.excludedReason,
            action: item.action,
            filterTrace: item.filterTrace,
          })),
    [runState, scanItems],
  );

  const telemetry = useRunTelemetry(runState);
  const runActive =
    runState?.status === 'running' || runState?.status === 'paused';
  // Re-resolve the open log against the latest rows so a running file's log
  // keeps streaming while the modal is open.
  const activeLogRow = logRow ? rows[logRow.index] ?? logRow : null;

  const requestScan = () => {
    // Clear the old view so the table shows the new scan instead of the last
    // run's results, and remount the scan hook so refetching cannot race its
    // previous complete payload.
    setBatchResult(undefined);
    setRunHidden(true);
    setScanState({ loading: true });
    setScanRequest((current) => current + 1);
  };

  const startRun = () => {
    setRunHidden(false);
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
  const ffmpegMode = batch.FFmpeg_toggle === 1;
  const customPresetCount = countConfiguredRows(batch.custom_preset_string);
  const presetCount = countConfiguredRows(
    ffmpegMode || customPresetCount > 0
      ? batch.custom_preset_string
      : batch.preset,
  );

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
          <FolderPairs
            sourcePath={batch.path?.source_path}
            destinationPath={batch.path?.destination_path}
          />
        </Panel>
        <Panel title={formatMessage(runMessages.encoding)}>
          {batch.FFmpeg_toggle === 1 ? 'FFmpeg' : 'HandBrake'} ·{' '}
          {presetCount > 0
            ? `${presetCount} ${ffmpegMode ? 'argument set' : 'preset'}${
                presetCount === 1 ? '' : 's'
              }`
            : formatMessage(runMessages.noPreset)}{' '}
          · {batch.container ?? '.mp4'}
        </Panel>
        <Panel title={formatMessage(runMessages.filters)}>
          <FilterChips
            expression={filterExpression}
            fields={scanFilterFields}
            empty={formatMessage(runMessages.noFilters)}
            ariaLabel={formatMessage(runMessages.filters)}
          />
          {batchResult?.typeFilteredCount ? (
            <div
              style={{
                marginTop: 'var(--hb-space-xs)',
                color: 'var(--hb-textMuted)',
                fontSize: 'var(--hb-font-xs)',
              }}
            >
              {formatMessage(runMessages.typeFiltered, {
                count: batchResult.typeFilteredCount,
              })}
            </div>
          ) : null}
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
          onClick={() => {
            if (scanItems.length > 0 || runState) setConfirmingRescan(true);
            else requestScan();
          }}
          disabled={scanState.loading || running}
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
            runnableItems.length === 0 ||
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
        {(scanState.loading || run.loading) && <Spinner size="sm" />}
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
            excluded: runState.counts.excluded,
          })}
        </div>
      )}

      {runState && <RunCharts state={runState} telemetry={telemetry} />}

      {scanState.error && (
        <Alert variant="danger">{scanState.error.message}</Alert>
      )}
      {run.error && <Alert variant="danger">{run.error.message}</Alert>}

      <Modal
        show={confirmingRescan}
        onHide={() => setConfirmingRescan(false)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>{formatMessage(runMessages.rescanTitle)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {formatMessage(runMessages.rescanBody)}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setConfirmingRescan(false)}
          >
            {formatMessage(runMessages.cancel)}
          </Button>
          <Button
            onClick={() => {
              setConfirmingRescan(false);
              requestScan();
            }}
          >
            {formatMessage(runMessages.rescanConfirm)}
          </Button>
        </Modal.Footer>
      </Modal>

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

      <FailuresPanel rows={rows} onOpenLog={setLogRow} />

      <Panel
        title={formatMessage(runMessages.queue)}
        actions={
          <span style={{ color: 'var(--hb-textMuted)' }}>
            {formatMessage(runMessages.queueCount, { count: rows.length })}
          </span>
        }
      >
        {rows.length === 0 ? (
          <div
            style={{ color: 'var(--hb-textMuted)' }}
            aria-live="polite"
            aria-atomic="true"
          >
            {scanState.loading
              ? formatMessage(runMessages.scanning)
              : !batchResult
                ? formatMessage(runMessages.scanFirst)
                : batchResult.totalCount === 0
                  ? formatMessage(runMessages.noMatchingFiles)
                  : formatMessage(runMessages.nothingRunnable, {
                      total: batchResult.totalCount,
                      excluded: scanItems.length - runnableItems.length,
                    })}
          </div>
        ) : (
          <QueueTable
            rows={rows}
            onOpenLog={setLogRow}
            onCancel={
              runActive
                ? (row) => {
                    void cancelItem.refetch({ index: row.index });
                  }
                : undefined
            }
          />
        )}
      </Panel>

      <ItemLogModal row={activeLogRow} onClose={() => setLogRow(null)} />

      {scanRequest > 0 && (
        <ScanRunner
          key={scanRequest}
          config={config}
          onResult={setBatchResult}
          onStateChange={setScanState}
        />
      )}
    </div>
  );
};
