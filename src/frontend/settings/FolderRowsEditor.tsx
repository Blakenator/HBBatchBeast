import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { parseMappedRows, serializeMappedRows } from '../../common';
import { Button } from '../ui/Button';
import { OpenFolderButton } from '../ui/OpenFolderButton';
import { isInside } from '../run/validation';
import { BrowseButton } from './PathInput';
import { Help, InlineNote } from './FieldLayout';
import { folderRowPreview, sharedDestinationRows } from './folderRowPreview';
import { settingsMessages } from './messages';

export interface FolderRowPaths {
  source: string;
  destination: string;
  temp: string;
}

interface FolderRow {
  source: string;
  destination: string;
  temp: string;
}

interface FolderRowsEditorProps {
  id: string;
  sourcePath: string;
  destinationPath: string;
  tempPath: string;
  tempEnabled: boolean;
  /** Container extension used for the output preview. */
  container: string;
  /** Per-row filename suffixes, aligned with the source rows. */
  suffixes: string[];
  paths: FolderRowPaths;
  onChange: (updates: Record<string, string>) => void;
}

const Rows = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
`;

const RowCard = styled.div`
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  padding: var(--hb-space-sm);
  background: var(--hb-surfaceMuted);
`;

const RowHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hb-space-sm);
  margin-bottom: var(--hb-space-xs);
`;

const RowTitle = styled.span`
  font-size: var(--hb-font-xs);
  font-weight: 600;
  color: var(--hb-textMuted);
`;

const FieldLine = styled.div`
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--hb-space-xs);

  & + & {
    margin-top: var(--hb-space-xs);
  }
`;

const FieldName = styled.label`
  font-size: var(--hb-font-xs);
  color: var(--hb-textMuted);
`;

const FieldActions = styled.div`
  display: flex;
  gap: var(--hb-space-xs);
`;

const Actions = styled.div`
  display: flex;
  gap: var(--hb-space-xs);
  flex-wrap: wrap;
  margin-top: var(--hb-space-sm);
`;

const Preview = styled.div`
  display: grid;
  gap: 2px;
  margin-top: var(--hb-space-xs);
  padding-left: var(--hb-space-sm);
  border-left: 2px solid var(--hb-border);
  font-size: var(--hb-font-xs);
  color: var(--hb-textMuted);
`;

const PreviewLine = styled.span`
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PreviewLabel = styled.span`
  font-weight: 600;
`;

const NoteLine = styled(InlineNote)`
  display: block;
  margin-top: var(--hb-space-xs);
