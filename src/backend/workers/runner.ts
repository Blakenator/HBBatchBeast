import { ChildProcess, execFile, spawn } from 'child_process';
import os from 'os';

export interface EncoderRunOptions {
  executable: string;
  args: string[];
  lowPriority?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface EncoderRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** Runtime dependency; tests substitute a fake encoder. */
export interface ProcessRunner {
  readonly isCancelled: boolean;
  run(options: EncoderRunOptions): Promise<EncoderRunResult>;
  cancel(): Promise<void>;
}

const KILL_ESCALATION_MS = 2000;

/**
 * Owns one encoder process: streaming output, optional low priority, and a
 * direct process-tree kill. Runs inside the worker child, never on Electron's
 * main thread.
 */
export class EncoderRunner implements ProcessRunner {
  private child?: ChildProcess;
  private cancelled = false;
  private killTimer?: ReturnType<typeof setTimeout>;

  get isCancelled(): boolean {
    return this.cancelled;
  }

  run(options: EncoderRunOptions): Promise<EncoderRunResult> {
    this.cancelled = false;
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (result: EncoderRunResult) => {
        if (settled) return;
        settled = true;
        if (this.killTimer) clearTimeout(this.killTimer);
        this.killTimer = undefined;
        this.child = undefined;
        resolve(result);
      };

      const child = spawn(options.executable, options.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // A detached POSIX process gets its own group, so cancel() can signal
        // the encoder and any grandchildren with one kill.
        detached: process.platform !== 'win32',
      });
      this.child = child;

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => options.onStdout?.(chunk));
      child.stderr?.on('data', (chunk: string) => options.onStderr?.(chunk));

      child.once('error', (error) => {
        if (settled) return;
        settled = true;
        if (this.killTimer) clearTimeout(this.killTimer);
        this.killTimer = undefined;
        this.child = undefined;
        reject(error);
      });

      child.once('close', (code, signal) => settle({ code, signal }));

      if (options.lowPriority && child.pid !== undefined) {
        applyLowPriority(child.pid);
      }
    });
  }

  /** Stops the encoder and its children, escalating to SIGKILL. */
  async cancel(): Promise<void> {
    const child = this.child;
    if (!child || child.pid === undefined) return;
    this.cancelled = true;

    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        execFile(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true },
          () => resolve(),
        );
      });
      return;
    }

    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }

    this.killTimer = setTimeout(() => {
      this.killTimer = undefined;
      if (!this.child || this.child.pid === undefined) return;
      try {
        process.kill(-this.child.pid, 'SIGKILL');
      } catch {
        this.child.kill('SIGKILL');
      }
    }, KILL_ESCALATION_MS);
  }
}

function applyLowPriority(pid: number): void {
  try {
    const priority =
      process.platform === 'win32'
        ? os.constants.priority.PRIORITY_BELOW_NORMAL
        : 10;
    os.setPriority(pid, priority);
  } catch {
    // Best effort; an unsupported platform or permission error must not fail
    // the conversion.
  }
}
