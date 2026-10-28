import { describe, expect, it } from 'vitest';
import {
  FilterExpression,
  createFilterGroup,
  createFilterRule,
  type PresetRule,
} from '../src/common';
import { FilterEvaluationContext } from '../src/backend/scanner/filterEvaluation';
import { resolvePresetForFile } from '../src/backend/scanner/presetResolution';

const catalog = [
  { id: 'mobile', name: 'Mobile', argument: '-Z "Mobile 480p"' },
  { id: 'hd', name: 'HD', argument: '-Z "Fast 1080p30"' },
  { id: 'default', name: 'Default', argument: '-Z "Very Fast 1080p30"' },
];

function condition(
  field: 'fileName' | 'fileSize' | 'folder',
  operator: 'containsAny' | 'atLeast' | 'isUnder',
  value: unknown,
): FilterExpression {
  return {
    version: 1,
    root: createFilterGroup('and', [
      createFilterRule(field, operator, value),
    ]),
  };
}

function rule(
  id: string,
  field: 'fileName' | 'fileSize' | 'folder',
  operator: 'containsAny' | 'atLeast' | 'isUnder',
  value: unknown,
  presetId: string,
  name?: string,
): PresetRule {
  return {
    id,
    name,
    condition: condition(field, operator, value),
    presetId,
  };
}

function context(
  overrides: Partial<FilterEvaluationContext> = {},
): FilterEvaluationContext {
  return {
    fileName: 'movie.mkv',
    extension: 'mkv',
    sizeBytes: 2_000_000_000,
    outputState: 'empty',
    folderId: 'folder-1',
    relativePath: 'Movies/movie.mkv',
    ...overrides,
  };
}

describe('resolvePresetForFile', () => {
  it('uses the first matching rule in order', async () => {
    const result = await resolvePresetForFile({
      rules: [
        rule('r1', 'fileName', 'containsAny', ['sample'], 'mobile'),
        rule('r2', 'fileSize', 'atLeast', 1000, 'hd', 'Large files'),
        rule('r3', 'fileSize', 'atLeast', 1, 'default'),
      ],
      catalog,
      defaultPresetId: 'default',
      defaultArgument: '-Z "Very Fast 1080p30"',
      context: context(),
      probe: async () => undefined,
    });

    expect(result.argument).toBe('-Z "Fast 1080p30"');
    expect(result.trace).toMatchObject({
      presetId: 'hd',
      ruleId: 'r2',
      ruleName: 'Large files',
    });
  });

  it('matches folder rules by library folder id and subpath', async () => {
    const result = await resolvePresetForFile({
      rules: [
        rule(
          'r1',
          'folder',
          'isUnder',
          { folderId: 'folder-1', subpath: 'Movies' },
          'hd',
          'Movies folder',
        ),
      ],
      catalog,
      defaultPresetId: 'default',
      defaultArgument: '-Z "Very Fast 1080p30"',
      context: context(),
      probe: async () => undefined,
    });

    expect(result.argument).toBe('-Z "Fast 1080p30"');
    expect(result.trace.ruleName).toBe('Movies folder');
  });

  it('does not match a folder rule for a different folder', async () => {
    const result = await resolvePresetForFile({
      rules: [
        rule(
          'r1',
          'folder',
          'isUnder',
          { folderId: 'folder-2', subpath: 'Movies' },
          'hd',
        ),
      ],
      catalog,
      defaultPresetId: 'default',
      defaultArgument: '-Z "Very Fast 1080p30"',
      context: context(),
      probe: async () => undefined,
    });

    expect(result.argument).toBe('-Z "Very Fast 1080p30"');
    expect(result.trace.ruleId).toBeUndefined();
  });

  it('falls back to the default when nothing matches or a preset is missing', async () => {
    const result = await resolvePresetForFile({
      rules: [
        rule('r1', 'fileName', 'containsAny', ['sample'], 'missing'),
      ],
      catalog,
      defaultPresetId: 'default',
      defaultArgument: '-Z "Very Fast 1080p30"',
      context: context(),
      probe: async () => undefined,
    });

    expect(result.argument).toBe('-Z "Very Fast 1080p30"');
    expect(result.trace).toMatchObject({
      presetId: 'default',
      presetName: 'Default',
    });
  });
});
