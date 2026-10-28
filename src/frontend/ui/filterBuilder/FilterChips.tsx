import React from 'react';
import { useIntl } from 'react-intl';
import {
  FilterExpression,
  flattenFilterRules,
  isFilterExpressionEmpty,
} from '../../../common/filterExpression';
import { TokenBox, TokenChip } from '../Tokens';
import { describeRule } from './describe';
import { filterBuilderMessages } from './messages';
import { FilterFieldDefinition } from './types';

interface FilterChipsProps {
  expression: FilterExpression;
  fields: FilterFieldDefinition[];
  empty?: React.ReactNode;
  ariaLabel?: string;
}

export const FilterChips: React.FC<FilterChipsProps> = ({
  expression,
  fields,
  empty,
  ariaLabel,
}) => {
  const { formatMessage } = useIntl();
  if (isFilterExpressionEmpty(expression)) {
    return (
      <span style={{ color: 'var(--hb-textMuted)' }}>
        {empty ?? formatMessage(filterBuilderMessages.emptyRoot)}
      </span>
    );
  }

  const rows = flattenFilterRules(expression);
  return (
    <TokenBox role="list" aria-label={ariaLabel}>
      {rows.map(({ rule, groupPath, group }, index) => {
        const field = fields.find((item) => item.id === rule.field);
        const nested = groupPath.length > 1;
        return (
          <React.Fragment key={rule.id}>
            {index > 0 && (
              <span
                role="listitem"
                style={{
                  color: 'var(--hb-textMuted)',
                  fontSize: 'var(--hb-font-xs)',
                  fontWeight: 600,
                }}
              >
                {formatMessage(
                  group.combinator === 'and'
                    ? filterBuilderMessages.connectorAnd
                    : filterBuilderMessages.connectorOr,
                )}
              </span>
            )}
            <TokenChip role="listitem">
              {nested ? (
                <span style={{ color: 'var(--hb-textMuted)' }}>
                  {formatMessage(
                    group.combinator === 'and'
                      ? filterBuilderMessages.matchAll
                      : filterBuilderMessages.matchAny,
                  )}
                  :{' '}
                </span>
              ) : null}
              {describeRule(rule, field, formatMessage)}
            </TokenChip>
          </React.Fragment>
        );
      })}
    </TokenBox>
  );
};
