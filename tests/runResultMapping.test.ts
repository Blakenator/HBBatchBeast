import { describe, expect, it } from 'vitest';
import { GlobalAppConfig } from '../src/common';
import { mapQueueBuildResult } from '../src/backend/handlers';
import { QueueBuildResult } from '../src/backend/processes/protocol';

function config(copyFilteredFiles: boolean): GlobalAppConfig {
  return {
    lang: 'en',
    selected_config: 0,
    version_message: 'test',
    configs: [
      {
        name: 'Default',
        tab_batch: {
          advanced: {
            copy_filtered_files_toggle: copyFilteredFiles ? 1 : 0,
          },
        },
      },
    ],
  };
}

function payload(overrides: Partial<QueueBuildResult> = {}): QueueBuildResult {
  return {
    total: 3,
    sources: ['/src/a.mp4', '/src/sample.mp4', '/src/subs.srt'],
    presets: ['-Z "x"', '-Z "x"', '-Z "x"'],
    skipOrCopy: [0, 1, 1],
    destinations: ['/dst/a.mp4', '/dst/sample.mp4', '/dst/subs.srt'],
    destinationsFinal: ['/final/a.mp4', '/final/sample.mp4', '/final/subs.srt'],
    notExists: 3,
    ...overrides,
  };
}

describe('mapQueueBuildResult', () => {
  it('carries final destinations and derive actions from scanner flags', () => {
    const withoutCopy = mapQueueBuildResult(payload(), config(false).configs[0]);
    expect(withoutCopy.fileList[0]).toMatchObject({
      action: 'encode',
      destinationFinalPath: '/final/a.mp4',
    });
    expect(withoutCopy.fileList[1]).toMatchObject({ action: 'skip' });
    expect(withoutCopy.fileList[2]).toMatchObject({ action: 'copy' });

    const withCopy = mapQueueBuildResult(payload(), config(true).configs[0]);
    expect(withCopy.fileList[1]).toMatchObject({ action: 'copy' });
    expect(withCopy.fileList[2]).toMatchObject({ action: 'copy' });
  });
});
