import { ASYNC_CHANNEL, BackendAsyncApi, BackendPromiseApi, BackendResult, PROMISE_CHANNEL } from '../../common';

export interface BackendApiHookResult<T extends PROMISE_CHANNEL> {
  data?: BackendPromiseApi[T]['result'];
  error?: BackendResult['error'];
  loading: boolean;
  refetch: (
    props?: BackendPromiseApi[T]['props'],
  ) => Promise<BackendResult<BackendPromiseApi[T]['result']>>;
}

export interface BackendApiHookProps<T extends PROMISE_CHANNEL> {
  channel: T;
  props?: BackendPromiseApi[T]['props'];
  skip?: boolean;
}

export interface BackendApiAsyncHookResult<T extends ASYNC_CHANNEL> {
  initialData?: BackendAsyncApi[T]['initResult'];
  progressData?: BackendAsyncApi[T]['progressResult'][];
  lastProgressData?: BackendAsyncApi[T]['progressResult'];
  completeData?: BackendAsyncApi[T]['completeResult'];

  error?: BackendResult['error'];

  loading: boolean;
  refetch: (props?: BackendAsyncApi[T]['props']) => Promise<BackendResult<void>>;
}

export interface BackendApiAsyncHookProps<T extends ASYNC_CHANNEL> {
  channel: T;
  props?: BackendAsyncApi[T]['props'];
  skip?: boolean;
  // handlers
  onInit?: (event: BackendAsyncApi[T]['initResult']) => void;
  onProgress?: (event: BackendAsyncApi[T]['progressResult']) => void;
  onComplete?: (event: BackendAsyncApi[T]['completeResult']) => void;
}

