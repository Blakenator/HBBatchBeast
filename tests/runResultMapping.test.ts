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
    excluded: [
      null,
      { code: 'filtered', reason: 'Filename contains none of 720p' },
      { code: 'subtitle', reason: 'Subtitle file (copied, not converted)' },
    ],
    destinations: ['/dst/a.mp4', '/dst/sample.mp4', '/dst/subs.srt'],
    destinationsFinal: ['/final/a.mp4', '/final/sample.mp4', '/final/subs.srt'],
    traces: [
      {
        entries: [],
        groupOutcomes: {},
        groupCombinators: {},
        groupNegates: {},
        outcome: 'included',
      },
      {
        entries: [],
        groupOutcomes: {},
        groupCombinators: {},
        groupNegates: {},
        outcome: 'excluded',
        excludedBy: 'name',
      },
      {
        entries: [],
        groupOutcomes: {},
        groupCombinators: {},
        groupNegates: {},
        outcome: 'included',
      },
    ],
    typeFiltered: 0,
    notExists: 3,
    ...overrides,
  };
}

describe('mapQueueBuildResult', () => {
  it('carries final destinations, actions and exclusion reasons', () => {
    const withoutCopy = mapQueueBuildResult(payload(), config(false).configs[0]);
    expect(withoutCopy.fileList[0]).toMatchObject({
      action: 'encode',
      destinationFinalPath: '/final/a.mp4',
    });
    expect(withoutCopy.fileList[0].excludedReason).toBeUndefined();
    expect(withoutCopy.fileList[1]).toMatchObject({
      action: 'skip',
      excludedReason: 'Filename contains none of 720p',
    });
    expect(withoutCopy.fileList[2]).toMatchObject({ action: 'copy' });

    const withCopy = mapQueueBuildResult(payload(), config(true).configs[0]);
    expect(withCopy.fileList[1]).toMatchObject({
      action: 'copy',
      extraActions: { copiedFromFilter: true },
    });
    expect(withCopy.fileList[2]).toMatchObject({ action: 'copy' });
  });

  it('never copies files that are already converted or replaced', () => {
    const result = mapQueueBuildResult(
      payload({
        excluded: [
          { code: 'alreadyConverted', reason: 'Already converted' },
          null,
          { code: 'alreadyReplaced', reason: 'Already replaced' },
        ],
      }),
      config(true).configs[0],
    );

    expect(result.fileList[0]).toMatchObject({
      action: 'skip',
      excludedReason: 'Already converted',
    });
    expect(result.fileList[2]).toMatchObject({ action: 'skip' });
  });
});