`;

const blankRow = (): FolderRow => ({ source: '', destination: '', temp: '' });

function buildRows(
  sourcePath: string,
  destinationPath: string,
  tempPath: string,
  tempEnabled: boolean,
): FolderRow[] {
  const sources = parseMappedRows(sourcePath);
  const destinations = parseMappedRows(destinationPath);
  const temp = tempEnabled ? parseMappedRows(tempPath) : [];
  const count = Math.max(sources.length, destinations.length, temp.length, 1);
  return Array.from({ length: count }, (_, index) => ({
    source: sources[index] ?? '',
    destination: destinations[index] ?? '',
    temp: temp[index] ?? '',
  }));
}

/**
 * Paired source/destination rows with an optional temp column. Rows are written
 * to the stored newline fields together so removing or inserting a row can never
 * shift the other column (design intent D7).
 */
export const FolderRowsEditor: React.FC<FolderRowsEditorProps> = ({
  id,
  sourcePath,
  destinationPath,
  tempPath,
  tempEnabled,
  container,
  suffixes,
  paths,
  onChange,
}) => {
  const { formatMessage } = useIntl();
  const [rows, setRows] = useState<FolderRow[]>(() =>
    buildRows(sourcePath, destinationPath, tempPath, tempEnabled),
  );
  const pushedKey = useRef<string | null>(null);

  const propKey = [tempEnabled, sourcePath, destinationPath, tempPath].join('\u0000');

  useEffect(() => {
    if (pushedKey.current === propKey) {
      pushedKey.current = null;
      return;
    }
    setRows(buildRows(sourcePath, destinationPath, tempPath, tempEnabled));
  }, [propKey, destinationPath, sourcePath, tempEnabled, tempPath]);

  const persist = (nextRows: FolderRow[]) => {
    const updates: Record<string, string> = {
      [paths.source]: serializeMappedRows(nextRows.map((row) => row.source)),
      [paths.destination]: serializeMappedRows(
        nextRows.map((row) => row.destination),
      ),
    };
    if (tempEnabled) {
      updates[paths.temp] = serializeMappedRows(nextRows.map((row) => row.temp));
    }
    const nextTemp = updates[paths.temp] ?? tempPath;
    pushedKey.current = [
      tempEnabled,
      updates[paths.source],
      updates[paths.destination],
      nextTemp,
    ].join('\u0000');
    setRows(nextRows);
    onChange(updates);
  };

  const updateRow = (index: number, key: keyof FolderRow, value: string) => {
    persist(
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row,
      ),
    );
  };

  const handlePaste = (
    event: React.ClipboardEvent<HTMLElement>,
    index: number,
    key: keyof FolderRow,
  ) => {
    const text = event.clipboardData.getData('text');
    if (!/[\r\n]/.test(text)) return;
    event.preventDefault();
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const nextRows = [...rows];
    lines.forEach((line, offset) => {
      const target = index + offset;
      while (nextRows.length <= target) nextRows.push(blankRow());
      nextRows[target] = { ...nextRows[target], [key]: line };
    });
    persist(nextRows);
  };

  const addRow = () => setRows((recent) => [...recent, blankRow()]);

  const addFolders = (folders: string[]) => {
    const nextRows = [...rows];
    let folderIndex = 0;

    if (nextRows.length === 1 && nextRows[0].source === '') {
      nextRows[0] = { ...nextRows[0], source: folders[0] };
      folderIndex = 1;
    }
    for (; folderIndex < folders.length; folderIndex += 1) {
      nextRows.push({ ...blankRow(), source: folders[folderIndex] });
    }
    persist(nextRows);
  };

  const removeRow = (index: number) => {
    const nextRows = rows.filter((_row, rowIndex) => rowIndex !== index);
    persist(nextRows.length > 0 ? nextRows : [blankRow()]);
  };

  const rowIssues = (row: FolderRow): string | null => {
    if (!row.source && !row.destination && (!tempEnabled || !row.temp)) {
      return null;
    }
    if (!row.source) return formatMessage(settingsMessages.missingSource);
    if (!row.destination) {
      return formatMessage(settingsMessages.missingDestination);
    }
    if (isInside(row.destination, row.source)) {
      return formatMessage(settingsMessages.destinationInsideSource);
    }
    if (tempEnabled && !row.temp) {
      return formatMessage(settingsMessages.missingTemp);
    }
    return null;
  };

  const sharedDestinations = sharedDestinationRows(
    rows.map((row) => row.destination),
  );

  return (
    <div>
      <Rows>
        {rows.map((row, index) => {
          const issue = rowIssues(row);
          const preview = folderRowPreview({
            destination: row.destination,
            suffix: suffixes[index] ?? '',
            container,
          });
          const sharedWith = sharedDestinations.get(index) ?? [];
          return (
            <RowCard key={index}>
              <RowHead>
                <RowTitle>
                  {formatMessage(settingsMessages.rowLabel, { number: index + 1 })}
                </RowTitle>
                <Button
                  compact
                  variant="ghost"
                  onClick={() => removeRow(index)}
                  disabled={rows.length === 1 && !row.source}
                  aria-label={formatMessage(settingsMessages.removeRow, {
                    number: index + 1,
                  })}
                >
                  {formatMessage(settingsMessages.remove)}
                </Button>
              </RowHead>

              <FieldLine>
                <FieldName htmlFor={`${id}-source-${index}`}>
                  {formatMessage(settingsMessages.sourceFolder)}
                </FieldName>
                <Form.Control
                  id={`${id}-source-${index}`}
                  value={row.source}
                  placeholder="/media/movies"
                  onChange={(event) =>
                    updateRow(index, 'source', event.target.value)
                  }
                  onPaste={(event) => handlePaste(event, index, 'source')}
                />
                <FieldActions>
                  <BrowseButton
                    kind="folder"
                    title={formatMessage(settingsMessages.pickSourceFolder)}
                    defaultPath={row.source}
                    label="…"
                    onPick={(selected) => {
                      if (selected.length === 1) {
                        updateRow(index, 'source', selected[0]);
                      } else {
                        addFolders(selected);
                      }
                    }}
                  />
                  <OpenFolderButton
                    path={row.source}
                    label={formatMessage(settingsMessages.open)}
                    title={formatMessage(settingsMessages.openSourceFolder)}
                    failureMessage={formatMessage(
                      settingsMessages.openFolderFailed,
                    )}
                  />
                </FieldActions>
              </FieldLine>

              <FieldLine>
                <FieldName htmlFor={`${id}-destination-${index}`}>
                  {formatMessage(settingsMessages.destinationFolder)}
                </FieldName>
                <Form.Control
                  id={`${id}-destination-${index}`}
                  value={row.destination}
                  placeholder="/media/converted/movies"
                  onChange={(event) =>
                    updateRow(index, 'destination', event.target.value)
                  }
                  onPaste={(event) => handlePaste(event, index, 'destination')}
                />
                <FieldActions>
                  <BrowseButton
                    kind="folder"
                    title={formatMessage(settingsMessages.pickDestinationFolder)}
                    defaultPath={row.destination}
                    label="…"
                    onPick={(selected) =>
                      updateRow(index, 'destination', selected[0] ?? '')
                    }
                  />
                  <OpenFolderButton
                    path={row.destination}
                    label={formatMessage(settingsMessages.open)}
                    title={formatMessage(settingsMessages.openDestinationFolder)}
                    failureMessage={formatMessage(
                      settingsMessages.openFolderFailed,
                    )}
                  />
                </FieldActions>
              </FieldLine>

              {tempEnabled && (
                <FieldLine>
                  <FieldName htmlFor={`${id}-temp-${index}`}>
                    {formatMessage(settingsMessages.tempFolder)}
                  </FieldName>
                  <Form.Control
                    id={`${id}-temp-${index}`}
                    value={row.temp}
                    placeholder="/media/temp"
                    onChange={(event) =>
                      updateRow(index, 'temp', event.target.value)
                    }
                    onPaste={(event) => handlePaste(event, index, 'temp')}
                  />
                  <BrowseButton
                    kind="folder"
                    title={formatMessage(settingsMessages.pickTempFolder)}
                    defaultPath={row.temp}
                    label="…"
                    onPick={(selected) =>
                      updateRow(index, 'temp', selected[0] ?? '')
                    }
                  />
                </FieldLine>
              )}

              {preview && (
                <Preview title={`${preview.sample} → ${preview.output}`}>
                  <PreviewLabel>
                    {formatMessage(settingsMessages.folderPreviewLabel)}
                  </PreviewLabel>
                  <PreviewLine>{preview.sample}</PreviewLine>
                  <PreviewLine>→ {preview.output}</PreviewLine>
                </Preview>
              )}

              {sharedWith.length > 0 && (
                <NoteLine $tone="warning">
                  {formatMessage(
                    sharedWith.length === 1
                      ? settingsMessages.sharedDestinationWarningOne
                      : settingsMessages.sharedDestinationWarningMany,
                    { rows: sharedWith.map((other) => other + 1).join(', ') },
                  )}
                </NoteLine>
              )}

              {issue && <NoteLine $tone="warning">{issue}</NoteLine>}
            </RowCard>
          );
        })}
      </Rows>

      <Actions>
        <Button compact variant="ghost" onClick={addRow}>
          {formatMessage(settingsMessages.addRow)}
        </Button>
        <BrowseButton
          kind="folder"
          multiple
          label={formatMessage(settingsMessages.addFolders)}
          title={formatMessage(settingsMessages.pickSourceFolders)}
          onPick={addFolders}
        />
      </Actions>

      <Help>{formatMessage(settingsMessages.folderRowsHelp)}</Help>
    </div>
  );
};
