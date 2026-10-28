import React, { createContext, useContext } from 'react';
import { Form } from 'react-bootstrap';
import { FolderPair } from '../../common';
import { Combobox } from '../ui/Combobox';
import {
  FilterFieldDefinition,
  FilterValueEditorProps,
} from '../ui/filterBuilder/types';
import { scanFilterFields } from './scanFilterFields';
import { settingsMessages } from './messages';

export const FolderContext = createContext<FolderPair[]>([]);

export const MappingFolderProvider: React.FC<{
  folders: FolderPair[];
  children: React.ReactNode;
}> = ({ folders, children }) => (
  <FolderContext.Provider value={folders}>{children}</FolderContext.Provider>
);

const folderLabel = (folder: FolderPair, index: number): string => {
  const name = folder.source.split(/[\\/]/).filter(Boolean).pop();
  return name ? `${index + 1}. ${name}` : `Folder ${index + 1}`;
};

const FolderValueEditor: React.FC<FilterValueEditorProps> = ({
  id,
  value,
  onChange,
  disabled,
}) => {
  const folders = useContext(FolderContext);
  const current = (value ?? {}) as { folderId?: string; subpath?: string };
  const update = (next: Partial<{ folderId: string; subpath: string }>) =>
    onChange({
      folderId: current.folderId ?? '',
      subpath: current.subpath ?? '',
      ...next,
    });

  return (
    <div style={{ display: 'grid', gap: 'var(--hb-space-xs)' }}>
      <Combobox
        id={`${id}-folder`}
        value={current.folderId ?? ''}
        options={folders.map((folder, index) => ({
          value: folder.id,
          label: folderLabel(folder, index),
          title: folder.source,
        }))}
        onChange={(folderId) => update({ folderId })}
        ariaLabel="Library folder"
        disabled={disabled}
      />
      <Form.Control
        value={current.subpath ?? ''}
        disabled={disabled}
        placeholder="Optional subfolder, e.g. Movies"
        aria-label="Subfolder"
        onChange={(event) => update({ subpath: event.target.value })}
      />
    </div>
  );
};

const folderField: FilterFieldDefinition = {
  id: 'folder',
  category: settingsMessages.mappingFolderCategory,
  label: settingsMessages.mappingFolder,
  description: settingsMessages.mappingFolderDescription,
  defaultOperator: 'is',
  createValue: () => ({ folderId: '', subpath: '' }),
  renderValueEditor: FolderValueEditor,
  operators: [
    {
      id: 'is',
      label: settingsMessages.mappingFolderIs,
      valueKind: 'none',
    },
    {
      id: 'isUnder',
      label: settingsMessages.mappingFolderIsUnder,
      valueKind: 'none',
    },
  ],
};

const byId = (id: string) =>
  scanFilterFields.find((field) => field.id === id) as FilterFieldDefinition;

/** Mapping-specific catalog: no output state (only runnable files map). */
export const mappingFilterFields: FilterFieldDefinition[] = [
  byId('mediaProperty'),
  folderField,
  byId('fileName'),
  byId('fileSize'),
  byId('fileType'),
];
