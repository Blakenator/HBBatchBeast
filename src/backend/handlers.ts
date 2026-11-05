import {
  AppPaths,
  appPaths,
  buildQueueBuildConfig,
  ensureAppFolders,
  findUnavailableHandBrakePresets,
  legacyAppPaths,
  listHandBrakePresets,
  migrateLegacyData,
  openFolder,
  pickPath,
  resolveHandBrakeExecutable,
  saveAppConfig,
  userPresetFiles,
} from './helpers';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { dialog, net, shell } from 'electron';
import {
  ASYNC_CHANNEL,
  BackendAsyncApi,
  BackendPromiseApi,
  AppConfigV2,
  BatchOperationMode,
  BatchTabConfig,
  GlobalAppConfig,
  createDefaultAppConfig,
  migrateAppConfig,
  parseMappedRows,
  OrganizePlexCheck,
  OrganizeScanProgress,
  PROMISE_CHANNEL,
  RunBatchOperationResult,
  isCaseInsensitivePlatform,
  libraryOrganizeSettings,
  resolveGlobalSettings,
  expandHomePath,
} from '../common';
import packageJson from '../../package.json';
import { AppError } from '@superflag/super-ipc-core';
import {
  BackendAsyncHandlersType,
  BackendSyncHandlersType,
} from '@superflag/super-ipc-backend';
import { ChildSupervisor } from './processes/childSupervisor';
import { RunManager, RunState } from './run/runManager';
import { createRunManager } from './run/runService';
import { buildWorkerItemConfig } from './run/buildWorkerItemConfig';
import { resolveChildEntry } from './processes/childEntries';
import { QueueBuildResult } from './processes/protocol';
import { setTrayStatus } from '../main/tray';
import { getMaxParallel } from '../main/processBudget';
import {
  assertOpenablePath,
  clearCaches,
  clearRunJournal,
  collectDiagnostics,
  logOrganizeFailure,
} from './helpers/diagnostics';
import { probeMedia } from './helpers/probeMedia';
import { TvdbClient } from './organizer/tvdb/client';
import {
  applyOrganizePlan,
  buildOrganizePlanForLibrary,
  detectShowFolders,
  readOrganizeJournal,
  undoLastOrganize,
} from './organizer/service';
import { completePendingHistoryTransfers } from './organizer/plex/writer';
import {
  plexDatabaseCandidates,
  plexExecutableCandidates,
  plexServiceHint,
} from './organizer/plex/environment';
import {
  attemptPlexAutoFix,
  canAutoFixPlex,
  plexAccessState,
  plexIssues,
  plexRemediation,
} from './organizer/plex/remediation';
import {
  detectPlexService,
  startPlexService,
  stopPlexService,
  waitForPlexStopped,
} from './organizer/plex/service';


export function mapQueueBuildResult(
  payload: QueueBuildResult,
  currentConfig: GlobalAppConfig['configs'][number],
): RunBatchOperationResult {
  const advanced: Partial<BatchTabConfig['advanced']> =
    currentConfig.tab_batch?.advanced ?? {};
  const copyFilteredFiles = advanced.copy_filtered_files_toggle === 1;

  return {
    totalCount: payload.total,
    discoveredQueueCount: payload.total,
    unconvertedFilesCount: payload.notExists,
    typeFilteredCount: payload.typeFiltered,
    fileList: payload.sources.map((filepath, index) => {
      const exclusion = payload.excluded[index] ?? null;
      const fileIsSrt = filepath.toLowerCase().endsWith('.srt');
      const copiedSrt = exclusion?.code === 'subtitle';
      const copiedFromFilter =
        exclusion?.code === 'filtered' && copyFilteredFiles;
      const skippedFromFilter =
        exclusion !== null && !copiedSrt && !copiedFromFilter;

      return {
        path: filepath,
        preset: payload.presets[index],
        destinationPath: payload.destinations[index] ?? undefined,
        destinationFinalPath: payload.destinationsFinal[index] ?? undefined,
        action: copiedSrt || copiedFromFilter
          ? ('copy' as const)
          : skippedFromFilter
            ? ('skip' as const)
            : ('encode' as const),
        excludedReason: exclusion?.reason,
        filterTrace: payload.traces[index],
        presetTrace: payload.presetTraces?.[index] ?? undefined,
        extraActions: {
          copiedFromFilter,
          skippedFromFilter,
          copiedSrt: copiedSrt && fileIsSrt,
        },
      };
    }),
  };
}

