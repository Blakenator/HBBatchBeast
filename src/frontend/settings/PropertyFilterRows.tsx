import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import {
  PropertyFilterRow,
  parsePropertyFilters,
  serializePropertyFilters,
} from '../../common';
import { Button } from '../ui/Button';
import { SegmentedControl } from './SegmentedControl';
import { settingsMessages } from './messages';

export type PropertyFilterMode = 'off' | 'any' | 'all';

interface PropertyFilterRowsProps {
  id: string;
  value: string;
  mode: PropertyFilterMode;
  onChange: (value: string) => void;
  onModeChange: (mode: PropertyFilterMode) => void;
}

const MODE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'any', label: 'Match any' },
  { value: 'all', label: 'Match all' },
];

const KNOWN_KEYS = [
  'codec_name',
  'codec_type',
  'profile',
  'pix_fmt',
  'width',
  'height',
  'r_frame_rate',
  'channel_layout',
  'channels',
  'sample_rate',
];

const Rows = styled.div`
  margin-top: var(--hb-space-sm);
  display: grid;
  gap: var(--hb-space-xs);
`;

const Pair = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: var(--hb-space-xs);
`;

const blank = (): PropertyFilterRow => ({ key: '', value: '' });

const withDraft = (rows: PropertyFilterRow[]): PropertyFilterRow[] =>
  rows.length === 0 || rows[rows.length - 1].key !== ''
    ? [...rows, blank()]
    : rows;

/** ffprobe property pairs edited as key/value rows instead of a comma string. */
export const PropertyFilterRows: React.FC<PropertyFilterRowsProps> = ({
  id,
  value,
  mode,
  onChange,
  onModeChange,
}) => {
  const { formatMessage } = useIntl();
  const [rows, setRows] = useState<PropertyFilterRow[]>(() =>
    withDraft(parsePropertyFilters(value)),
  );
  const pushedValue = useRef<string | null>(null);

  useEffect(() => {
    if (pushedValue.current === value) {
      pushedValue.current = null;
      return;
    }
    setRows(withDraft(parsePropertyFilters(value)));
  }, [value]);

  const persist = (nextRows: PropertyFilterRow[]) => {
    const nextValue = serializePropertyFilters(nextRows);
    pushedValue.current = nextValue;
    setRows(nextRows);
    onChange(nextValue);
  };

  const update = (index: number, key: keyof PropertyFilterRow, next: string) => {
    const nextRows = rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [key]: next } : row,
    );
    if (nextRows[nextRows.length - 1]?.key !== '') nextRows.push(blank());
    persist(nextRows);
  };

  return (
    <div>
      <SegmentedControl
        label={formatMessage(settingsMessages.propertyFilterMode)}
        options={MODE_OPTIONS.map((option) => ({
          ...option,
          label: formatMessage(
            option.value === 'off'
              ? settingsMessages.propertyFilterOff
              : option.value === 'any'
                ? settingsMessages.propertyFilterAny
                : settingsMessages.propertyFilterAll,
          ),
        }))}
        value={mode}
        onChange={(next) => onModeChange(next as PropertyFilterMode)}
      />

      {mode !== 'off' && (
        <>
          <Rows>
            {rows.map((row, index) => (
              <Pair key={index}>
                <Form.Control
                  list={`${id}-keys`}
                  value={row.key}
                  placeholder="codec_name"
                  aria-label={formatMessage(settingsMessages.propertyKey)}
                  onChange={(event) => update(index, 'key', event.target.value)}
                />
                <Form.Control
                  value={row.value}
                  placeholder="h264"
                  aria-label={formatMessage(settingsMessages.propertyValue)}
                  onChange={(event) => update(index, 'value', event.target.value)}
                />
                <Button
                  compact
                  variant="ghost"
                  onClick={() =>
                    persist(
                      withDraft(rows.filter((_row, rowIndex) => rowIndex !== index)),
                    )
                  }
                  aria-label={formatMessage(settingsMessages.removeProperty)}
                >
                  ×
                </Button>
              </Pair>
            ))}
          </Rows>
          <datalist id={`${id}-keys`}>
            {KNOWN_KEYS.map((key) => (
              <option key={key} value={key} />
            ))}
          </datalist>
        </>
      )}
    </div>
  );
};
