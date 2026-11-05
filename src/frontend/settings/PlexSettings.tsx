import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { Alert, Form } from 'react-bootstrap';
import {
  PROMISE_CHANNEL,
  type OrganizePlexCheck,
  type PlexConnectionSettings,
  type PlexFixStep,
} from '../../common';
import { useBackend, backendFailure, backendErrorMessage } from '../helpers';
import { Button } from '../ui/Button';
import { PlexStatusReport } from '../ui/PlexStatusReport';
import { PathInput } from './PathInput';

const Wrap = styled.section`
  display: grid;
  gap: var(--hb-space-sm);
  padding: var(--hb-space-md);
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  background: var(--hb-surface);
  margin-top: var(--hb-space-lg);
`;

const Title = styled.h3`
  margin: 0;
  font-size: var(--hb-font-sm);
  font-weight: 600;
`;

const Muted = styled.p`
  margin: 0;
  color: var(--hb-textMuted);
  font-size: var(--hb-font-xs);
`;

interface PlexSettingsProps {
  value?: PlexConnectionSettings;
  onChange: (value: PlexConnectionSettings | undefined) => void;
}

/**
 * One Plex server per machine. The organizer reads library paths from this
 * database and optionally updates them (plus watch history) after a rename.
 */
export const PlexSettings: React.FC<PlexSettingsProps> = ({
  value,
  onChange,
}) => {
  const environment = useBackend({
    channel: PROMISE_CHANNEL.OrganizeGetPlexEnvironment,
  });
  const check = useBackend({
    channel: PROMISE_CHANNEL.OrganizeCheckPlex,
    skip: true,
  });
  const fix = useBackend({
    channel: PROMISE_CHANNEL.OrganizeFixPlex,
    skip: true,
  });
  const [status, setStatus] = useState<OrganizePlexCheck>();
  const [fixSteps, setFixSteps] = useState<PlexFixStep[]>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const candidates = environment.data?.databaseCandidates ?? [];

  useEffect(() => {
    setStatus(undefined);
    setFixSteps(undefined);
    setError(undefined);
  }, [value?.dbPath]);

  const dbPath = value?.dbPath ?? '';
  const update = (patch: Partial<PlexConnectionSettings>) =>
    onChange({
      dbPath,
      updateByDefault: value?.updateByDefault ?? false,
      ...patch,
    });

  const runCheck = async () => {
    if (!dbPath.trim()) return;
    setBusy(true);
    setError(undefined);
    setFixSteps(undefined);
    try {
      const result = await check.refetch({ path: dbPath });
      const failure = backendFailure(result, 'Could not check the Plex database.');
      if (failure) {
        setError(failure);
        return;
      }
      setStatus(result.data);
    } finally {
      setBusy(false);
    }
  };

  const runAutoFix = async () => {
    if (!dbPath.trim()) return;
    setFixing(true);
    setError(undefined);
    setFixSteps(undefined);
    try {
      const result = await fix.refetch({ path: dbPath });
      const failure = backendFailure(
        result,
        'Could not fix the Plex database access.',
      );
      if (failure) {
        setError(failure);
        return;
      }
      if (result.data) {
        setStatus(result.data.check);
        setFixSteps(result.data.steps);
      }
    } finally {
      setFixing(false);
    }
  };

  return (
    <Wrap>
      <Title>Plex integration</Title>
      <Muted>
        Shared by every library. Used to read existing paths and, when enabled
        during an organize run, to update them and keep watch history.
      </Muted>
      <Form.Group>
        <Form.Label>Plex database</Form.Label>
        <PathInput
          id="plex-database-path"
          kind="file"
          title="Choose com.plexapp.plugins.library.db"
          value={dbPath}
          placeholder="Path to com.plexapp.plugins.library.db"
          allowClear
          onChange={(path) => {
            if (!path) onChange(undefined);
            else update({ dbPath: path });
          }}
        />
        {candidates.length > 0 && candidates[0] !== dbPath && (
          <Form.Text muted>
            Detected:{' '}
            <button
              type="button"
              className="btn btn-link btn-sm p-0 align-baseline"
              onClick={() => onChange({ dbPath: candidates[0], updateByDefault: value?.updateByDefault ?? false })}
            >
              {candidates[0]}
            </button>
          </Form.Text>
        )}
      </Form.Group>
      <Form.Check
        id="plex-update-default"
        type="switch"
        checked={value?.updateByDefault ?? false}
        disabled={!dbPath.trim()}
        label="Update Plex by default when organizing"
        onChange={(event) => update({ updateByDefault: event.target.checked })}
      />
      <div>
        <Button
          compact
          variant="secondary"
          icon="scan"
          onClick={() => void runCheck()}
          disabled={!dbPath.trim() || busy}
        >
          {busy ? 'Checking…' : 'Check database'}
        </Button>
      </div>
      {error && (
        <Alert variant="danger" className="mb-0">
          {error}
        </Alert>
      )}
      {status && (
        <PlexStatusReport
          check={status}
          fixing={fixing}
          fixSteps={fixSteps}
          onAutoFix={() => void runAutoFix()}
        />
      )}
      {environment.error && (
        <Muted>
          Could not look for a Plex database automatically:{' '}
          {backendErrorMessage(environment.error) ?? 'unknown error'}
        </Muted>
      )}
    </Wrap>
  );
};
