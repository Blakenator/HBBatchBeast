import type { MediaType } from './types';
import type {
  NamingRule,
  OrganizeConditionField,
  OrganizeConditionOperator,
  OrganizeRuleCondition,
} from './settings';

export interface NamingRuleContext {
  mediaType: MediaType;
  path: string;
  filename: string;
  extension: string;
  resolution?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  title?: string;
  year?: number;
}

const FIELDS: OrganizeConditionField[] = [
  'mediaType',
  'path',
  'filename',
  'extension',
  'resolution',
  'season',
  'episode',
  'title',
  'year',
];

const OPERATORS: OrganizeConditionOperator[] = [
  'is',
  'isNot',
  'contains',
  'notContains',
  'atLeast',
  'atMost',
];

function stringValue(
  context: NamingRuleContext,
  field: OrganizeConditionField,
): string | undefined {
  switch (field) {
    case 'mediaType':
      return context.mediaType;
    case 'path':
      return context.path;
    case 'filename':
      return context.filename;
    case 'extension':
      return context.extension;
    case 'resolution':
      return context.resolution;
    case 'title':
      return context.title;
    default:
      return undefined;
  }
}

function numberValue(
  context: NamingRuleContext,
  field: OrganizeConditionField,
): number | undefined {
  switch (field) {
    case 'season':
      return context.seasonNumber;
    case 'episode':
      return context.episodeNumber;
    case 'year':
      return context.year;
    default:
      return undefined;
  }
}

export function evaluateCondition(
  condition: OrganizeRuleCondition,
  context: NamingRuleContext,
): boolean {
  if (condition.field === 'season' || condition.field === 'episode' || condition.field === 'year') {
    const actual = numberValue(context, condition.field);
    const expected = Number(condition.value);
    if (actual === undefined || !Number.isFinite(expected)) return false;
    switch (condition.operator) {
      case 'is':
        return actual === expected;
      case 'isNot':
        return actual !== expected;
      case 'atLeast':
        return actual >= expected;
      case 'atMost':
        return actual <= expected;
      default:
        return false;
    }
  }

  const actual = stringValue(context, condition.field);
  if (actual === undefined) return false;
  const expected = String(condition.value ?? '').trim();
  const left = actual.trim().toLowerCase();
  const right = expected.toLowerCase();
  switch (condition.operator) {
    case 'is':
      return left === right;
    case 'isNot':
      return left !== right;
    case 'contains':
      return left.includes(right);
    case 'notContains':
      return !left.includes(right);
    default:
      return false;
  }
}

export function ruleMatches(
  rule: NamingRule,
  context: NamingRuleContext,
): boolean {
  if (rule.conditions.length === 0) return true;
  const results = rule.conditions.map((condition) =>
    evaluateCondition(condition, context),
  );
  return rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/** Ordered first-match; the final rule is the default. */
export function selectNamingRule(
  rules: NamingRule[],
  context: NamingRuleContext,
): NamingRule | undefined {
  if (rules.length === 0) return undefined;
  return rules.find((rule) => ruleMatches(rule, context)) ?? rules[rules.length - 1];
}

export function validateNamingRules(rules: NamingRule[]): string[] {
  const errors: string[] = [];
  if (rules.length === 0) errors.push('Add at least one naming rule.');
  rules.forEach((rule, index) => {
    if (!rule.fileTemplate.trim()) {
      errors.push(`Rule ${index + 1}: file template is empty.`);
    }
    if (rule.folderTemplate.trim() === '') {
      // In-place organizing is valid; an explicit empty folder template is fine.
    }
    if (rule.conditions.length > 0 && rule.match !== 'all' && rule.match !== 'any') {
      errors.push(`Rule ${index + 1}: invalid match mode.`);
    }
    rule.conditions.forEach((condition) => {
      if (!FIELDS.includes(condition.field)) {
        errors.push(`Rule ${index + 1}: unknown field "${condition.field}".`);
      }
      if (!OPERATORS.includes(condition.operator)) {
        errors.push(
          `Rule ${index + 1}: unknown operator "${condition.operator}".`,
        );
      }
    });
  });
  return errors;
}

export function describeCondition(condition: OrganizeRuleCondition): string {
  const field = {
    mediaType: 'media type',
    path: 'path',
    filename: 'filename',
    extension: 'extension',
    resolution: 'resolution',
    season: 'season',
    episode: 'episode',
    title: 'title',
    year: 'year',
  }[condition.field];
  const operator = {
    is: 'is',
    isNot: 'is not',
    contains: 'contains',
    notContains: 'does not contain',
    atLeast: 'is at least',
    atMost: 'is at most',
  }[condition.operator];
  return `${field} ${operator} ${condition.value}`;
}
