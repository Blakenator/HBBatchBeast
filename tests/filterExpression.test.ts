import { describe, expect, it } from 'vitest';
import {
  createFilterGroup,
  createFilterRule,
  defaultFilterExpression,
  fileTypeGate,
  flattenFilterRules,
  legacyFilterExpression,
  moveFilterNode,
  removeFilterNode,
  resolveFilterExpression,
  validateFilterExpression,
} from '../src/common/filterExpression';

describe('filter expressions', () => {
  it('creates a safe default with file types and the output stage', () => {
    const expression = defaultFilterExpression();
    const fields = flattenFilterRules(expression).map(({ rule }) => rule.field);
    expect(fields).toEqual(['fileType', 'outputState']);
    expect(validateFilterExpression(expression)).toEqual([]);
  });

  it('validates operators, values and nesting depth', () => {
    const invalid = createFilterGroup('and', [
      createFilterRule('fileType', 'isAnyOf', []),
      createFilterRule('mediaProperty', 'gt', { key: 'width', value: 'wide' }),
    ]);
    const problems = validateFilterExpression({ version: 1, root: invalid });
    expect(problems.join(' ')).toContain('non-empty');
    expect(problems.join(' ')).toContain('number');
  });

  it('compiles legacy flat fields without dropping any filter', () => {
    const expression = legacyFilterExpression({
      included_file_types: 'mp4,mkv',
      title_word_filter: 'sample',
      min_file_size_filter_toggle: 1,
      min_file_size_filter: '100',
      max_file_size_filter_toggle: 1,
      max_file_size_filter: '900',
      included_property_filter: "codec_name: 'hevc',width: '1920'",
      included_property_filter_any_toggle: 1,
      excluded_property_filter: "codec_name: 'mpeg4'",
      excluded_property_filter_all_toggle: 1,
    });
    expect(validateFilterExpression(expression)).toEqual([]);
    const rows = flattenFilterRules(expression);
    expect(rows.some(({ rule }) => rule.field === 'fileType')).toBe(true);
    expect(rows.some(({ rule }) => rule.field === 'fileName')).toBe(true);
    expect(rows.filter(({ rule }) => rule.field === 'fileSize')).toHaveLength(2);
    expect(rows.filter(({ rule }) => rule.field === 'mediaProperty')).toHaveLength(3);
    expect(rows.some(({ group }) => group.negate)).toBe(true);
  });

  it('compiles legacy fields with stable ids so queue signatures do not churn', () => {
    const first = legacyFilterExpression({ included_file_types: 'mp4' });
    const second = legacyFilterExpression({ included_file_types: 'mp4' });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('prefers a stored expression over legacy fields', () => {
    const stored = defaultFilterExpression();
    expect(
      resolveFilterExpression({
        included_file_types: 'avi',
        filter_expression: stored,
      }),
    ).toBe(stored);
  });

  it('gates discovery to the union of isAnyOf file types', () => {
    expect(fileTypeGate(defaultFilterExpression())).toContain('mp4');
    const excludeOne = createFilterGroup('and', [
      createFilterRule('fileType', 'isNoneOf', ['mp4']),
    ]);
    const gate = fileTypeGate({ version: 1, root: excludeOne });
    expect(gate.has('mkv')).toBe(true);
    expect(gate.has('mp4')).toBe(false);
  });

  it('removes and moves rules without mutating the original', () => {
    const first = createFilterRule('fileSize', 'atLeast', 100);
    const second = createFilterRule('fileSize', 'atMost', 900);
    const wrapped = {
      version: 1 as const,
      root: createFilterGroup('and', [first, second]),
    };

    const moved = moveFilterNode(wrapped, second.id, -1);
    expect(flattenFilterRules(moved).map(({ rule }) => rule.value)).toEqual([
      900,
      100,
    ]);
    expect(flattenFilterRules(moved).map(({ rule }) => rule.id)).toEqual([
      second.id,
      first.id,
    ]);

    const removed = removeFilterNode(wrapped, first.id);
    expect(flattenFilterRules(removed)).toHaveLength(1);
    expect(flattenFilterRules(wrapped)).toHaveLength(2);
  });
});
