import { ChildProcess, fork } from 'child_process';
import { AppError } from '@superflag/super-ipc-core';
import {
  ChildMessage,
  ParentMessage,
  PROTOCOL_VERSION,
  parseChildMessage,
} from './protocol';

export interface ChildSupervisorEvents {
  onLog?: (level: 'info' | 'error', message: string) => void;
  onProgress?: (phase: 'discovered' | 'queued', count: number) => void;
  onChildMessage?: (message: ChildMessage) => void;
  /** Every IPC payload, before protocol parsing (used by legacy worker arrays). */
  onRawMessage?: (raw: unknown) => void;
  onError?: (error: Error) => void;
}

export interface ChildSupervisorOptions {
  /** Logical name, used in logs and error messages. */
  name: string;
  /** Absolute path to the child module. */
  entry: string;
  /** Extra argv entries (worker1 reads its worker number from argv[2]). */
  args?: string[];
  readyTimeoutMs?: number;
  /** 0 disables the watchdog. */
  runTimeoutMs?: number;
  shutdownGraceMs?: number;
  killGraceMs?: number;
  /** Restarts after an unexpected exit. Callers must resend configuration. */
  restartAttempts?: number;
  env?: NodeJS.ProcessEnv;
  events?: ChildSupervisorEvents;
  /** Overrides the default queueBuild message parser. */
  parseMessage?: (raw: unknown) => ChildMessage | null;
  /** Legacy children announce readiness with their own message shape. */
  isReadyMessage?: (raw: unknown) => boolean;
  /** Message that asks the child to stop (legacy children use their own shape). */
  shutdownMessage?: unknown;
}

/**
 * Owns the full lifecycle of one child process: readiness handshake, typed
 * messages, timeouts, kill escalation, restart and shutdown.
 *
 * Replaces the previous fire-and-forget `childProcess.fork` calls, which had no
 * `error` listener, no timeout and no way to terminate a stuck child
 * (MIGRATION_STATUS.md D13/D19).
 */
export class ChildSupervisor {
  private static readonly registry = new Set<ChildSupervisor>();

  static async shutdownAll(reason = 'app-quit'): Promise<void> {
    await Promise.all([...ChildSupervisor.registry].map((c) => c.stop(reason)));
  }

  private child?: ChildProcess;
  private ready = false;
  private stopping = false;
  private exited = false;
  private restarts = 0;
  private readyTimer?: ReturnType<typeof setTimeout>;
  private runTimer?: ReturnType<typeof setTimeout>;
  private exitInfo?: { code: number | null; signal: NodeJS.Signals | null };

  constructor(private readonly options: ChildSupervisorOptions) {}

  get isRunning(): boolean {
    return Boolean(this.child) && !this.exited;
  }

  async start(): Promise<void> {
    ChildSupervisor.registry.add(this);
    await this.spawn();
  }

  send(message: ParentMessage): void {
    if (!this.child?.connected) {
      throw new AppError(`Cannot message "${this.options.name}": child is not running`);
    }
    this.child.send(message);
  }

  configure(payload: unknown): void {
    this.send({ v: PROTOCOL_VERSION, type: 'configure', payload: payload as never });
  }

  /** Escape hatch for children that still speak their own message format. */
  sendRaw(payload: unknown): void {
    if (!this.child?.connected) {
      throw new AppError(`Cannot message "${this.options.name}": child is not running`);
    }
    this.child.send(payload as never);
  }

  /** Graceful shutdown, escalating to SIGTERM then SIGKILL. */
  async stop(reason = 'requested'): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    ChildSupervisor.registry.delete(this);

    const child = this.child;
    if (!child || this.exited) {
      this.clearTimers();
      return;
    }

    this.options.events?.onLog?.('info', `${this.options.name}: stopping (${reason})`);

    const exited = this.waitForExit();
    if (child.connected) {
      try {
        child.send(
          (this.options.shutdownMessage ?? {
            v: PROTOCOL_VERSION,
            type: 'shutdown',
          }) as never,
        );
      } catch {
        // child already gone; the exit handler will settle this
      }
    }

    if (await this.settle(exited, this.options.shutdownGraceMs ?? 3000)) return;

    child.kill('SIGTERM');
    if (await this.settle(exited, this.options.killGraceMs ?? 2000)) return;

