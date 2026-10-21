import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { TrayStatus } from '../common';
import { assetPath } from './paths';

const ICONS: Record<TrayStatus, string> = {
  idle: 'icons/png/icon.png',
  running: 'icons/png/iconrunning.png',
  paused: 'icons/png/iconwatching.png',
  error: 'icons/png/iconerror.png',
};

const TOOLTIPS: Record<TrayStatus, string> = {
  idle: 'HBBatchBeast — idle',
  running: 'HBBatchBeast — converting',
  paused: 'HBBatchBeast — paused',
  error: 'HBBatchBeast — errors in the last run',
};

let tray: Tray | null = null;
let status: TrayStatus = 'idle';

function icon(status: TrayStatus) {
  const image = nativeImage.createFromPath(assetPath(ICONS[status]));
  if (image.isEmpty()) {
    // A missing asset leaves an invisible tray entry, which is hard to diagnose.
    console.error(`Tray icon could not be loaded: ${assetPath(ICONS[status])}`);
  }
  return image;
}

export function getTrayStatus(): TrayStatus {
  return status;
}

/**
 * Creates the tray once, on every platform. The legacy app only had one on
 * Windows, which is why Linux/macOS users had no way back to a hidden window.
 */
export function createTray(mainWindow: BrowserWindow): Tray {
  if (tray) return tray;

  tray = new Tray(icon(status));
  tray.setToolTip(TOOLTIPS[status]);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show HBBatchBeast',
        click: () => {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', () => {
    if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  return tray;
}

export function setTrayStatus(next: TrayStatus): void {
  if (next === status && tray) return;
  status = next;
  if (!tray) return;
  tray.setImage(icon(next));
  tray.setToolTip(TOOLTIPS[next]);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
  status = 'idle';
}
