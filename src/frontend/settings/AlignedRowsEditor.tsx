import React from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import {
  HandBrakePresetScan,
  parseCommandPair,
  parseMappedRows,
  serializeCommandPair,
  serializeMappedRows,
} from '../../common';
import { Button } from '../ui/Button';
import { PresetSelect } from './PresetSelect';
import { InlineNote } from './FieldLayout';
import { settingsMessages } from './messages';

export type AlignedVariant =
  | 'preset'
  | 'suffix'
  | 'handbrake-args'
  | 'ffmpeg-args';

interface AlignedRowsEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  sourceRows: string[];
  variant: AlignedVariant;
  scan?: HandBrakePresetScan;
  presetsLoading?: boolean;
}

const Rows = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
  margin-top: var(--hb-space-xs);
`;

const RowCard = styled.div`
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-xs) var(--hb-space-sm);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surfaceMuted);
`;

const RowLabel = styled.div`
  min-width: 0;
`;

const RowTitle = styled.div`
  font-size: var(--hb-font-xs);
  font-weight: 600;
`;

const RowPath = styled.div`
  font-size: var(--hb-font-xs);
  color: var(--hb-textMuted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Pair = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--hb-space-xs);
`;

const Prefix = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-xs);
`;

const PrefixLabel = styled.span`
  font-size: var(--hb-font-xs);
  color: var(--hb-textMuted);
  white-space: nowrap;
`;

/**
 * One row per source folder. Blank rows show the first configured value so the
 * UI matches the backend's "reuse the first preset" padding.
 */
export const AlignedRowsEditor: React.FC<AlignedRowsEditorProps> = ({
  id,
  value,
  onChange,
  sourceRows,
  variant,
  scan,
  presetsLoading,
}) => {
  const { formatMessage } = useIntl();
  const values = parseMappedRows(value);
  const fieldLabel = formatMessage(
    variant === 'preset'
      ? settingsMessages.standardPresets
      : variant === 'suffix'
        ? settingsMessages.suffixRows
        : variant === 'ffmpeg-args'
          ? settingsMessages.ffmpegArguments
          : settingsMessages.customPresets,
  );
  const firstValue = values.find((row) => row.trim().length > 0) ?? '';
  const rowCount = Math.max(sourceRows.length, values.length, 1);
  const rows = Array.from({ length: rowCount }, (_, index) =>
    variant === 'suffix' ? (values[index] ?? '') : values[index] || firstValue,
  );

  const write = (index: number, nextValue: string) => {
    const next = [...rows];
    next[index] = nextValue;
    if (variant !== 'suffix') {
      // A blank preset/argument row reuses the first configured value, which is
      // exactly what the backend pads with. Persist that explicitly so the file
      // never contains a hole that the backend would read as an empty preset.
      const fallback = next.map((row) => row.trim()).find(Boolean) ?? '';
      for (let rowIndex = 0; rowIndex < next.length; rowIndex += 1) {
        if (!next[rowIndex].trim()) next[rowIndex] = fallback;
      }
    }
    onChange(serializeMappedRows(next));
  };

  const removeOrphan = (index: number) => {
    onChange(
      serializeMappedRows(values.filter((_row, rowIndex) => rowIndex !== index)),
    );
  };

  return (
    <Rows>
      {rows.map((rowValue, index) => {
        const source = sourceRows[index];
        const orphan = sourceRows.length > 0 && index >= sourceRows.length;
        const rowId = `${id}-${index}`;
        const rowFieldLabel = source
          ? formatMessage(settingsMessages.folderFieldLabel, {
              number: index + 1,
              field: fieldLabel,
            })
          : fieldLabel;

        return (
          <RowCard key={index}>
            <RowLabel>
              <RowTitle>
                {source
                  ? formatMessage(settingsMessages.folderNumber, { number: index + 1 })
                  : formatMessage(settingsMessages.allFolders)}
              </RowTitle>
              {source && <RowPath title={source}>{source}</RowPath>}
            </RowLabel>

            {variant === 'preset' || variant === 'handbrake-args' ? (
              <PresetSelect
                id={rowId}
                ariaLabel={rowFieldLabel}
                value={rowValue}
                onChange={(next) => write(index, next)}
                scan={scan}
                loading={presetsLoading}
              />
            ) : variant === 'ffmpeg-args' ? (
              <Pair>
                <Prefix>
                  <PrefixLabel>
                    {formatMessage(settingsMessages.beforeInput)}
                  </PrefixLabel>
                  <Form.Control
                    id={`${rowId}-input`}
                    aria-label={formatMessage(
                      settingsMessages.folderFieldPartLabel,
                      {
                        number: index + 1,
                        part: formatMessage(settingsMessages.beforeInput),
                      },
                    )}
                    value={parseCommandPair(rowValue).input}
                    placeholder="-ss 00:00:10"
                    onChange={(event) =>
                      write(
                        index,
                        serializeCommandPair({
                          input: event.target.value,
                          output: parseCommandPair(rowValue).output,
                        }),
                      )
                    }
                  />
                </Prefix>
                <Prefix>
                  <PrefixLabel>
                    {formatMessage(settingsMessages.afterInput)}
                  </PrefixLabel>
                  <Form.Control
                    id={`${rowId}-output`}
                    aria-label={formatMessage(
                      settingsMessages.folderFieldPartLabel,
                      {
                        number: index + 1,
                        part: formatMessage(settingsMessages.afterInput),
                      },
                    )}
                    value={parseCommandPair(rowValue).output}
                    placeholder="-c:v libx264 -crf 20"
                    onChange={(event) =>
                      write(
                        index,
                        serializeCommandPair({
                          input: parseCommandPair(rowValue).input,
                          output: event.target.value,
                        }),
                      )
                    }
                  />
                </Prefix>
              </Pair>
            ) : (
              <Form.Control
                id={rowId}
                aria-label={rowFieldLabel}
                value={rowValue}
                placeholder="_720p"
                onChange={(event) => write(index, event.target.value)}
              />
            )}

            {orphan ? (
              <Button
                compact
                variant="ghost"
                onClick={() => removeOrphan(index)}
                aria-label={formatMessage(settingsMessages.removeOrphanRow)}
                title={formatMessage(settingsMessages.noMatchingSource)}
              >
                ×
              </Button>
            ) : (
              <span />
            )}

            {orphan && (
              <InlineNote $tone="warning" style={{ gridColumn: '1 / -1' }}>
                {formatMessage(settingsMessages.noMatchingSource)}
              </InlineNote>
            )}
          </RowCard>
        );
      })}
    </Rows>
  );
};
