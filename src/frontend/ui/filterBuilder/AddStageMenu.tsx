import React, { useId, useMemo, useState } from 'react';
import styled from 'styled-components';
import { Form } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { Button } from '../Button';
import { filterBuilderMessages } from './messages';
import { FilterFieldDefinition } from './types';

const Menu = styled.div`
  flex: 1 1 100%;
  display: grid;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-sm);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-sm);
  background: var(--hb-surface);
  box-shadow: 0 8px 24px rgb(0 0 0 / 12%);
`;

const MenuHeader = styled.div`
  display: flex;
  align-items: center;
  gap: var(--hb-space-sm);
`;

const MenuTitle = styled.span`
  font-weight: 600;
  font-size: var(--hb-font-sm);
`;

const MenuBody = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
  max-height: 320px;
  overflow-y: auto;
`;

const Group = styled.div`
  display: grid;
  gap: 2px;
`;

const GroupTitle = styled.div`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: var(--hb-space-xs) var(--hb-space-sm) 0;
`;

const FieldButton = styled.button`
  display: grid;
  gap: 2px;
  text-align: left;
  border: 0;
  border-radius: var(--hb-radius-sm);
  background: transparent;
  color: var(--hb-text);
  font: inherit;
  padding: var(--hb-space-xs) var(--hb-space-sm);
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--hb-surfaceMuted);
    outline: none;
  }
`;

const FieldDescription = styled.span`
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

interface AddStageMenuProps {
  fields: FilterFieldDefinition[];
  label?: string;
  disabled?: boolean;
  onAdd: (field: FilterFieldDefinition) => void;
}

export const AddStageMenu: React.FC<AddStageMenuProps> = ({
  fields,
  label,
  disabled,
  onAdd,
}) => {
  const { formatMessage } = useIntl();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const panelId = useId();

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? fields.filter(
          (field) =>
            formatMessage(field.label).toLowerCase().includes(needle) ||
            field.id.toLowerCase().includes(needle),
        )
      : fields;
    const byCategory = new Map<string, FilterFieldDefinition[]>();
    for (const field of filtered) {
      const key = field.category.id;
      byCategory.set(key, [...(byCategory.get(key) ?? []), field]);
    }
    return [...byCategory.values()];
  }, [fields, formatMessage, query]);

  return (
    <div style={{ display: 'contents' }}>
      <Button
        compact
        variant="ghost"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((current) => !current);
          setQuery('');
        }}
      >
        {label ?? `+ ${formatMessage(filterBuilderMessages.addStage)}`}
      </Button>
      {open && (
        <Menu id={panelId} role="region" aria-label={formatMessage(filterBuilderMessages.addStage)}>
          <MenuHeader>
            <MenuTitle>{formatMessage(filterBuilderMessages.addStage)}</MenuTitle>
            <div style={{ flex: 1 }} />
            <Button
              compact
              variant="ghost"
              aria-label={formatMessage(filterBuilderMessages.closeMenu)}
              title={formatMessage(filterBuilderMessages.closeMenu)}
              onClick={() => setOpen(false)}
            >
              ×
            </Button>
          </MenuHeader>
          <Form.Control
            autoFocus
            value={query}
            placeholder={formatMessage(filterBuilderMessages.searchStages)}
            aria-label={formatMessage(filterBuilderMessages.searchStages)}
            onChange={(event) => setQuery(event.target.value)}
          />
          <MenuBody>
            {groups.length === 0 ? (
              <div style={{ color: 'var(--hb-textMuted)', fontSize: 'var(--hb-font-sm)' }}>
                {formatMessage(filterBuilderMessages.noMatchingStages)}
              </div>
            ) : (
              groups.map((groupFields) => (
                <Group key={groupFields[0].category.id}>
                  <GroupTitle>{formatMessage(groupFields[0].category)}</GroupTitle>
                  {groupFields.map((field) => (
                    <FieldButton
                      key={field.id}
                      type="button"
                      onClick={() => {
                        onAdd(field);
                        setOpen(false);
                      }}
                    >
                      <span>{formatMessage(field.label)}</span>
                      {field.description && (
                        <FieldDescription>
                          {formatMessage(field.description)}
                        </FieldDescription>
                      )}
                    </FieldButton>
                  ))}
                </Group>
              ))
            )}
          </MenuBody>
        </Menu>
      )}
    </div>
  );
};
