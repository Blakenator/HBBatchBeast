// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { registerElectronApiBridge } from '@superflag/super-ipc/preloader';
import { contextBridge, ipcRenderer } from 'electron';

registerElectronApiBridge(contextBridge, ipcRenderer);
