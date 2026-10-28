import React from 'react';
import {
  FilterExpression,
  FilterField,
  FilterOperator,
} from '../../../common/filterExpression';

export interface FilterMessage {
  id?: string;
  defaultMessage: string;
}

export type FilterValueKind =
  | 'none'
  | 'tokens'
  | 'number'
  | 'range'
  | 'property'
  | 'select';

export interface FilterValueEditorProps {
  id: string;
  field: FilterFieldDefinition;
  operator: FilterOperatorDefinition;
  value: unknown;
  disabled?: boolean;
  onChange: (value: unknown) => void;
}

export interface FilterOption {
  value: string;
  label: FilterMessage;
}

export interface FilterOperatorDefinition {
  id: FilterOperator;
  label: FilterMessage;
  valueKind: FilterValueKind;
  options?: FilterOption[];
  defaultValue?: unknown;
}

export interface FilterFieldDefinition {
  id: FilterField;
  category: FilterMessage;
  label: FilterMessage;
  description?: FilterMessage;
  defaultOperator: FilterOperator;
  operators: FilterOperatorDefinition[];
  createValue: (operator: FilterOperator) => unknown;
  renderValueEditor?: React.ComponentType<FilterValueEditorProps>;
}

export interface FilterBuilderProps {
  fields: FilterFieldDefinition[];
  value: FilterExpression;
  onChange: (next: FilterExpression) => void;
  disabled?: boolean;
  /** Used for input ids so multiple builders can coexist in tests. */
  idPrefix?: string;
}
