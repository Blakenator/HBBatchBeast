/**
 * Boolean filter expression used by the file scanner.
 *
 * The expression is a small AND/OR tree. Rules are intentionally generic here:
 * the UI supplies field definitions and the scanner supplies an evaluation
 * context. Keeping the shape independent of HandBrake/ffprobe lets the builder
 * be reused and keeps persistence stable.
 */

import { DEFAULT_INCLUDED_FILE_TYPES } from './defaults';
import { parsePropertyFilters, parseTokenList } from './configValues';

export const FILTER_FIELDS = [
  'fileType',
  'fileName',
  'fileSize',
  'outputState',
  'mediaProperty',
] as const;

export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_OPERATORS = [
  'isAnyOf',
  'isNoneOf',
  'containsAny',
  'containsNone',
  'atLeast',
  'atMost',
  'between',
  'is',
  'isNot',
  'equals',
  'notEquals',
  'contains',
  'gt',
  'lt',
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const FILTER_FIELD_OPERATORS: Record<FilterField, FilterOperator[]> = {
  fileType: ['isAnyOf', 'isNoneOf'],
  fileName: ['containsAny', 'containsNone'],
  fileSize: ['atLeast', 'atMost', 'between'],
  outputState: ['is', 'isNot'],
  mediaProperty: ['equals', 'notEquals', 'contains', 'gt', 'lt'],
};

export type Combinator = 'and' | 'or';

export interface FilterRule {
  id: string;
  kind: 'rule';
  field: FilterField;
  operator: FilterOperator;
  /** Shape depends on the field/operator; see the UI field definitions. */
  value: unknown;
  /** Inverts the leaf result ("does not match"). */
  negate?: boolean;
}

export interface FilterGroup {
  id: string;
  kind: 'group';
  combinator: Combinator;
  /** Inverts the whole group; used for legacy exclude-property filters. */
  negate?: boolean;
  children: FilterNode[];
}

export type FilterNode = FilterRule | FilterGroup;

export interface FilterExpression {
  version: 1;
  root: FilterGroup;
}

export type FilterStageStatus = 'pass' | 'fail' | 'skipped' | 'error';

export interface FilterTraceEntry {
  ruleId: string;
  /** Ancestor group ids, root first. */
  groupPath: string[];
  field: FilterField;
  operator: FilterOperator;
  value: unknown;
  negate: boolean;
  status: FilterStageStatus;
  /** What the scanner saw, e.g. `612 MB` or `codec_name: h264`. */
  observed?: string;
  /** English fallback used in logs and compact row reasons. */
  detail?: string;
}

export interface FilterTrace {
  entries: FilterTraceEntry[];
  groupOutcomes: Record<string, 'pass' | 'fail'>;
  groupCombinators: Record<string, Combinator>;
  groupNegates: Record<string, boolean>;
  outcome: 'included' | 'excluded';
  excludedBy?: string;
}

let generatedIds = 0;

export function createFilterId(prefix = 'node'): string {
  generatedIds += 1;
  return `${prefix}-${generatedIds.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

export function createFilterGroup(
  combinator: Combinator = 'and',
  children: FilterNode[] = [],
): FilterGroup {
  return { id: createFilterId('group'), kind: 'group', combinator, children };
}

export function createFilterRule(
  field: FilterField,
  operator: FilterOperator,
  value: unknown,
): FilterRule {
  return { id: createFilterId('rule'), kind: 'rule', field, operator, value };
}

export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return node.kind === 'group';
}

export function isFilterRule(node: FilterNode): node is FilterRule {
  return node.kind === 'rule';
}

export function defaultFilterExpression(): FilterExpression {
  return {
    version: 1,
    root: createFilterGroup('and', [
      createFilterRule(
        'fileType',
        'isAnyOf',
        DEFAULT_INCLUDED_FILE_TYPES.split(','),
      ),
      createFilterRule('outputState', 'isNot', 'converted'),
    ]),
  };
}

export function createEmptyFilterExpression(): FilterExpression {
  return { version: 1, root: createFilterGroup('and') };
}

export function cloneFilterExpression(
  expression: FilterExpression,
): FilterExpression {
  return {
    version: 1,
    root: cloneNodeWithNewIds(expression.root) as FilterGroup,
  };
}

function cloneNodeWithNewIds(node: FilterNode): FilterNode {
  if (isFilterGroup(node)) {
    return {
      ...node,
      id: createFilterId('group'),
      children: node.children.map((child) => cloneNodeWithNewIds(child)),
    };
  }
  return { ...node, id: createFilterId('rule') };
}

export function countFilterRules(expression: FilterExpression): number {
  let count = 0;
  const walk = (node: FilterNode) => {
    if (isFilterRule(node)) {
      count += 1;
      return;
    }
    node.children.forEach(walk);
  };
  walk(expression.root);
  return count;
}

export function isFilterExpressionEmpty(
  expression: FilterExpression,
): boolean {
  return countFilterRules(expression) === 0;
}

export interface FlatFilterRule {
  rule: FilterRule;
  /** Ancestor group ids, root first. */
  groupPath: string[];
  group: FilterGroup;
}

export function flattenFilterRules(
  expression: FilterExpression,
): FlatFilterRule[] {
  const rows: FlatFilterRule[] = [];
  const walk = (node: FilterNode, path: string[], parent: FilterGroup) => {
    if (isFilterRule(node)) {
      rows.push({ rule: node, groupPath: path, group: parent });
      return;
    }
    const nextPath = [...path, node.id];
    node.children.forEach((child) => walk(child, nextPath, node));
  };
  expression.root.children.forEach((child) =>
    walk(child, [expression.root.id], expression.root),
  );
  return rows;
}

export function expressionHasField(
  expression: FilterExpression,
  field: FilterField,
): boolean {
  return flattenFilterRules(expression).some(({ rule }) => rule.field === field);
}

function expressionHasNegation(node: FilterNode): boolean {
  if (isFilterGroup(node)) {
    if (node.negate) return true;
    return node.children.some(expressionHasNegation);
  }
  return Boolean(node.negate);
}

/**
 * Extensions the discovery walk can possibly queue. This is an optimization,
 * not the rule evaluation itself: it keeps non-media files from being probed
 * or listed. A negated or unusual expression falls back to the default media
 * extensions so a bare search never converts arbitrary files.
 */
export function fileTypeGate(expression: FilterExpression): Set<string> {
  const defaults = new Set(
    DEFAULT_INCLUDED_FILE_TYPES.split(',').map((value) =>
      value.trim().toLowerCase(),
    ),
  );
  if (expressionHasNegation(expression.root)) return defaults;

  const rules = flattenFilterRules(expression).filter(
    ({ rule }) => rule.field === 'fileType',
  );
  const anyOf = new Set<string>();
  const noneOf = new Set<string>();
  for (const { rule } of rules) {
    if (!Array.isArray(rule.value)) continue;
    for (const raw of rule.value) {
      if (typeof raw !== 'string') continue;
      const normalized = raw.trim().replace(/^\.+/, '').toLowerCase();
      if (!normalized) continue;
      (rule.operator === 'isAnyOf' ? anyOf : noneOf).add(normalized);
    }
  }
  if (anyOf.size > 0) return anyOf;
  for (const value of noneOf) defaults.delete(value);
  return defaults;
}

export function findFilterNode(
  expression: FilterExpression,
  id: string,
): FilterNode | undefined {
  const walk = (node: FilterNode): FilterNode | undefined => {
    if (node.id === id) return node;
    if (!isFilterGroup(node)) return undefined;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return undefined;
  };
  return walk(expression.root);
}

export function updateFilterNode(
  expression: FilterExpression,
  id: string,
  update: (node: FilterNode) => FilterNode,
): FilterExpression {
  const walk = (node: FilterNode): FilterNode => {
    if (node.id === id) return update(node);
    if (!isFilterGroup(node)) return node;
    return { ...node, children: node.children.map(walk) };
  };
  return { ...expression, root: walk(expression.root) as FilterGroup };
}

export function addFilterChild(
  expression: FilterExpression,
  groupId: string,
  child: FilterNode,
  index?: number,
): FilterExpression {
  return updateFilterNode(expression, groupId, (node) => {
    if (!isFilterGroup(node)) return node;
    const children = [...node.children];
    const at = index === undefined ? children.length : index;
    children.splice(Math.max(0, Math.min(at, children.length)), 0, child);
    return { ...node, children };
  });
}

export function removeFilterNode(
  expression: FilterExpression,
  id: string,
): FilterExpression {
  const walk = (node: FilterNode): FilterNode => {
    if (!isFilterGroup(node)) return node;
    return {
      ...node,
      children: node.children.filter((child) => child.id !== id).map(walk),
    };
  };
  return { ...expression, root: walk(expression.root) as FilterGroup };
}

export function duplicateFilterNode(
  expression: FilterExpression,
  id: string,
): FilterExpression {
  const walk = (node: FilterNode): FilterNode => {
    if (!isFilterGroup(node)) return node;
    const index = node.children.findIndex((child) => child.id === id);
    if (index !== -1) {
      const children = [...node.children];
      children.splice(index + 1, 0, cloneNodeWithNewIds(children[index]));
      return { ...node, children };
    }
    return { ...node, children: node.children.map(walk) };
  };
  return { ...expression, root: walk(expression.root) as FilterGroup };
}

export function moveFilterNode(
  expression: FilterExpression,
  id: string,
  direction: -1 | 1,
): FilterExpression {
  const walk = (node: FilterNode): FilterNode => {
    if (!isFilterGroup(node)) return node;
    const index = node.children.findIndex((child) => child.id === id);
    if (index !== -1) {
      const target = index + direction;
      if (target < 0 || target >= node.children.length) return node;
      const children = [...node.children];
      [children[index], children[target]] = [children[target], children[index]];
      return { ...node, children };
    }
    return { ...node, children: node.children.map(walk) };
  };
  return { ...expression, root: walk(expression.root) as FilterGroup };
}

function isNonEmptyStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateRule(rule: FilterRule): string[] {
  const issues: string[] = [];
  if (!FILTER_FIELDS.includes(rule.field)) {
    return [`Unknown filter field "${String(rule.field)}".`];
  }
  const allowed = FILTER_FIELD_OPERATORS[rule.field];
  if (!allowed.includes(rule.operator)) {
    return [
      `Operator "${String(rule.operator)}" is not valid for ${rule.field}.`,
    ];
  }

  if (rule.field === 'fileType' || rule.field === 'fileName') {
    if (!isNonEmptyStringList(rule.value)) {
      issues.push(`${rule.field} needs at least one non-empty value.`);
    }
    return issues;
  }

  if (rule.field === 'fileSize') {
    if (rule.operator === 'between') {
      if (
        !Array.isArray(rule.value) ||
        rule.value.length !== 2 ||
        !isNonNegativeNumber(rule.value[0]) ||
        !isNonNegativeNumber(rule.value[1])
      ) {
        issues.push('Size range needs two non-negative MB values.');
      } else if (rule.value[0] > rule.value[1]) {
        issues.push('Size range minimum cannot be greater than its maximum.');
      }
      return issues;
    }
    if (!isNonNegativeNumber(rule.value)) {
      issues.push('Size value must be a non-negative number of MB.');
    }
    return issues;
  }

  if (rule.field === 'outputState') {
    if (rule.value !== 'converted') {
      issues.push('Output state must be "converted".');
    }
    return issues;
  }

  if (rule.field === 'mediaProperty') {
    const value = rule.value as { key?: unknown; value?: unknown } | null;
    if (!value || typeof value !== 'object') {
      issues.push('Media property needs a name and a value.');
      return issues;
    }
    if (typeof value.key !== 'string' || value.key.trim().length === 0) {
      issues.push('Media property name is required.');
    }
    if (typeof value.value !== 'string' || value.value.trim().length === 0) {
      issues.push('Media property value is required.');
    }
    if (
      (rule.operator === 'gt' || rule.operator === 'lt') &&
      value.value !== undefined &&
      value.value !== '' &&
      !Number.isFinite(Number(value.value))
    ) {
      issues.push('Numeric media property comparisons need a number.');
    }
  }
  return issues;
}

export const MAX_FILTER_DEPTH = 3;
export const MAX_FILTER_RULES = 50;

/** Human-readable blocking problems; empty means the expression is usable. */
export function validateFilterExpression(
  expression: FilterExpression,
): string[] {
  if (!expression || expression.version !== 1) {
    return ['Filter expression has an unsupported version.'];
  }
  if (!expression.root || expression.root.kind !== 'group') {
    return ['Filter expression needs a root group.'];
  }

  const issues: string[] = [];
  const ids = new Set<string>();
  let ruleCount = 0;

  const walk = (node: FilterNode, depth: number) => {
    if (ids.has(node.id)) {
      issues.push(`Duplicate filter node id "${node.id}".`);
    }
    ids.add(node.id);

    if (isFilterGroup(node)) {
      if (depth > MAX_FILTER_DEPTH) {
        issues.push(
          `Filter groups can be nested at most ${MAX_FILTER_DEPTH} levels deep.`,
        );
      }
      if (node !== expression.root && node.children.length === 0) {
        issues.push('A nested filter group needs at least one condition.');
      }
      if (node.combinator !== 'and' && node.combinator !== 'or') {
        issues.push('A filter group must match all or any conditions.');
      }
      node.children.forEach((child) => walk(child, depth + 1));
      return;
    }

    ruleCount += 1;
    issues.push(...validateRule(node));
  };

  walk(expression.root, 1);
  if (ruleCount > MAX_FILTER_RULES) {
    issues.push(
      `Use at most ${MAX_FILTER_RULES} filter rules; this expression has ${ruleCount}.`,
    );
  }
  return issues;
}

export function isFilterExpression(value: unknown): value is FilterExpression {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FilterExpression>;
  return (
    candidate.version === 1 &&
    Boolean(candidate.root) &&
    candidate.root?.kind === 'group' &&
    Array.isArray(candidate.root?.children)
  );
}

export interface LegacyFilterFields {
  included_file_types?: string;
  title_word_filter?: string;
  min_file_size_filter_toggle?: 0 | 1;
  min_file_size_filter?: string;
  max_file_size_filter_toggle?: 0 | 1;
  max_file_size_filter?: string;
  included_property_filter?: string;
  included_property_filter_any_toggle?: 0 | 1;
  included_property_filter_all_toggle?: 0 | 1;
  excluded_property_filter?: string;
  excluded_property_filter_any_toggle?: 0 | 1;
  excluded_property_filter_all_toggle?: 0 | 1;
  include_converted_files_toggle?: 0 | 1;
  filter_expression?: FilterExpression;
}

/**
 * Legacy compilation runs on every render for profiles that have not been
 * edited yet, so its ids must be deterministic. Random ids here would make the
 * Run screen's queue signature change on every render and discard scan results.
 */
function legacyIdFactory() {
  let groups = 0;
  let rules = 0;
  return {
    group: () => `legacy-group-${groups++}`,
    rule: (): FilterRule => {
      const rule = createFilterRule('fileType', 'isAnyOf', []);
      return { ...rule, id: `legacy-rule-${rules++}` };
    },
  };
}

function propertyGroup(
  raw: string | undefined,
  anyToggle: number | undefined,
  allToggle: number | undefined,
  negate: boolean,
  ids: ReturnType<typeof legacyIdFactory>,
): FilterGroup | null {
  const rows = parsePropertyFilters(raw);
  if (rows.length === 0) return null;
  if (anyToggle !== 1 && allToggle !== 1) return null;
  return {
    id: ids.group(),
    kind: 'group',
    combinator: allToggle === 1 ? 'and' : 'or',
    negate,
    children: rows.map((row) => ({
      ...ids.rule(),
      field: 'mediaProperty',
      operator: 'equals',
      value: { key: row.key, value: row.value },
    })),
  };
}

/** Compiles the pre-expression flat fields into equivalent rules. */
export function legacyFilterExpression(
  advanced: LegacyFilterFields,
): FilterExpression {
  const ids = legacyIdFactory();
  const children: FilterNode[] = [];
  const fileTypes = parseTokenList(advanced.included_file_types);
  if (advanced.included_file_types !== undefined) {
    // An explicitly empty legacy list used to match nothing; keep it invalid so
    // the builder asks for a value instead of silently scanning default types.
    children.push({ ...ids.rule(), operator: 'isAnyOf', value: fileTypes });
  }
  if (advanced.include_converted_files_toggle !== 1) {
    children.push({
      ...ids.rule(),
      field: 'outputState',
      operator: 'isNot',
      value: 'converted',
    });
  }
  const titleWords = parseTokenList(advanced.title_word_filter);
  if (titleWords.length > 0) {
    children.push({
      ...ids.rule(),
      field: 'fileName',
      operator: 'containsNone',
      value: titleWords,
    });
  }
  const minRaw = (advanced.min_file_size_filter ?? '').trim();
  if (advanced.min_file_size_filter_toggle === 1) {
    // Invalid legacy values are kept as NaN so the builder reports them
    // instead of silently dropping the size filter.
    const min = minRaw === '' ? Number.NaN : Number(minRaw);
    children.push({
      ...ids.rule(),
      field: 'fileSize',
      operator: 'atLeast',
      value: min,
    });
  }
  const maxRaw = (advanced.max_file_size_filter ?? '').trim();
  if (advanced.max_file_size_filter_toggle === 1) {
    const max = maxRaw === '' ? Number.NaN : Number(maxRaw);
    children.push({
      ...ids.rule(),
      field: 'fileSize',
      operator: 'atMost',
      value: max,
    });
  }
  const included = propertyGroup(
    advanced.included_property_filter,
    advanced.included_property_filter_any_toggle,
    advanced.included_property_filter_all_toggle,
    false,
    ids,
  );
  if (included) children.push(included);
  const excluded = propertyGroup(
    advanced.excluded_property_filter,
    advanced.excluded_property_filter_any_toggle,
    advanced.excluded_property_filter_all_toggle,
    true,
    ids,
  );
  if (excluded) children.push(excluded);

  return {
    version: 1,
    root: {
      id: ids.group(),
      kind: 'group',
      combinator: 'and',
      children,
    },
  };
}

/**
 * Returns the stored expression when present, otherwise the compiled legacy
 * fields. An expression that exists but is malformed is returned as-is so the
 * settings UI can show the problem instead of silently dropping filters.
 */
export function resolveFilterExpression(
  advanced: LegacyFilterFields | undefined,
): FilterExpression {
  if (
    advanced?.filter_expression &&
    isFilterExpression(advanced.filter_expression)
  ) {
    return advanced.filter_expression;
  }
  return legacyFilterExpression(advanced ?? {});
}
