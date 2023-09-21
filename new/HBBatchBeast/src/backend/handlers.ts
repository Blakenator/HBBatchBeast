import { createLogFolders, saveAppConfig } from './helpers';
import fs from 'fs';
import path from 'path';
import {
  ASYNC_CHANNEL,
  BackendAsyncApi,
  BackendPromiseApi,
  GlobalAppConfig,
  PROMISE_CHANNEL,
  RunBatchOperationResult,
} from '../common';
import packageJson from '../../package.json';
import childProcess from 'child_process';
import { AppError } from '@superflag/super-ipc/common';
import {
  BackendAsyncHandlersType,
  BackendSyncHandlersType,
} from '@superflag/super-ipc/backend';

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
  [ASYNC_CHANNEL.RunBatchOperation]: ({
    app,
    args: { config, operationMode },
    handlers: { onInit, onProgress, onComplete, onError },
  }) => {
    const currentConfig = config.configs[config.selected_config];
    const queueInfoBomb = [
      'queueInfoBomb',
      currentConfig.tab_batch.path.source_path.split('\n'),
      currentConfig.tab_batch.path.destination_path.split('\n'),
      currentConfig.tab_batch.path.temp_toggle === 1
        ? currentConfig.tab_batch.path.destination_path.split('\n')
        : [],
      currentConfig.tab_batch.path.temp_toggle === 1,
      currentConfig.tab_batch.advanced.copy_srt_files_toggle === 1
        ? currentConfig.tab_batch.advanced.included_file_types + ',srt,SRT'
        : currentConfig.tab_batch.advanced.included_file_types,
      currentConfig.tab_batch.container,
      operationMode,
      currentConfig.tab_batch.preset.split('\n'),
      currentConfig.tab_batch.advanced.title_word_filter,
      currentConfig.tab_batch.advanced
        .replace_original_file_if_converted_is_smaller_toggle === 1,
      currentConfig.tab_batch.advanced.file_name_suffix_toggle === 1
        ? currentConfig.tab_batch.advanced.file_name_suffix.split('\n')
        : [],
      currentConfig.tab_batch.advanced.remove_filename_apostrophes === 1,
      currentConfig.tab_batch.advanced.replace_original_file_always_toggle ===
        1,
      currentConfig.tab_batch.advanced.reverse_file_queue === 1,
    ];
    console.log(queueInfoBomb);

    const queueBuildModulePath = 'queueBuild.js';

    const queueBuildModule = childProcess.fork(
      path.join(__dirname, queueBuildModulePath),
    );

    const completeResult: RunBatchOperationResult = {
      fileList: [],
      totalCount: 0,
      unconvertedFilesCount: 0,
      discoveredQueueCount: 0,
    };
    const completionStatus: {
      isCompleted: boolean;
      isError: boolean;
      error: any;
    } = {
      isCompleted: false,
      isError: false,
      error: undefined,
    };

    queueBuildModule.on('exit', function (code, signal) {
      console.log('Child exited:', code, signal);

      if (!completionStatus.isCompleted) {
        onError(
          new AppError('Module exited before operation was completed', {
            context: { code, signal, isError: completionStatus.isError },
            inner: completionStatus.error,
          }),
        );
      }
    });

    queueBuildModule.on('message', (message: any[] & { error: any }) => {
      console.log({ message });

      if (message.error) {
        console.error(message.error);
        completionStatus.isError = true;
        completionStatus.error = message.error;
      }

      if (message[0] == 'readyforInfo') {
        console.log('File scanner ready for info. Sending.');
        queueBuildModule.send(queueInfoBomb);
        onInit(completeResult);
      }

      if (message[0] == 'writeRequest') {
        try {
          fs.writeFileSync(message[1], message[2], 'utf8');
        } catch (err) {
          console.log('request write error', err);
        }
      }

      if (message[0] == 'consoleMessage') {
        console.log(message[1]);
      }

      if (message[0] == 'appendRequest') {
        try {
          fs.appendFileSync(message[1], message[2], 'utf8');
        } catch (err) {
          console.log('request append error', err);
        }
      }

      if (message[0] == 'complete') {
        console.log('File scanner finished');

        completeResult.totalCount = +message[1];
        completeResult.discoveredQueueCount = +message[1];
        completeResult.fileList = (message[2] as string[]).map(
          (filepath, i) => {
            const copyFilteredFiles =
              currentConfig.tab_batch.advanced.copy_filtered_files_toggle === 1;
            const extraActionPerformed = +(message[4] as string[])[i] === 1;
            const fileIsSrt = filepath.toLowerCase().endsWith('.srt');

            return {
              path: filepath,
              presetIndex: +message[3][i],
              extraActions: {
                copiedFromFilter: copyFilteredFiles && extraActionPerformed,
                skippedFromFilter:
                  !copyFilteredFiles && extraActionPerformed && !fileIsSrt,
                copiedSrt:
                  !copyFilteredFiles && fileIsSrt && extraActionPerformed,
              },
            };
          },
        );
        completeResult.unconvertedFilesCount = +message[7];
        console.log({
          destinationQueue: message[5],
          destinationFinalQueue: message[6],
        });

        onComplete(completeResult);
        completionStatus.isCompleted = true;
      }

      if (message[0] == 'exitRequest') {
        queueBuildModule.send(['exitApproved']);
      }

      if (message[0] == 'totalFiles') {
        console.log('totalFiles', { count: message[1] });

        completeResult.totalCount = +message[1];
        onProgress(completeResult);
      }

      if (message[0] == 'buildQueue') {
        console.log('buildQueue', { count: message[1] });

        completeResult.discoveredQueueCount = +message[1];
        onProgress(completeResult);
      }
    });
  },
};
