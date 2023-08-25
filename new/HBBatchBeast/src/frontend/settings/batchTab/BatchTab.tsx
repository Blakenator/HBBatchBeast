import React from 'react';
import { GlobalAppConfig } from '../../../common';
import { useUpdateConfigDebounced } from '../hooks';
import { Card } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { settingsMessages } from '../messages';

interface BatchTabProps {
  config: GlobalAppConfig;
}

export const BatchTab: React.FC<BatchTabProps> = ({ config }) => {
  const { formatMessage } = useIntl();
  const { currentConfig, mergeUpdate } = useUpdateConfigDebounced(config);
  return (
    <Card>
      <Card.Body>
        <div style={{ display: 'flex', gap: '1em', flexDirection: 'column' }}>
          <div>
            <div className="form-label">
              {formatMessage(settingsMessages.sourceFolders)}
            </div>
            <textarea
              className="form-control"
              value={currentConfig.tab_batch.path.source_path}
              onChange={(e) =>
                mergeUpdate({
                  tab_batch: { path: { source_path: e.target.value } },
                })
              }
            />
          </div>
          <div>
            <div className="form-label">
              {formatMessage(settingsMessages.destinationFolders)}
            </div>
            <textarea
              className="form-control"
              value={currentConfig.tab_batch.path.destination_path}
              onChange={(e) =>
                mergeUpdate({
                  tab_batch: { path: { destination_path: e.target.value } },
                })
              }
            />
          </div>
          <div>
            <div className="form-label">
              {formatMessage(settingsMessages.customPreset)}
            </div>
            <textarea
              className="form-control"
              value={currentConfig.tab_batch.custom_preset_string}
              onChange={(e) =>
                mergeUpdate({
                  tab_batch: { custom_preset_string: e.target.value },
                })
              }
            />
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};
