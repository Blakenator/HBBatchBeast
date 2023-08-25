import { BackendHandler, BackendHandlerAsync } from '../types';
import {
  AppError,
  ASYNC_REPLY_SUFFIX,
  BackendResult,
  BackendResultMode,
} from '../../common';

function backendResultFromError(
  error: any,
  resultMode: BackendResultMode = BackendResultMode.Complete,
  callId?: number,
) {
  return {
    error: JSON.stringify(new AppError('error', { inner: error })),
    resultMode,
    callId,
  };
}

export function wrapHandler(
  app: Electron.App,
  handler: BackendHandler,
): (event: Electron.IpcMainEvent, args: any) => Promise<BackendResult> {
  return async (event, args) => {
    try {
      const content = handler({ app, args, event });
      return {
        content: JSON.stringify(content),
        resultMode: BackendResultMode.Init,
      };
    } catch (error) {
      return backendResultFromError(error);
    }
  };
}

function wrapAsyncResult(
  data: any,
  event: Electron.IpcMainEvent,
  channel: string,
  resultMode: BackendResultMode,
  callId: number,
) {
  let result: BackendResult;
  try {
    result = {
      content: JSON.stringify(data),
      resultMode,
      callId,
    };
  } catch (error) {
    result = backendResultFromError(error, resultMode, callId);
  }
  event.sender.send(channel + ASYNC_REPLY_SUFFIX, result);
}

export function wrapHandlerAsync(
  app: Electron.App,
  handler: BackendHandlerAsync,
  channel: string,
): (
  event: Electron.IpcMainEvent,
  args: any,
  callId: number,
) => Promise<BackendResult> {
  return async (event, args, callId) => {
    try {
      const content = handler({
        app,
        args,
        event,
        handlers: {
          onInit: (data) => {
            wrapAsyncResult(
              data,
              event,
              channel,
              BackendResultMode.Init,
              callId,
            );
          },
          onProgress: (data) => {
            wrapAsyncResult(
              data,
              event,
              channel,
              BackendResultMode.Progress,
              callId,
            );
          },
          onComplete: (data) => {
            wrapAsyncResult(
              data,
              event,
              channel,
              BackendResultMode.Complete,
              callId,
            );
          },
        },
      });
      return {
        content: JSON.stringify(content),
        resultMode: BackendResultMode.Complete,
        callId,
      };
    } catch (error) {
      return backendResultFromError(error, BackendResultMode.Complete, callId);
    }
  };
}
