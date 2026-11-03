import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Alert, Form, ProgressBar, Spinner } from 'react-bootstrap';
import { toast } from 'react-toastify';
import {
  ASYNC_CHANNEL,
  AppConfigV2,
  Library,
  PROMISE_CHANNEL,
  applyPlanOverride,
  clearOverride,
  createFolderId,
  libraryOrganizeSettings,
  organizerIsPathInside,
  resolveGlobalSettings,
  setOverride,
  withLibraryMediaType,
  type MediaType,
  type OrganizeApplyResult,
  type OrganizeMatchOverride,
  type OrganizePlan,
  type OrganizePlanItem,
  type OrganizeScanProgress,
  type OrganizeScanScope,
  type OrganizeSettings,
} from '../../common';
import { useBackend, useBackendAsync } from '../helpers';
import { formatDuration } from '../run/format';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import { SegmentedControl } from '../settings/SegmentedControl';
import { MatchFixModal } from './MatchFixModal';
import { NamingRulesEditor } from './NamingRulesEditor';
import { OrganizePlanTable } from './OrganizePlanTable';
import { ShowMappings } from './ShowMappings';

interface OrganizePageProps {
  config: AppConfigV2;
  /** Library being organized; quick sessions pass an unsaved copy. */
  library: Library;
  /** Quick sessions never write to saved libraries. */
  isQuick?: boolean;
  onUpdateLibrary: (library: Library) => Promise<unknown> | void;
  onBack: () => void;
  /** Quick sessions can promote themselves to a saved library. */
  onSaveAsLibrary?: (library: Library) => Promise<Library | void> | Library | void;
}

interface PlexStatus {
  exists: boolean;
  writable: boolean;
  running: boolean;
  serviceInstructions: string;
  permissionRemediation: string;
}

interface OrganizeScanRunnerProps {
  library: Library;
  scope?: OrganizeScanScope[];
  onProgress: (progress: OrganizeScanProgress) => void;
  onComplete: (plan: OrganizePlan) => void;
  onError: (message: string) => void;
}

/**
 * Mounted once per scan so the async hook always starts with clean state.
 * Progress arrives faster than the UI needs it, so the parent only stores the
 * latest snapshot.
 */
const OrganizeScanRunner: React.FC<OrganizeScanRunnerProps> = ({
  library,
  scope,
  onProgress,
  onComplete,
  onError,
}) => {
  const [scanLibrary] = useState(library);
  const [scanScope] = useState(scope);
  const handlers = useRef({ onProgress, onComplete, onError });
  handlers.current = { onProgress, onComplete, onError };
  const scan = useBackendAsync({
    channel: ASYNC_CHANNEL.OrganizeScan,
    props: {
      library: scanLibrary,
      ...(scanScope && scanScope.length > 0 ? { scope: scanScope } : {}),
    },
    skip: false,
    onInit: (progress) => handlers.current.onProgress(progress),
    onProgress: (progress) => handlers.current.onProgress(progress),
    onComplete: (plan) => handlers.current.onComplete(plan),
  });

  useEffect(() => {
    if (scan.error) handlers.current.onError(scan.error.message);
  }, [scan.error]);

  return null;
};

