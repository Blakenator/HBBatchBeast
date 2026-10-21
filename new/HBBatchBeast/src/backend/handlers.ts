import {
  buildQueueBuildConfig,
  createLogFolders,
  saveAppConfig,
} from './helpers';
import fs from 'fs';
import path from 'path';
import {
  ASYNC_CHANNEL,
  BackendAsyncApi,
  BackendPromiseApi,
  BatchOperationMode,
  BatchTabConfig,
  GlobalAppConfig,
  PROMISE_CHANNEL,
  RunBatchOperationResult,
} from '../common';
import packageJson from '../../package.json';
import { AppError } from '@superflag/super-ipc-core';
import {
  BackendAsyncHandlersType,
  BackendSyncHandlersType,
} from '@superflag/super-ipc-backend';
import { ChildSupervisor } from './processes/childSupervisor';
import { resolveChildEntry } from './processes/childEntries';
import { QueueBuildResult } from './processes/protocol';


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
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (err) {
        console.log('Unable to load configuration file, archiving old version');
        fs.renameSync(configPath, configPath + '.old');
      }
    }

    console.log('Initializing new config file');
    const config: GlobalAppConfig = {
      lang: 'en',
      selected_config: 0,
      api_key: '',
      version_message: packageJson.version,
      configs: [
        {
          tab_system: {},
          tab_batch: {},
          tab_health: {},
          tab_remote: {},
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
};
