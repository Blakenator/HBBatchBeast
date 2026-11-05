import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { Alert, Form, ProgressBar, Spinner } from 'react-bootstrap';
import { toast } from 'react-toastify';
import {
  ASYNC_CHANNEL,
  AppConfigV2,
  Library,
  PROMISE_CHANNEL,
  approvePlanItems,
  applyPlanOverride,
  carryPlanRowFlags,
  setPlanFolderOnly,
  applyPlanSkips,
  applyPlanBestGuess,
  mergeRescannedPlan,
  clearOverride,
  createFolderId,
  libraryOrganizeSettings,
  organizeLibrarySignature,
  organizeMatchSignature,
  organizePlanSignature,
  organizerIsPathInside,
  overrideFor,
  pathDirname,
  replanPlan,
  resolveGlobalSettings,
  resolveShowMapping,
  setOverride,
  withLibraryMediaType,
  type MediaType,
  type OrganizeApplyResult,
  type OrganizeMatchOverride,
  type OrganizePlan,
  type OrganizePlanItem,
  type OrganizePlexCheck,
  type OrganizeScanProgress,
  type OrganizeScanScope,
  type OrganizeSettings,
  type PlexFixStep,
} from '../../common';
import { useBackend, useBackendAsync, backendFailure } from '../helpers';
import { formatDuration } from '../run/format';
import { Button } from '../ui/Button';
import { Panel } from '../ui/Panel';
import {
  PlexCommandBlock,
  PlexStatusReport,
} from '../ui/PlexStatusReport';
import { SegmentedControl } from '../settings/SegmentedControl';
import { MatchFixModal } from './MatchFixModal';
import { NamingRulesEditor } from './NamingRulesEditor';
import { OrganizePlanTable } from './OrganizePlanTable';
import { ShowMappings } from './ShowMappings';
import {
  readOrganizeSession,
  saveOrganizeSession,
  type OrganizeStep,
} from './organizeSession';
import { describeOrganizeScanError } from './scanError';

const MAX_VISIBLE_WARNINGS = 8;
const MAX_VISIBLE_SCOPE = 7;
const MAX_VISIBLE_FAILURES = 6;

function compactWarnings(warnings: string[]): {
  visible: string[];
  hidden: number;
} {
  const unique = [...new Set(warnings.filter(Boolean))];
  return {
    visible: unique.slice(0, MAX_VISIBLE_WARNINGS),
    hidden: Math.max(0, unique.length - MAX_VISIBLE_WARNINGS),
  };
}

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

