import React, { useState } from 'react';
import styled from 'styled-components';
import { Form, Modal } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { AppConfigV2 } from '../../../common';
import { Button } from '../../ui/Button';
import { Combobox } from '../../ui/Combobox';
import { libraryMessages } from './messages';

const Bar = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
`;

const Actions = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
`;

interface LibraryBarProps {
  config: AppConfigV2;
  onSelect: (libraryId: string) => void;
  onCreate: () => void;
  onDuplicate: () => void;
  onRename: (libraryId: string, name: string) => void;
  onDelete: () => void;
}

export const LibraryBar: React.FC<LibraryBarProps> = ({
  config,
  onSelect,
  onCreate,
  onDuplicate,
  onRename,
  onDelete,
}) => {
  const { formatMessage } = useIntl();
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const current =
    config.libraries.find(
      (library) => library.id === config.selected_library,
    ) ?? config.libraries[0];

  return (
    <Bar>
      <Form.Label htmlFor="library-select" className="mb-0">
        {formatMessage(libraryMessages.active)}
      </Form.Label>
      <Combobox
        id="library-select"
        value={config.selected_library}
        options={config.libraries.map((library) => ({
          value: library.id,
          label: library.name.trim() || 'Untitled library',
        }))}
        onChange={onSelect}
      />

      <Actions>
        <Button compact variant="ghost" onClick={onCreate}>
          {formatMessage(libraryMessages.add)}
        </Button>
        <Button compact variant="ghost" onClick={onDuplicate}>
          {formatMessage(libraryMessages.duplicate)}
        </Button>
        <Button
          compact
          variant="ghost"
          onClick={() => {
            setNameDraft(current?.name ?? '');
            setRenaming(true);
          }}
        >
          {formatMessage(libraryMessages.rename)}
        </Button>
        <Button
          compact
          variant="dangerOutline"
          onClick={onDelete}
          disabled={config.libraries.length <= 1}
          title={
            config.libraries.length <= 1
              ? formatMessage(libraryMessages.cannotDeleteLast)
              : undefined
          }
        >
          {formatMessage(libraryMessages.remove)}
        </Button>
      </Actions>

      <Modal show={renaming} onHide={() => setRenaming(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{formatMessage(libraryMessages.rename)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Control
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            autoFocus
            aria-label={formatMessage(libraryMessages.name)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setRenaming(false)}>
            {formatMessage(libraryMessages.cancel)}
          </Button>
          <Button
            onClick={() => {
              if (current) onRename(current.id, nameDraft);
              setRenaming(false);
            }}
          >
            {formatMessage(libraryMessages.save)}
          </Button>
        </Modal.Footer>
      </Modal>
    </Bar>
  );
};
