import React from 'react';
import { Form } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import {
  DEFAULT_INCLUDED_FILE_TYPES,
  normalizeFileType,
  parseTokenList,
} from '../../../common';
import { TokenListEditor } from '../TokenListEditor';
import { filterBuilderMessages } from './messages';
import { FilterValueEditorProps } from './types';

const asNumber = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

export const FilterValueEditor: React.FC<FilterValueEditorProps> = (props) => {
  const { field, operator, value, onChange, disabled } = props;
  const { formatMessage } = useIntl();
  const Custom = field.renderValueEditor;

  if (Custom) {
    return <Custom {...props} />;
  }

  if (operator.valueKind === 'none') return null;

  if (operator.valueKind === 'tokens') {
    const tokens = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
    return (
      <TokenListEditor
        id={props.id}
        value={tokens.join(',')}
        onChange={(next) => onChange(parseTokenList(next))}
        normalize={field.id === 'fileType' ? normalizeFileType : undefined}
        defaults={
          field.id === 'fileType'
            ? DEFAULT_INCLUDED_FILE_TYPES.split(',')
            : undefined
        }
        placeholder={formatMessage(filterBuilderMessages.tokensPlaceholder)}
      />
    );
  }

  if (operator.valueKind === 'number') {
    return (
      <Form.Control
        id={props.id}
        type="number"
        min={0}
        step={operator.id === 'between' ? 1 : 0.1}
        value={asNumber(value)}
        disabled={disabled}
        aria-label={formatMessage(filterBuilderMessages.value)}
        placeholder={formatMessage(filterBuilderMessages.numberPlaceholder)}
        onChange={(event) =>
          onChange(
            event.target.value === ''
              ? ''
              : Number(event.target.value),
          )
        }
      />
    );
  }

  if (operator.valueKind === 'range') {
    const range = Array.isArray(value) ? value : ['', ''];
    return (
      <div style={{ display: 'flex', gap: 'var(--hb-space-xs)', alignItems: 'center' }}>
        <Form.Control
          type="number"
          min={0}
          step={0.1}
          value={asNumber(range[0])}
          disabled={disabled}
          aria-label={formatMessage(filterBuilderMessages.minimum)}
          placeholder={formatMessage(filterBuilderMessages.minimum)}
          onChange={(event) =>
            onChange([
              event.target.value === '' ? '' : Number(event.target.value),
              range[1],
            ])
          }
        />
        <span aria-hidden>–</span>
        <Form.Control
          type="number"
          min={0}
          step={0.1}
          value={asNumber(range[1])}
          disabled={disabled}
          aria-label={formatMessage(filterBuilderMessages.maximum)}
          placeholder={formatMessage(filterBuilderMessages.maximum)}
          onChange={(event) =>
            onChange([
              range[0],
              event.target.value === '' ? '' : Number(event.target.value),
            ])
          }
        />
      </div>
    );
  }

  if (operator.valueKind === 'select') {
    return (
      <Form.Select
        id={props.id}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        aria-label={formatMessage(filterBuilderMessages.value)}
        onChange={(event) => onChange(event.target.value)}
      >
        {(operator.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {formatMessage(option.label)}
          </option>
        ))}
      </Form.Select>
    );
  }

  return (
    <Form.Control
      id={props.id}
      value={typeof value === 'string' ? value : ''}
      disabled={disabled}
      aria-label={formatMessage(filterBuilderMessages.value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
};