interface OrganizeScanRunnerProps {
  library: Library;
  scope?: OrganizeScanScope[];
  /** Reuses cached discovery data instead of walking the folders again. */
  reuseScanId?: string;
  /** Walks only these folders again for a partial rescan. */
  rescanFolders?: string[];
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
  reuseScanId,
  rescanFolders,
  onProgress,
  onComplete,
  onError,
}) => {
  const [scanLibrary] = useState(library);
  const [scanScope] = useState(scope);
  const [scanCacheId] = useState(reuseScanId);
  const [scanFolders] = useState(rescanFolders);
  const handlers = useRef({ onProgress, onComplete, onError });
  handlers.current = { onProgress, onComplete, onError };
  const scan = useBackendAsync({
    channel: ASYNC_CHANNEL.OrganizeScan,
    props: {
      library: scanLibrary,
      ...(scanScope && scanScope.length > 0 ? { scope: scanScope } : {}),
      ...(scanCacheId ? { reuseScanId: scanCacheId } : {}),
      ...(scanFolders && scanFolders.length > 0
        ? { rescanFolders: scanFolders }
        : {}),
    },
    skip: false,
    onInit: (progress) => handlers.current.onProgress(progress),
    onProgress: (progress) => handlers.current.onProgress(progress),
    onComplete: (plan) => handlers.current.onComplete(plan),
  });

  useEffect(() => {
    if (!scan.error) return;
    console.error('Organize scan failed', scan.error);
    handlers.current.onError(describeOrganizeScanError(scan.error));
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
  const [initialSession] = useState(() => {
    const stored = readOrganizeSession(library.id);
    if (!stored) return undefined;
    return stored.librarySignature === organizeLibrarySignature(library)
      ? stored
      : undefined;
  });
  const [current, setCurrent] = useState<Library>(library);
  const settings = libraryOrganizeSettings(current);
  const [step, setStep] = useState<OrganizeStep>(initialSession?.step ?? 'setup');
  const [plan, setPlan] = useState<OrganizePlan | undefined>(initialSession?.plan);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSession?.selected ?? []),
  );
  const [scope, setScope] = useState<OrganizeScanScope[]>(
    initialSession?.scope ?? [],
  );
  const plex = resolveGlobalSettings(config).plex;
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingSave = useRef<Library | null>(null);
  const planTimer = useRef<number | undefined>(undefined);
  /**
   * Rows to force onto their best match once a recalculation returns. A
   * recalculated plan applies the settings' confidence threshold, which would
   * otherwise turn a requested best guess back into a skip.
   */
  const pendingBestGuess = useRef<Set<string>>(new Set());
  const latestSession = useRef<{
    libraryId: string;
    step: OrganizeStep;
    plan: OrganizePlan | undefined;
    selected: Set<string>;
    scope: OrganizeScanScope[];
    settings: OrganizeSettings;
    mediaType: MediaType;
    librarySignature: string;
  }>({
    libraryId: current.id,
    step,
    plan,
    selected,
    scope,
    settings,
    mediaType: current.mediaType,
    librarySignature: organizeLibrarySignature(current),
  });
  latestSession.current = {
    libraryId: current.id,
    step,
    plan,
    selected,
    scope,
    settings,
    mediaType: current.mediaType,
    librarySignature: organizeLibrarySignature(current),
  };

  const [newFolder, setNewFolder] = useState('');
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
  const [scanMode, setScanMode] = useState<
    'fresh' | 'recalculate' | 'rescan'
  >('fresh');
  const [reuseScanId, setReuseScanId] = useState<string>();
  /** Parent folders of the rows picked for a partial rescan. */
  const [rescanFolders, setRescanFolders] = useState<string[]>([]);
  const [scanProgress, setScanProgress] = useState<OrganizeScanProgress>();
  const [updatePlex, setUpdatePlex] = useState(
    plex?.updateByDefault ?? false,
  );
  const [plexStatus, setPlexStatus] = useState<OrganizePlexCheck>();
  const [plexFixSteps, setPlexFixSteps] = useState<PlexFixStep[]>();

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
  const fixPlex = useBackend({
    channel: PROMISE_CHANNEL.OrganizeFixPlex,
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
      const hadPendingPlan = planTimer.current !== undefined;
      if (planTimer.current) window.clearTimeout(planTimer.current);
      const pending = pendingSave.current;
      if (pending) {
        void Promise.resolve(updateRef.current(pending)).catch(() => {});
      }
      const latest = latestSession.current;
      const finalPlan =
        hadPendingPlan && latest.plan
          ? replanPlan(latest.plan, {
              settings: latest.settings,
              mediaType: latest.mediaType,
              caseInsensitive: latest.settings.caseInsensitive ?? false,
            })
          : latest.plan;
      saveOrganizeSession({
        libraryId: latest.libraryId,
        step: latest.step,
        plan: finalPlan,
        selected: [...latest.selected],
        scope: latest.scope,
        matchSignature: organizeMatchSignature(latest.settings),
        planSignature: organizePlanSignature(latest.settings),
        librarySignature: latest.librarySignature,
        updatedAt: Date.now(),
      });
    };
  }, []);

  const commit = (next: Library, options: { keepPlan?: boolean } = {}) => {
    setCurrent(next);
    if (!options.keepPlan) {
      if (planTimer.current) window.clearTimeout(planTimer.current);
      planTimer.current = undefined;
      setPlan(undefined);
      setSelected(new Set());
    }
    pendingSave.current = next;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      pendingSave.current = null;
      void Promise.resolve(updateRef.current(next)).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
    }, 400);
  };

  /**
   * Persists an organizer settings change and recalculates the existing review
   * when possible: match inputs rematch in the backend, naming inputs replan
   * locally.
   */
  const commitSettings = (next: OrganizeSettings) => {
    const matchChanged =
      organizeMatchSignature(next) !== organizeMatchSignature(settings);
    const planChanged =
      organizePlanSignature(next) !== organizePlanSignature(settings);
    commit({ ...current, organize: next }, { keepPlan: true });
    if (!plan) return;
    if (matchChanged) {
      if (planTimer.current) window.clearTimeout(planTimer.current);
      planTimer.current = undefined;
      if (plan.scanId) {
        recalculateMatches(plan.scanId);
      } else {
        setPlan(undefined);
        toast.info('Scan the library again to apply the new show matches.');
      }
      return;
    }
    if (planChanged) {
      if (planTimer.current) window.clearTimeout(planTimer.current);
      planTimer.current = window.setTimeout(() => {
        planTimer.current = undefined;
        setPlan((previous) =>
          previous
            ? replanPlan(previous, {
                settings: next,
                mediaType: current.mediaType,
                caseInsensitive: next.caseInsensitive ?? false,
              })
            : previous,
        );
      }, 200);
    }
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

  /**
   * Toasts the reason a sync IPC call failed. Reports `true` so callers can
   * stop; the hooks also resolve to `undefined` when the bridge rejects.
   */
  const reportFailure = (
    result: { error?: unknown } | undefined,
    fallback: string,
  ): boolean => {
    const message = backendFailure(result, fallback);
    if (!message) return false;
    toast.error(message);
    return true;
  };

  const browseFolder = async () => {
    const result = await pickPath.refetch({
      kind: 'folder',
      title: 'Choose a source folder to organize',
    });
    if (reportFailure(result, 'Could not open the folder picker.')) return;
    const selectedPath = result.data?.paths[0];
    if (selectedPath) addFolder(selectedPath);
  };

  const checkPlexDatabase = async () => {
    if (!plex?.dbPath) return;
    const result = await checkPlex.refetch({ path: plex.dbPath });
    if (reportFailure(result, 'Could not check the Plex database.')) return;
    if (result.data) {
      setPlexStatus(result.data);
      setPlexFixSteps(undefined);
    }
  };

  const runPlexAutoFix = async () => {
    if (!plex?.dbPath) return;
    setBusy('plexFix');
    try {
      const result = await fixPlex.refetch({ path: plex.dbPath });
      if (
        reportFailure(result, 'Could not fix the Plex database access.')
      ) {
        return;
      }
      if (result.data) {
        setPlexStatus(result.data.check);
        setPlexFixSteps(result.data.steps);
        if (
          plexPrompt &&
          result.data.check.writable &&
          !result.data.check.running
        ) {
          const items = plexPrompt;
          setPlexPrompt(undefined);
          setConfirm({ items, updatePlex: true });
        }
      } else {
        toast.error('Could not fix the Plex database access.');
      }
    } finally {
      setBusy(undefined);
    }
  };

  const recheckPlexAndContinue = async () => {
    if (!plex?.dbPath || !plexPrompt) return;
    setBusy('check');
    try {
      const result = await checkPlex.refetch({ path: plex.dbPath });
      if (reportFailure(result, 'Could not re-check the Plex database.')) {
        return;
      }
      if (!result.data) {
        toast.error('Could not re-check the Plex database.');
        return;
      }
      setPlexStatus(result.data);
      setPlexFixSteps(undefined);
      if (result.data.writable && !result.data.running) {
        const items = plexPrompt;
        setPlexPrompt(undefined);
        setConfirm({ items, updatePlex: true });
      }
    } finally {
      setBusy(undefined);
    }
  };

  const scan = () => {
    if (current.folders.length === 0) {
      toast.info('Add a source folder first.');
      return;
    }
    pendingBestGuess.current = new Set();
    setApplyResult(undefined);
    if (planTimer.current) window.clearTimeout(planTimer.current);
    planTimer.current = undefined;
    setScanProgress(undefined);
    setScanMode('fresh');
    setReuseScanId(undefined);
    setRescanFolders([]);
    setScanning(true);
    setScanToken((token) => token + 1);
  };

  function recalculateMatches(scanId: string) {
    setScanProgress(undefined);
    setScanMode('recalculate');
    setReuseScanId(scanId);
    setRescanFolders([]);
    setScanning(true);
    setScanToken((token) => token + 1);
  }

  /**
   * Walks the parent folders of the selected rows again so added, removed and
   * renamed files in those folders are picked up and re-matched.
   */
  function rescanFoldersFor(items: OrganizePlanItem[]) {
    const folders = [
      ...new Set(
        items.map((item) => pathDirname(item.sourcePath)).filter(Boolean),
      ),
    ];
    if (folders.length === 0) return;
    pendingBestGuess.current = new Set();
    setApplyResult(undefined);
    if (planTimer.current) window.clearTimeout(planTimer.current);
    planTimer.current = undefined;
    setScanProgress(undefined);
    setScanMode('rescan');
    setReuseScanId(undefined);
    setRescanFolders(folders);
    setScanning(true);
    setScanToken((token) => token + 1);
  }

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
        if (reportFailure(result, 'Could not check the Plex database.')) {
          return;
        }
        if (!result.data) {
          toast.error('Could not check the Plex database.');
          return;
        }
        setPlexStatus(result.data);
        setPlexFixSteps(undefined);
        if (result.data.running || !result.data.writable) {
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
    setApplyResult(undefined);
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
      if (reportFailure(result, 'Could not apply the organize plan.')) return;
      if (result.data) {
        const applied = result.data;
        setApplyResult(applied);
        // Keep the rows whose move failed in the review so their error stays
        // visible and the user can retry them.
        const attempts = new Set(items.map((item) => item.id));
        const failedPaths = new Set(applied.failed.map((failure) => failure.path));
        setPlan((previous) =>
          previous
            ? {
                ...previous,
                items: previous.items.filter(
                  (item) =>
                    !attempts.has(item.id) || failedPaths.has(item.sourcePath),
                ),
              }
            : previous,
        );
        setSelected(
          new Set(
            items
              .filter((item) => failedPaths.has(item.sourcePath))
              .map((item) => item.id),
          ),
        );
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
      if (reportFailure(result, 'Could not stop Plex.')) return;
      if (!result.data) {
        toast.error('Could not stop Plex.');
        return;
      }
      setPlexStatus(result.data);
      if (result.data.running) {
        toast.error('Plex is still running. Stop it manually and try again.');
        return;
      }
      if (!result.data.writable) {
        toast.info(
          'Plex is stopped, but the database or its folder is still read-only. Fix access before applying.',
        );
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
      if (reportFailure(result, 'Could not undo the last apply.')) return;
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
      if (
        reportFailure(
          result,
          'Could not complete the pending history transfers.',
        )
      ) {
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
    const matchChanged =
      organizeMatchSignature(nextSettings) !== organizeMatchSignature(settings);
    commit({ ...current, organize: nextSettings }, { keepPlan: true });
    if (plan && override) {
      // Re-plan only this row; other review decisions stay untouched.
      setPlan(
        applyPlanOverride(plan, item.id, override, {
          settings: nextSettings,
          mediaType: current.mediaType,
          caseInsensitive,
        }),
      );
    } else if (plan) {
      // Use best guess: drop the override and any skip, then keep this row's
      // top-ranked match even when it scored below the confidence threshold.
      const skipped = new Set(
        plan.items
          .filter(
            (candidate) => candidate.manualSkip && candidate.id !== item.id,
          )
          .map((candidate) => candidate.id),
      );
      const basePlan = applyPlanSkips(plan, skipped, {
        settings: nextSettings,
        mediaType: current.mediaType,
        caseInsensitive,
      });
      const replanOptions = {
        settings: nextSettings,
        mediaType: current.mediaType,
        caseInsensitive,
      };
      if (matchChanged) {
        // The stored match was the manual override, so the automatic one has
        // to come back from the cached scan before it can be promoted.
        setPlan(basePlan);
        if (plan.scanId) {
          pendingBestGuess.current = new Set([item.id]);
          recalculateMatches(plan.scanId);
        } else {
          setPlan(undefined);
          toast.info('Scan the library again to restore the automatic match.');
        }
      } else {
        const promoted = applyPlanBestGuess(basePlan, [item.id], replanOptions);
        setPlan(promoted);
        if (promoted === basePlan) {
          toast.info(
            'No automatic match is available for this file. Pick an episode or movie to fix it manually.',
          );
        }
      }
    }
    setFixItem(undefined);
  };

  const skipItem = (item: OrganizePlanItem, skip: boolean) => {
    if (!plan) return;
    const skipped = new Set(
      plan.items.filter((candidate) => candidate.manualSkip).map((candidate) => candidate.id),
    );
    if (skip) skipped.add(item.id);
    else skipped.delete(item.id);
    setPlan(
      applyPlanSkips(plan, skipped, {
        settings,
        mediaType: current.mediaType,
        caseInsensitive: settings.caseInsensitive ?? false,
      }),
    );
    if (skip && selected.has(item.id)) {
      const next = new Set(selected);
      next.delete(item.id);
      setSelected(next);
    }
  };

  const runBulkAction = (
    action: 'skip' | 'useBestGuess' | 'rescan' | 'approve' | 'folderOnly',
    items: OrganizePlanItem[],
  ) => {
    if (!plan || items.length === 0) return;
    if (action === 'rescan') {
      rescanFoldersFor(items);
      return;
    }
    if (action === 'skip') {
      const skipped = new Set(
        plan.items
          .filter((candidate) => candidate.manualSkip)
          .map((candidate) => candidate.id),
      );
      for (const item of items) skipped.add(item.id);
      setPlan(
        applyPlanSkips(plan, skipped, {
          settings,
          mediaType: current.mediaType,
          caseInsensitive: settings.caseInsensitive ?? false,
        }),
      );
      setSelected(new Set());
      return;
    }
    if (action === 'approve') {
      // Approval behaves like saving the row's current match: the override
      // keeps the episode/movie on later scans, and the plan flag keeps the row
      // a rename across replans in this review.
      const caseInsensitive = settings.caseInsensitive ?? false;
      let nextSettings = settings;
      for (const item of items) {
        if (overrideFor(nextSettings, item.sourcePath, caseInsensitive)) continue;
        let override: OrganizeMatchOverride | undefined;
        if (item.mediaType === 'tv') {
          const folder = current.folders.find((candidate) =>
            organizerIsPathInside(item.sourcePath, candidate.source, {
              caseInsensitive,
            }),
          );
          const series = folder
            ? resolveShowMapping(
                nextSettings,
                folder.id,
                item.sourceRelativePath,
                { caseInsensitive },
              )?.series
            : undefined;
          if (series && (item.episode || item.episodes?.length)) {
            override = {
              series,
              ...(item.episode ? { episode: item.episode } : {}),
              ...(item.episodes?.length ? { episodes: item.episodes } : {}),
            };
          }
        } else if (item.movie) {
          override = { movie: item.movie };
        }
        if (override) {
          nextSettings = setOverride(
            nextSettings,
            item.sourcePath,
            override,
            caseInsensitive,
          );
        }
      }
      if (nextSettings !== settings) {
        commit({ ...current, organize: nextSettings }, { keepPlan: true });
      }
      setPlan(
        approvePlanItems(
          plan,
          items.map((item) => item.id),
          {
            settings: nextSettings,
            mediaType: current.mediaType,
            caseInsensitive,
          },
        ),
      );
      return;
    }
    if (action === 'folderOnly') {
      // Toggle: a selection that is entirely folder-only goes back to the
      // template file name.
      const allFolderOnly = items.every(
        (item) =>
          plan.items.find((candidate) => candidate.id === item.id)
            ?.renameFolderOnly,
      );
      setPlan(
        setPlanFolderOnly(
          plan,
          items.map((item) => item.id),
          !allFolderOnly,
          {
            settings,
            mediaType: current.mediaType,
            caseInsensitive: settings.caseInsensitive ?? false,
          },
        ),
      );
      return;
    }
    const caseInsensitive = settings.caseInsensitive ?? false;
    let nextSettings = settings;
    for (const item of items) {
      nextSettings = clearOverride(
        nextSettings,
        item.sourcePath,
        caseInsensitive,
      );
    }
    const selectedIds = new Set(items.map((item) => item.id));
    const manualSkips = plan.items
      .filter((candidate) => candidate.manualSkip)
      .map((candidate) => candidate.id);
    const remainingSkips = manualSkips.filter((id) => !selectedIds.has(id));
    const skipChanged = remainingSkips.length !== manualSkips.length;
    const matchChanged =
      organizeMatchSignature(nextSettings) !== organizeMatchSignature(settings);
    const basePlan = skipChanged
      ? applyPlanSkips(plan, remainingSkips, {
          settings: nextSettings,
          mediaType: current.mediaType,
          caseInsensitive,
        })
      : plan;
    commit({ ...current, organize: nextSettings }, { keepPlan: true });
    if (matchChanged) {
      // Cleared overrides have to be re-matched against the cached scan; the
      // requested best guesses are promoted again when that plan arrives.
      setPlan(basePlan);
      if (plan.scanId) {
        pendingBestGuess.current = selectedIds;
        recalculateMatches(plan.scanId);
      } else {
        setPlan(undefined);
        toast.info(
          'Scan the library again to restore the automatic matches.',
        );
      }
      return;
    }
    const promoted = applyPlanBestGuess(basePlan, selectedIds, {
      settings: nextSettings,
      mediaType: current.mediaType,
      caseInsensitive,
    });
    setPlan(promoted);
    if (promoted === basePlan) {
      toast.info(
        'The selected file(s) have no automatic match to use. Fix them manually.',
      );
    }
  };

  const matchSignature = organizeMatchSignature(settings);
  const planSignature = organizePlanSignature(settings);
  const librarySignature = organizeLibrarySignature(current);
  useEffect(() => {
    saveOrganizeSession({
      libraryId: current.id,
      step,
      plan,
      selected: [...selected],
      scope,
      matchSignature,
      planSignature,
      librarySignature,
      updatedAt: Date.now(),
    });
  }, [
    current.id,
    librarySignature,
    matchSignature,
    plan,
    planSignature,
    scope,
    selected,
    step,
  ]);

  useEffect(() => {
    setPlexStatus(undefined);
    setPlexFixSteps(undefined);
  }, [plex?.dbPath]);

  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (!initialSession?.plan || !plan) return;
    if (
      initialSession.matchSignature &&
      initialSession.matchSignature !== organizeMatchSignature(settings)
    ) {
      if (plan.scanId) recalculateMatches(plan.scanId);
      else {
        setPlan(undefined);
        toast.info('Show matches changed. Scan the library again to apply them.');
      }
      return;
    }
    if (
      initialSession.planSignature &&
      initialSession.planSignature !== organizePlanSignature(settings)
    ) {
      setPlan(
        replanPlan(plan, {
          settings,
          mediaType: current.mediaType,
          caseInsensitive: settings.caseInsensitive ?? false,
        }),
      );
    }
  }, []);

  const plexConfigured = Boolean(plex?.dbPath);
  const warnings = compactWarnings(plan?.warnings ?? []);

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
          {isQuick ? 'One-off organize' : `Organize: ${current.name}`}
        </strong>
        {isQuick && (
          <span style={{ color: 'var(--hb-textMuted)', fontSize: 'var(--hb-font-xs)' }}>
            Temporary session — saved libraries are not changed.
          </span>
        )}
      </div>

      {applyResult && (() => {
        const failures = applyResult.failed;
        const applyWarnings = applyResult.warnings.filter(
          (warning) => !(plan?.warnings ?? []).includes(warning),
        );
        return (
          <Alert variant={failures.length > 0 ? 'danger' : 'success'}>
            <div>
              Renamed {applyResult.renamed.length} file(s).
              {applyResult.plexUpdated > 0
                ? ` Updated ${applyResult.plexUpdated} Plex item(s); moved ${applyResult.historyMoved} history row(s).`
                : ''}
              {applyResult.pendingHistoryTransfers > 0
                ? ` ${applyResult.pendingHistoryTransfers} history transfer(s) are waiting for a Plex rescan.`
                : ''}
              {failures.length > 0
                ? ` ${failures.length} move(s) failed; those files stay in the review.`
                : ''}
            </div>
            {failures.length > 0 && (
              <ul
                style={{
                  margin: 'var(--hb-space-xs) 0 0',
                  paddingLeft: '1.2rem',
                }}
              >
                {failures.slice(0, MAX_VISIBLE_FAILURES).map((failure) => (
                  <li
                    key={failure.path}
                    style={{ overflowWrap: 'anywhere' }}
                  >
                    <strong>{failure.path}</strong> — {failure.message}
                  </li>
                ))}
              </ul>
            )}
            {failures.length > MAX_VISIBLE_FAILURES && (
              <div>
                and {failures.length - MAX_VISIBLE_FAILURES} more failed
                move(s)…
              </div>
            )}
            {applyWarnings.length > 0 && (
              <ul
                style={{
                  margin: 'var(--hb-space-xs) 0 0',
                  paddingLeft: '1.2rem',
                }}
              >
                {applyWarnings
                  .slice(0, MAX_VISIBLE_WARNINGS)
                  .map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
              </ul>
            )}
          </Alert>
        );
      })()}

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
            <PlexStatusReport
              check={plexStatus}
              fixing={busy === 'plexFix'}
              fixSteps={plexFixSteps}
              onAutoFix={() => void runPlexAutoFix()}
            />
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
                {plexStatus?.running
                  ? 'Plex Media Server is running and must be stopped before the database can be updated.'
                  : 'HBBatchBeast cannot write the Plex database.'}
              </div>
              <div style={{ display: 'flex', gap: 'var(--hb-space-xs)', marginTop: 'var(--hb-space-sm)', flexWrap: 'wrap' }}>
                {plexStatus?.running && (
                  <Button
                    compact
                    variant="secondary"
                    onClick={() => void stopPlexAndApply(plexPrompt)}
                    disabled={busy !== undefined}
                  >
                    Stop Plex and continue
                  </Button>
                )}
                <Button
                  compact
                  variant="ghost"
                  icon="scan"
                  onClick={() => void recheckPlexAndContinue()}
                  disabled={busy !== undefined}
                >
                  Recheck
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
              {plexStatus && (
                <div
                  style={{
                    marginTop: 'var(--hb-space-sm)',
                    display: 'grid',
                    gap: 'var(--hb-space-xs)',
                  }}
                >
                  {!plexStatus.writable && plexStatus.canAutoFix && (
                    <div>
                      <Button
                        compact
                        variant="secondary"
                        icon="fix"
                        onClick={() => void runPlexAutoFix()}
                        disabled={busy !== undefined}
                      >
                        {busy === 'plexFix'
                          ? 'Fixing…'
                          : 'Fix database access automatically'}
                      </Button>
                    </div>
                  )}
                  <PlexCommandBlock
                    steps={
                      plexStatus.writable
                        ? plexStatus.remediation.steps.filter(
                            (step) => step.id === 'stop-service',
                          )
                        : plexStatus.remediation.steps.filter(
                            (step) => step.id === 'grant-access',
                          )
                    }
                    summary={
                      plexStatus.writable
                        ? 'Stop Plex, then choose Stop Plex and continue.'
                        : 'Grant access to the database folder, then continue.'
                    }
                  />
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
              <div>
                Scan limited to {scope.length} show folder
                {scope.length === 1 ? '' : 's'}:
              </div>
              <ul
                style={{
                  margin: 'var(--hb-space-xs) 0',
                  paddingLeft: '1.2rem',
                }}
              >
                {scope.slice(0, MAX_VISIBLE_SCOPE).map((show) => (
                  <li key={`${show.folderId}:${show.subpath}`}>
                    {show.name ?? show.subpath}
                  </li>
                ))}
              </ul>
              {scope.length > MAX_VISIBLE_SCOPE && (
                <div>and {scope.length - MAX_VISIBLE_SCOPE} more…</div>
              )}
              <div>
                Choose “Scan the whole library” in step 1 to scan everything.
              </div>
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
              {warnings.visible.length > 0 && (
                <Alert variant="warning" className="mb-0">
                  {warnings.visible.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                  {warnings.hidden > 0 && (
                    <div>{warnings.hidden} more warning(s) are hidden.</div>
                  )}
                </Alert>
              )}
              <OrganizePlanTable
                plan={plan}
                settings={settings}
                mediaType={current.mediaType}
                selected={selected}
                onSelectedChange={setSelected}
                onFixMatch={setFixItem}
                onSkipChange={skipItem}
                onBulkAction={runBulkAction}
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
          reuseScanId={scanMode === 'recalculate' ? reuseScanId : undefined}
          rescanFolders={scanMode === 'rescan' ? rescanFolders : undefined}
          onProgress={setScanProgress}
          onComplete={(next) => {
            if (scanMode === 'rescan' && plan) {
              const merged = mergeRescannedPlan(plan, next, rescanFolders, {
                settings,
                mediaType: current.mediaType,
                caseInsensitive: settings.caseInsensitive ?? false,
              });
              const available = new Set(merged.items.map((item) => item.id));
              setSelected(
                new Set([...selected].filter((id) => available.has(id))),
              );
              setPlan(merged);
              toast.info(
                `Rescanned ${next.items.length} file(s) in ${rescanFolders.length} folder(s).`,
              );
            } else if (scanMode === 'recalculate' && plan) {
              const skips = plan.items
                .filter((item) => item.manualSkip)
                .map((item) => item.id);
              const recalculated =
                skips.length > 0
                  ? applyPlanSkips(next, skips, {
                      settings,
                      mediaType: current.mediaType,
                      caseInsensitive: settings.caseInsensitive ?? false,
                    })
                  : next;
              const withRowFlags = carryPlanRowFlags(plan, recalculated, {
                settings,
                mediaType: current.mediaType,
                caseInsensitive: settings.caseInsensitive ?? false,
              });
              const bestGuessIds = pendingBestGuess.current;
              pendingBestGuess.current = new Set();
              const withBestGuess =
                bestGuessIds.size > 0
                  ? applyPlanBestGuess(withRowFlags, bestGuessIds, {
                      settings,
                      mediaType: current.mediaType,
                      caseInsensitive: settings.caseInsensitive ?? false,
                    })
                  : withRowFlags;
              const renameIds = new Set(
                withBestGuess.items
                  .filter((item) => item.action === 'rename')
                  .map((item) => item.id),
              );
              setSelected(
                new Set([...selected].filter((id) => renameIds.has(id))),
              );
              setPlan(withBestGuess);
            } else {
              pendingBestGuess.current = new Set();
              setPlan(next);
              setSelected(
                new Set(
                  next.items
                    .filter((item) => item.action === 'rename')
                    .map((item) => item.id),
                ),
              );
            }
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
