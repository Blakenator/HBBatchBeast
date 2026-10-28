import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Spinner } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import {
  ASYNC_CHANNEL,
  AppConfigV2,
  Library,
  PROMISE_CHANNEL,
  RunBatchOperationResult,
  libraryToRuntimeConfig,
  presetDisplayName,
  validateLibrary,
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

interface RunScreenProps {
  config: AppConfigV2;
  library: Library;
  isQuick?: boolean;
  onSaveLibrary?: (library: Library) => void;
  onEditQuick?: () => void;
  onStatusChange: (status: AppStatus) => void;
  onOpenSettings: () => void;
}

interface ScanRunnerProps {
  config: AppConfigV2;
  library: Library;
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
  library,
  onResult,
  onStateChange,
}) => {
  const scan = useBackendAsync({
    channel: ASYNC_CHANNEL.RunBatchOperation,
    props: {
      config: libraryToRuntimeConfig(config, library),
      library,
      presets: config.presets,
    },
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
  library,
  isQuick,
  onSaveLibrary,
  onEditQuick,
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

  const runtimeConfig = useMemo(
    () => libraryToRuntimeConfig(config, library),
    [config, library],
  );
  const problems = useMemo(
    () => validateLibrary(library, config.presets),
    [library, config.presets],
  );

  const scanItems = batchResult?.fileList ?? [];
  const runnableItems = scanItems.filter(
    (item) => (item.action ?? 'encode') !== 'skip',
  );

  const queueSignature = [
    library.id,
    JSON.stringify(library.folders),
    library.encoder,
    library.container,
    library.defaultPresetId,
    JSON.stringify(library.mappingRules),
    JSON.stringify(library.filters),
    library.defaults.copy_srt_files_toggle,
    library.defaults.copy_filtered_files_toggle,
    JSON.stringify(config.presets),
  ].join('|');

  useEffect(() => {
    setBatchResult(undefined);
  }, [queueSignature, setBatchResult]);

  const run = useBackendAsync({
    channel: ASYNC_CHANNEL.RunConversion,
    props: {
      config: runtimeConfig,
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

  const [runSignature, setRunSignature] = useState<string | null>(null);
  const liveRunState: RunStatePayload | undefined =
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
            presetTrace: scanItems[index]?.presetTrace,
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
            presetTrace: item.presetTrace,
          })),
    [runState, scanItems],
  );

  const telemetry = useRunTelemetry(runState);
  const runActive =
    runState?.status === 'running' || runState?.status === 'paused';
  const activeLogRow = logRow ? rows[logRow.index] ?? logRow : null;

  const requestScan = () => {
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
    deleteSource: library.defaults.delete_source_files_toggle === 1,
    replaceAlways:
      library.defaults.replace_original_file_always_toggle === 1,
    replaceIfSmaller:
      library.defaults
        .replace_original_file_if_converted_is_smaller_toggle === 1,
  };
  const hasDestructive =
    destructive.deleteSource ||
    destructive.replaceAlways ||
    destructive.replaceIfSmaller;

  const running = runState?.status === 'running';
  const paused = runState?.status === 'paused';
  const sourceCount = library.folders.filter(
    (folder) => folder.source.trim().length > 0,
  ).length;
  const destinationCount = library.folders.filter(
    (folder) => folder.destination.trim().length > 0,
  ).length;
  const defaultPreset = config.presets.find(
    (preset) => preset.id === library.defaultPresetId,
  );
  const sourcePath = library.folders.map((folder) => folder.source).join('\n');
  const destinationPath = library.folders
    .map((folder) => folder.destination)
    .join('\n');

  if (sourceCount === 0) {
    return (
      <Panel
        title={formatMessage(runMessages.emptyTitle)}
        icon="emptyFolders"
      >
        <p style={{ margin: 0, color: 'var(--hb-textMuted)' }}>
          {formatMessage(runMessages.emptyBody)}
        </p>
        <Button
          className="mt-3"
          icon="emptyFolders"
          onClick={onOpenSettings}
        >
          {formatMessage(runMessages.emptyCta)}
        </Button>
      </Panel>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--hb-space-lg)' }}>
      <PanelGrid>
        <Panel title={formatMessage(runMessages.folders)} icon="folders">
          <strong>{sourceCount}</strong> source →{' '}
          <strong>{destinationCount}</strong> destination
          {library.defaults.temp_toggle === 1 ? ' · temp staging' : ''}
          <FolderPairs
            sourcePath={sourcePath}
            destinationPath={destinationPath}
          />
        </Panel>
        <Panel title={formatMessage(runMessages.encoding)} icon="encoding">
          {library.encoder === 'ffmpeg' ? 'FFmpeg' : 'HandBrake'} ·{' '}
          {presetDisplayName(defaultPreset) || formatMessage(runMessages.noPreset)}{' '}
          · {library.container}
          {library.mappingRules.length > 0
            ? ` · ${library.mappingRules.length} mapping rule${
                library.mappingRules.length === 1 ? '' : 's'
              }`
            : ''}
        </Panel>
        <Panel title={formatMessage(runMessages.filters)} icon="filters">
          <FilterChips
            expression={library.filters}
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

      <div style={{ display: 'flex', gap: 'var(--hb-space-sm)', flexWrap: 'wrap' }}>
        <Button
          icon="scan"
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
          icon="start"
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
          icon={paused ? 'resume' : 'pause'}
          onClick={() => (paused ? void resume.refetch() : void pause.refetch())}
          disabled={!running && !paused}
        >
          {formatMessage(paused ? runMessages.resume : runMessages.pause)}
        </Button>
        <Button
          variant="dangerOutline"
          icon="stop"
          onClick={() => stop.refetch()}
          disabled={!(running || paused)}
        >
          {formatMessage(runMessages.stop)}
        </Button>
        {isQuick && onEditQuick && (
          <Button
            variant="ghost"
            icon="edit"
            onClick={onEditQuick}
            disabled={running || paused}
          >
            Edit quick setup
          </Button>
        )}
        {isQuick && onSaveLibrary && (
          <Button
            variant="ghost"
            icon="saveLibrary"
            onClick={() => onSaveLibrary(library)}
            disabled={problems.length > 0 || running || paused}
          >
            Save as library
          </Button>
        )}
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
        <Modal.Body>{formatMessage(runMessages.rescanBody)}</Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setConfirmingRescan(false)}
          >
            {formatMessage(runMessages.cancel)}
          </Button>
          <Button
            icon="rescan"
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
            icon="start"
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
        icon="queue"
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
          library={library}
          onResult={setBatchResult}
          onStateChange={setScanState}
        />
      )}
    </div>
  );
};
