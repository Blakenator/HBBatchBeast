import React, { useState } from 'react';
import styled from 'styled-components';
import { Form, Modal } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { AppConfigV2, Library, withLibraryMediaType } from '../../../common';
import { Button } from '../../ui/Button';
import { Combobox } from '../../ui/Combobox';
import { SegmentedControl } from '../SegmentedControl';
import { libraryMessages } from './messages';

const Card = styled.section`
  display: grid;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-md);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surface);
`;

const SelectorRow = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
  }
`;

const Field = styled.div`
  display: grid;
  gap: var(--hb-space-xs);
`;

const IdentityRow = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
`;

const Summary = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--hb-space-xs);
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

const TypeChip = styled.span`
  padding: 0 var(--hb-space-xs);
  border: 1px solid var(--hb-border);
  border-radius: 999px;
  font-size: var(--hb-font-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const Dot = styled.span`
  color: var(--hb-textMuted);
`;

const ActionRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--hb-space-sm);
  padding-top: var(--hb-space-sm);
  border-top: 1px dashed var(--hb-border);
`;

const Spacer = styled.div`
  flex: 1;
`;

interface LibraryHeaderProps {
  config: AppConfigV2;
  library?: Library;
  onSelect: (libraryId: string) => void;
  onCreate: () => void;
  onDuplicate: () => void;
  onChange: (library: Library) => void;
  onDelete: () => void;
}

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Library switcher plus the identity fields shared by every library setting
 * section. Both the Encoding and Organizer sub-tabs render below this header.
 */
export const LibraryHeader: React.FC<LibraryHeaderProps> = ({
  config,
  library,
  onSelect,
  onCreate,
  onDuplicate,
  onChange,
  onDelete,
}) => {
  const { formatMessage } = useIntl();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const displayName =
    library?.name.trim() || libraryMessages.untitled.defaultMessage;
  const preset = config.presets.find(
    (candidate) => candidate.id === library?.defaultPresetId,
  );
  const isTv = library?.mediaType === 'tv';

  return (
    <Card>
      <SelectorRow>
        <Field>
          <Form.Label htmlFor="library-select" className="mb-0">
            {formatMessage(libraryMessages.library)}
          </Form.Label>
          <Combobox
            id="library-select"
            value={library?.id ?? ''}
            ariaLabel={formatMessage(libraryMessages.library)}
            options={config.libraries.map((candidate) => ({
              value: candidate.id,
              label:
                candidate.name.trim() ||
                libraryMessages.untitled.defaultMessage,
            }))}
            onChange={onSelect}
          />
        </Field>
        <Button icon="add" onClick={onCreate}>
          {formatMessage(libraryMessages.add)}
        </Button>
      </SelectorRow>

      {library && (
        <>
          <Summary>
            <TypeChip>{isTv ? 'TV' : 'Movies'}</TypeChip>
            <span>{countLabel(library.folders.length, 'folder')}</span>
            <Dot>·</Dot>
            <span>
              {countLabel(library.mappingRules.length, 'mapping rule')}
            </span>
            <Dot>·</Dot>
            <span>
              {preset
                ? `Default preset: ${preset.name}`
                : formatMessage(libraryMessages.noDefaultPreset)}
            </span>
          </Summary>

          <IdentityRow>
            <Field>
              <Form.Label htmlFor="library-name" className="mb-0">
                {formatMessage(libraryMessages.name)}
              </Form.Label>
              <Form.Control
                id="library-name"
                value={library.name}
                onChange={(event) =>
                  onChange({ ...library, name: event.target.value })
                }
              />
            </Field>
            <Field>
              <Form.Label className="mb-0">
                {formatMessage(libraryMessages.type)}
              </Form.Label>
              <SegmentedControl
                label={formatMessage(libraryMessages.type)}
                value={isTv ? 'tv' : 'movies'}
                onChange={(value) =>
                  onChange(
                    withLibraryMediaType(
                      library,
                      value === 'tv' ? 'tv' : 'movies',
                    ),
                  )
                }
                options={[
                  {
                    value: 'movies',
                    label: formatMessage(libraryMessages.movies),
                  },
                  { value: 'tv', label: formatMessage(libraryMessages.tv) },
                ]}
              />
            </Field>
          </IdentityRow>

          <ActionRow>
            <Button compact variant="ghost" icon="copy" onClick={onDuplicate}>
              {formatMessage(libraryMessages.duplicate)}
            </Button>
            <Spacer />
            <Button
              compact
              variant="dangerOutline"
              icon="delete"
              onClick={() => setConfirmingDelete(true)}
              disabled={config.libraries.length <= 1}
              title={
                config.libraries.length <= 1
                  ? formatMessage(libraryMessages.cannotDeleteLast)
                  : undefined
              }
            >
              {formatMessage(libraryMessages.remove)}
            </Button>
          </ActionRow>
        </>
      )}

      <Modal
        show={confirmingDelete}
        onHide={() => setConfirmingDelete(false)}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>
            {formatMessage(libraryMessages.deleteTitle)}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {formatMessage(libraryMessages.deleteBody, { name: displayName })}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => setConfirmingDelete(false)}
          >
            {formatMessage(libraryMessages.cancel)}
          </Button>
          <Button
            variant="danger"
            icon="delete"
            onClick={() => {
              setConfirmingDelete(false);
              onDelete();
            }}
          >
            {formatMessage(libraryMessages.remove)}
          </Button>
        </Modal.Footer>
      </Modal>
    </Card>
  );
};
