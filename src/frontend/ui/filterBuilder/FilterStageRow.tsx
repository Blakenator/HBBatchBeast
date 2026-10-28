import React from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { FilterRule } from '../../../common/filterExpression';
import { IconButton } from '../Button';
import { FilterValueEditor } from './FilterValueEditor';
import { filterBuilderMessages } from './messages';
import { NegateButton } from './NegateButton';
import { FilterFieldDefinition } from './types';

const Row = styled.div`
  display: grid;
  grid-template-columns: minmax(120px, 0.8fr) minmax(0, 1.6fr) auto;
  gap: var(--hb-space-sm);
  align-items: start;
  padding: var(--hb-space-sm);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surface);
`;

const FieldName = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
`;

const FieldLabel = styled.span`
  font-weight: 600;
  font-size: var(--hb-font-sm);
`;

const Description = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const Controls = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
  min-width: 0;
`;

const Actions = styled.div`
  display: flex;
  gap: 2px;
  align-items: center;
`;

const Negated = styled.span`
  align-self: center;
  padding: 1px var(--hb-space-xs);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surfaceMuted);
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

interface FilterStageRowProps {
  rule: FilterRule;
  field: FilterFieldDefinition | undefined;
  stageNumber: number;
  idPrefix: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled?: boolean;
  onChange: (rule: FilterRule) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
}

export const FilterStageRow: React.FC<FilterStageRowProps> = ({
  rule,
  field,
  stageNumber,
  idPrefix,
  canMoveUp,
  canMoveDown,
  disabled,
  onChange,
  onRemove,
  onDuplicate,
  onMove,
}) => {
  const { formatMessage } = useIntl();
  const operator = field?.operators.find((item) => item.id === rule.operator);
  const inputId = `${idPrefix}-${rule.id}`;

  return (
    <Row role="listitem">
      <FieldName>
        <Description>
          {formatMessage(filterBuilderMessages.stageNumber, {
            number: stageNumber,
          })}
        </Description>
        <FieldLabel>
          {field ? formatMessage(field.label) : rule.field}
          {rule.negate ? (
            <>
              {' '}
              <Negated>{formatMessage(filterBuilderMessages.negated)}</Negated>
            </>
          ) : null}
        </FieldLabel>
        {field?.description && (
          <Description>{formatMessage(field.description)}</Description>
        )}
      </FieldName>

      <Controls>
        <Form.Select
          aria-label={formatMessage(filterBuilderMessages.operator)}
          value={rule.operator}
          disabled={disabled || !field}
          onChange={(event) => {
            if (!field) return;
            const next = event.target.value as FilterRule['operator'];
            onChange({
              ...rule,
              operator: next,
              value: field.createValue(next),
            });
          }}
        >
          {(field?.operators ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {formatMessage(item.label)}
            </option>
          ))}
        </Form.Select>

        {operator && (
          <FilterValueEditor
            id={inputId}
            field={field as FilterFieldDefinition}
            operator={operator}
            value={rule.value}
            disabled={disabled}
            onChange={(value) => onChange({ ...rule, value })}
          />
        )}
      </Controls>

      <Actions>
        <NegateButton
          active={Boolean(rule.negate)}
          disabled={disabled}
          onToggle={() => onChange({ ...rule, negate: !rule.negate })}
        />
        <IconButton
          icon="copy"
          label={formatMessage(filterBuilderMessages.duplicate)}
          disabled={disabled}
          onClick={onDuplicate}
        />
        <IconButton
          icon="moveUp"
          label={formatMessage(filterBuilderMessages.moveUp)}
          disabled={disabled || !canMoveUp}
          onClick={() => onMove(-1)}
        />
        <IconButton
          icon="moveDown"
          label={formatMessage(filterBuilderMessages.moveDown)}
          disabled={disabled || !canMoveDown}
          onClick={() => onMove(1)}
        />
        <IconButton
          icon="close"
          label={formatMessage(filterBuilderMessages.remove)}
          disabled={disabled}
          onClick={onRemove}
        />
      </Actions>
    </Row>
  );
};
