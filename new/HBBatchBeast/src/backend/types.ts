import * as Electron from 'electron';

export type BackendHandler<P = any, R = any> = (args: {
  app: Electron.App;
  args: P;
  event: Electron.IpcMainEvent;
}) => Promise<R> | R;

export type BackendHandlerAsync<
  P = any,
  RINIT = any,
  RPROGRESS = any,
  RCOMPLETE = any,
> = (args: {
  app: Electron.App;
  args: P;
  event: Electron.IpcMainEvent;
  handlers: {
    onInit: (result: RINIT) => void;
    onProgress: (result: RPROGRESS) => void;
    onComplete: (result: RCOMPLETE) => void;
  };
}) => Promise<void> | void;
