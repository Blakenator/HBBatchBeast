import {
  ASYNC_CHANNEL,
  BackendAsyncApi,
  BackendPromiseApi,
  PROMISE_CHANNEL,
} from '../../common';

import {
  createUseBackendAsyncHook,
  createUseBackendSyncHook,
} from '@superflag/super-ipc/react';

export const useBackend = createUseBackendSyncHook<
  PROMISE_CHANNEL,
  BackendPromiseApi
>();

export const useBackendAsync = createUseBackendAsyncHook<
  ASYNC_CHANNEL,
  BackendAsyncApi
>();