let preparedPaths: AppPaths | null = null;

function prepareAppPaths(app: Electron.App): AppPaths {
  if (preparedPaths) return preparedPaths;
  const paths = appPaths({
    userDataPath: app.getPath('userData'),
    logsPath: app.getPath('logs'),
  });
  const migration = (() => {
    try {
      return migrateLegacyData(paths, legacyAppPaths(app.getPath('home')));
    } catch (error) {
      console.error('Unable to migrate legacy app data:', error);
      return { migrated: false, copied: [] };
    }
  })();
  if (migration.migrated) {
    console.log(
      `Migrated legacy app data (${migration.copied.length} file(s)) into ${paths.configDir}`,
    );
  }
  ensureAppFolders(paths);
  preparedPaths = paths;
  return paths;
}

/** Only one run may be active at a time; the renderer observes it via GetRunState. */
let activeRun: RunManager | null = null;
let lastRunState: RunState | null = null;

function currentRunState(): RunState | null {
  return activeRun?.getState() ?? lastRunState;
}

function legacyPresetValue(batch?: Partial<BatchTabConfig>): string {
  const customRows = parseMappedRows(batch?.custom_preset_string);
  const hasCustomRows = customRows.some((row) => row.trim().length > 0);
  return (hasCustomRows ? customRows : parseMappedRows(batch?.preset))
    .filter((row) => !row.startsWith('-') || /^-Z\s/i.test(row))
    .join('\n');
}

function workerCountFor(config: GlobalAppConfig): number {
  const configured = Number(resolveGlobalSettings(config).worker_instance_number);
  const requested =
    Number.isFinite(configured) && configured >= 1
      ? Math.min(Math.trunc(configured), 32)
      : 4;
  // A startup --max-parallel budget also caps how many conversions may run.
  const maxParallel = getMaxParallel();
  return maxParallel === undefined ? requested : Math.min(requested, maxParallel);
}

function loadConfiguration(app: Electron.App): AppConfigV2 {
  const configPath = prepareAppPaths(app).configFile;
  if (fs.existsSync(configPath)) {
    try {
      console.log('Loading configuration file');
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown;
      const migrated = migrateAppConfig(raw);
      if (migrated.changed) {
        const version = (raw as { schema_version?: unknown }).schema_version;
        const suffix = version === 2 || version === 3 ? '.v2.bak' : '.v1.bak';
        let backup = `${configPath}${suffix}`;
        let attempt = 2;
        while (fs.existsSync(backup)) {
          backup = `${configPath}${suffix}.${attempt}`;
          attempt += 1;
        }
        fs.copyFileSync(configPath, backup);
        saveAppConfig(configPath, migrated.config);
      }
      return migrated.config;
    } catch {
      console.log('Unable to load configuration file, archiving old version');
      fs.renameSync(configPath, configPath + '.old');
    }
  }

  console.log('Initializing new config file');
  const config: AppConfigV2 = createDefaultAppConfig(packageJson.version);
  saveAppConfig(configPath, config);
  return config;
}

let tvdbClient: TvdbClient | null = null;
let tvdbCacheDir = '';

/**
 * Chromium's network stack (system proxy and certificate aware) is preferred,
 * but it cancels some cross-origin requests outright. Fall back to Node's
 * fetch so a metadata lookup never fails for a transport reason.
 */
