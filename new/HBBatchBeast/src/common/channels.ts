import {
  GlobalAppConfig,
  RunBatchOperationProps,
  RunBatchOperationResult,
} from './types';
import {
  BackendAsyncApiType,
  BackendSyncApiType,
} from '@superflag/super-ipc/common';

export enum PROMISE_CHANNEL {
  LoadConfiguration = 'LOAD_CONFIGURATION',
  SaveConfiguration = 'SAVE_CONFIGURATION',
}

export enum ASYNC_CHANNEL {
  RunBatchOperation = 'RUN_BATCH_OPERATION',
}

export interface BackendPromiseApi extends BackendSyncApiType<PROMISE_CHANNEL> {
  [PROMISE_CHANNEL.LoadConfiguration]: {
    props: void;
    result: GlobalAppConfig;
  };
  [PROMISE_CHANNEL.SaveConfiguration]: {
    props: GlobalAppConfig;
    result: void;
  };
}

export interface BackendAsyncApi extends BackendAsyncApiType<ASYNC_CHANNEL> {
  [ASYNC_CHANNEL.RunBatchOperation]: {
    props: RunBatchOperationProps;
    initResult: RunBatchOperationResult;
    progressResult: RunBatchOperationResult;
    completeResult: RunBatchOperationResult;
  };
}
