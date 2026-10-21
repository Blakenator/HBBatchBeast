import { describe, expect, it } from 'vitest';
import {
  encodeWorkerItem,
  parseWorkerEvent,
  WorkerItemConfig,
} from '../src/backend/run/workerProtocol';

const item: WorkerItemConfig = {
  queueNumber: 7,
  skipOrCopy: 0,
  copyOnOff: false,
  replaceOriginalFile: true,
  moveCorruptFileOnOff: false,
  corruptDestinationPath: '/corrupt',
  mode: 'scanAndConvert',
  itemChecked: true,
  fileFiltersInclude: 'codec_name=h264',
  fileFiltersExclude: '',
  replaceOriginalFileAlways: false,
  includeAnyProperties: false,
  includeAllProperties: false,
  excludeAnyProperties: false,
  excludeAllProperties: false,
  handBrakeMode: true,
  ffmpegMode: false,
  deleteSourceFiles: false,
  customBatOn: false,
  tempFolderSelected: false,
  sourcePath: '/src/a.mkv',
  preset: '-Z "Very Fast 1080p30"',
  destinationPath: '/dst/a.mp4',
  destinationFinalPath: '',
  minFileSizeOnOff: false,
  minFileSize: '',
  maxFileSizeOnOff: false,
  maxFileSize: '',
  thoroughHealthCheck: false,
  repairFile: false,
  repairCrfValue: '23',
  handBrakeCliPath: 'HandBrakeCLI',
  ffmpegPath: '/usr/bin/ffmpeg',
  saveWorkerLogs: false,
  handBrakePresetImportFiles: ['/home/user/.config/ghb/presets.json'],
};

describe('encodeWorkerItem', () => {
  it('keeps the legacy slot layout worker1 still reads', () => {
    const encoded = encodeWorkerItem(item);

    expect(encoded[0]).toBe('queueNumber');
    expect(encoded[1]).toBe(7); // queueNumber
    expect(encoded[2]).toBe(0); // skipOrCopy
    expect(encoded[7]).toBe('scanAndConvert'); // mode
    expect(encoded[9]).toBe(true); // itemChecked
    expect(encoded[17]).toBe(true); // handBrakeMode
    expect(encoded[22]).toBe('/src/a.mkv');
    expect(encoded[23]).toBe('-Z "Very Fast 1080p30"');
    expect(encoded[24]).toBe('/dst/a.mp4');
    expect(encoded[35]).toBe(false); // saveWorkerLogs
    expect(encoded[36]).toEqual(['/home/user/.config/ghb/presets.json']);
    expect(encoded).toHaveLength(37);
  });
});

describe('parseWorkerEvent', () => {
  it('reads a queue request', () => {
    expect(parseWorkerEvent([1, 'queueRequest'])).toEqual({
      worker: 1,
      type: 'queueRequest',
    });
  });

  it('reads console output', () => {
    expect(parseWorkerEvent([2, 'consoleMessage', 'hello'])).toEqual({
      worker: 2,
      type: 'console',
      message: 'hello',
    });
  });

  it('reads start, progress and probe updates', () => {
    expect(parseWorkerEvent([1, 'processing', 4, 'Running'])).toEqual({
      worker: 1,
      type: 'started',
      queueNumber: 4,
    });
    expect(parseWorkerEvent([1, 'percentage', 4, '42.5%'])).toEqual({
      worker: 1,
      type: 'progress',
      queueNumber: 4,
      percent: '42.5%',
    });
    expect(parseWorkerEvent([1, 'FFPROBE', 4, 'OK', '/src/a.mkv'])).toEqual({
      worker: 1,
      type: 'probe',
      queueNumber: 4,
      ok: true,
      sourcePath: '/src/a.mkv',
    });
  });

  it('maps terminal results to item states', () => {
    expect(parseWorkerEvent([1, 'OK', 4, '-Z "x"', ''])).toEqual({
      worker: 1,
      type: 'result',
      queueNumber: 4,
      state: 'OK',
      preset: '-Z "x"',
      detail: '',
    });
    expect(parseWorkerEvent([1, 'success', 4, '-Z "x"', ''])).toMatchObject({
      state: 'OK',
    });
    expect(parseWorkerEvent([1, 'Fail', 5, '-Z "x"', 'boom'])).toMatchObject({
      state: 'Fail',
      detail: 'boom',
    });
    expect(
      parseWorkerEvent([1, 'Skipped: Not selected', 6, 'Skip', '']),
    ).toMatchObject({ state: 'Skip', preset: '' });
    expect(parseWorkerEvent([1, 'copied', 7, 'Copy', ''])).toMatchObject({
      state: 'Copy',
    });
    expect(parseWorkerEvent([1, 'cancelled', 6, '-Z "x"', ''])).toMatchObject({
      state: 'cancelled',
    });
    expect(
      parseWorkerEvent([1, 'Unable to repair file', 7, '-Z "x"', '']),
    ).toMatchObject({ state: 'error' });
  });

  it('reads log append requests and exit requests', () => {
    expect(
      parseWorkerEvent([1, 'appendRequest', '/logs/ErrorLog.txt', 'line\n']),
    ).toEqual({
      worker: 1,
      type: 'logAppend',
      filePath: '/logs/ErrorLog.txt',
      text: 'line\n',
    });
    expect(parseWorkerEvent([1, 'exitRequest'])).toEqual({
      worker: 1,
      type: 'exitRequest',
    });
  });

  it('ignores unknown shapes', () => {
    expect(parseWorkerEvent(['something'])).toBeNull();
    expect(parseWorkerEvent([1, 'notARealTag'])).toBeNull();
    expect(parseWorkerEvent({ type: 'ready' })).toBeNull();
  });
});
