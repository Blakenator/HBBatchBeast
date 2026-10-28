import React from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import {
  FilterExpression,
  FilterGroup,
  FilterNode,
  FilterRule,
  addFilterChild,
  createFilterGroup,
  createFilterRule,
  duplicateFilterNode,
  isFilterGroup,
  moveFilterNode,
  removeFilterNode,
  updateFilterNode,
} from '../../../common/filterExpression';
import { Button, IconButton } from '../Button';
import { AddStageMenu } from './AddStageMenu';
import { FilterStageRow } from './FilterStageRow';
import { filterBuilderMessages } from './messages';
import { NegateButton } from './NegateButton';
import { FilterBuilderProps, FilterFieldDefinition } from './types';

const Builder = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
`;

const GroupBox = styled.div<{ $nested: boolean }>`
  display: grid;
  gap: var(--hb-space-sm);
  padding: ${({ $nested }) =>
    $nested ? 'var(--hb-space-sm)' : 'var(--hb-space-md)'};
  border: 1px solid
    ${({ $nested }) => ($nested ? 'var(--hb-border)' : 'transparent')};
  border-radius: var(--hb-radius-md);
  background: ${({ $nested }) =>
    $nested ? 'var(--hb-surfaceMuted)' : 'transparent'};
`;

const GroupHeader = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
`;

const GroupTitle = styled.span`
  font-weight: 600;
  font-size: var(--hb-font-sm);
`;

const GroupHint = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const Toggle = styled.div`
  display: inline-flex;
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  overflow: hidden;
`;

const ToggleButton = styled.button<{ $active: boolean }>`
  border: 0;
  height: 26px;
  padding: 0 var(--hb-space-sm);
  font: inherit;
  font-size: var(--hb-font-xs);
  cursor: pointer;
  background: ${({ $active }) =>
    $active ? 'var(--hb-accent)' : 'var(--hb-surface)'};
  color: ${({ $active }) =>
    $active ? 'var(--hb-accentContrast)' : 'var(--hb-text)'};

  &:focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: -2px;
  }
`;

const StageList = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
`;

function countGroupRules(group: FilterGroup): number {
  return group.children.reduce(
    (count, child) => count + (isFilterGroup(child) ? countGroupRules(child) : 1),
    0,
  );
}

const Empty = styled.div`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  padding: var(--hb-space-xs) 0;
`;

const Footer = styled.div`
  display: flex;
  gap: var(--hb-space-xs);
  flex-wrap: wrap;
  align-items: center;
