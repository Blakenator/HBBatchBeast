import React from 'react';
import { ASYNC_CHANNEL, GlobalAppConfig } from '../../../common';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { actionMessages } from './messages';
import { RunBatchOperationResult, useBackendAsync } from '../../helpers';

interface ScanButtonProps {
  config: GlobalAppConfig;
  onScanComplete: (res: RunBatchOperationResult) => void;
}

export const ScanButton: React.FC<ScanButtonProps> = ({
  config,
  onScanComplete,
}) => {
  const { formatMessage } = useIntl();
  const {
    refetch: startScan,
    loading,
    error,
    progressData,
    initialData,
    completeData,
  } = useBackendAsync({
    channel: ASYNC_CHANNEL.RunBatchOperation,
    props: { runScan: true },
    skip: true,
  });
  return (
    <>
      <Button
        onClick={() => startScan()}
        disabled={loading}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '.25em' }}
      >
        <span>{formatMessage(actionMessages.scanOnly)}</span>
        {loading && <Spinner />}
      </Button>
      {error && <Alert variant="danger">{error.toString()}</Alert>}
      {initialData && (
        <div>
          <div>initial data</div>
          <ol>
            {initialData.fileList.map((file) => (
              <li key={file.path}>{file.path}</li>
            ))}
          </ol>
        </div>
      )}
      <hr />
      {progressData && progressData.length > 0 && (
        <div>
          <div>progress data</div>
          {progressData.map((chunk, i) => (
            <div>
              <div>Chunk {i + 1}</div>
              <ol key={i}>
                {chunk.fileList.map((file) => (
                  <li>{file.path}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      <hr />
      {completeData && (
        <div>
          <div>completion data</div>
          <ol>
            {completeData.fileList.map((file) => (
              <li key={file.path}>{file.path}</li>
            ))}
          </ol>
        </div>
      )}
    </>
  );
};
