import {
  ConversionItem,
  GlobalAppConfig,
  RunBatchOperationProps,
  RunBatchOperationResult,
} from './types';
import type { RunState } from '../backend/run/runManager';
import {
  BackendAsyncApiType,
  BackendSyncApiType,
} from '@superflag/super-ipc-core';

export enum PROMISE_CHANNEL {
  LoadConfiguration = 'LOAD_CONFIGURATION',
  SaveConfiguration = 'SAVE_CONFIGURATION',
  GetRunState = 'GET_RUN_STATE',
  PauseRun = 'PAUSE_RUN',
  ResumeRun = 'RESUME_RUN',
  StopRun = 'STOP_RUN',
  CancelRunItem = 'CANCEL_RUN_ITEM',
}

export enum ASYNC_CHANNEL {
  RunBatchOperation = 'RUN_BATCH_OPERATION',
  RunConversion = 'RUN_CONVERSION',
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
  [PROMISE_CHANNEL.GetRunState]: {
    props: void;
    result: RunState | null;
  };
  [PROMISE_CHANNEL.PauseRun]: {
    props: void;
    result: RunState | null;
  };
  [PROMISE_CHANNEL.ResumeRun]: {
    props: void;
    result: RunState | null;
  };
  [PROMISE_CHANNEL.StopRun]: {
    props: void;
    result: RunState | null;
  };
  [PROMISE_CHANNEL.CancelRunItem]: {
    props: { index: number };
    result: RunState | null;
  };
}

export interface BackendAsyncApi extends BackendAsyncApiType<ASYNC_CHANNEL> {
  [ASYNC_CHANNEL.RunBatchOperation]: {
    props: RunBatchOperationProps;
    initResult: RunBatchOperationResult;
    progressResult: RunBatchOperationResult;
    completeResult: RunBatchOperationResult;
  };
  [ASYNC_CHANNEL.RunConversion]: {
    props: { config: GlobalAppConfig; items: ConversionItem[] };
    initResult: RunState;
    progressResult: RunState;
    completeResult: RunState;
  };
}
