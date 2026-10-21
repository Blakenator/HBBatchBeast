import React from 'react';
import { Card } from 'react-bootstrap';
import { GlobalAppConfig } from '../../../common';
import { useIntl } from 'react-intl';
import { useUpdateConfigDebounced } from '../hooks';
import { systemMessages } from './messages';

interface SystemSettingsProps {
  config: GlobalAppConfig;
}

export const SystemSettings: React.FC<SystemSettingsProps> = ({ config }) => {
  const { formatMessage } = useIntl();
  const { currentConfig, mergeUpdate } = useUpdateConfigDebounced(config);
  const system = currentConfig.tab_system ?? {};

  return (
    <Card className="mt-3">
      <Card.Body>
        <div style={{ display: 'flex', gap: '1em', flexWrap: 'wrap' }}>
          <div>
            <label className="form-label" htmlFor="workerCount">
              {formatMessage(systemMessages.workerCount)}
            </label>
            <input
              id="workerCount"
              className="form-control"
              type="number"
              min={1}
              max={32}
              value={system.worker_instance_number ?? '4'}
              onChange={(event) =>
                mergeUpdate({
                  tab_system: { worker_instance_number: event.target.value },
                })
              }
            />
          </div>

          <div>
            <label className="form-label" htmlFor="queueViewLimit">
              {formatMessage(systemMessages.queueViewLimit)}
            </label>
            <input
              id="queueViewLimit"
              className="form-control"
              type="number"
              min={100}
              value={system.max_queue_view_size ?? '1000'}
              onChange={(event) =>
                mergeUpdate({
                  tab_system: { max_queue_view_size: event.target.value },
                })
              }
            />
          </div>

          <div className="form-check align-self-end">
            <input
              id="saveWorkerLogs"
              className="form-check-input"
              type="checkbox"
              checked={system.save_worker_logs_toggle === 1}
              onChange={(event) =>
                mergeUpdate({
                  tab_system: {
                    save_worker_logs_toggle: event.target.checked ? 1 : 0,
                  },
                })
              }
            />
            <label className="form-check-label" htmlFor="saveWorkerLogs">
              {formatMessage(systemMessages.verboseLogs)}
            </label>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};
