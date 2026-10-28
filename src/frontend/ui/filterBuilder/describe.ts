import { FilterRule } from '../../../common/filterExpression';
import { filterBuilderMessages } from './messages';
import { FilterFieldDefinition, FilterMessage } from './types';

type FormatMessage = (
  descriptor: FilterMessage,
  values?: Record<string, unknown>,
) => string;

function formatValue(
  rule: FilterRule,
  field: FilterFieldDefinition | undefined,
  formatMessage: FormatMessage,
): string {
  const operator = field?.operators.find((item) => item.id === rule.operator);
  const kind = operator?.valueKind;
  if (kind === 'none') return '';
  if (kind === 'property') {
    const value = rule.value as { key?: string; value?: string } | null;
    return `${value?.key ?? ''} ${value?.value ?? ''}`.trim();
  }
  if (kind === 'range') {
    const range = Array.isArray(rule.value) ? rule.value : [];
    return `${String(range[0] ?? '')}–${String(range[1] ?? '')}`;
  }
  if (kind === 'select') {
    const selected = operator?.options?.find(
      (option) => option.value === rule.value,
    );
    return selected
      ? formatMessage(selected.label)
      : String(rule.value ?? '');
  }
  if (Array.isArray(rule.value)) return rule.value.join(', ');
  return String(rule.value ?? '');
}

export function describeRule(
  rule: FilterRule,
  field: FilterFieldDefinition | undefined,
  formatMessage: FormatMessage,
): string {
  const operator = field?.operators.find((item) => item.id === rule.operator);
  const label = field ? formatMessage(field.label) : rule.field;
  const condition = operator ? formatMessage(operator.label) : rule.operator;
  const value = formatValue(rule, field, formatMessage);
  const negated = rule.negate
    ? `${formatMessage(filterBuilderMessages.negated)} `
    : '';
  return `${label} ${negated}${condition}${value ? ` ${value}` : ''}`;
}