async function tvdbFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await net.fetch(url, init as RequestInit);
  } catch (error) {
    console.warn(
      `net.fetch failed for ${url}; retrying with the Node HTTP client: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return fetch(url, init);
  }
}

function getTvdbClient(app: Electron.App): TvdbClient {
  const paths = prepareAppPaths(app);
  if (!tvdbClient || tvdbCacheDir !== paths.cacheDir) {
    tvdbClient = new TvdbClient({
      cacheDir: paths.cacheDir,
      fetchImpl: tvdbFetch,
    });
    tvdbCacheDir = paths.cacheDir;
  }
  return tvdbClient;
}

function currentUserName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? 'your user';
  }
}

function resolvedPlexExecutable(app: Electron.App): string | undefined {
  return plexExecutableCandidates({
    platform: process.platform,
    env: process.env,
    home: app.getPath('home'),
    exists: fs.existsSync,
  })[0];
}

function plexRemediationInput(
  app: Electron.App,
  dbPath: string,
  status: { running: boolean; kind: OrganizePlexCheck['serviceKind'] },
  exists: boolean,
  writable: boolean,
  folderWritable: boolean,
) {
  const user = currentUserName();
  const home = app.getPath('home');
  const executable = resolvedPlexExecutable(app);
  return {
    platform: process.platform,
    dbPath,
    user,
    exists,
    writable,
    folderWritable,
    running: status.running,
    serviceKind: status.kind,
    ...(executable ? { executable } : {}),
    home,
    env: process.env,
    existsOnDisk: fs.existsSync,
  };
}

async function inspectPlexDatabase(
  app: Electron.App,
  requestedPath: string,
): Promise<OrganizePlexCheck> {
  const dbPath = path.resolve(
    expandHomePath(requestedPath, app.getPath('home')),
  );
  const access = plexAccessState(process.platform, dbPath);
  const status = await detectPlexService(process.platform);
  const exists = fs.existsSync(dbPath);
  const input = plexRemediationInput(
    app,
    dbPath,
    status,
    exists,
    access.writable,
    access.folderWritable,
  );
  return {
    path: dbPath,
    exists,
    writable: access.writable,
    folderWritable: access.folderWritable,
    running: status.running,
    serviceKind: status.kind,
    issues: plexIssues(input),
    remediation: plexRemediation(input),
    canAutoFix: canAutoFixPlex(input),
  };
}

/** Plex lives in the global settings, so every library uses the same server. */
function configuredPlexPath(app: Electron.App): string | undefined {
  return resolveGlobalSettings(loadConfiguration(app)).plex?.dbPath;
}

export const BackendHandlers: BackendSyncHandlersType<
  PROMISE_CHANNEL,
  BackendPromiseApi
> = {
  [PROMISE_CHANNEL.LoadConfiguration]: ({ app }) => loadConfiguration(app),
  [PROMISE_CHANNEL.SaveConfiguration]: ({ app, args: config }) => {
    saveAppConfig(prepareAppPaths(app).configFile, config);
  },
  [PROMISE_CHANNEL.GetDiagnostics]: ({ app }) =>
    collectDiagnostics(prepareAppPaths(app)),
  [PROMISE_CHANNEL.OpenAppPath]: ({ app, args }) => {
    const target = assertOpenablePath(prepareAppPaths(app), args.path);
    void shell.openPath(target).then((error) => {
      if (!error) return;
      console.error(`Could not open path "${target}": ${error}`);
      dialog.showErrorBox('Could not open folder', `${target}\n\n${error}`);
    });
  },
  [PROMISE_CHANNEL.OpenFolder]: ({ args }) => openFolder(args.path),
  [PROMISE_CHANNEL.ClearCaches]: ({ app }) => ({
    cleared: clearCaches(prepareAppPaths(app)),
  }),
  [PROMISE_CHANNEL.ClearRunJournal]: ({ app }) => {
    clearRunJournal(prepareAppPaths(app));
  },
  [PROMISE_CHANNEL.ProbeMedia]: ({ args }) => probeMedia(args.path),
  [PROMISE_CHANNEL.PickPath]: ({ args }) => pickPath(args),
  [PROMISE_CHANNEL.ListHandBrakePresets]: ({ args }) =>
    listHandBrakePresets({ refresh: args?.refresh === true }),
  [PROMISE_CHANNEL.SetTrayStatus]: ({ args }) => {
    setTrayStatus(args.status);
  },
  [PROMISE_CHANNEL.GetRunState]: () => currentRunState(),
  [PROMISE_CHANNEL.PauseRun]: () => {
    activeRun?.pause();
    lastRunState = currentRunState();
    return lastRunState;
  },
  [PROMISE_CHANNEL.ResumeRun]: () => {
    activeRun?.resume();
    lastRunState = currentRunState();
    return lastRunState;
  },
  [PROMISE_CHANNEL.StopRun]: () => {
    void activeRun?.stop();
    return currentRunState();
  },
  [PROMISE_CHANNEL.CancelRunItem]: ({ args: { index } }) => {
    activeRun?.cancelItem(index);
    return currentRunState();
  },
  [PROMISE_CHANNEL.OrganizeGetPlexEnvironment]: ({ app }) => {
    const home = app.getPath('home');
    const databaseCandidates = plexDatabaseCandidates({
      platform: process.platform,
      env: process.env,
      home,
      appData: app.getPath('appData'),
      exists: fs.existsSync,
    });
    return {
      platform: process.platform,
      databaseCandidates,
      serviceKind: plexServiceHint(process.platform),
    };
  },
  [PROMISE_CHANNEL.OrganizeCheckPlex]: ({ app, args }) =>
    inspectPlexDatabase(app, args.path),
  [PROMISE_CHANNEL.OrganizeControlPlex]: async ({ app, args }) => {
    if (args.action === 'stop') {
      await stopPlexService(process.platform);
      await waitForPlexStopped(process.platform, 10_000);
    } else if (args.action === 'start') {
      await startPlexService(
        process.platform,
        undefined,
        resolvedPlexExecutable(app),
      );
    }
    return inspectPlexDatabase(app, args.path);
  },
  [PROMISE_CHANNEL.OrganizeFixPlex]: async ({ app, args }) => {
    const before = await inspectPlexDatabase(app, args.path);
    const input = plexRemediationInput(
      app,
      before.path,
      { running: before.running, kind: before.serviceKind },
      before.exists,
      before.writable,
      before.folderWritable ?? before.writable,
    );
    const steps = await attemptPlexAutoFix(input);
    return {
      check: await inspectPlexDatabase(app, args.path),
      steps,
    };
  },
  [PROMISE_CHANNEL.OrganizeSearchSeries]: ({ app, args }) =>
    getTvdbClient(app).searchSeries(args.query),
  [PROMISE_CHANNEL.OrganizeSearchMovies]: ({ app, args }) =>
    getTvdbClient(app).searchMovies(args.query),
  [PROMISE_CHANNEL.OrganizeLoadEpisodes]: ({ app, args }) =>
    getTvdbClient(app).loadEpisodes(args.slug),
  [PROMISE_CHANNEL.OrganizeDetectShows]: async ({ app, args }) =>
    detectShowFolders({
      library: args.library,
      settings: libraryOrganizeSettings(args.library),
      home: app.getPath('home'),
      tvdbClient: getTvdbClient(app),
    }),
  [PROMISE_CHANNEL.OrganizeApplyPlan]: async ({ app, args }) => {
    const plexDbPath = configuredPlexPath(app);
    return applyOrganizePlan({
      plan: args.plan,
      settings: libraryOrganizeSettings(args.library),
      appPaths: prepareAppPaths(app),
      platform: process.platform,
      updatePlex: args.updatePlex,
      ...(plexDbPath ? { plexDbPath } : {}),
    });
  },
  [PROMISE_CHANNEL.OrganizeUndo]: async ({ app, args }) =>
    undoLastOrganize(prepareAppPaths(app), {
      restorePlex: args?.restorePlex === true,
    }),
  [PROMISE_CHANNEL.OrganizeCompletePending]: async ({ app, args }) => {
    const paths = prepareAppPaths(app);
    const dbPath = path.resolve(
      expandHomePath(args.dbPath, app.getPath('home')),
    );
    const exists = fs.existsSync(dbPath);
    const status = await detectPlexService(process.platform);
    if (status.running) {
      const remediation = plexRemediation(
        plexRemediationInput(app, dbPath, status, exists, true, true),
      );
      throw new AppError(
        `Plex Media Server is running.\n\n${remediation.script}`,
      );
    }
    const access = plexAccessState(process.platform, dbPath);
    if (!access.writable) {
      const remediation = plexRemediation(
        plexRemediationInput(
          app,
          dbPath,
          status,
          exists,
          access.writable,
          access.folderWritable,
        ),
      );
      throw new AppError(
        `HBBatchBeast cannot write the Plex database.\n\n${remediation.script}`,
      );
    }
    const result = completePendingHistoryTransfers({
      dbPath,
      backupDir: paths.backupDir,
      pendingPath: path.join(paths.configDir, 'organize-pending.json'),
      platform: process.platform,
      caseInsensitive: isCaseInsensitivePlatform(process.platform),
    });
    return {
      historyMoved: result.historyMoved,
      pendingTransfers: result.pendingTransfers,
      warnings: result.warnings,
    };
  },
  [PROMISE_CHANNEL.OrganizeReadJournal]: ({ app }) =>
    readOrganizeJournal(prepareAppPaths(app)),
};

export const BackendAsyncHandlers: BackendAsyncHandlersType<
  ASYNC_CHANNEL,
  BackendAsyncApi
> = {
  [ASYNC_CHANNEL.OrganizeScan]: async ({
    app,
    args,
    handlers: { onInit, onProgress, onComplete, onError },
  }) => {
    const plexDbPath = configuredPlexPath(app);
    const initialProgress: OrganizeScanProgress = {
      phase: 'discovering',
      completed: 0,
      total: 0,
      discovered: 0,
      elapsedMs: 0,
    };
    onInit(initialProgress);
    try {
      const plan = await buildOrganizePlanForLibrary({
        library: args.library,
        settings: libraryOrganizeSettings(args.library),
        appPaths: prepareAppPaths(app),
        platform: process.platform,
        home: app.getPath('home'),
        tvdbClient: getTvdbClient(app),
        ...(plexDbPath ? { plexDbPath } : {}),
        ...(args.scope && args.scope.length > 0 ? { scope: args.scope } : {}),
        ...(args.reuseScanId ? { reuseScanId: args.reuseScanId } : {}),
        ...(args.rescanFolders && args.rescanFolders.length > 0
          ? { rescanFolders: args.rescanFolders }
          : {}),
        onProgress,
      });
      onComplete(plan);
    } catch (error) {
      logOrganizeFailure(prepareAppPaths(app), error);
      onError(
        error instanceof AppError
          ? error
          : new AppError('Organize scan failed', { inner: error }),
      );
    }
  },
  [ASYNC_CHANNEL.RunBatchOperation]: async ({
    app,
    args: { config, operationMode, library, presets },
    handlers: { onInit, onProgress, onComplete, onError },
  }) => {
    const currentConfig = config.configs[config.selected_config];
    const payload = buildQueueBuildConfig({
      config,
      operationMode: operationMode ?? BatchOperationMode.ScanAndConvert,
      appPaths: prepareAppPaths(app),
      ...(library ? { library, presets } : {}),
    });

    const progressSnapshot: RunBatchOperationResult = {
      fileList: [],
      totalCount: 0,
      unconvertedFilesCount: 0,
      discoveredQueueCount: 0,
    };

    let settled = false;
    let resolveComplete: (result: RunBatchOperationResult) => void;
    let rejectComplete: (error: unknown) => void;
    const completed = new Promise<RunBatchOperationResult>((resolve, reject) => {
      resolveComplete = resolve;
      rejectComplete = reject;
    });

    const supervisor = new ChildSupervisor({
      name: 'queueBuild',
      entry: resolveChildEntry('queueBuild'),
      events: {
        onLog: (level, message) => {
          if (level === 'error') console.error('[queueBuild]', message);
          else console.log('[queueBuild]', message);
        },
        onProgress: (phase, count) => {
          if (phase === 'discovered') progressSnapshot.totalCount = count;
          else progressSnapshot.discoveredQueueCount = count;

          if (!settled) onProgress({ ...progressSnapshot });
        },
        onChildMessage: (message) => {
          if (message.type !== 'complete' || settled) return;
          settled = true;
          resolveComplete(mapQueueBuildResult(message.payload, currentConfig));
        },
        onError: (error) => {
          if (settled) {
            console.error('[queueBuild]', error);
            return;
          }
          settled = true;
          rejectComplete(error);
        },
      },
    });

    try {
      const libraryEncoder =
        library?.encoder ??
        (currentConfig?.tab_batch?.FFmpeg_toggle === 1 ? 'ffmpeg' : 'handbrake');
      if (libraryEncoder === 'handbrake') {
        // Rows can be preset names (from the picker) or raw arguments; only
        // preset rows can be checked against the installed preset list.
        const usedPresetIds = library
          ? new Set([
              library.defaultPresetId,
              ...library.mappingRules.map((rule) => rule.presetId),
            ])
          : undefined;
        const presetValue = library
          ? (presets ?? [])
              .filter(
                (preset) => !usedPresetIds || usedPresetIds.has(preset.id),
              )
              .map((preset) => preset.handbrake?.preset?.trim() ?? '')
              .filter(Boolean)
              .join('\n')
          : legacyPresetValue(currentConfig?.tab_batch);
        const presetScan = await listHandBrakePresets();
        if (presetScan.available) {
          const unavailable = findUnavailableHandBrakePresets(
            presetValue,
            presetScan.presets,
          );
          if (unavailable.length > 0) {
            throw new AppError(
              `HandBrake preset(s) not installed: ${unavailable
                .map((preset) => `"${preset}"`)
                .join(', ')}. Open Settings to choose an installed preset or refresh the list.`,
            );
          }
        }
      }

      await supervisor.start();
      supervisor.configure(payload);
      onInit({ ...progressSnapshot });

      const result = await completed;
      onComplete(result);
    } catch (error) {
      onError(
        error instanceof AppError
          ? error
          : new AppError('Batch operation failed', { inner: error }),
      );
    } finally {
      await supervisor.stop('run-finished');
    }
  },
  [ASYNC_CHANNEL.RunConversion]: async ({
    app,
    args: { config, items },
    handlers: { onInit, onProgress, onComplete, onError },
  }) => {
    if (activeRun) {
      onError(new AppError('A conversion is already running'));
      return;
    }

    let settle: ((state: RunState) => void) | undefined;
    const finished = new Promise<RunState>((resolve) => {
      settle = resolve;
    });

    const handBrakeExecutable = resolveHandBrakeExecutable();
    const manager = createRunManager(prepareAppPaths(app), {
      workerCount: workerCountFor(config),
      buildItemConfig: (item, index) =>
        buildWorkerItemConfig(
          config,
          item,
          index,
          process.platform,
          userPresetFiles(),
          handBrakeExecutable,
        ),
      onState: (state) => {
        lastRunState = state;
        if (state.status === 'completed' || state.status === 'interrupted') {
          settle?.(state);
          return;
        }
        onProgress(state);
      },
      onConsole: (worker, message) =>
        console.log(`[worker ${worker}]`, message),
    });

    activeRun = manager;
    try {
      onInit(manager.getState());
      await manager.start(items);
      const finalState = await finished;
      onComplete(finalState);
    } catch (error) {
      onError(
        error instanceof AppError
          ? error
          : new AppError('Conversion failed', { inner: error }),
      );
    } finally {
      activeRun = null;
    }
  },
};
