import { ipcMain } from 'electron';
import { wrapHandler, wrapHandlerAsync } from './wrapHandler';
import { BackendHandler, BackendHandlerAsync } from '../types';

export function setupApiHandlers(
  app: Electron.App,
  backendHandlers: Record<string, BackendHandler>,
  backendAsyncHandlers: Record<string, BackendHandlerAsync>,
) {
  Object.entries(backendHandlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, wrapHandler(app, handler));
  });

  Object.entries(backendAsyncHandlers).forEach(([channel, handler]) => {
    ipcMain.handle(channel, wrapHandlerAsync(app, handler, channel));
  });
}
