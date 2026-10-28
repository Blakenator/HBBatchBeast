import React from 'react';
import styled from 'styled-components';
import { Alert, Form } from 'react-bootstrap';
import {
  AppConfigV2,
  BatchConfig,
  BatchTabConfig,
  FolderPair,
  Library,
  createFolderId,
  libraryPresetIds,
  outputContainerExtension,
  presetMatchesEncoder,
  validateLibrary,
} from '../../../common';
import { usesHardwarePreset } from '../presetWarnings';
import { Combobox } from '../../ui/Combobox';
import { FilterTab } from '../FilterTab';
import { FolderRowsEditor } from '../FolderRowsEditor';
import { AlignedRowsEditor } from '../AlignedRowsEditor';
import { MappingRulesEditor } from './MappingRulesEditor';
import { PathInput } from '../PathInput';

const Wrap = styled.div`
  display: grid;
  gap: var(--hb-space-md);
`;

const Section = styled.section`
  display: grid;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-md);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surface);
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: var(--hb-font-sm);
  font-weight: 600;
`;

const TwoColumns = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--hb-space-sm);
`;

const CONTAINERS: Record<'handbrake' | 'ffmpeg', string[]> = {
  handbrake: ['.mp4', '.mkv', '.m4v'],
  ffmpeg: ['.mp4', '.mkv', '.m4v', '.webm', '.mov', '.avi'],
};

interface LibraryEditorProps {
  config: AppConfigV2;
  library: Library;
  onChange: (library: Library) => void;
  /** Quick conversion keeps the safe defaults and hides destructive controls. */
  showFileHandling?: boolean;
}

function rows(value: string): string[] {
  return value.split('\n').map((row) => row.trim());
}

function folderField(library: Library, key: 'source' | 'destination' | 'temp') {
  return library.folders.map((folder) => folder[key] ?? '').join('\n');
}

export const LibraryEditor: React.FC<LibraryEditorProps> = ({
  config,
  library,
  onChange,
  showFileHandling = true,
}) => {
  const encoderPresets = config.presets.filter((preset) =>
    presetMatchesEncoder(preset, library.encoder),
  );
  const problems = validateLibrary(library, config.presets);
  const usedPresetIds = libraryPresetIds(library);
  const usesHardware = config.presets.some(
    (preset) => usedPresetIds.has(preset.id) && usesHardwarePreset(preset),
  );
  const sources = library.folders.map((folder) => folder.source);
  const suffixes = library.folders.map((folder) => folder.suffix ?? '');

  const updateFolders = (updates: Record<string, string>) => {
    const sourceRows = rows(updates.source ?? folderField(library, 'source'));
    const destinationRows = rows(
      updates.destination ?? folderField(library, 'destination'),
    );
    const tempEnabled = library.defaults.temp_toggle === 1;
    const tempRows = tempEnabled
      ? rows(updates.temp ?? folderField(library, 'temp'))
      : [];
    const count = Math.max(
      sourceRows.length,
      destinationRows.length,
      tempRows.length,
    );
    // Folder ids are referenced by mapping rules. Preserve them by matching
    // unchanged rows first, then fall back to positional reuse so an edit or a
    // removal does not silently repoint every rule.
    const remaining = new Set(library.folders.map((_, index) => index));
    const folders: FolderPair[] = Array.from({ length: count }, (_, index) => {
      const source = sourceRows[index] ?? '';
      const destination = destinationRows[index] ?? '';
      const temp = tempRows[index] ?? '';
      const exact = library.folders.findIndex(
        (folder, oldIndex) =>
          remaining.has(oldIndex) &&
          folder.source === source &&
          folder.destination === destination &&
          (folder.temp ?? '') === temp,
      );
      const oldIndex =
        exact !== -1
          ? exact
          : remaining.has(index)
            ? index
            : [...remaining][0];
      if (oldIndex === undefined) {
        return {
          id: createFolderId(),
          source,
          destination,
          ...(tempEnabled ? { temp } : {}),
        };
      }
      remaining.delete(oldIndex);
      const current = library.folders[oldIndex];
      return {
        id: current.id,
        source,
        destination,
        ...(tempEnabled ? { temp } : {}),
        ...(current.suffix ? { suffix: current.suffix } : {}),
      };
    });
    onChange({ ...library, folders });
  };

  const updateSuffixes = (value: string) => {
    const next = rows(value);
    onChange({
      ...library,
      folders: library.folders.map((folder, index) => ({
        ...folder,
        ...(next[index]?.trim() ? { suffix: next[index].trim() } : { suffix: undefined }),
      })),
    });
  };

  const changeEncoder = (next: 'handbrake' | 'ffmpeg') => {
    const compatible = config.presets.filter((preset) =>
      presetMatchesEncoder(preset, next),
    );
    const defaultPresetId = compatible.some(
      (preset) => preset.id === library.defaultPresetId,
    )
      ? library.defaultPresetId
      : compatible[0]?.id ?? '';
    const container = (CONTAINERS[next] as readonly string[]).includes(
      outputContainerExtension(library.container),
    )
      ? library.container
      : next === 'handbrake'
        ? '.mkv'
        : library.container;
    onChange({ ...library, encoder: next, defaultPresetId, container });
  };

  const filterAdapter: BatchConfig = {
    name: library.name,
    tab_batch: {
      advanced: {
        filter_expression: library.filters,
        copy_filtered_files_toggle:
          library.defaults.copy_filtered_files_toggle ?? 0,
        copy_srt_files_toggle: library.defaults.copy_srt_files_toggle ?? 0,
      } as BatchTabConfig['advanced'],
    },
  };

  return (
    <Wrap>
      <Section>
        <SectionTitle>Library</SectionTitle>
        <Form.Control
          value={library.name}
          aria-label="Library name"
          onChange={(event) =>
            onChange({ ...library, name: event.target.value })
          }
        />
      </Section>

      <Section>
        <SectionTitle>Folders</SectionTitle>
        <Form.Check
          id="library-temp-toggle"
          type="switch"
          checked={library.defaults.temp_toggle === 1}
          label="Stage conversions in temp folders"
          onChange={(event) =>
            onChange({
              ...library,
              defaults: {
                ...library.defaults,
                temp_toggle: event.target.checked ? 1 : 0,
              },
            })
          }
        />
        <FolderRowsEditor
          id={`library-${library.id}`}
          sourcePath={folderField(library, 'source')}
          destinationPath={folderField(library, 'destination')}
          tempPath={folderField(library, 'temp')}
          tempEnabled={library.defaults.temp_toggle === 1}
          container={outputContainerExtension(library.container)}
          suffixes={suffixes}
          paths={{
            source: 'source',
            destination: 'destination',
            temp: 'temp',
          }}
          onChange={updateFolders}
        />
      </Section>

      <Section>
        <SectionTitle>Encoding</SectionTitle>
        <TwoColumns>
          <div>
            <Form.Label>Encoder</Form.Label>
            <Combobox
              id="library-encoder"
              value={library.encoder}
              options={[
                { value: 'handbrake', label: 'HandBrake' },
                { value: 'ffmpeg', label: 'FFmpeg' },
              ]}
              onChange={(next) =>
                changeEncoder(next === 'ffmpeg' ? 'ffmpeg' : 'handbrake')
              }
            />
          </div>
          <div>
            <Form.Label>Container</Form.Label>
            <Combobox
              id="library-container"
              value={outputContainerExtension(library.container)}
              options={CONTAINERS[library.encoder].map((container) => ({
                value: container,
                label: container,
              }))}
              onChange={(container) =>
                onChange({ ...library, container })
              }
            />
          </div>
        </TwoColumns>

        {encoderPresets.length === 0 && (
          <Alert variant="warning" className="mb-0">
            Create a {library.encoder === 'handbrake' ? 'HandBrake' : 'FFmpeg'}{' '}
            preset in the Presets tab first.
          </Alert>
        )}
        {usesHardware && (
          <Alert variant="warning" className="mb-0">
            This library uses a hardware encoder preset. Hardware encoders
            usually serialize jobs, so keep the worker count low.
          </Alert>
        )}

        <div>
          <Form.Label>Filename suffix per folder (optional)</Form.Label>
          <AlignedRowsEditor
            id={`library-suffix-${library.id}`}
            value={suffixes.join('\n')}
            onChange={updateSuffixes}
            sourceRows={sources}
            variant="suffix"
          />
        </div>
      </Section>

      <Section>
        <SectionTitle>Default mapping rules</SectionTitle>
        <p
          style={{
            margin: 0,
            color: 'var(--hb-textMuted)',
            fontSize: 'var(--hb-font-xs)',
          }}
        >
          Rules are evaluated top to bottom; the first matching rule chooses the
          preset. Files that match nothing use the default preset.
        </p>
        <MappingRulesEditor
          key={library.id}
          rules={library.mappingRules}
          folders={library.folders}
          presets={config.presets}
          encoder={library.encoder}
          defaultPresetId={library.defaultPresetId}
          onDefaultPresetChange={(defaultPresetId) =>
            onChange({ ...library, defaultPresetId })
          }
          onChange={(mappingRules) => onChange({ ...library, mappingRules })}
        />
      </Section>

      <Section>
        <SectionTitle>Scan filters</SectionTitle>
        <FilterTab
          config={filterAdapter}
          onChange={(path, value) => {
            if (path.endsWith('filter_expression')) {
              onChange({ ...library, filters: value as Library['filters'] });
              return;
            }
            if (path.endsWith('copy_filtered_files_toggle')) {
              onChange({
                ...library,
                defaults: {
                  ...library.defaults,
                  copy_filtered_files_toggle: value as 0 | 1,
                },
              });
              return;
            }
            if (path.endsWith('copy_srt_files_toggle')) {
              onChange({
                ...library,
                defaults: {
                  ...library.defaults,
                  copy_srt_files_toggle: value as 0 | 1,
                },
              });
            }
          }}
        />
      </Section>

      {showFileHandling && (
      <Section>
        <SectionTitle>File handling</SectionTitle>
        {(
          [
            ['temp_marker_toggle', 'Mark in-progress conversions with .temp'],
            ['delete_source_files_toggle', 'Delete source files after a successful conversion'],
            ['replace_original_file_if_converted_is_smaller_toggle', 'Replace the original when the result is smaller'],
            ['replace_original_file_always_toggle', 'Always replace the original'],
            ['remove_filename_apostrophes', 'Remove apostrophes from filenames'],
            ['reverse_file_queue', 'Reverse the file queue'],
            ['low_process_priority_toggle', 'Run conversions at low priority'],
          ] as const
        ).map(([key, label]) => (
          <Form.Check
            key={key}
            id={`library-${key}`}
            type="switch"
            checked={library.defaults[key] === 1}
            label={label}
            onChange={(event) =>
              onChange({
                ...library,
                defaults: {
                  ...library.defaults,
                  [key]: event.target.checked ? 1 : 0,
                },
              })
            }
          />
        ))}
        <div>
          <Form.Label>Batch file to run after each file</Form.Label>
          <PathInput
            id="library-custom-bat"
            kind="file"
            title="Choose a batch file"
            value={library.defaults.custom_bat_path ?? ''}
            onChange={(custom_bat_path) =>
              onChange({
                ...library,
                defaults: { ...library.defaults, custom_bat_path },
              })
            }
            placeholder="Optional"
            allowClear
            filters={[
              { name: 'Batch scripts', extensions: ['bat', 'cmd', 'sh'] },
              { name: 'All files', extensions: ['*'] },
            ]}
          />
        </div>
      </Section>
      )}

      {problems.length > 0 && (
        <Alert variant="warning" className="mb-0">
          <strong>Fix these before running</strong>
          <ul className="mb-0">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Alert>
      )}
    </Wrap>
  );
};
