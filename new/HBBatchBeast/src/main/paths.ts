import { app } from 'electron';
import path from 'path';

/**
 * Runtime assets (tray icons, window icon) live outside the JS bundle. In
 * development they are read from `src/assets`; packaging copies them to
 * `resources/assets` because the asar only receives the Vite output.
 */
export function assetsRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '..', '..', 'src', 'assets');
}

export function assetPath(...segments: string[]): string {
  return path.join(assetsRoot(), ...segments);
}
