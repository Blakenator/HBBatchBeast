import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const forgeCli = require.resolve('@electron-forge/cli/dist/electron-forge.js');

// Electron 45 renders no window decorations on Wayland (GNOME), which hides the
// titlebar buttons. The Ozone platform has to be chosen before the app script
// runs, so dev has to pass it on the command line. Packaged builds re-exec
// themselves for the same reason (see src/main.ts).
const electronArgs = process.platform === 'linux' ? ['--', '--ozone-platform=x11'] : [];

const child = spawn(
  process.execPath,
  [forgeCli, 'start', ...electronArgs],
  { stdio: 'inherit' },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
