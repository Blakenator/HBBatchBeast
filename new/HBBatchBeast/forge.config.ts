import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
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
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
        },
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/backend/modules/mediaAnalyser.js',
          config: 'vite.main.config.ts',
        },
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/backend/modules/priorityModule.js',
          config: 'vite.main.config.ts',
        },
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/backend/modules/queueBuild.js',
          config: 'vite.main.config.ts',
        },
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/backend/modules/scheduler.js',
          config: 'vite.main.config.ts',
        },
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/backend/modules/worker1.js',
          config: 'vite.main.config.ts',
        },
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/backend/modules/worker2.js',
          config: 'vite.main.config.ts',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
};

export default config;
