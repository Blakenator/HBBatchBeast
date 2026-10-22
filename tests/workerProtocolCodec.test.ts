import { describe, expect, it } from 'vitest';
import {
  cancelItemCommand,
  configureCommand,
  decodeWorkerCommand,
  decodeWorkerEvent,
  decodeWorkerItem,
  itemCommand,
  shutdownCommand,
  toWorkerEvent,
  WORKER_PROTOCOL_VERSION,
  WorkerItemConfig,
} from '../src/backend/workers/protocol';

function makeItem(overrides: Partial<WorkerItemConfig> = {}): WorkerItemConfig {
  return {
    queueNumber: 3,
    sourcePath: '/src/a.mkv',
    outputPath: '/tmp/a.mp4',
    finalPath: '/dst/a.mp4',
    action: 'encode',
    copyFilteredFiles: false,
    encoder: {
      kind: 'handbrake',
      executable: 'HandBrakeCLI',
      preset: '-Z "Very Fast 1080p30"',
      presetImportFiles: ['/home/user/presets.json'],
    },
    deleteSource: false,
    replaceOriginal: 'never',
    customBatPath: '',
    lowPriority: false,
    saveWorkerLogs: false,
    filters: {
      include: { mode: 'off', rows: [] },
      exclude: { mode: 'off', rows: [] },
      size: {},
    },
    ...overrides,
  };
}

describe('worker command codec', () => {
  it('round-trips a structured item', () => {
    const command = itemCommand(makeItem());
    expect(command.v).toBe(WORKER_PROTOCOL_VERSION);
    expect(decodeWorkerCommand(command)).toEqual({ ok: true, value: command });
  });

  it('decodes configure, cancel and shutdown commands', () => {
    expect(
      decodeWorkerCommand(
        configureCommand({ logDirectory: '/home/user/Logs' }),
      ).ok,
    ).toBe(true);
    expect(decodeWorkerCommand(cancelItemCommand(4)).ok).toBe(true);
    expect(decodeWorkerCommand(shutdownCommand()).ok).toBe(true);
  });

  it('rejects a stale protocol version', () => {
    const result = decodeWorkerCommand({ ...cancelItemCommand(1), v: 2 });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown fields and wrong primitive types', () => {
    expect(
      decodeWorkerCommand({ ...cancelItemCommand(1), extra: true }).ok,
    ).toBe(false);
    expect(
      decodeWorkerCommand({
        v: WORKER_PROTOCOL_VERSION,
        type: 'cancel-item',
        queueNumber: '1',
      }).ok,
    ).toBe(false);
  });

  it('reports the failing field path', () => {
    const result = decodeWorkerCommand({
      ...itemCommand(makeItem()),
      payload: { ...makeItem(), sourcePath: '' },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('payload.sourcePath');
  });
});

describe('worker item codec', () => {
  it('accepts a valid item', () => {
    expect(decodeWorkerItem(makeItem())).toEqual({
      ok: true,
      value: makeItem(),
    });
  });

  it('rejects invalid actions, queue numbers and filter ranges', () => {
    expect(decodeWorkerItem(makeItem({ action: 'transcode' as never })).ok).toBe(
      false,
    );
    expect(decodeWorkerItem(makeItem({ queueNumber: -1 })).ok).toBe(false);
    expect(
      decodeWorkerItem(
        makeItem({
          filters: {
            include: { mode: 'off', rows: [] },
            exclude: { mode: 'off', rows: [] },
            size: { minMb: 10, maxMb: 5 },
          },
        }),
      ).ok,
    ).toBe(false);
  });
});

describe('worker event codec', () => {
  it('decodes structured progress and results', () => {
    expect(
      decodeWorkerEvent(
        toWorkerEvent({
          type: 'progress',
          queueNumber: 2,
          telemetry: { percent: 42.5, fps: 45.7 },
          raw: 'Encoding: 42.50 %',
        }),
      ).ok,
    ).toBe(true);

    for (const state of ['success', 'error', 'skipped', 'cancelled'] as const) {
      expect(
        decodeWorkerEvent(
          toWorkerEvent({
            type: 'result',
            queueNumber: 2,
            state,
            detail: '',
            preset: '-Z "x"',
          }),
        ).ok,
      ).toBe(true);
    }
  });

  it('rejects out-of-range telemetry and unknown events', () => {
    expect(
      decodeWorkerEvent(
        toWorkerEvent({
          type: 'progress',
          queueNumber: 0,
          telemetry: { percent: 140 },
          raw: '',
        }),
      ).ok,
    ).toBe(false);
    expect(decodeWorkerEvent({ v: WORKER_PROTOCOL_VERSION, type: 'nope' }).ok).toBe(
      false,
    );
  });
});
