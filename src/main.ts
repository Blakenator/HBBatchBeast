import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { setupApiHandlers } from '@superflag/super-ipc-backend';
import squirrelStartup from 'electron-squirrel-startup';
import path from 'path';
import { BackendAsyncHandlers, BackendHandlers } from './backend';
import { ChildSupervisor } from './backend/processes/childSupervisor';
import { validateChildEntries } from './backend/processes/childEntries';
import { createTray, destroyTray } from './main/tray';
import { installAppMenu } from './main/menu';
import { assetPath } from './main/paths';
import {
  describeCounts,
  enforceProcessBudget,
  parseMaxParallel,
  setMaxParallel,
} from './main/processBudget';

// Optional startup guard: refuse to run when the machine already has more
// encoder processes than the configured budget (see main/processBudget.ts).
let startupBlocked = false;
try {
  const maxParallel = parseMaxParallel(process.argv, process.env);
  if (maxParallel !== undefined) {
    setMaxParallel(maxParallel);
    const counts = enforceProcessBudget(maxParallel);
    console.log(
      `--max-parallel ${maxParallel} accepted: ${describeCounts(counts)}.`,
    );
  }
} catch (error) {
  startupBlocked = true;
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  // A terminal launch shows the message directly; a desktop launch would
  // otherwise fail silently, so keep a dialog for that case only.
  if (process.stdout.isTTY) {
    app.exit(1);
  } else {
    dialog.showErrorBox('HBBatchBeast cannot start', message);
    app.exit(1);
  }
}

// Electron 45 running natively on Wayland under GNOME renders no window
// decorations, so the titlebar (and its maximise/close buttons) disappears.
// XWayland restores normal chrome. The switch has to be present before Chromium
// picks its Ozone platform, which is earlier than this script runs, so relaunch
// once with it. Set HBB_OZONE_PLATFORM=wayland to keep native Wayland.
const ozonePlatformOverride = process.env.HBB_OZONE_PLATFORM;
const runningOnWayland = process.env.XDG_SESSION_TYPE === 'wayland';
const platformAlreadySelected = process.argv.some((arg) =>
  arg.startsWith('--ozone-platform'),
);

// In development `scripts/start.mjs` passes the flag, so only packaged builds
// need to re-exec (and only they can do so safely: Forge supervises dev).
if (
  app.isPackaged &&
  process.platform === 'linux' &&
  runningOnWayland &&
  !ozonePlatformOverride &&
  !platformAlreadySelected
) {
  process.env.HBB_OZONE_RELAUNCHED = '1';
  app.relaunch({ args: ['--ozone-platform=x11', ...process.argv.slice(1)] });
  app.exit(0);
}

if (process.platform === 'linux' && ozonePlatformOverride) {
  app.commandLine.appendSwitch('ozone-platform', ozonePlatformOverride);
}

// Opt-in DevTools protocol endpoint for UI automation in development builds.
if (!app.isPackaged && process.env.HBB_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.HBB_DEBUG_PORT);
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (squirrelStartup) {
  app.quit();
}

try {
  validateChildEntries();
} catch (error) {
  console.error('Build output is incomplete; child processes cannot start.', error);
}

// Never leave worker processes behind when the app shuts down.
app.on('will-quit', () => {
  destroyTray();
  void ChildSupervisor.shutdownAll();
});

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    frame: true,
    backgroundColor: '#16161a',
    icon: assetPath('png/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
    },
    title: 'HBBatchBeast',
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Tray and menu are created once; the legacy build only had a Windows tray
  // and re-registered its IPC listeners on every window.
  createTray(mainWindow);
  installAppMenu();

  setupApiHandlers(app, BackendHandlers, BackendAsyncHandlers, ipcMain);
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  if (startupBlocked) {
    app.quit();
    return;
  }
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
