import React, { useCallback } from 'react';
import { ASYNC_CHANNEL, BatchOperationMode } from '../../../common';
import { Alert, Button, ProgressBar, Spinner } from 'react-bootstrap';
import { useIntl } from 'react-intl';
import { actionMessages } from './messages';
import { useBackendAsync } from '../../helpers';
import { useGlobalConfigRequired, useSetBatchResult } from '../../core/stores';

interface ScanButtonProps {
}

export const ScanButton: React.FC<ScanButtonProps> = ({}) => {
  const { formatMessage, formatNumber } = useIntl();
  const setBatchResult = useSetBatchResult();
  const config = useGlobalConfigRequired();
  const {
    refetch: startScan,
    loading,
    error,
    lastProgressData,
  } = useBackendAsync({
    channel: ASYNC_CHANNEL.RunBatchOperation,
    props: { operationMode: BatchOperationMode.ScanOnly, config },
    skip: true,
    onComplete: useCallback((result) => setBatchResult(result),[]),
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
      {error && <Alert variant='danger'>{error.toString()}</Alert>}
      {lastProgressData && <div style={{ display: 'flex', flexDirection: 'column', gap: '.5em' }}>
        <div>{formatMessage(actionMessages.filesDiscovered, { num: lastProgressData.totalCount })}</div>
        <div>{formatMessage(
          actionMessages.queueScan,
          { num: lastProgressData.discoveredQueueCount, total: lastProgressData.totalCount },
        )}</div>
        <ProgressBar variant='primary'
                     max={lastProgressData.totalCount}
                     min={0}
                     now={lastProgressData.discoveredQueueCount}
                     label={formatNumber(
                       lastProgressData.discoveredQueueCount / lastProgressData.totalCount,
                       { style: 'percent', maximumFractionDigits: 0 },
                     )}
        />
      </div>}
    </>
  );
};
