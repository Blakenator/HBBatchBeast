import {
  AppError,
  ASYNC_CHANNEL,
  ASYNC_REPLY_SUFFIX,
  BackendAsyncApi,
  BackendPromiseApi,
  BackendResult,
  BackendResultMode,
  PROMISE_CHANNEL,
} from '../../common';
import {
  BackendApiAsyncHookProps,
  BackendApiAsyncHookResult,
  BackendApiHookProps,
  BackendApiHookResult,
} from './types';
import { useCallback, useEffect, useRef, useState } from 'react';

const electronApi = (window as any).electronApi;

function handleError<T>(
  response: BackendResult<T>,
  setError: (value: any) => void,
) {
  if (response.error) {
    try {
      console.error(response.error);
      setError(AppError.fromJSON(response.error));
    } catch (err) {
      console.error('received error that is not an AppError', response.error);
      setError(response.error);
    }
  }
}

function tryParseData<T>(response: BackendResult): T {
  try {
    return JSON.parse(response.content);
  } catch (err) {
    console.error('Invalid json response');
    return undefined;
  }
}

export const useBackend = <T extends PROMISE_CHANNEL>({
  channel,
  props,
  skip,
}: BackendApiHookProps<T>): BackendApiHookResult<T> => {
  const [loading, setLoading] = useState(!skip);
  const [data, setData] = useState<BackendPromiseApi[T][1]>();
  const [error, setError] = useState<BackendResult['error']>();

  const makeRequest = useCallback(
    (propOverrides?: BackendPromiseApi[T][0]) => {
      if (!loading) {
        setLoading(true);
      }
      return electronApi
        .invoke(channel, propOverrides ?? props)
        .then((response: BackendResult) => {
          let receivedData: BackendPromiseApi[T][1] | undefined;
          if (response.content) {
            receivedData = tryParseData(response);
            if (receivedData) {
              setData(receivedData);
            }
          }

          handleError(response, setError);

          setLoading(false);
          return {
            data: receivedData,
            error: response.error,
            resultMode: BackendResultMode.Complete,
          } as BackendResult<BackendPromiseApi[T][1]>;
        });
    },
    [channel, loading, props],
  );

  useEffect(() => {
    if (!skip) {
      makeRequest(props);
    }
  }, []);

  return {
    data,
    error,
    loading,
    refetch: makeRequest,
  };
};

export const useBackendAsync = <T extends ASYNC_CHANNEL>({
  channel,
  props,
  skip,
  onInit,
  onProgress,
  onComplete,
}: BackendApiAsyncHookProps<T>): BackendApiAsyncHookResult<T> => {
  const [loading, setLoading] = useState(!skip);
  const [initialData, setInitialData] = useState<BackendAsyncApi[T][1]>();
  const [progressData, setProgressData] = useState<BackendAsyncApi[T][2][]>([]);
  const [completeData, setCompleteData] = useState<BackendAsyncApi[T][3]>();
  const [error, setError] = useState<BackendResult['error']>();
  const callId = useRef(Math.round(Math.random() * 100000));
  const replyChannel = channel + ASYNC_REPLY_SUFFIX;

  // status listener
  const listener = useCallback(
    (event: any, result: BackendResult) => {
      if (result.callId !== callId.current) {
        // exit early if not same origin
        return;
      }

      if (completeData) {
        throw new AppError('Async data received after onComplete processed', {
          context: { result },
        });
      }

      handleError(result, setError);

      if (result.content) {
        if (result.resultMode === BackendResultMode.Init) {
          const parsedData = tryParseData<BackendAsyncApi[T][1]>(result);
          if (parsedData) {
            setInitialData(parsedData);
            onInit?.(parsedData);
          }
        } else if (result.resultMode === BackendResultMode.Progress) {
          const parsedData = tryParseData<BackendAsyncApi[T][2]>(result);
          if (parsedData) {
            setProgressData((currentProgressData) => [
              ...currentProgressData,
              parsedData,
            ]);
            onProgress?.(parsedData);
          }
        } else if (result.resultMode === BackendResultMode.Complete) {
          const parsedData = tryParseData<BackendAsyncApi[T][3]>(result);
          if (parsedData) {
            setCompleteData(parsedData);
            onComplete?.(parsedData);
            setLoading(false);
            console.log('loading set to false');
          }
        }
      }
    },
    [
      setLoading,
      setCompleteData,
      setProgressData,
      setError,
      onComplete,
      onInit,
      onProgress,
    ],
  );

  useEffect(() => {
    electronApi.on(replyChannel, listener);

    // remove on unmount
    return electronApi.removeListener(replyChannel, listener);
  }, [listener]);

  const makeRequest = useCallback(
    (propOverrides?: BackendAsyncApi[T][0]) => {
      callId.current = Math.round(Math.random() * 100000);
      if (!loading) {
        setLoading(true);
      }

      return electronApi
        .invoke(channel, propOverrides ?? props, callId.current)
        .then((response: BackendResult<void>) => {
          handleError(response, setError);
          return {
            error: response.error,
            resultMode: BackendResultMode.Complete,
          } as BackendResult<void>;
        });
    },
    [channel, loading, props],
  );

  useEffect(() => {
    if (!skip) {
      makeRequest(props);
    }
  }, []);

  return {
    initialData,
    progressData,
    completeData,
    error,
    loading,
    refetch: makeRequest,
  };
};
