import React from 'react';
import { useBackend } from '../helpers';
import { PROMISE_CHANNEL } from '../../common';
import { VersionWarning } from '../versionWarning/VersionWarning';
import { ToastContainer } from 'react-toastify';
import { BatchTab } from '../settings/batchTab/BatchTab';
import { Alert } from 'react-bootstrap';
import { ScanButton } from './actions/ScanButton';

export const HomePage: React.FC = () => {
  const { data, error, loading } = useBackend({
    channel: PROMISE_CHANNEL.LoadConfiguration,
  });

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
      {data && (
        <>
          <BatchTab config={data} />
          <ScanButton
            config={data}
            onScanComplete={(res) => console.log(res)}
          />
        </>
      )}
      {/*<pre>{JSON.stringify(data, null, 2)}</pre>*/}
      {loading && <span>loading</span>}
      {error && (
        <Alert variant="danger">
          {JSON.stringify(error)} - {error.message}
        </Alert>
      )}
    </div>
  );
};
