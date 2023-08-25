import { BackendHandler, BackendHandlerAsync } from './types';
import { createLogFolders, saveAppConfig } from './helpers';
import fs from 'fs';
import path from 'path';
import {
  ASYNC_CHANNEL,
  BackendAsyncApi,
  BackendPromiseApi,
  GlobalAppConfig,
  PROMISE_CHANNEL,
} from '../common';
import packageJson from '../../package.json';

export const BackendHandlers: {
  [K in PROMISE_CHANNEL]: BackendHandler<
    BackendPromiseApi[K][0],
    BackendPromiseApi[K][1]
  >;
} = {
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

export const BackendAsyncHandlers: {
  [K in ASYNC_CHANNEL]: BackendHandlerAsync<
    BackendAsyncApi[K][0],
    BackendAsyncApi[K][1],
    BackendAsyncApi[K][2],
    BackendAsyncApi[K][3]
  >;
} = {
  [ASYNC_CHANNEL.RunBatchOperation]: ({
    app,
    args,
    handlers: { onInit, onProgress, onComplete },
  }) => {
    console.log(ASYNC_CHANNEL.RunBatchOperation, args);
    setTimeout(() => onInit({ fileList: [{ path: '123' }] }), 500);
    setTimeout(
      () => onProgress({ fileList: [{ path: '123' }, { path: '234' }] }),
      2000,
    );
    setTimeout(
      () =>
        onProgress({
          fileList: [{ path: '123' }, { path: '234' }, { path: '345' }],
        }),
      3000,
    );
    setTimeout(
      () =>
        onComplete({
          fileList: [
            { path: '123' },
            { path: '234' },
            { path: '345' },
            { path: '456' },
            { path: 'done' },
          ],
        }),
      6000,
    );
  },
};