    this.options.events?.onLog?.(
      'error',
      `${this.options.name}: did not exit after SIGTERM, sending SIGKILL`,
    );
    child.kill('SIGKILL');
    await this.settle(exited, 2000);
  }

  private async spawn(): Promise<void> {
    this.ready = false;
    this.exited = false;
    this.exitInfo = undefined;

    const child = fork(this.options.entry, this.options.args ?? [], {
      env: { ...process.env, ...this.options.env },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    this.child = child;

    child.on('message', (raw) => this.handleMessage(raw));
    child.on('error', (error) => this.options.events?.onError?.(error));
    child.stderr?.on('data', (chunk) =>
      this.options.events?.onLog?.('error', String(chunk).trimEnd()),
    );
    child.stdout?.on('data', (chunk) =>
      this.options.events?.onLog?.('info', String(chunk).trimEnd()),
    );

    const exited = this.waitForExit();
    child.once('exit', (code, signal) => this.handleExit(code, signal));

    const timeoutMs = this.options.readyTimeoutMs ?? 15000;
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        clearTimeout(this.readyTimer);
        resolve();
      };
      this.onReady = onReady;

      this.readyTimer = setTimeout(() => {
        reject(
          new AppError(`"${this.options.name}" did not become ready in time`, {
            context: { timeoutMs, entry: this.options.entry },
          }),
        );
        void this.stop('ready-timeout');
      }, timeoutMs);

      exited.then((info) => {
        if (this.ready) return;
        clearTimeout(this.readyTimer);
        reject(
          new AppError(`"${this.options.name}" exited before becoming ready`, {
            context: info,
          }),
        );
      });
    });

    if (this.options.runTimeoutMs) {
      this.runTimer = setTimeout(() => {
        this.options.events?.onError?.(
          new AppError(`"${this.options.name}" exceeded its run timeout`, {
            context: { runTimeoutMs: this.options.runTimeoutMs },
          }),
        );
        void this.stop('run-timeout');
      }, this.options.runTimeoutMs);
    }
  }

  private onReady?: () => void;

  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.onReady?.();
  }

  private handleMessage(raw: unknown): void {
    this.options.events?.onRawMessage?.(raw);

    if (!this.ready && this.options.isReadyMessage?.(raw)) {
      this.markReady();
    }

    const customParser = this.options.parseMessage;
    const message = (customParser ?? parseChildMessage)(raw);
    if (!message) {
      // A caller-supplied parser opts out of protocol validation (the worker
      // modules still speak their own array format).
      if (!customParser) {
        this.options.events?.onError?.(
          new AppError(`"${this.options.name}" sent an invalid message`, {
            context: { raw },
          }),
        );
      }
      return;
    }

    this.options.events?.onChildMessage?.(message);

    switch (message.type) {
      case 'ready':
        this.markReady();
        break;
      case 'log':
        this.options.events?.onLog?.(message.level, message.message);
        break;
      case 'progress':
        this.options.events?.onProgress?.(message.phase, message.count);
        break;
      case 'error':
        this.options.events?.onError?.(
          new AppError(message.message, { stack: message.stack }),
        );
        break;
      case 'complete':
        break;
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exited = true;
    this.exitInfo = { code, signal };
    this.clearTimers();

    if (this.stopping) return;

    const attempts = this.options.restartAttempts ?? 0;
    if (this.restarts < attempts) {
      this.restarts += 1;
      this.options.events?.onLog?.(
        'error',
        `${this.options.name}: exited unexpectedly (code ${code}), restarting (${this.restarts}/${attempts})`,
      );
      void this.spawn().catch((error) => this.options.events?.onError?.(error));
      return;
    }

    this.options.events?.onError?.(
      new AppError(`"${this.options.name}" exited unexpectedly`, {
        context: { code, signal },
      }),
    );
  }

  private waitForExit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    if (this.exited) {
      return Promise.resolve(this.exitInfo ?? { code: null, signal: null });
    }
    return new Promise((resolve) => {
      this.child?.once('exit', (code, signal) => resolve({ code, signal }));
    });
  }

  private async settle(
    exited: Promise<unknown>,
    timeoutMs: number,
  ): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    const result = await Promise.race([exited.then(() => true as const), timedOut]);
    if (timer) clearTimeout(timer);
    return result;
  }

  private clearTimers(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.runTimer) clearTimeout(this.runTimer);
    this.readyTimer = undefined;
    this.runTimer = undefined;
  }
}
