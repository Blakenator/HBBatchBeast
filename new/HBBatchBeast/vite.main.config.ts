import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';
import packageJson from './package.json';

// Modules that must stay external: the Electron runtime, Node built-ins, and
// anything the forked child-process modules `require()` at runtime. Bundling
// those would break them (and `ffprobe`-style binaries cannot be bundled).
const runtimeDependencies = [
  'fs-extra',
  'ffprobe',
  'ffprobe-static',
  ...Object.keys(packageJson.dependencies ?? {}),
];

// https://vitejs.dev/config
export default defineConfig({
  build: {
    sourcemap: 'inline',
    rolldownOptions: {
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
        ...runtimeDependencies,
      ],
    },
  },
});
