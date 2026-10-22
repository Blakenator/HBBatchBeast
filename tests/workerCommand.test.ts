import { describe, expect, it } from 'vitest';
import {
  buildEncoderInvocation,
  splitArguments,
} from '../src/backend/workers/command';
import { WorkerItemConfig } from '../src/backend/workers/protocol';

function item(overrides: Partial<WorkerItemConfig> = {}): WorkerItemConfig {
  return {
    queueNumber: 0,
    sourcePath: '/src/a.mkv',
    outputPath: '/out/a.mp4',
    finalPath: '/out/a.mp4',
    action: 'encode',
    copyFilteredFiles: false,
    encoder: {
      kind: 'handbrake',
      executable: 'HandBrakeCLI',
      preset: '-Z "Very Fast 1080p30"',
      presetImportFiles: [],
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

describe('splitArguments', () => {
  it('splits plain arguments and collapses whitespace', () => {
    expect(splitArguments('  -c:v   libx264  -crf 20 ')).toEqual([
      '-c:v',
      'libx264',
      '-crf',
      '20',
    ]);
  });

  it('keeps quoted names together', () => {
    expect(splitArguments('-Z "Very Fast 1080p30"')).toEqual([
      '-Z',
      'Very Fast 1080p30',
    ]);
    expect(splitArguments("-Z 'H.265 MKV 1080p30'")).toEqual([
      '-Z',
      'H.265 MKV 1080p30',
    ]);
  });

  it('handles apostrophes inside double quotes and escaped quotes', () => {
    expect(splitArguments('--title "Bob\'s film"')).toEqual([
      '--title',
      "Bob's film",
    ]);
    expect(splitArguments('--title "say \\"hi\\""')).toEqual([
      '--title',
      'say "hi"',
    ]);
  });

  it('supports empty quoted arguments and backslash escapes', () => {
    expect(splitArguments('--empty "" --path a\\ b')).toEqual([
      '--empty',
      '',
      '--path',
      'a b',
    ]);
  });

  it('rejects unterminated quotes', () => {
    expect(() => splitArguments('-Z "unterminated')).toThrow(/Unterminated/);
    expect(() => splitArguments("-Z 'unterminated")).toThrow(/Unterminated/);
  });
});

describe('buildEncoderInvocation', () => {
  it('imports GUI presets before the HandBrake input', () => {
    const invocation = buildEncoderInvocation(
      item({
        encoder: {
          kind: 'handbrake',
          executable: '/opt/HandBrakeCLI',
          preset: '-Z "H.265 MKV 1080p30"',
          presetImportFiles: ['/home/user/presets.json'],
        },
      }),
    );

    expect(invocation).toEqual({
      executable: '/opt/HandBrakeCLI',
      args: [
        '--preset-import-file',
        '/home/user/presets.json',
        '-i',
        '/src/a.mkv',
        '-o',
        '/out/a.mp4',
        '-Z',
        'H.265 MKV 1080p30',
      ],
    });
  });

  it('places FFmpeg input options before -i and output options after the source', () => {
    const invocation = buildEncoderInvocation(
      item({
        encoder: {
          kind: 'ffmpeg',
          executable: 'ffmpeg',
          preset: '-ss 10,-c:v libx264 -crf 20',
          presetImportFiles: [],
        },
      }),
    );

    expect(invocation.args).toEqual([
      '-ss',
      '10',
      '-i',
      '/src/a.mkv',
      '-c:v',
      'libx264',
      '-crf',
      '20',
      '/out/a.mp4',
    ]);
  });

  it('tolerates a missing FFmpeg output half', () => {
    const invocation = buildEncoderInvocation(
      item({
        encoder: {
          kind: 'ffmpeg',
          executable: 'ffmpeg',
          preset: '-an',
          presetImportFiles: [],
        },
      }),
    );
    expect(invocation.args).toEqual(['-an', '-i', '/src/a.mkv', '/out/a.mp4']);
  });
});
