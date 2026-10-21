import {
  buildQueueBuildConfig,
  createLogFolders,
  findUnavailableHandBrakePresets,
  listHandBrakePresets,
  pickPath,
  saveAppConfig,
} from './helpers';
import fs from 'fs';
import path from 'path';
import { shell } from 'electron';
import {
  ASYNC_CHANNEL,
  BackendAsyncApi,
  BackendPromiseApi,
  BatchOperationMode,
  BatchTabConfig,
  DEFAULT_GLOBAL_SETTINGS,
  GlobalAppConfig,
  migrateGlobalSettings,
  parseMappedRows,
  PROMISE_CHANNEL,
  RunBatchOperationResult,
  resolveGlobalSettings,
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
} from './helpers/diagnostics';
import { probeMedia } from './helpers/probeMedia';


function mapQueueBuildResult(
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
    fileList: payload.sources.map((filepath, index) => {
      const extraActionPerformed = payload.skipOrCopy[index] === 1;
      const fileIsSrt = filepath.toLowerCase().endsWith('.srt');

      return {
        path: filepath,
        preset: payload.presets[index],
        destinationPath: payload.destinations[index] ?? undefined,
        extraActions: {
          copiedFromFilter: copyFilteredFiles && extraActionPerformed,
          skippedFromFilter:
            !copyFilteredFiles && extraActionPerformed && !fileIsSrt,
          copiedSrt: !copyFilteredFiles && fileIsSrt && extraActionPerformed,
        },
      };
    }),
  };
}

function ensureLogFolders(app: Electron.App) {
  createLogFolders(app.getPath('home'));
}

/** Only one run may be active at a time; the renderer observes it via GetRunState. */
let activeRun: RunManager | null = null;
let lastRunState: RunState | null = null;

function currentRunState(): RunState | null {
  return activeRun?.getState() ?? lastRunState;
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

export const BackendHandlers: BackendSyncHandlersType<
  PROMISE_CHANNEL,
  BackendPromiseApi
> = {
  [PROMISE_CHANNEL.LoadConfiguration]: ({ app }) => {
    const homePath = app.getPath('home');
    createLogFolders(homePath);

    const configPath = path.resolve(
      path.join(homePath, '/Documents/HBBatchBeast/Config/Configuration.json'),
    );
    if (fs.existsSync(configPath)) {
      try {
        console.log('Loading configuration file');
        return migrateGlobalSettings(
          JSON.parse(fs.readFileSync(configPath, 'utf8')) as GlobalAppConfig,
        );
      } catch (err) {
        console.log('Unable to load configuration file, archiving old version');
        fs.renameSync(configPath, configPath + '.old');
      }
    }

    console.log('Initializing new config file');
    const config: GlobalAppConfig = {
      lang: 'en',
      app_settings: { ...DEFAULT_GLOBAL_SETTINGS },
      selected_config: 0,
      version_message: packageJson.version,
      configs: [
        {
          tab_batch: {},
          name: 'Default',
        },
      ],
    };

    saveAppConfig(configPath, config);

    return config;
  },
  [PROMISE_CHANNEL.SaveConfiguration]: ({ app, args: config }) => {
    const homePath = app.getPath('home');
    createLogFolders(homePath);

    const configPath = path.resolve(
      path.join(homePath, '/Documents/HBBatchBeast/Config/Configuration.json'),
    );

    saveAppConfig(configPath, config);
  },
  [PROMISE_CHANNEL.GetDiagnostics]: ({ app }) =>
    collectDiagnostics(app.getPath('home')),
  [PROMISE_CHANNEL.OpenAppPath]: ({ app, args }) => {
    ensureLogFolders(app);
    const target = assertOpenablePath(app.getPath('home'), args.path);
    void shell.openPath(target);
  },
  [PROMISE_CHANNEL.ClearCaches]: ({ app }) => {
    ensureLogFolders(app);
    return { cleared: clearCaches(app.getPath('home')) };
  },
  [PROMISE_CHANNEL.ClearRunJournal]: ({ app }) => {
    clearRunJournal(app.getPath('home'));
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
};

export const BackendAsyncHandlers: BackendAsyncHandlersType<
  ASYNC_CHANNEL,
  BackendAsyncApi
> = {
  [ASYNC_CHANNEL.RunBatchOperation]: async ({
    args: { config, operationMode },
    handlers: { onInit, onProgress, onComplete, onError },
  }) => {
    const currentConfig = config.configs[config.selected_config];
    const payload = buildQueueBuildConfig({
      config,
      operationMode: operationMode ?? BatchOperationMode.ScanAndConvert,
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
      const batch = currentConfig?.tab_batch;
      if (batch && batch.FFmpeg_toggle !== 1) {
        // Rows can be preset names (from the picker) or raw arguments; only
        // preset rows can be checked against the installed preset list.
        const customRows = parseMappedRows(batch.custom_preset_string);
        const hasCustomRows = customRows.some(
          (row) => row.trim().length > 0,
        );
        const presetValue = (
          hasCustomRows ? customRows : parseMappedRows(batch.preset)
        )
          .filter((row) => !row.startsWith('-') || /^-Z\s/i.test(row))
          .join('\n');
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

    const manager = createRunManager(app.getPath('home'), {
      workerCount: workerCountFor(config),
      buildItemConfig: (item, index) =>
        buildWorkerItemConfig(config, item, index),
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
