import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const forgeCli = require.resolve('@electron-forge/cli/dist/electron-forge.js');

// Electron 45 renders no window decorations on Wayland (GNOME), which hides the
// titlebar buttons. The Ozone platform has to be chosen before the app script
// runs, so dev has to pass it on the command line. Packaged builds re-exec
// themselves for the same reason (see src/main.ts).
const ozoneArgs = process.platform === 'linux' ? ['--ozone-platform=x11'] : [];
// Forward extra args (e.g. `pnpm start -- --max-parallel 4`) to the app itself.
const appArgs = [...ozoneArgs, ...process.argv.slice(2)];
const electronArgs = ['--', ...appArgs];

const child = spawn(
  process.execPath,
  [forgeCli, 'start', ...electronArgs],
  {
    stdio: 'inherit',
    // Give the whole dev tree its own process group so Ctrl+C / SIGTERM can be
    // forwarded to Electron and every encoder it spawned, not just Forge.
    detached: process.platform !== 'win32',
  },
);

const killTree = (signal) => {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The tree may already be gone.
  }
};

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    killTree(signal);
    // Never leave the dev app running if a child ignores the signal.
    setTimeout(() => {
      killTree('SIGKILL');
      process.exit(1);
    }, 8000).unref();
  });
}

child.on('exit', (code, signal) => {
  // Workers or encoders can outlive Electron if it was killed abruptly.
  if (process.platform !== 'win32') killTree('SIGTERM');
  process.exit(signal ? 1 : (code ?? 0));
});
