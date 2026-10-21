import { describe, expect, it } from 'vitest';
import {
  budgetExceeded,
  countProcesses,
  countEncoderCommands,
  enforceProcessBudget,
  parseMaxParallel,
  parsePsCommListing,
  parsePsListing,
  parseTasklist,
} from '../src/main/processBudget';

const psComm = `HandBrakeCLI
HandBrakeCLI
node
node
ffmpeg
ffprobe
code
bash
`;

const psArgs = `HandBrakeCLI --preset-list
HandBrakeCLI -i /media/a.mkv -o /out/a.mkv -Z Fast 1080p30
node /app/src/backend/modules/worker1.js
node /app/src/backend/modules/worker2.js
/usr/bin/ffmpeg -i /media/b.mkv -c:v libx264 /out/b.mkv
ffprobe -v error -print_format json /media/c.mkv
/usr/lib/code/code --type=renderer
node /app/node_modules/vite/bin/vite.js --config vite.config.mts ffprobe-static
`;

describe('parseMaxParallel', () => {
  it('reads the flag in both forms', () => {
    expect(parseMaxParallel(['app', '--max-parallel', '6'], {})).toBe(6);
    expect(parseMaxParallel(['app', '--max-parallel=2'], {})).toBe(2);
  });

  it('falls back to the environment and lets the flag win', () => {
    expect(parseMaxParallel(['app'], { HBB_MAX_PARALLEL: '3' })).toBe(3);
    expect(
      parseMaxParallel(['app', '--max-parallel=5'], { HBB_MAX_PARALLEL: '3' }),
    ).toBe(5);
  });

  it('returns undefined when no budget is configured', () => {
    expect(parseMaxParallel(['app', '--ozone-platform=x11'], {})).toBeUndefined();
    expect(parseMaxParallel(['app'], { HBB_MAX_PARALLEL: '  ' })).toBeUndefined();
  });

  it('rejects invalid values instead of silently disabling the guard', () => {
    expect(() => parseMaxParallel(['app', '--max-parallel', '0'], {})).toThrow(
      /at least 1/,
    );
    expect(() => parseMaxParallel(['app', '--max-parallel', 'abc'], {})).toThrow(
      /positive integer/,
    );
    expect(() => parseMaxParallel(['app', '--max-parallel', '1.5'], {})).toThrow(
      /positive integer/,
    );
    expect(() => parseMaxParallel(['app', '--max-parallel'], {})).toThrow(
      /needs a value/,
    );
    expect(() => parseMaxParallel(['app'], { HBB_MAX_PARALLEL: '-2' })).toThrow(
      /positive integer/,
    );
  });
});

describe('countProcesses', () => {
  it('counts encoders by executable name and workers by module path', () => {
    expect(
      countProcesses(parsePsCommListing(psComm), parsePsListing(psArgs)),
    ).toEqual({ encoders: 4, appWorkers: 2, total: 6 });
  });

  it('ignores command lines that merely mention an encoder', () => {
    expect(
      countProcesses(parsePsCommListing(psComm), [
        'node /app/node_modules/vite/bin/vite.js ffprobe-static',
        '/bin/bash -lc ps -A -o args=',
        '/usr/lib/code/code --type=renderer --file ffmpeg.txt',
      ]),
    ).toEqual({ encoders: 4, appWorkers: 0, total: 4 });
  });

  it('matches encoder names with a path or .exe suffix', () => {
    expect(
      countEncoderCommands([
        '/Applications/HandBrake.app/Contents/MacOS/HandBrakeCLI',
        'C:\\Tools\\HandBrakeCLI.exe',
        'FFmpeg',
        'ffprobe',
        'node',
      ]),
    ).toBe(4);
  });

  it('reads Windows tasklist output', () => {
    const listing = [
      '"HandBrakeCLI.exe","1234","Console","1","12,345 K"',
      '"ffmpeg.exe","1235","Console","1","12,345 K"',
      '"Code.exe","1236","Console","1","12,345 K"',
    ].join('\r\n');

    expect(countProcesses(parseTasklist(listing))).toEqual({
      encoders: 2,
      appWorkers: 0,
      total: 2,
    });
  });
});

describe('budgetExceeded', () => {
  it('compares the total against the limit', () => {
    expect(budgetExceeded({ encoders: 1, appWorkers: 1, total: 2 }, 1)).toBe(true);
    expect(budgetExceeded({ encoders: 1, appWorkers: 0, total: 1 }, 1)).toBe(false);
    expect(budgetExceeded({ encoders: 0, appWorkers: 0, total: 0 }, 1)).toBe(false);
  });
});

describe('enforceProcessBudget', () => {
  const list = () =>
    countProcesses(parsePsCommListing(psComm), parsePsListing(psArgs));

  it('returns the counts when the budget holds', () => {
    expect(enforceProcessBudget(6, list)).toEqual({
      encoders: 4,
      appWorkers: 2,
      total: 6,
    });
  });

  it('fails with the counts and the limit when it is exceeded', () => {
    expect(() => enforceProcessBudget(2, list)).toThrow(
      /6 encoder\/worker process\(es\) running .*exceeds --max-parallel 2/,
    );
  });

  it('does not block startup when the process table cannot be read', () => {
    expect(enforceProcessBudget(1, () => null)).toEqual({
      encoders: 0,
      appWorkers: 0,
      total: 0,
    });
  });
});
