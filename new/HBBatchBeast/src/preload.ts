// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApi', {
  invoke: (channel: any, ...props: any[]) =>
    ipcRenderer.invoke(channel, ...props),
  on: (channel: any, callback: (...props: any[]) => void) =>
    ipcRenderer.on(channel, callback),
  removeListener: (channel: any, callback: (...props: any[]) => void) =>
    ipcRenderer.removeListener(channel, callback),
  // send: (channel, ...props) => ipcRenderer.send(channel, ...props),
  // removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
