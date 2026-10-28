import React from 'react';
import styled from 'styled-components';
import { useIntl } from 'react-intl';
import {
  ffprobePropertySuggestions,
  ffprobeValueOptions,
  isKnownFfprobeProperty,
  isNumericFfprobeProperty,
} from '../../common/ffprobeProperties';
import { Combobox } from '../ui/Combobox';
import { FilterValueEditorProps } from '../ui/filterBuilder/types';
import { filterBuilderMessages } from '../ui/filterBuilder/messages';

const Pair = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--hb-space-xs);

  @media (max-width: 720px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const Warning = styled.div`
  color: var(--hb-warning);
  font-size: var(--hb-font-xs);
`;

interface PropertyValue {
  key: string;
  value: string;
}

function readValue(value: unknown): PropertyValue {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<PropertyValue>;
    return {
      key: typeof candidate.key === 'string' ? candidate.key : '',
      value: typeof candidate.value === 'string' ? candidate.value : '',
    };
  }
  return { key: '', value: '' };
}

export const FilterPropertyValue: React.FC<FilterValueEditorProps> = ({
  id,
  value,
  disabled,
  onChange,
}) => {
  const { formatMessage } = useIntl();
  const current = readValue(value);
  const suggestions = ffprobePropertySuggestions();
  const valueOptions = ffprobeValueOptions(current.key).map((item) => ({
    value: item,
    label: item,
  }));
  const unknown = current.key.length > 0 && !isKnownFfprobeProperty(current.key);

  const changeKey = (key: string) => {
    const oldSuggested = ffprobeValueOptions(current.key);
    const newSuggested = ffprobeValueOptions(key);
    const wasSuggested = oldSuggested.includes(current.value);
    const nowSuggested = newSuggested.includes(current.value);
    const numericMismatch =
      isNumericFfprobeProperty(key) &&
      current.value.length > 0 &&
      !Number.isFinite(Number(current.value));
    const nextValue =
      (wasSuggested && !nowSuggested) || numericMismatch ? '' : current.value;
    onChange({ key, value: nextValue });
  };

  return (
    <div>
      <Pair>
        <Combobox
          id={`${id}-key`}
          value={current.key}
          options={suggestions}
          allowCustom
          disabled={disabled}
          ariaLabel={formatMessage(filterBuilderMessages.propertyKey)}
          placeholder={formatMessage(filterBuilderMessages.searchProperties)}
          onChange={changeKey}
        />
        <Combobox
          id={`${id}-value`}
          value={current.value}
          options={valueOptions}
          allowCustom
          disabled={disabled}
          ariaLabel={formatMessage(filterBuilderMessages.propertyValue)}
          placeholder={formatMessage(filterBuilderMessages.propertyValue)}
          onChange={(next) => onChange({ key: current.key, value: next })}
        />
      </Pair>
      {unknown && (
        <Warning>{formatMessage(filterBuilderMessages.unknownProperty)}</Warning>
      )}
    </div>
  );
};
