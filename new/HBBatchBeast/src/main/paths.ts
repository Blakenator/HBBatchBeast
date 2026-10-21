import { app } from 'electron';
import path from 'path';

/**
 * Runtime assets (tray icons, window icon) live outside the JS bundle. In
 * development they are read from `src/assets/icons`; packaging copies that
 * directory to `resources/icons` because the asar only receives Vite output.
 */
export function assetsRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icons')
    : path.join(__dirname, '..', '..', 'src', 'assets', 'icons');
}

export function assetPath(...segments: string[]): string {
  return path.join(assetsRoot(), ...segments);
}
