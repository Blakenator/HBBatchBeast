import fs from 'fs';
import path from 'path';
import type { ForgeConfig, ResolvedForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';

/** Packaging runs once per target platform, so pick that platform's icon. */
function iconFor(platform: NodeJS.Platform): string {
  switch (platform) {
    case 'win32':
      return 'src/assets/icons/win/icon.ico';
    case 'darwin':
      return 'src/assets/icons/mac/icon.icns';
    default:
      return 'src/assets/icons/png/icon.png';
  }
}

/**
 * `ffprobe-static` ships darwin/win32/linux binaries (~340 MB). Only the target
 * platform's copy can ever run, so drop the rest before the asar is built.
 */
function pruneForeignFfprobe(buildPath: string, platform: string): void {
  const binDir = path.join(buildPath, 'node_modules', 'ffprobe-static', 'bin');
  if (!fs.existsSync(binDir)) return;

  for (const entry of fs.readdirSync(binDir)) {
    if (entry === platform) continue;
    fs.rmSync(path.join(binDir, entry), { recursive: true, force: true });
  }
}

const config: ForgeConfig = {
  hooks: {
    packageAfterCopy: async (
      _config: ResolvedForgeConfig,
      buildPath: string,
      _electronVersion: string,
      platform: string,
    ) => {
      pruneForeignFfprobe(buildPath, platform);
    },
  },
  packagerConfig: {
    // Binaries cannot be executed from inside an asar archive, so ffprobe is
    // unpacked next to it (the code swaps app.asar for app.asar.unpacked).
    asar: { unpack: '**/node_modules/ffprobe-static/bin/**' },
    icon: iconFor(process.platform),
    // Linux makers (and the generated .desktop `Exec=` line) look for the package
    // name, not the product name.
    executableName: 'hbbatchbeast',
    // Tray and window icons are read at runtime through `resources/icons`.
    extraResource: ['src/assets/icons'],
    // The Vite plugin keeps only `/.vite` by default. The forked child modules and
    // ffprobe-static resolve real packages at runtime, so keep the app manifest and
    // production node_modules too (packager prunes devDependencies).
    ignore: (file: string) => {
      if (!file) return false;
      // .bin holds symlinks to dev-only binaries that pruning removes
      if (/\/\.bin(\/|$)/.test(file)) return true;
      return !(
        file === '/package.json' ||
        file.startsWith('/.vite') ||
        file.startsWith('/node_modules')
      );
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          homepage: 'https://github.com/Blakenator/HBBatchBeast',
          categories: ['AudioVideo', 'Utility'],
        },
      },
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          homepage: 'https://github.com/Blakenator/HBBatchBeast',
          categories: ['AudioVideo', 'Utility'],
          maintainer: 'Blake Stacks <blakestacks@rocketmail.com>',
          // Adds --ozone-platform=x11 so the launcher matches the Wayland workaround
          // in main.ts instead of relying on the packaged re-exec alone.
          desktopTemplate: 'packaging/desktop.ejs',
        },
      },
    },
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
        },
        {
          // Child-process entries keep their basenames: Forge emits
          // `[name].cjs`, which `childEntries.ts` resolves by name.
          entry: 'src/backend/scanner/queueBuild.ts',
          config: 'vite.main.config.mts',
        },
        {
          entry: 'src/backend/workers/worker1.ts',
          config: 'vite.main.config.mts',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
  ],
};

export default config;
