import {
  ASYNC_CHANNEL,
  BackendAsyncApi,
  BackendPromiseApi,
  BackendResult,
  PROMISE_CHANNEL,
} from '../../common';

export interface BackendApiHookResult<T extends PROMISE_CHANNEL> {
  data?: BackendPromiseApi[T][1];
  error?: BackendResult['error'];
  loading: boolean;
  refetch: (
    props?: BackendPromiseApi[T][0],
  ) => Promise<BackendResult<BackendPromiseApi[T][1]>>;
}

export interface BackendApiHookProps<T extends PROMISE_CHANNEL> {
  channel: T;
  props?: BackendPromiseApi[T][0];
  skip?: boolean;
}

export interface BackendApiAsyncHookResult<T extends ASYNC_CHANNEL> {
  initialData?: BackendAsyncApi[T][1];
  progressData?: BackendAsyncApi[T][2][];
  completeData?: BackendAsyncApi[T][3];
  error?: BackendResult['error'];
  loading: boolean;
  refetch: (props?: BackendAsyncApi[T][0]) => Promise<BackendResult<void>>;
}

export interface BackendApiAsyncHookProps<T extends ASYNC_CHANNEL> {
  channel: T;
  props?: BackendAsyncApi[T][0];
  skip?: boolean;
  // handlers
  onInit?: (event: BackendAsyncApi[T][1]) => void;
  onProgress?: (event: BackendAsyncApi[T][2]) => void;
  onComplete?: (event: BackendAsyncApi[T][3]) => void;
}

export interface RunBatchOperationProps {
  runScan?: boolean;
}

export interface RunBatchOperationResult {
  fileList: {
    path: string;
    worker?: number;
    preset?: string;
  }[];
}
