import React, { useState } from 'react';
import styled from 'styled-components';
import { Form, Modal } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { cloneDeep } from 'lodash';
import {
  PROMISE_CHANNEL,
  GlobalAppConfig,
  DEFAULT_INCLUDED_FILE_TYPES,
  DEFAULT_TEMP_MARKER_TOGGLE,
  BatchConfig,
  BatchTabConfig,
  defaultFilterExpression,
} from '../../../common';
import { useBackend } from '../../helpers';
import { useGlobalConfig, useSetGlobalConfigDirect } from '../../core/stores';
import { profileMessages } from './messages';
import { Button } from '../../ui/Button';
import { Combobox } from '../../ui/Combobox';

const Bar = styled.div`
  display: grid;
  gap: var(--hb-space-sm);
`;

const Actions = styled.div`
  display: flex;
  gap: var(--hb-space-sm);
  flex-wrap: wrap;
`;

function emptyProfile(name: string): BatchConfig {
  return {
    name,
    tab_batch: {
      container: '.mkv',
      // Profiles start sparse and fill in as the user edits them, so this is a
      // deliberately partial `advanced` block.
      advanced: {
        included_file_types: DEFAULT_INCLUDED_FILE_TYPES,
        temp_marker_toggle: DEFAULT_TEMP_MARKER_TOGGLE,
        filter_expression: defaultFilterExpression(),
      } as BatchTabConfig['advanced'],
    },
  };
}

export const ProfileBar: React.FC = () => {
  const { formatMessage } = useIntl();
  const config = useGlobalConfig();
  const setConfig = useSetGlobalConfigDirect();
  const save = useBackend({
    channel: PROMISE_CHANNEL.SaveConfiguration,
    skip: true,
  });
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  if (!config) return null;

  const persist = (next: GlobalAppConfig) => {
    setConfig(next);
    void save.refetch(next);
  };

  const select = (index: number) => persist({ ...config, selected_config: index });

  const add = () => {
    const profiles = [
      ...config.configs,
      emptyProfile(`Profile ${config.configs.length + 1}`),
    ];
    persist({ ...config, configs: profiles, selected_config: profiles.length - 1 });
  };

  const duplicate = () => {
    const source = config.configs[config.selected_config];
    const copy = cloneDeep(source);
    delete copy.tab_system;
    const profiles = [
      ...config.configs,
      copy,
    ];
    persist({ ...config, configs: profiles, selected_config: profiles.length - 1 });
  };

  const remove = () => {
    if (config.configs.length <= 1) return;
    const profiles = config.configs.filter(
      (_profile, index) => index !== config.selected_config,
    );
    persist({
      ...config,
      configs: profiles,
      selected_config: Math.max(0, config.selected_config - 1),
    });
  };

  const rename = () => {
    const profiles = config.configs.map((profile, index) =>
      index === config.selected_config
        ? { ...profile, name: nameDraft.trim() || profile.name }
        : profile,
    );
    persist({ ...config, configs: profiles });
    setRenaming(false);
  };

  return (
    <Bar>
      <Form.Label htmlFor="profile-select" className="mb-0">
        {formatMessage(profileMessages.active)}
      </Form.Label>
      <Combobox
        id="profile-select"
        value={String(config.selected_config)}
        options={config.configs.map((profile, index) => ({
          value: String(index),
          label: profile.name?.trim() || `Profile ${index + 1}`,
        }))}
        onChange={(next) => select(Number(next))}
      />

      <Actions>
        <Button compact variant="ghost" onClick={add}>
          {formatMessage(profileMessages.add)}
        </Button>
        <Button compact variant="ghost" onClick={duplicate}>
          {formatMessage(profileMessages.duplicate)}
        </Button>
        <Button
          compact
          variant="ghost"
          onClick={() => {
            const index = config.selected_config;
            setNameDraft(
              config.configs[index]?.name?.trim() || `Profile ${index + 1}`,
            );
            setRenaming(true);
          }}
        >
          {formatMessage(profileMessages.rename)}
        </Button>
        <Button
          compact
          variant="dangerOutline"
          onClick={remove}
          disabled={config.configs.length <= 1}
          title={
            config.configs.length <= 1
              ? formatMessage(profileMessages.cannotDeleteLast)
              : undefined
          }
        >
          {formatMessage(profileMessages.remove)}
        </Button>
      </Actions>

      <Modal show={renaming} onHide={() => setRenaming(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{formatMessage(profileMessages.rename)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Control
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            autoFocus
            aria-label={formatMessage(profileMessages.name)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setRenaming(false)}>
            {formatMessage(profileMessages.cancel)}
          </Button>
          <Button onClick={rename}>{formatMessage(profileMessages.save)}</Button>
        </Modal.Footer>
      </Modal>
    </Bar>
  );
};
