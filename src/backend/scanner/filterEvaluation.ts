import {
  Combinator,
  FilterExpression,
  FilterGroup,
  FilterNode,
  FilterRule,
  FilterTrace,
  FilterTraceEntry,
  flattenFilterRules,
  isFilterGroup,
} from '../../common/filterExpression';
import type { RawProbe } from '../helpers/ffprobe';

export type OutputState = 'empty' | 'converted' | 'untrusted' | 'replaced';

export interface FilterEvaluationContext {
  fileName: string;
  /** Lower-case, without the leading dot. */
  extension: string;
  sizeBytes?: number;
  outputState: OutputState;
}

export interface FilterEvaluationOptions {
  /** Lazy probe so property rules only pay the ffprobe cost when reached. */
  probe?: () => Promise<RawProbe | undefined>;
}

interface EvaluationState {
  entries: FilterTraceEntry[];
  groupOutcomes: Record<string, 'pass' | 'fail'>;
  groupCombinators: Record<string, Combinator>;
  groupNegates: Record<string, boolean>;
}

function normalizeExtension(value: string): string {
  return value.trim().replace(/^\.+/, '').toLowerCase();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function sizeMb(sizeBytes: number | undefined): number | undefined {
  return sizeBytes === undefined ? undefined : sizeBytes / 1_000_000;
}

function formatMb(value: number): string {
  return `${Number(value.toFixed(2))} MB`;
}

function conditionText(rule: FilterRule): string {
  const negate = rule.negate ? 'not ' : '';
  switch (rule.field) {
    case 'fileType':
      return `${negate}file type ${rule.operator === 'isAnyOf' ? 'is any of' : 'is none of'} ${stringList(rule.value).join(', ')}`;
    case 'fileName':
      return `${negate}filename ${rule.operator === 'containsAny' ? 'contains any of' : 'contains none of'} ${stringList(rule.value).join(', ')}`;
    case 'fileSize': {
      if (rule.operator === 'between' && Array.isArray(rule.value)) {
        return `${negate}size is between ${rule.value[0]} MB and ${rule.value[1]} MB`;
      }
      return `${negate}size is ${rule.operator === 'atLeast' ? 'at least' : 'at most'} ${String(rule.value)} MB`;
    }
    case 'outputState':
      return `${negate}output is ${rule.operator === 'is' ? '' : 'not '}${String(rule.value)}`;
    case 'mediaProperty': {
      const value = rule.value as { key?: string; value?: string } | null;
      const operator =
        rule.operator === 'equals'
          ? '='
          : rule.operator === 'notEquals'
            ? '≠'
            : rule.operator === 'contains'
              ? 'contains'
              : rule.operator === 'gt'
                ? '>'
                : '<';
      return `${negate}${value?.key ?? 'property'} ${operator} ${value?.value ?? ''}`;
    }
    default:
      return 'filter condition';
  }
}

function traceEntry(
  rule: FilterRule,
  path: string[],
  status: FilterTraceEntry['status'],
  observed: string | undefined,
  detail: string,
): FilterTraceEntry {
  return {
    ruleId: rule.id,
    groupPath: path,
    field: rule.field,
    operator: rule.operator,
    value: rule.value,
    negate: Boolean(rule.negate),
    status,
    ...(observed ? { observed } : {}),
    detail,
  };
}

interface RuleResult {
  passed: boolean;
  entry: FilterTraceEntry;
}

function evaluateFileType(
  rule: FilterRule,
  context: FilterEvaluationContext,
): { passed: boolean; observed: string } {
  const values = stringList(rule.value).map(normalizeExtension);
  const matched = values.includes(normalizeExtension(context.extension));
  const passed = rule.operator === 'isAnyOf' ? matched : !matched;
  return { passed, observed: context.extension || '(no extension)' };
}

function evaluateFileName(
  rule: FilterRule,
  context: FilterEvaluationContext,
): { passed: boolean; observed: string } {
  const words = stringList(rule.value).map((word) => word.toLowerCase());
  const name = context.fileName.toLowerCase();
  const matched = words.some((word) => name.includes(word));
  const passed = rule.operator === 'containsAny' ? matched : !matched;
  return { passed, observed: context.fileName };
}

function evaluateFileSize(
  rule: FilterRule,
  context: FilterEvaluationContext,
): { passed: boolean; observed: string; error?: string } {
  const mb = sizeMb(context.sizeBytes);
  if (mb === undefined) {
    return { passed: true, observed: 'size unavailable', error: 'File size could not be read' };
  }
  const observed = formatMb(mb);
  if (rule.operator === 'atLeast' && typeof rule.value === 'number') {
    return { passed: mb >= rule.value, observed };
  }
  if (rule.operator === 'atMost' && typeof rule.value === 'number') {
    return { passed: mb <= rule.value, observed };
  }
  if (
    rule.operator === 'between' &&
    Array.isArray(rule.value) &&
    rule.value.length === 2
  ) {
    return {
      passed: mb >= Number(rule.value[0]) && mb <= Number(rule.value[1]),
      observed,
    };
  }
  return { passed: true, observed, error: 'Invalid size rule' };
}

function evaluateOutputState(
  rule: FilterRule,
  context: FilterEvaluationContext,
): { passed: boolean; observed: string } {
  const isConverted =
    context.outputState === 'converted' || context.outputState === 'replaced';
  const passed = rule.operator === 'is' ? isConverted : !isConverted;
  return { passed, observed: context.outputState };
}

function propertyValues(probe: RawProbe, key: string): string[] {
  return (probe.streams ?? [])
    .map((stream) => stream[key])
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => String(value));
}

