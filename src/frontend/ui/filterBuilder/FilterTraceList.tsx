import React from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import {
  FilterTrace,
  FilterTraceEntry,
} from '../../../common/filterExpression';
import { describeRule } from './describe';
import { filterBuilderMessages } from './messages';
import { FilterFieldDefinition } from './types';

const List = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--hb-space-xs);
`;

const Item = styled.li<{ $indent: number }>`
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: var(--hb-space-xs);
  padding-left: ${({ $indent }) => `${$indent * 12}px`};
  font-size: var(--hb-font-sm);
`;

const Status = styled.span<{ $tone: string }>`
  color: ${({ $tone }) => `var(--hb-${$tone})`};
  font-weight: 700;
  line-height: 1.4;
`;

const Body = styled.div`
  display: grid;
  gap: 1px;
  min-width: 0;
`;

const Condition = styled.span`
  overflow-wrap: anywhere;
`;

const Meta = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const GroupBadge = styled.span`
  display: inline-block;
  margin-right: var(--hb-space-xs);
  padding: 0 4px;
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surfaceMuted);
  color: var(--hb-textMuted);
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

function statusText(entry: FilterTraceEntry): {
  label: keyof typeof filterBuilderMessages;
  tone: string;
} {
  if (entry.status === 'pass') {
    return { label: 'tracePassed', tone: 'success' };
  }
  if (entry.status === 'fail') {
    return { label: 'traceFailed', tone: 'danger' };
  }
  if (entry.status === 'error') {
    return { label: 'traceError', tone: 'warning' };
  }
  return { label: 'traceNotEvaluated', tone: 'textMuted' };
}

const statusIcon: Record<FilterTraceEntry['status'], string> = {
  pass: '✓',
  fail: '✕',
  skipped: '–',
  error: '⚠',
};

interface FilterTraceListProps {
  trace: FilterTrace;
  fields: FilterFieldDefinition[];
}

export const FilterTraceList: React.FC<FilterTraceListProps> = ({
  trace,
  fields,
}) => {
  const { formatMessage } = useIntl();

  if (trace.entries.length === 0) {
    return (
      <Meta>{formatMessage(filterBuilderMessages.noStagesRan)}</Meta>
    );
  }

  return (
    <List aria-label={formatMessage(filterBuilderMessages.traceTitle)}>
      {trace.entries.map((entry) => {
        const field = fields.find((item) => item.id === entry.field);
        const { label, tone } = statusText(entry);
        const nestedGroup = entry.groupPath.length > 1
          ? entry.groupPath[entry.groupPath.length - 1]
          : undefined;
        const combinator = nestedGroup
          ? trace.groupCombinators[nestedGroup]
          : undefined;
        const negatedGroup = nestedGroup
          ? trace.groupNegates[nestedGroup]
          : false;
        return (
          <Item key={entry.ruleId} $indent={Math.max(0, entry.groupPath.length - 1)}>
            <Status $tone={tone} aria-hidden>
              {statusIcon[entry.status]}
            </Status>
            <Body>
              <Condition>
                {combinator && (
                  <GroupBadge>
                    {negatedGroup ? 'NOT ' : ''}
                    {formatMessage(
                      combinator === 'and'
                        ? filterBuilderMessages.groupOutcomeAll
                        : filterBuilderMessages.groupOutcomeAny,
                    )}
                  </GroupBadge>
                )}
                {describeRule(
                  {
                    id: entry.ruleId,
                    kind: 'rule',
                    field: entry.field,
                    operator: entry.operator,
                    value: entry.value,
                    negate: entry.negate,
                  },
                  field,
                  formatMessage,
                )}
              </Condition>
              <Meta>
                <span>{formatMessage(filterBuilderMessages[label])}</span>
                {entry.observed && (
                  <>
                    {' · '}
                    {formatMessage(filterBuilderMessages.traceObserved, {
                      value: entry.observed,
                    })}
                  </>
                )}
              </Meta>
              {entry.status === 'error' && entry.detail && (
                <Meta>{entry.detail}</Meta>
              )}
            </Body>
          </Item>
        );
      })}
    </List>
  );
};
