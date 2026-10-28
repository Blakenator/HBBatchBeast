import {
  DEFAULT_INCLUDED_FILE_TYPES,
  FilterOperator,
} from '../../common';
import { settingsMessages } from './messages';
import { FilterPropertyValue } from './FilterPropertyValue';
import { FilterFieldDefinition } from '../ui/filterBuilder/types';

const fileTypeValue = (operator: FilterOperator): unknown =>
  operator === 'isNoneOf'
    ? ['mp4']
    : DEFAULT_INCLUDED_FILE_TYPES.split(',');

const fileNameValue = (operator: FilterOperator): unknown =>
  operator === 'containsAny' ? ['sample'] : ['sample', 'trailer'];

const sizeValue = (operator: FilterOperator): unknown => {
  if (operator === 'atMost') return 1000;
  if (operator === 'between') return [100, 1000];
  return 100;
};

const propertyValue = (operator: FilterOperator): unknown =>
  operator === 'gt'
    ? { key: 'width', value: '1920' }
    : operator === 'lt'
      ? { key: 'width', value: '1280' }
      : { key: 'codec_name', value: 'h264' };

/** Scan-specific field definitions injected into the generic builder. */
export const scanFilterFields: FilterFieldDefinition[] = [
  {
    id: 'fileType',
    category: settingsMessages.filterCategoryFile,
    label: settingsMessages.filterFileType,
    description: settingsMessages.filterFileTypeDescription,
    defaultOperator: 'isAnyOf',
    createValue: fileTypeValue,
    operators: [
      {
        id: 'isAnyOf',
        label: settingsMessages.filterFileTypeIsAnyOf,
        valueKind: 'tokens',
      },
      {
        id: 'isNoneOf',
        label: settingsMessages.filterFileTypeIsNoneOf,
        valueKind: 'tokens',
      },
    ],
  },
  {
    id: 'fileName',
    category: settingsMessages.filterCategoryFile,
    label: settingsMessages.filterFileName,
    description: settingsMessages.filterFileNameDescription,
    defaultOperator: 'containsNone',
    createValue: fileNameValue,
    operators: [
      {
        id: 'containsAny',
        label: settingsMessages.filterFileNameContainsAny,
        valueKind: 'tokens',
      },
      {
        id: 'containsNone',
        label: settingsMessages.filterFileNameContainsNone,
        valueKind: 'tokens',
      },
    ],
  },
  {
    id: 'fileSize',
    category: settingsMessages.filterCategorySize,
    label: settingsMessages.filterFileSize,
    description: settingsMessages.filterFileSizeDescription,
    defaultOperator: 'atLeast',
    createValue: sizeValue,
    operators: [
      {
        id: 'atLeast',
        label: settingsMessages.filterFileSizeAtLeast,
        valueKind: 'number',
      },
      {
        id: 'atMost',
        label: settingsMessages.filterFileSizeAtMost,
        valueKind: 'number',
      },
      {
        id: 'between',
        label: settingsMessages.filterFileSizeBetween,
        valueKind: 'range',
      },
    ],
  },
  {
    id: 'outputState',
    category: settingsMessages.filterCategoryOutput,
    label: settingsMessages.filterOutputState,
    description: settingsMessages.filterOutputStateDescription,
    defaultOperator: 'isNot',
    createValue: () => 'converted',
    operators: [
      {
        id: 'is',
        label: settingsMessages.filterOutputStateIs,
        valueKind: 'select',
        options: [
          {
            value: 'converted',
            label: settingsMessages.filterOutputConverted,
          },
        ],
      },
      {
        id: 'isNot',
        label: settingsMessages.filterOutputStateIsNot,
        valueKind: 'select',
        options: [
          {
            value: 'converted',
            label: settingsMessages.filterOutputConverted,
          },
        ],
      },
    ],
  },
  {
    id: 'mediaProperty',
    category: settingsMessages.filterCategoryMedia,
    label: settingsMessages.filterMediaProperty,
    description: settingsMessages.filterMediaPropertyDescription,
    defaultOperator: 'equals',
    createValue: propertyValue,
    renderValueEditor: FilterPropertyValue,
    operators: [
      {
        id: 'equals',
        label: settingsMessages.filterMediaPropertyEquals,
        valueKind: 'property',
      },
      {
        id: 'notEquals',
        label: settingsMessages.filterMediaPropertyNotEquals,
        valueKind: 'property',
      },
      {
        id: 'contains',
        label: settingsMessages.filterMediaPropertyContains,
        valueKind: 'property',
      },
      {
        id: 'gt',
        label: settingsMessages.filterMediaPropertyGt,
        valueKind: 'property',
      },
      {
        id: 'lt',
        label: settingsMessages.filterMediaPropertyLt,
        valueKind: 'property',
      },
    ],
  },
];