function evaluateMediaProperty(
  rule: FilterRule,
  probe: RawProbe,
): { passed: boolean; observed: string } {
  const value = rule.value as { key?: string; value?: string } | null;
  const key = value?.key?.trim() ?? '';
  const expected = value?.value ?? '';
  if (!key) {
    return { passed: true, observed: 'no property name' };
  }
  const values = propertyValues(probe, key);
  const observed =
    values.length > 0
      ? `${key}: ${values.slice(0, 3).join(', ')}`
      : `no ${key}`;
  if (values.length === 0) {
    return {
      passed: rule.operator === 'notEquals',
      observed,
    };
  }

  switch (rule.operator) {
    case 'equals':
      return { passed: values.some((item) => item === expected), observed };
    case 'notEquals':
      return { passed: values.every((item) => item !== expected), observed };
    case 'contains':
      return {
        passed: values.some((item) =>
          item.toLowerCase().includes(expected.toLowerCase()),
        ),
        observed,
      };
    case 'gt':
      return {
        passed: values.some((item) => Number(item) > Number(expected)),
        observed,
      };
    case 'lt':
      return {
        passed: values.some((item) => Number(item) < Number(expected)),
        observed,
      };
    default:
      return { passed: true, observed };
  }
}

async function evaluateRule(
  rule: FilterRule,
  path: string[],
  context: FilterEvaluationContext,
  getProbe: () => Promise<RawProbe | undefined>,
): Promise<RuleResult> {
  let base: { passed: boolean; observed: string; error?: string };
  switch (rule.field) {
    case 'fileType':
      base = evaluateFileType(rule, context);
      break;
    case 'fileName':
      base = evaluateFileName(rule, context);
      break;
    case 'fileSize':
      base = evaluateFileSize(rule, context);
      break;
    case 'outputState':
      base = evaluateOutputState(rule, context);
      break;
    case 'mediaProperty': {
      const probe = await getProbe();
      if (!probe) {
        base = {
          passed: true,
          observed: 'probe unavailable',
          error: 'ffprobe could not read this file',
        };
      } else {
        base = evaluateMediaProperty(rule, probe);
      }
      break;
    }
    default:
      base = { passed: true, observed: 'unknown field' };
  }

  const passed = rule.negate ? !base.passed : base.passed;
  const detail = `${conditionText(rule)}${
    base.observed ? ` (observed ${base.observed})` : ''
  }`;
  const status: FilterTraceEntry['status'] = base.error
    ? 'error'
    : passed
      ? 'pass'
      : 'fail';

  return {
    passed: base.error ? true : passed,
    entry: traceEntry(rule, path, status, base.observed, base.error ?? detail),
  };
}

function markSkipped(
  node: FilterNode,
  path: string[],
  state: EvaluationState,
): void {
  if (isFilterGroup(node)) {
    state.groupCombinators[node.id] = node.combinator;
    state.groupNegates[node.id] = Boolean(node.negate);
    node.children.forEach((child) => markSkipped(child, [...path, node.id], state));
    return;
  }
  state.entries.push(
    traceEntry(node, path, 'skipped', undefined, 'Not evaluated'),
  );
}

