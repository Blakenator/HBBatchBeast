import React from 'react';
import { Form } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { GlobalSettingsConfig } from '../../common';
import { Field, Help, Label } from './FieldLayout';
import { settingsMessages } from './messages';

interface GlobalSystemSettingsProps {
  value: GlobalSettingsConfig;
  onChange: (value: Partial<GlobalSettingsConfig>) => void;
}

export const GlobalSystemSettings: React.FC<GlobalSystemSettingsProps> = ({
  value,
  onChange,
}) => {
  const { formatMessage } = useIntl();

  return (
    <>
      <Field>
        <Label htmlFor="global-worker-count">
          {formatMessage(settingsMessages.workerProcesses)}
        </Label>
        <Form.Control
          id="global-worker-count"
          type="number"
          min={1}
          max={32}
          value={value.worker_instance_number}
          onChange={(event) =>
            onChange({ worker_instance_number: event.target.value })
          }
        />
        <Help>{formatMessage(settingsMessages.workerProcessesHelp)}</Help>
      </Field>

      <Field>
        <Form.Check
          id="global-save-worker-logs"
          type="switch"
          checked={value.save_worker_logs_toggle === 1}
          label={formatMessage(settingsMessages.saveWorkerLogs)}
          onChange={(event) =>
            onChange({ save_worker_logs_toggle: event.target.checked ? 1 : 0 })
          }
        />
        <Help>{formatMessage(settingsMessages.saveWorkerLogsHelp)}</Help>
      </Field>
    </>
  );
};
