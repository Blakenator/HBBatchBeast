import { describe, expect, it, vi } from 'vitest';
import {
  createFilterGroup,
  createFilterRule,
  FilterExpression,
} from '../src/common/filterExpression';
import {
  evaluateFilterExpression,
  filterTraceReason,
} from '../src/backend/scanner/filterEvaluation';

const context = {
  fileName: 'movie.sample.mkv',
  extension: 'mkv',
  sizeBytes: 500_000_000,
  outputState: 'empty' as const,
};

function expression(children: ReturnType<typeof createFilterRule>[]): FilterExpression {
  return { version: 1, root: createFilterGroup('and', children) };
}

describe('filter evaluation', () => {
  it('passes a file through AND rules and records every stage', async () => {
    const trace = await evaluateFilterExpression(
      expression([
        createFilterRule('fileType', 'isAnyOf', ['mkv']),
        createFilterRule('fileSize', 'atLeast', 100),
        createFilterRule('outputState', 'isNot', 'converted'),
      ]),
      context,
    );

    expect(trace.outcome).toBe('included');
    expect(trace.entries.map((entry) => entry.status)).toEqual([
      'pass',
      'pass',
      'pass',
    ]);
    expect(trace.entries[1].observed).toBe('500 MB');
  });

  it('stops an AND group at the first failure and marks later stages skipped', async () => {
    const trace = await evaluateFilterExpression(
      expression([
        createFilterRule('fileName', 'containsNone', ['sample']),
        createFilterRule('fileType', 'isAnyOf', ['mp4']),
      ]),
      context,
    );

    expect(trace.outcome).toBe('excluded');
    expect(trace.entries.map((entry) => entry.status)).toEqual([
      'fail',
      'skipped',
    ]);
    expect(trace.excludedBy).toBe(trace.entries[0].ruleId);
    expect(filterTraceReason(trace)).toContain('sample');
  });

  it('supports OR groups, negation and short-circuiting', async () => {
    const any = createFilterGroup('or', [
      createFilterRule('fileSize', 'atLeast', 1_000),
      createFilterRule('fileType', 'isAnyOf', ['mkv']),
    ]);
    const trace = await evaluateFilterExpression(
      { version: 1, root: createFilterGroup('and', [any]) },
      context,
    );
    expect(trace.outcome).toBe('included');
    expect(trace.entries[0].status).toBe('fail');
    expect(trace.entries[1].status).toBe('pass');

    const negated = createFilterGroup('or', [
      createFilterRule('fileName', 'containsAny', ['sample']),
    ]);
    negated.negate = true;
    const negatedTrace = await evaluateFilterExpression(
      { version: 1, root: createFilterGroup('and', [negated]) },
      context,
    );
    expect(negatedTrace.outcome).toBe('excluded');
    expect(negatedTrace.excludedBy).toBe(negated.id);
    expect(filterTraceReason(negatedTrace)).toMatch(/negated/i);
  });

  it('evaluates media properties lazily and fails open on probe errors', async () => {
    const probe = vi.fn(async () => ({
      streams: [{ codec_name: 'h264', width: 1920 }],
    }));
    const trace = await evaluateFilterExpression(
      expression([
        createFilterRule('mediaProperty', 'equals', {
          key: 'codec_name',
          value: 'hevc',
        }),
      ]),
      context,
      { probe },
    );
    expect(probe).toHaveBeenCalledTimes(1);
    expect(trace.outcome).toBe('excluded');
    expect(trace.entries[0].observed).toContain('h264');

    const failedProbe = vi.fn(async () => undefined);
    const errorTrace = await evaluateFilterExpression(
      expression([
        createFilterRule('mediaProperty', 'equals', {
          key: 'codec_name',
          value: 'hevc',
        }),
      ]),
      context,
      { probe: failedProbe },
    );
    expect(errorTrace.outcome).toBe('included');
    expect(errorTrace.entries[0].status).toBe('error');
  });

  it('does not probe when an earlier AND rule already excluded the file', async () => {
    const probe = vi.fn(async () => ({ streams: [{ codec_name: 'h264' }] }));
    const trace = await evaluateFilterExpression(
      expression([
        createFilterRule('fileType', 'isAnyOf', ['mp4']),
        createFilterRule('mediaProperty', 'equals', {
          key: 'codec_name',
          value: 'h264',
        }),
      ]),
      context,
      { probe },
    );
    expect(probe).not.toHaveBeenCalled();
    expect(trace.entries[1].status).toBe('skipped');
  });

  it('compares size ranges in decimal megabytes', async () => {
    const trace = await evaluateFilterExpression(
      expression([createFilterRule('fileSize', 'between', [100, 900])]),
      context,
    );
    expect(trace.outcome).toBe('included');
  });
});