async function evaluateGroup(
  group: FilterGroup,
  path: string[],
  context: FilterEvaluationContext,
  state: EvaluationState,
  getProbe: () => Promise<RawProbe | undefined>,
): Promise<boolean> {
  state.groupCombinators[group.id] = group.combinator;
  state.groupNegates[group.id] = Boolean(group.negate);

  const isAnd = group.combinator === 'and';
  let passed = isAnd;
  let decided = false;

  for (const child of group.children) {
    if (decided) {
      markSkipped(child, path, state);
      continue;
    }

    let childPassed: boolean;
    if (isFilterGroup(child)) {
      childPassed = await evaluateGroup(child, [...path, child.id], context, state, getProbe);
    } else {
      const result = await evaluateRule(child, path, context, getProbe);
      state.entries.push(result.entry);
      childPassed = result.passed;
    }

    if (isAnd && !childPassed) {
      passed = false;
      decided = true;
    } else if (!isAnd && childPassed) {
      passed = true;
      decided = true;
    }
  }

  if (group.children.length === 0) passed = true;
  if (group.negate) passed = !passed;
  state.groupOutcomes[group.id] = passed ? 'pass' : 'fail';
  return passed;
}

function findFailureId(
  node: FilterNode,
  state: EvaluationState,
): string | undefined {
  if (isFilterGroup(node)) {
    if (state.groupOutcomes[node.id] !== 'fail') return undefined;
    if (node.negate) return node.id;
    for (const child of node.children) {
      const found = findFailureId(child, state);
      if (found) return found;
    }
    return node.id;
  }
  const entry = state.entries.find((item) => item.ruleId === node.id);
  return entry?.status === 'fail' ? node.id : undefined;
}

export async function evaluateFilterExpression(
  expression: FilterExpression,
  context: FilterEvaluationContext,
  options: FilterEvaluationOptions = {},
): Promise<FilterTrace> {
  const state: EvaluationState = {
    entries: [],
    groupOutcomes: {},
    groupCombinators: {},
    groupNegates: {},
  };

  let probePromise: Promise<RawProbe | undefined> | undefined;
  const getProbe = (): Promise<RawProbe | undefined> => {
    if (!options.probe) return Promise.resolve(undefined);
    if (!probePromise) {
      probePromise = options.probe().catch((): undefined => undefined);
    }
    return probePromise;
  };

  const included = await evaluateGroup(
    expression.root,
    [expression.root.id],
    context,
    state,
    getProbe,
  );
  const excludedBy = included ? undefined : findFailureId(expression.root, state);

  return {
    entries: state.entries,
    groupOutcomes: state.groupOutcomes,
    groupCombinators: state.groupCombinators,
    groupNegates: state.groupNegates,
    outcome: included ? 'included' : 'excluded',
    ...(excludedBy ? { excludedBy } : {}),
  };
}

/** Best effort English reason for logs and compact row cells. */
export function filterTraceReason(trace: FilterTrace): string | undefined {
  if (trace.outcome === 'included') return undefined;
  const direct = trace.entries.find(
    (item) => item.ruleId === trace.excludedBy,
  );
  if (direct?.detail) return direct.detail;
  if (trace.excludedBy && trace.groupNegates[trace.excludedBy]) {
    return 'A negated filter group matched this file';
  }
  if (trace.excludedBy && trace.groupCombinators[trace.excludedBy]) {
    return 'A filter group excluded this file';
  }
  const failed = trace.entries.find((item) => item.status === 'fail');
  return failed?.detail ?? 'Excluded by the file filter';
}

/** Trace used for sidecars that bypass rule evaluation but are still copied. */
export function skippedFilterTrace(
  expression: FilterExpression,
  detail: string,
): FilterTrace {
  const entries: FilterTraceEntry[] = flattenFilterRules(expression).map(
    ({ rule, groupPath }) => ({
      ruleId: rule.id,
      groupPath,
      field: rule.field,
      operator: rule.operator,
      value: rule.value,
      negate: Boolean(rule.negate),
      status: 'skipped',
      detail,
    }),
  );
  return {
    entries,
    groupOutcomes: { [expression.root.id]: 'pass' },
    groupCombinators: { [expression.root.id]: expression.root.combinator },
    groupNegates: { [expression.root.id]: Boolean(expression.root.negate) },
    outcome: 'included',
  };
}

