import path from 'path';
import { RawProbe } from '../helpers/ffprobe';
import { buildEncoderInvocation, EncoderInvocation } from './command';
import {
  appendLog,
  copyFile,
  formatLogTimestamp,
  LOG_FILES,
  moveFile,
  removeFile,
  replaceOriginalFile,
  runCustomBat,
  statSize,
  withSourceExtension,
} from './files';
import {
  hasTelemetry,
  matchesExcludeFilter,
  matchesIncludeFilter,
  parseTelemetry,
  probeFile,
  summarizeProbe,
  evaluateSizeFilter,
} from './media';
import {
  decodeErrorMessage,
  decodeWorkerCommand,
  toWorkerEvent,
  WorkerEvent,
  WorkerItemConfig,
  WorkerResultState,
  WorkerSetup,
} from './protocol';
import { EncoderRunner, ProcessRunner } from './runner';

export interface WorkerRuntimeDeps {
  workerNumber: number;
  send: (event: WorkerEvent) => void;
  probe?: (filePath: string) => Promise<RawProbe>;
  createRunner?: () => ProcessRunner;
  clock?: () => Date;
}

interface ActiveItem {
  queueNumber: number;
  cancelRequested: boolean;
}

const MAX_CAPTURED_OUTPUT = 4 * 1024 * 1024;
const MAX_ERROR_TAIL = 64 * 1024;

/**
 * Per-worker state machine. Everything is instance state so two items can never
 * share the transient flags the legacy module kept in module-level `var`s.
 */
export class WorkerRuntime {
  private readonly workerNumber: number;
  private readonly send: (event: WorkerEvent) => void;
  private readonly probe: (filePath: string) => Promise<RawProbe>;
  private readonly createRunner: () => ProcessRunner;
  private readonly clock: () => Date;

  private setup?: WorkerSetup;
  private active?: ActiveItem;
  private runner?: ProcessRunner;
  private shuttingDown = false;

  constructor(deps: WorkerRuntimeDeps) {
    this.workerNumber = deps.workerNumber;
    this.send = deps.send;
    this.probe = deps.probe ?? probeFile;
    this.createRunner = deps.createRunner ?? (() => new EncoderRunner());
    this.clock = deps.clock ?? (() => new Date());
  }

  start(): void {
    this.emit({ type: 'ready' });
  }

  /** Returns true when the process should exit. */
  async handleCommand(raw: unknown): Promise<boolean> {
    const decoded = decodeWorkerCommand(raw);
    if (!decoded.ok) {
      this.console(
        'error',
        `Worker ${this.workerNumber} rejected a command: ${decodeErrorMessage(decoded)}`,
      );
      return false;
    }

    const command = decoded.value;
    switch (command.type) {
      case 'configure': {
        const firstConfigure = this.setup === undefined;
        this.setup = command.payload;
        if (firstConfigure && !this.active) this.requestItem();
        return false;
      }
      case 'item': {
        if (this.shuttingDown) return false;
        if (this.active) {
          this.console(
            'error',
            `Worker ${this.workerNumber} is busy with item ${this.active.queueNumber}; ignoring item ${command.payload.queueNumber}`,
          );
          return false;
        }
        void this.runItem(command.payload);
        return false;
      }
      case 'cancel-item': {
        if (this.active?.queueNumber !== command.queueNumber) return false;
        this.active.cancelRequested = true;
        await this.runner?.cancel();
        return false;
      }
      case 'shutdown': {
        this.shuttingDown = true;
        await this.runner?.cancel();
        return true;
      }
    }
  }

  private requestItem(): void {
    if (!this.shuttingDown) this.emit({ type: 'request-item' });
  }

  private emit(event: Parameters<typeof toWorkerEvent>[0]): void {
    this.send(toWorkerEvent(event));
  }

  private console(level: 'info' | 'error', message: string): void {
    this.emit({ type: 'console', level, message });
  }

  private result(
    item: WorkerItemConfig,
    state: WorkerResultState,
    detail: string,
    reason?: string,
  ): void {
    this.emit({
      type: 'result',
      queueNumber: item.queueNumber,
      state,
      detail,
      preset: item.encoder.preset,
      ...(reason ? { reason } : {}),
    });
  }