const ScanProgress: React.FC<{ progress?: OrganizeScanProgress }> = ({
  progress,
}) => {
  const percent =
    progress && progress.total > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((progress.completed / progress.total) * 100)),
        )
      : undefined;
  const label =
    !progress || progress.phase === 'discovering'
      ? 'Discovering files…'
      : progress.phase === 'matching'
        ? `Matching ${progress.completed} of ${progress.total} files…`
        : 'Building the plan…';
  return (
    <ScanStatus role="status" aria-live="polite">
      <span
        style={{
          display: 'flex',
          gap: 'var(--hb-space-xs)',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Spinner size="sm" animation="border" />
        <span style={{ color: 'var(--hb-text)' }}>{label}</span>
        {percent !== undefined && <strong>{percent}%</strong>}
        {progress && !percent && progress.discovered > 0 && (
          <span>{progress.discovered} file(s) found</span>
        )}
      </span>
      <ProgressBar
        animated
        now={percent ?? 100}
        striped={percent === undefined}
        aria-label="Scan progress"
      />
      <span
        title={progress?.currentFile}
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {progress?.currentShow ? `${progress.currentShow} · ` : ''}
        {progress?.currentFile ?? ''}
      </span>
      {progress && progress.elapsedMs > 0 && (
        <span>
          Elapsed {formatDuration(progress.elapsedMs / 1000)}
          {progress.etaMs !== undefined && progress.etaMs > 0
            ? ` · about ${formatDuration(progress.etaMs / 1000)} left`
            : ''}
        </span>
      )}
    </ScanStatus>
  );
};

const Stepper = styled.div`
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  gap: var(--hb-space-xs);
  padding: var(--hb-space-xs);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surface);
`;

const StepButton = styled.button<{ $active: boolean; $done: boolean }>`
  display: flex;
  align-items: center;
  gap: var(--hb-space-xs);
  min-width: 0;
  padding: var(--hb-space-xs) var(--hb-space-sm);
  border: 1px solid
    ${({ $active }) => ($active ? 'var(--hb-accent)' : 'transparent')};
  border-radius: var(--hb-radius-sm);
  background: ${({ $active }) =>
    $active ? 'var(--hb-surfaceMuted)' : 'transparent'};
  color: ${({ $active }) => ($active ? 'var(--hb-text)' : 'var(--hb-textMuted)')};
  font: inherit;
  font-size: var(--hb-font-sm);
  cursor: pointer;
  text-align: left;

  &:hover {
    color: var(--hb-text);
    background: var(--hb-surfaceMuted);
  }

  &:focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: 1px;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const StepNumber = styled.span<{ $active: boolean; $done: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  font-size: var(--hb-font-xs);
  font-weight: 600;
  border: 1px solid
    ${({ $active, $done }) =>
      $active
        ? 'var(--hb-accent)'
        : $done
          ? 'var(--hb-success)'
          : 'var(--hb-border)'};
  color: ${({ $active, $done }) =>
    $active
      ? 'var(--hb-accent)'
      : $done
        ? 'var(--hb-success)'
        : 'var(--hb-textMuted)'};
`;

const StepNav = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  align-items: center;
  flex-wrap: wrap;
`;

const ScanStatus = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);

  .progress {
    height: 6px;
  }
`;

export const OrganizePage: React.FC<OrganizePageProps> = ({
  config,
  library,
  isQuick = false,
  onUpdateLibrary,
  onBack,
  onSaveAsLibrary,
}) => {
  const [current, setCurrent] = useState<Library>(library);
  const [step, setStep] = useState<'setup' | 'rules' | 'review'>('setup');
  const settings = libraryOrganizeSettings(current);
  const plex = resolveGlobalSettings(config).plex;
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingSave = useRef<Library | null>(null);

  const [newFolder, setNewFolder] = useState('');
  const [plan, setPlan] = useState<OrganizePlan>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applyResult, setApplyResult] = useState<OrganizeApplyResult>();
  const [confirm, setConfirm] = useState<{
    items: OrganizePlanItem[];
    updatePlex: boolean;
  }>();
  const [plexPrompt, setPlexPrompt] = useState<OrganizePlanItem[]>();
  const [fixItem, setFixItem] = useState<OrganizePlanItem>();
  const [busy, setBusy] = useState<string>();
  const [scanning, setScanning] = useState(false);
  const [scanToken, setScanToken] = useState(0);
  const [scanProgress, setScanProgress] = useState<OrganizeScanProgress>();
  const [scope, setScope] = useState<OrganizeScanScope[]>([]);
  const [updatePlex, setUpdatePlex] = useState(
    plex?.updateByDefault ?? false,
  );
  const [plexStatus, setPlexStatus] = useState<PlexStatus>();

  const pickPath = useBackend({
    channel: PROMISE_CHANNEL.PickPath,
    skip: true,
  });
  const applyPlan = useBackend({
    channel: PROMISE_CHANNEL.OrganizeApplyPlan,
    skip: true,
  });
  const checkPlex = useBackend({
    channel: PROMISE_CHANNEL.OrganizeCheckPlex,
    skip: true,
  });
  const controlPlex = useBackend({
    channel: PROMISE_CHANNEL.OrganizeControlPlex,
    skip: true,
  });
  const undoLast = useBackend({
    channel: PROMISE_CHANNEL.OrganizeUndo,
    skip: true,
  });
  const completePending = useBackend({
    channel: PROMISE_CHANNEL.OrganizeCompletePending,
    skip: true,
  });

  // Saved libraries coalesce edits; quick sessions only update local state.
  // Leaving the page flushes whatever is still pending.
  const updateRef = useRef(onUpdateLibrary);
  updateRef.current = onUpdateLibrary;
  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      const pending = pendingSave.current;
      if (pending) {
        void Promise.resolve(updateRef.current(pending)).catch(() => {});
      }
    };
  }, []);

  const commit = (next: Library) => {
    setCurrent(next);
    // Any settings change can move targets, so an old plan is no longer valid.
    setPlan(undefined);
    setSelected(new Set());
    pendingSave.current = next;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      pendingSave.current = null;
      void Promise.resolve(updateRef.current(next)).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
    }, 400);
  };

  const commitSettings = (next: OrganizeSettings) => {
    commit({ ...current, organize: next });
  };

  const changeMediaType = (value: string) => {
    const mediaType: MediaType = value === 'tv' ? 'tv' : 'movies';
    if (mediaType === current.mediaType) return;
    const next = withLibraryMediaType(current, mediaType);
    setCurrent(next);
    setScope([]);
    setPlan(undefined);
    setSelected(new Set());
    void Promise.resolve(onUpdateLibrary(next)).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
  };

  const addFolder = (path: string) => {
    const source = path.trim();
    if (!source) return;
    if (current.folders.some((folder) => folder.source === source)) {
      toast.info('That folder is already in this library.');
      return;
    }
    setNewFolder('');
    commit({
      ...current,
      folders: [
        ...current.folders,
        { id: createFolderId(), source, destination: '' },
      ],
    });
  };

  const removeFolder = (folderId: string) => {
    if (scope.some((show) => show.folderId === folderId)) {
      setScope(scope.filter((show) => show.folderId !== folderId));
    }
    const folder = current.folders.find((candidate) => candidate.id === folderId);
    const remaining = current.folders.filter(
      (candidate) => candidate.id !== folderId,
    );
    const nextSettings: OrganizeSettings = {
      ...settings,
      tvdb: {
        ...settings.tvdb,
        shows: (settings.tvdb?.shows ?? []).filter(
          (mapping) => mapping.folderId !== folderId,
        ),
      },
    };
    if (folder) {
      const caseInsensitive = settings.caseInsensitive ?? false;
      for (const sourcePath of Object.keys(settings.overrides ?? {})) {
        if (
          organizerIsPathInside(sourcePath, folder.source, { caseInsensitive })
        ) {
          const cleared = clearOverride(
            nextSettings,
            sourcePath,
            caseInsensitive,
          );
          nextSettings.overrides = cleared.overrides;
        }
      }
    }
    commit({ ...current, folders: remaining, organize: nextSettings });
  };

  const browseFolder = async () => {
    const result = await pickPath.refetch({
      kind: 'folder',
      title: 'Choose a source folder to organize',
    });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    const selectedPath = result.data?.paths[0];
    if (selectedPath) addFolder(selectedPath);
  };

  const checkPlexDatabase = async () => {
    if (!plex?.dbPath) return;
    const result = await checkPlex.refetch({ path: plex.dbPath });
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    if (result.data) setPlexStatus(result.data);
  };

  const scan = () => {
    if (current.folders.length === 0) {
      toast.info('Add a source folder first.');
      return;
    }
    setApplyResult(undefined);
    setScanProgress(undefined);
    setScanning(true);
    setScanToken((token) => token + 1);
  };

  const selectedItems = useMemo(
    () =>
      (plan?.items ?? []).filter(
        (item) => item.action === 'rename' && selected.has(item.id),
      ),
    [plan, selected],
  );

  const beginApply = async () => {
    if (plan?.items.some((item) => item.action === 'conflict')) return;
    const items = selectedItems;
    if (items.length === 0) return;
    if (updatePlex && plex?.dbPath) {
      setBusy('check');
      try {
        const result = await checkPlex.refetch({ path: plex.dbPath });
        if (result.error) {
          toast.error(result.error.message);
          return;
        }
        if (result.data) setPlexStatus(result.data);
        if (result.data?.running) {
          setPlexPrompt(items);
          return;
        }
      } finally {
        setBusy(undefined);
      }
      setConfirm({ items, updatePlex: true });
      return;
    }
    setConfirm({ items, updatePlex: false });
  };

  const runApply = async (
    items: OrganizePlanItem[],
    withPlex: boolean,
  ) => {
    if (!plan) return;
    setBusy('apply');
    setConfirm(undefined);
    setPlexPrompt(undefined);
    try {
      const subset: OrganizePlan = {
        ...plan,
        items,
        warnings: plan.warnings.filter(
          (warning) => !warning.includes('conflict'),
        ),
      };
      const result = await applyPlan.refetch({
        library: current,
        plan: subset,
        updatePlex: withPlex,
      });
      if (result.error) {
        toast.error(result.error.message);
        return;
      }
      if (result.data) {
        setApplyResult(result.data);
        setPlan((previous) =>
          previous
            ? {
                ...previous,
                items: previous.items.filter(
                  (item) => !items.some((applied) => applied.id === item.id),
                ),
              }
            : previous,
        );
        setSelected(new Set());
      }
    } finally {
      setBusy(undefined);
    }
  };

  const stopPlexAndApply = async (items: OrganizePlanItem[]) => {
    if (!plex?.dbPath) return;
    setBusy('plex');
    try {
      const result = await controlPlex.refetch({
        action: 'stop',
        path: plex.dbPath,
      });
      if (result.error) {
        toast.error(result.error.message);
        return;
      }
      if (result.data) setPlexStatus(result.data);
      if (result.data?.running) {
        toast.error('Plex is still running. Stop it manually and try again.');
        return;
      }
      setPlexPrompt(undefined);
      setConfirm({ items, updatePlex: true });
    } finally {
      setBusy(undefined);
    }
  };

  const undo = async () => {
    setBusy('undo');
    try {
      const result = await undoLast.refetch({});
      if (result.error) {
        toast.error(result.error.message);
        return;
      }
      if (result.data) {
        toast.success(`Reversed ${result.data.reversed} file move(s).`);
        for (const warning of result.data.warnings) toast.warning(warning);
      }
    } finally {
      setBusy(undefined);
    }
  };

  const completePendingTransfers = async () => {
    if (!plex?.dbPath) return;
    setBusy('pending');
    try {
      const result = await completePending.refetch({ dbPath: plex.dbPath });
      if (result.error) {
        toast.error(result.error.message);
        return;
      }
      if (result.data) {
        toast.success(
          `Moved ${result.data.historyMoved} history row(s); ${result.data.pendingTransfers} still pending.`,
        );
        for (const warning of result.data.warnings) toast.warning(warning);
      }
    } finally {
      setBusy(undefined);
    }
  };

  const saveFix = (
    item: OrganizePlanItem,
    override: OrganizeMatchOverride | undefined,
  ) => {
    const caseInsensitive = settings.caseInsensitive ?? false;
    const nextSettings = override
      ? setOverride(settings, item.sourcePath, override, caseInsensitive)
      : clearOverride(settings, item.sourcePath, caseInsensitive);
    commit({ ...current, organize: nextSettings });
    // `commit` clears the stale plan; re-apply it for this one row afterwards.
    if (plan) {
      setPlan(
        applyPlanOverride(plan, item.id, override, {
          settings: nextSettings,
          mediaType: current.mediaType,
          caseInsensitive,
        }),
      );
    }
    setFixItem(undefined);
  };

  const plexConfigured = Boolean(plex?.dbPath);

  return (
    <div style={{ display: 'grid', gap: 'var(--hb-space-lg)' }}>
      <div
        style={{
          display: 'flex',
          gap: 'var(--hb-space-sm)',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <Button compact variant="ghost" icon="back" onClick={onBack}>
          Back
        </Button>
        <strong>
          {isQuick ? 'Quick organize' : `Organize: ${current.name}`}
        </strong>
        {isQuick && (
          <span style={{ color: 'var(--hb-textMuted)', fontSize: 'var(--hb-font-xs)' }}>
            Temporary session — saved libraries are not changed.
          </span>
        )}
      </div>

      {applyResult && (
        <Alert variant="success">
          Renamed {applyResult.renamed.length} file(s).
          {applyResult.plexUpdated > 0
            ? ` Updated ${applyResult.plexUpdated} Plex item(s); moved ${applyResult.historyMoved} history row(s).`
            : ''}
          {applyResult.pendingHistoryTransfers > 0
            ? ` ${applyResult.pendingHistoryTransfers} history transfer(s) are waiting for a Plex rescan.`
            : ''}
          {applyResult.failed.length > 0
            ? ` ${applyResult.failed.length} move(s) failed.`
            : ''}
        </Alert>
      )}

      <Stepper role="tablist" aria-label="Organize steps">
        {(
          [
            ['setup', 'What to organize'],
            ['rules', 'Naming rules'],
            ['review', 'Review and apply'],
          ] as const
        ).map(([id, label], index) => {
          const order = ['setup', 'rules', 'review'];
          const done = order.indexOf(step) > index;
          return (
            <StepButton
              key={id}
              type="button"
              role="tab"
              aria-selected={step === id}
              $active={step === id}
              $done={done}
              onClick={() => setStep(id)}
            >
              <StepNumber $active={step === id} $done={done}>
                {done ? '✓' : index + 1}
              </StepNumber>
              <span>{label}</span>
            </StepButton>
          );
        })}
      </Stepper>

      {step === 'setup' ? (
      <Panel title="What to organize">
        <div style={{ display: 'grid', gap: 'var(--hb-space-sm)' }}>
          <SegmentedControl
            label="Library type"
            value={current.mediaType}
            onChange={changeMediaType}
            options={[
              { value: 'movies', label: 'Movies' },
              { value: 'tv', label: 'TV shows' },
            ]}
          />
          <span style={{ color: 'var(--hb-textMuted)', fontSize: 'var(--hb-font-xs)' }}>
            Source folders are shared with conversion. Destinations, presets and
            filters live in Settings → Convert.
          </span>

          <div style={{ display: 'grid', gap: 'var(--hb-space-xs)' }}>
            <div style={{ display: 'flex', gap: 'var(--hb-space-xs)' }}>
              <Form.Control
                value={newFolder}
                placeholder="Add a source folder path…"
                aria-label="Source folder path"
                onChange={(event) => setNewFolder(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addFolder(newFolder);
                }}
              />
              <Button compact variant="ghost" icon="browse" onClick={() => void browseFolder()}>
                Browse
              </Button>
              <Button
                compact
                variant="secondary"
                icon="add"
                onClick={() => addFolder(newFolder)}
                disabled={!newFolder.trim()}
              >
                Add
              </Button>
            </div>
            {current.folders.length === 0 ? (
              <span style={{ color: 'var(--hb-textMuted)', fontSize: 'var(--hb-font-xs)' }}>
                No source folders yet. Add the movie library or TV library root.
              </span>
            ) : (
              current.folders.map((folder) => (
                <div
                  key={folder.id}
                  style={{
                    display: 'flex',
                    gap: 'var(--hb-space-xs)',
                    alignItems: 'center',
                    fontSize: 'var(--hb-font-xs)',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={folder.source}>
                    {folder.source}
                  </span>
                  <Button
                    compact
                    variant="ghost"
                    icon="delete"
                    onClick={() => removeFolder(folder.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>

          {current.mediaType === 'movies' ? (
            <Form.Group style={{ maxWidth: '22rem' }}>
              <Form.Label>Movie metadata</Form.Label>
              <Form.Select
                value={settings.movieMetadata}
                onChange={(event) =>
                  commitSettings({
                    ...settings,
                    movieMetadata:
                      event.target.value === 'plex' ? 'plex' : 'tvdb',
                  })
                }
              >
                <option value="tvdb">TVDB (no Plex required)</option>
                <option value="plex">Plex database</option>
              </Form.Select>
            </Form.Group>
          ) : (
            <ShowMappings
              library={current}
              settings={settings}
              onSettingsChange={commitSettings}
              scope={scope}
              onScopeChange={setScope}
            />
          )}

          <div
            style={{
              display: 'flex',
              gap: 'var(--hb-space-xs)',
              alignItems: 'center',
              flexWrap: 'wrap',
              fontSize: 'var(--hb-font-xs)',
              color: 'var(--hb-textMuted)',
            }}
          >
            <span>
              Plex database:{' '}
              {plexConfigured ? plex?.dbPath : 'not configured (Settings → Global)'}
            </span>
            {plexConfigured && (
              <Button compact variant="ghost" icon="scan" onClick={() => void checkPlexDatabase()}>
                Check
              </Button>
            )}
          </div>
          {plexStatus && (
            <div style={{ fontSize: 'var(--hb-font-xs)', color: 'var(--hb-textMuted)' }}>
              {plexStatus.running ? 'Plex is running.' : 'Plex is stopped.'}{' '}
              {plexStatus.running
                ? plexStatus.serviceInstructions
                : plexStatus.writable
                  ? 'The database is writable.'
                  : plexStatus.permissionRemediation}
            </div>
          )}
        </div>
      </Panel>

      ) : null}

      {step === 'rules' ? (
      <Panel title="Naming rules">
        <NamingRulesEditor
          mediaType={current.mediaType}
          rules={settings.namingRules}
          confidenceThreshold={settings.confidenceThreshold}
          onChange={(namingRules) => commitSettings({ ...settings, namingRules })}
          onConfidenceChange={(confidenceThreshold) =>
            commitSettings({ ...settings, confidenceThreshold })
          }
        />
      </Panel>

      ) : null}

      {step === 'review' ? (
      <Panel title="Review and apply">
        <div
          style={{
            display: 'grid',
            gap: 'var(--hb-space-sm)',
            minWidth: 0,
          }}
        >
          {plexPrompt && (
            <Alert variant="warning" className="mb-0">
              <div>
                Plex Media Server is running and must be stopped before the
                database can be updated.
              </div>
              <div style={{ display: 'flex', gap: 'var(--hb-space-xs)', marginTop: 'var(--hb-space-sm)', flexWrap: 'wrap' }}>
                <Button
                  compact
                  variant="secondary"
                  onClick={() => void stopPlexAndApply(plexPrompt)}
                  disabled={busy !== undefined}
                >
                  Stop Plex and continue
                </Button>
                <Button
                  compact
                  variant="ghost"
                  onClick={() => {
                    const items = plexPrompt;
                    setPlexPrompt(undefined);
                    setConfirm({ items, updatePlex: false });
                  }}
                  disabled={busy !== undefined}
                >
                  Apply without Plex
                </Button>
                <Button
                  compact
                  variant="ghost"
                  onClick={() => setPlexPrompt(undefined)}
                  disabled={busy !== undefined}
                >
                  Cancel
                </Button>
              </div>
              {plexStatus?.serviceInstructions && (
                <div style={{ marginTop: 'var(--hb-space-xs)', fontSize: 'var(--hb-font-xs)' }}>
                  {plexStatus.serviceInstructions}
                </div>
              )}
            </Alert>
          )}

          {confirm && (
            <Alert variant="info" className="mb-0">
              <div>
                Move {confirm.items.length} file(s)
                {confirm.items.some((item) => item.sidecars.length > 0)
                  ? ' and their subtitle sidecars'
                  : ''}
                {confirm.updatePlex
                  ? ' and update the Plex database, including watch history.'
                  : ' without changing Plex.'}
              </div>
              <div style={{ display: 'flex', gap: 'var(--hb-space-xs)', marginTop: 'var(--hb-space-sm)' }}>
                <Button
                  compact
                  variant="success"
                  onClick={() => void runApply(confirm.items, confirm.updatePlex)}
                  disabled={busy !== undefined}
                >
                  Confirm apply
                </Button>
                <Button
                  compact
                  variant="ghost"
                  onClick={() => setConfirm(undefined)}
                  disabled={busy !== undefined}
                >
                  Cancel
                </Button>
              </div>
            </Alert>
          )}

          {scope.length > 0 && (
            <Alert variant="info" className="mb-0">
              Scan limited to{' '}
              <strong>
                {scope.map((show) => show.name ?? show.subpath).join(', ')}
              </strong>
              . Choose “Scan the whole library” in step 1 to scan everything.
            </Alert>
          )}

          <div style={{ display: 'flex', gap: 'var(--hb-space-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              variant={plan ? 'secondary' : 'success'}
              icon="scan"
              onClick={scan}
              disabled={scanning || busy !== undefined}
            >
              {scanning ? 'Scanning…' : 'Scan files'}
            </Button>
            <Button
              variant="success"
              icon="arrowRight"
              onClick={() => void beginApply()}
              disabled={
                !plan ||
                selectedItems.length === 0 ||
                scanning ||
                busy !== undefined ||
                (plan?.items.some((item) => item.action === 'conflict') ?? false)
              }
            >
              Apply {selectedItems.length > 0 ? `(${selectedItems.length})` : ''}
            </Button>
            <Button
              variant="ghost"
              icon="reset"
              onClick={() => void undo()}
              disabled={scanning || busy !== undefined}
            >
              Undo last
            </Button>
            {plexConfigured && (
              <Button
                variant="ghost"
                icon="rescan"
                onClick={() => void completePendingTransfers()}
                disabled={scanning || busy !== undefined}
              >
                Complete pending history
              </Button>
            )}
            {isQuick && onSaveAsLibrary && (
              <Button
                variant="secondary"
                icon="saveLibrary"
                onClick={() => {
                  void Promise.resolve(onSaveAsLibrary(current)).then(
                    (saved) => {
                      if (saved) setCurrent(saved);
                    },
                  );
                }}
              >
                Save as library
              </Button>
            )}
            <span style={{ flex: 1 }} />
            <Form.Check
              type="checkbox"
              label="Update Plex (stop Plex first)"
              checked={updatePlex && plexConfigured}
              disabled={!plexConfigured || scanning}
              onChange={(event) => setUpdatePlex(event.target.checked)}
            />
          </div>

          {scanning && <ScanProgress progress={scanProgress} />}

          {!plan && !scanning && (
            <div style={{ color: 'var(--hb-textMuted)' }}>
              Scan to build a review list. Nothing changes on disk until you
              apply.
            </div>
          )}

          {plan && (
            <>
              {plan.warnings.length > 0 && (
                <Alert variant="warning" className="mb-0">
                  {plan.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </Alert>
              )}
              <OrganizePlanTable
                plan={plan}
                settings={settings}
                mediaType={current.mediaType}
                selected={selected}
                onSelectedChange={setSelected}
                onFixMatch={setFixItem}
              />
              {plan.items.some((item) => item.action === 'conflict') && (
                <Alert variant="danger" className="mb-0">
                  Resolve the conflicts or change the collision policy before
                  applying.
                </Alert>
              )}
            </>
          )}
        </div>
      </Panel>

      ) : null}

      <StepNav>
        {step !== 'setup' ? (
          <Button
            compact
            variant="secondary"
            icon="back"
            onClick={() => setStep(step === 'review' ? 'rules' : 'setup')}
          >
            Back
          </Button>
        ) : null}
        <span style={{ flex: 1 }} />
        {step === 'setup' ? (
          <Button
            compact
            variant="secondary"
            icon="arrowRight"
            onClick={() => setStep('rules')}
            disabled={current.folders.length === 0}
          >
            Next: naming rules
          </Button>
        ) : step === 'rules' ? (
          <Button
            compact
            variant="secondary"
            icon="arrowRight"
            onClick={() => setStep('review')}
          >
            Next: review
          </Button>
        ) : null}
      </StepNav>

      {scanning && (
        <OrganizeScanRunner
          key={scanToken}
          library={current}
          scope={scope}
          onProgress={setScanProgress}
          onComplete={(next) => {
            setPlan(next);
            setSelected(
              new Set(
                next.items
                  .filter((item) => item.action === 'rename')
                  .map((item) => item.id),
              ),
            );
            setScanProgress(undefined);
            setScanning(false);
          }}
          onError={(message) => {
            toast.error(message);
            setScanProgress(undefined);
            setScanning(false);
          }}
        />
      )}

      {fixItem && (
        <MatchFixModal
          item={fixItem}
          mediaType={current.mediaType}
          settings={settings}
          library={current}
          onClose={() => setFixItem(undefined)}
          onSave={(override) => saveFix(fixItem, override)}
        />
      )}
    </div>
  );
};
