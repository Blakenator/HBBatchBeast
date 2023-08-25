import {
  RunBatchOperationProps,
  RunBatchOperationResult,
} from '../frontend/helpers';
import { GlobalAppConfig } from './types';

export enum PROMISE_CHANNEL {
  LoadConfiguration = 'LOAD_CONFIGURATION',
  SaveConfiguration = 'SAVE_CONFIGURATION',
}

export enum ASYNC_CHANNEL {
  RunBatchOperation = 'RUN_BATCH_OPERATION',
}

export interface BackendPromiseApi
  extends Record<
    PROMISE_CHANNEL,
    [
      // props
      any,
      // result
      any,
    ]
  > {
  [PROMISE_CHANNEL.LoadConfiguration]: [never, GlobalAppConfig];
  [PROMISE_CHANNEL.SaveConfiguration]: [GlobalAppConfig, void];
}

export interface BackendAsyncApi
  extends Record<
    ASYNC_CHANNEL,
    [
      // props
      any,
      // init result
      any,
      // progress
      any,
      // complete
      any,
    ]
  > {
  [ASYNC_CHANNEL.RunBatchOperation]: [
    RunBatchOperationProps,
    RunBatchOperationResult,
    RunBatchOperationResult,
    RunBatchOperationResult,
  ];
}