  private async runItem(item: WorkerItemConfig): Promise<void> {
    this.active = { queueNumber: item.queueNumber, cancelRequested: false };
    this.emit({ type: 'started', queueNumber: item.queueNumber });
    this.console('info', `Received item: ${item.sourcePath}`);

    try {
      if (item.action === 'skip') {
        const reason = item.skipReason ?? 'Excluded by the file filter';
        this.result(item, 'excluded', reason, reason);
      } else if (item.action === 'copy') {
        await this.copyItem(item, 'Copied');
      } else {
        await this.encodeItem(item);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.console('error', `Item ${item.queueNumber} failed: ${message}`);
      this.result(item, 'error', message);
      await this.writeErrorLog(item, message);
    } finally {
      this.active = undefined;
      this.runner = undefined;
      this.requestItem();
    }
  }

  private async copyItem(
    item: WorkerItemConfig,
    detail: string,
  ): Promise<void> {
    const target = withSourceExtension(item.finalPath, item.sourcePath);
    try {
      await copyFile(item.sourcePath, target);
      this.console('info', `Copied: ${item.sourcePath} -> ${target}`);
      this.result(item, 'skipped', detail, detail);
      if (item.deleteSource) {
        await removeFile(item.sourcePath);
        this.console('info', `Deleted source: ${item.sourcePath}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.console('error', `Copy failed: ${item.sourcePath} -> ${target}: ${message}`);
      this.result(item, 'error', `Copy failed: ${message}`);
      await this.writeErrorLog(item, message);
    }
  }

  private async encodeItem(item: WorkerItemConfig): Promise<void> {
    let invocation: EncoderInvocation;
    try {
      invocation = buildEncoderInvocation(item);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.result(item, 'error', `Invalid preset: ${message}`);
      return;
    }

    const commandDescription = describeInvocation(invocation);
    await this.log(LOG_FILES.commandList, `${commandDescription}\n`);

    let probe: RawProbe | undefined;
    let frameCount: number | undefined;
    try {
      probe = await this.probe(item.sourcePath);
      frameCount = summarizeProbe(probe).frameCount;
    } catch (error) {
      this.console(
        'error',
        `ffprobe failed for ${item.sourcePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (this.active?.cancelRequested) {
      this.result(item, 'cancelled', 'Cancelled by user');
      return;
    }

    const filterReason = await this.evaluateFilters(item, probe);
    if (filterReason) {
      const isSubtitle = path.extname(item.sourcePath).toLowerCase() === '.srt';
      if (item.copyFilteredFiles || isSubtitle) {
        await this.copyItem(item, `Copied: ${filterReason}`);
      } else {
        this.console('info', `Excluded: ${filterReason} (${item.sourcePath})`);
        this.result(item, 'excluded', filterReason, filterReason);
      }
      return;
    }

    const runner = this.createRunner();
    this.runner = runner;
    // A hard-killed run can leave a marked output behind. Removing it first
    // keeps FFmpeg from stopping at its overwrite prompt on the next attempt.
    if (item.tempOutput) {
      await removeFile(item.outputPath);
    }
    let stdout = '';
    let stderr = '';

    const capture = (chunk: string, target: 'stdout' | 'stderr') => {
      if (target === 'stdout') {
        stdout = cap(stdout + chunk, MAX_CAPTURED_OUTPUT);
      } else {
        stderr = cap(stderr + chunk, MAX_CAPTURED_OUTPUT);
      }
      const telemetry = parseTelemetry(chunk, {
        encoder: item.encoder.kind,
        frameCount,
      });
      if (hasTelemetry(telemetry)) {
        this.emit({
          type: 'progress',
          queueNumber: item.queueNumber,
          telemetry,
          raw: cap(chunk, 4000),
        });
      }
    };

    this.console('info', `Encoding: ${commandDescription}`);

    let runResult: { code: number | null; signal: NodeJS.Signals | null };
    try {
      runResult = await runner.run({
        executable: invocation.executable,
        args: invocation.args,
        lowPriority: item.lowPriority,
        onStdout: (chunk) => capture(chunk, 'stdout'),
        onStderr: (chunk) => capture(chunk, 'stderr'),
      });
    } catch (error) {
      runResult = { code: null, signal: null };
      stderr += `\n${error instanceof Error ? error.message : String(error)}`;
    }

    await this.flushEncoderLogs(item, stdout, stderr);

    if (this.active?.cancelRequested || runner.isCancelled) {
      await removeFile(item.outputPath);
      this.console('info', `Cancelled: ${item.sourcePath}`);
      this.result(item, 'cancelled', 'Cancelled by user');
      return;
    }

    const errorLog = `Command: \n\n${commandDescription}\n\n${cap(stderr, MAX_ERROR_TAIL)}`;
    const outputBytes = await statSize(item.outputPath);

    if (outputBytes === undefined || outputBytes === 0) {
      const detail = `HBBatchBeast ALERT: NO OUTPUT FILE PRODUCED\n${errorLog}`;
      this.console('error', `No output file: ${item.outputPath}`);
      await removeFile(item.outputPath);
      this.result(item, 'error', detail);
      await this.writeErrorLog(item, errorLog);
      return;
    }

    if (runResult.code !== 0) {
      const detail = `Encoder exited with code ${runResult.code ?? 'null'}\n${errorLog}`;
      this.console('error', `Encoder failed: ${item.outputPath}`);
      await removeFile(item.outputPath);
      this.result(item, 'error', detail);
      await this.writeErrorLog(item, errorLog);
      return;
    }

    await this.finishSuccessfulItem(item, outputBytes);
  }

  private async evaluateFilters(
    item: WorkerItemConfig,
    probe: RawProbe | undefined,
  ): Promise<string | undefined> {
    if (probe) {
      if (!matchesIncludeFilter(probe, item.filters.include)) {
        return "Excluded, does not meet 'Include' conditions";
      }
      if (matchesExcludeFilter(probe, item.filters.exclude)) {
        return "Excluded by 'Exclude' property filter";
      }
    }

    const size = await statSize(item.sourcePath);
    if (size === undefined) return undefined;
    const evaluation = evaluateSizeFilter(size, item.filters.size);
    return evaluation.ok ? undefined : evaluation.reason;
  }

  private async finishSuccessfulItem(
    item: WorkerItemConfig,
    outputBytes: number,
  ): Promise<void> {
    const sourceBytes = (await statSize(item.sourcePath)) ?? 0;
    this.emit({
      type: 'file-sizes',
      queueNumber: item.queueNumber,
      sourceBytes,
      outputBytes,
    });

    if (item.customBatPath) {
      try {
        await runCustomBat(item.customBatPath);
        this.console('info', `Ran batch script: ${item.customBatPath}`);
      } catch (error) {
        this.console(
          'error',
          `Batch script failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    let actualOutput = item.outputPath;
    let reachedFinalPath = true;
    if (item.outputPath !== item.finalPath) {
      try {
        await moveFile(item.outputPath, item.finalPath);
        actualOutput = item.finalPath;
        this.console(
          'info',
          `Moved file: ${item.outputPath} -> ${item.finalPath}`,
        );
      } catch (error) {
        reachedFinalPath = false;
        const message = `Moving file failed: ${item.outputPath} -> ${item.finalPath}: ${
          error instanceof Error ? error.message : String(error)
        }`;
        this.console('error', message);
        await this.writeErrorLog(item, message);
      }
    }

    // Without the rename the conversion never reached its final name. Keep the
    // source untouched so the item can be retried safely.
    if (!reachedFinalPath) {
      this.result(
        item,
        'error',
        `Could not move the converted file to ${item.finalPath}`,
      );
      return;
    }

    const logTarget =
      item.outputPath === item.finalPath ? item.outputPath : item.finalPath;
    await this.log(
      LOG_FILES.conversionLog,
      `[${formatLogTimestamp(this.clock())}]--------Processed----------${
        item.sourcePath
      }------------to----------${logTarget}----------using preset----------:${
        item.encoder.preset
      }\r\n`,
    );

    if (item.replaceOriginal === 'never' && item.deleteSource) {
      await removeFile(item.sourcePath);
      this.console('info', `Deleted source: ${item.sourcePath}`);
    }

    if (item.replaceOriginal !== 'never') {
      await this.maybeReplaceOriginal(item, actualOutput);
    }

    this.result(item, 'success', '');
  }

  private async maybeReplaceOriginal(
    item: WorkerItemConfig,
    actualOutput: string,
  ): Promise<void> {
    const originalSize = await statSize(item.sourcePath);
    const convertedSize = await statSize(actualOutput);
    if (originalSize === undefined || convertedSize === undefined) {
      this.console(
        'error',
        `Original not replaced: could not measure ${item.sourcePath}`,
      );
      return;
    }

    const shouldReplace =
      item.replaceOriginal === 'always' || convertedSize < originalSize;

    if (!shouldReplace) {
      this.console(
        'info',
        `Original not replaced: New file is larger (${item.sourcePath})`,
      );
      return;
    }

    try {
      const target = await replaceOriginalFile(item.sourcePath, actualOutput);
      this.console('info', `Original file replaced: ${item.sourcePath} -> ${target}`);
      await this.log(
        LOG_FILES.replacedList,
        `${path.normalize(target)}\n`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.console(
        'error',
        `Error replacing original file: ${item.sourcePath}: ${message}`,
      );
      await this.log(
        LOG_FILES.errorLog,
        `[${formatLogTimestamp(this.clock())}]${item.sourcePath}\r\n${message}\r\n`,
      );
    }
  }

  private async flushEncoderLogs(
    item: WorkerItemConfig,
    stdout: string,
    stderr: string,
  ): Promise<void> {
    if (!item.saveWorkerLogs) return;
    if (stdout) {
      await this.log(
        LOG_FILES.workerConsole(this.workerNumber),
        stdout,
      );
    }
    if (stderr) {
      await this.log(
        LOG_FILES.workerConsoleError(this.workerNumber),
        stderr,
      );
    }
  }

  private async writeErrorLog(
    item: WorkerItemConfig,
    errorLog: string,
  ): Promise<void> {
    const text = item.saveWorkerLogs
      ? `[${formatLogTimestamp(this.clock())}]${item.sourcePath}\r\n${errorLog}\r\n`
      : `${item.sourcePath}\r\n`;
    await this.log(LOG_FILES.errorLog, text);
  }

  private async log(
    fileName: string,
    text: string,
  ): Promise<void> {
    if (!this.setup) return;
    await appendLog(this.setup.logDirectory, fileName, text);
  }
}

function cap(value: string, limit: number): string {
  return value.length <= limit ? value : value.slice(value.length - limit);
}

function describeInvocation(invocation: EncoderInvocation): string {
  const quote = (value: string) =>
    /[\s'"]/.test(value) ? JSON.stringify(value) : value;
  return [quote(invocation.executable), ...invocation.args.map(quote)].join(' ');
}
