import React from 'react';
import { useBackend } from '../helpers';
import { PROMISE_CHANNEL } from '../../common';
import { VersionWarning } from '../versionWarning/VersionWarning';
import { ToastContainer } from 'react-toastify';
import { BatchTab } from '../settings/batchTab/BatchTab';
import { Alert } from 'react-bootstrap';
import { ScanButton } from './actions/ScanButton';
import {
  useBatchResult,
  useGlobalConfig,
  useSetGlobalConfig,
} from '../core/stores';
import { BatchOperationResults } from './BatchOperationResults';
import { RunPanel } from '../run/RunPanel';
import { SystemSettings } from '../settings/systemSettings/SystemSettings';

export const HomePage: React.FC = () => {
  const { data, error, loading } = useBackend({
    channel: PROMISE_CHANNEL.LoadConfiguration,
  });
  useSetGlobalConfig(data);
  const globalConfig = useGlobalConfig();
  const batchResult = useBatchResult();

  return (
    <div>
      <ToastContainer
        position="top-center"
        autoClose={2000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
      <VersionWarning oldVersion={data?.version_message} />
      {globalConfig && (
        <>
          <BatchTab config={globalConfig} />
          <SystemSettings config={globalConfig} />
          <ScanButton />
          <RunPanel
            config={globalConfig}
            items={
              batchResult?.fileList.map((file) => ({
                path: file.path,
                preset: file.preset ?? '',
                destinationPath: file.destinationPath,
              })) ?? []
            }
          />
        </>
      )}
      {loading && <span>loading</span>}
      {error && (
        <Alert variant="danger">
          {JSON.stringify(error)} - {error.message}
        </Alert>
      )}
      <BatchOperationResults />
    </div>
  );
};