`;

interface GroupEditorProps {
  expression: FilterExpression;
  group: FilterGroup;
  fields: FilterFieldDefinition[];
  idPrefix: string;
  nested: boolean;
  disabled?: boolean;
  onChange: (next: FilterExpression) => void;
}

const FilterGroupEditor: React.FC<GroupEditorProps> = ({
  expression,
  group,
  fields,
  idPrefix,
  nested,
  disabled,
  onChange,
}) => {
  const { formatMessage } = useIntl();
  const all = group.combinator === 'and';
  const addField = (field: FilterFieldDefinition) => {
    const rule = createFilterRule(
      field.id,
      field.defaultOperator,
      field.createValue(field.defaultOperator),
    );
    onChange(addFilterChild(expression, group.id, rule));
  };
  const addGroup = () =>
    onChange(addFilterChild(expression, group.id, createFilterGroup('or')));

  return (
    <GroupBox $nested={nested} role="group" aria-label={formatMessage(filterBuilderMessages.field)}>
      <GroupHeader>
        <Toggle role="group" aria-label={formatMessage(filterBuilderMessages.operator)}>
          <ToggleButton
            type="button"
            $active={all}
            disabled={disabled}
            aria-pressed={all}
            title={formatMessage(filterBuilderMessages.matchAllHint)}
            onClick={() =>
              onChange(
                updateFilterNode(expression, group.id, (node) =>
                  isFilterGroup(node) ? { ...node, combinator: 'and' } : node,
                ),
              )
            }
          >
            {formatMessage(filterBuilderMessages.matchAll)}
          </ToggleButton>
          <ToggleButton
            type="button"
            $active={!all}
            disabled={disabled}
            aria-pressed={!all}
            title={formatMessage(filterBuilderMessages.matchAnyHint)}
            onClick={() =>
              onChange(
                updateFilterNode(expression, group.id, (node) =>
                  isFilterGroup(node) ? { ...node, combinator: 'or' } : node,
                ),
              )
            }
          >
            {formatMessage(filterBuilderMessages.matchAny)}
          </ToggleButton>
        </Toggle>
        <GroupTitle>
          {group.negate
            ? `${formatMessage(filterBuilderMessages.negated)} `
            : ''}
          {formatMessage(
            all
              ? filterBuilderMessages.groupHeadingAll
              : filterBuilderMessages.groupHeadingAny,
          )}
        </GroupTitle>
        <GroupHint>
          {formatMessage(filterBuilderMessages.filterCount, {
            count: countGroupRules(group),
          })}
        </GroupHint>
        <div style={{ flex: 1 }} />
        <NegateButton
          group
          active={Boolean(group.negate)}
          disabled={disabled}
          onToggle={() =>
            onChange(
              updateFilterNode(expression, group.id, (node) =>
                isFilterGroup(node) ? { ...node, negate: !node.negate } : node,
              ),
            )
          }
        />
        {nested && (
          <IconButton
            icon="close"
            label={formatMessage(filterBuilderMessages.remove)}
            disabled={disabled}
            onClick={() => onChange(removeFilterNode(expression, group.id))}
          />
        )}
      </GroupHeader>

      <StageList role="list">
        {group.children.map((child, index) => {
          if (isFilterGroup(child)) {
            return (
              <div role="listitem" key={child.id}>
                <FilterGroupEditor
                  expression={expression}
                  group={child}
                  fields={fields}
                  idPrefix={idPrefix}
                  nested
                  disabled={disabled}
                  onChange={onChange}
                />
              </div>
            );
          }
          const field = fields.find((item) => item.id === child.field);
          return (
            <FilterStageRow
              key={child.id}
              rule={child}
              field={field}
              stageNumber={index + 1}
              idPrefix={idPrefix}
              canMoveUp={index > 0}
              canMoveDown={index < group.children.length - 1}
              disabled={disabled}
              onChange={(next: FilterRule) =>
                onChange(updateFilterNode(expression, child.id, () => next))
              }
              onRemove={() => onChange(removeFilterNode(expression, child.id))}
              onDuplicate={() => onChange(duplicateFilterNode(expression, child.id))}
              onMove={(direction) => onChange(moveFilterNode(expression, child.id, direction))}
            />
          );
        })}
      </StageList>

      {group.children.length === 0 && (
        <Empty>
          {formatMessage(
            nested
              ? filterBuilderMessages.emptyGroup
              : filterBuilderMessages.emptyRoot,
          )}
        </Empty>
      )}

      <Footer>
        <AddStageMenu fields={fields} disabled={disabled} onAdd={addField} />
        <Button
          compact
          variant="ghost"
          icon="addGroup"
          disabled={disabled}
          onClick={addGroup}
        >
          {formatMessage(filterBuilderMessages.addGroup)}
        </Button>
      </Footer>
    </GroupBox>
  );
};

export const FilterBuilder: React.FC<FilterBuilderProps> = ({
  fields,
  value,
  onChange,
  disabled,
  idPrefix = 'filter',
}) => {
  const { formatMessage } = useIntl();
  return (
    <Builder aria-label={formatMessage(filterBuilderMessages.field)}>
      <FilterGroupEditor
        expression={value}
        group={value.root}
        fields={fields}
        idPrefix={idPrefix}
        nested={false}
        disabled={disabled}
        onChange={onChange}
      />
    </Builder>
  );
};

export type { FilterNode };
