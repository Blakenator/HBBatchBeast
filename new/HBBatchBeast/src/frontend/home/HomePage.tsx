import React, { useState } from 'react';
import { Alert, Button, Offcanvas } from 'react-bootstrap';
import { ToastContainer } from 'react-toastify';
import { useIntl } from 'react-intl';
import { useBackend } from '../helpers';
import { PROMISE_CHANNEL } from '../../common';
import { VersionWarning } from '../versionWarning/VersionWarning';
import { BatchTab } from '../settings/batchTab/BatchTab';
import { SystemSettings } from '../settings/systemSettings/SystemSettings';
import { useGlobalConfig, useSetGlobalConfig } from '../core/stores';
import { AppShell } from '../ui/AppShell';
import { AppStatus } from '../ui/StatusPill';
import { RunScreen } from '../run/RunScreen';
import { homeMessages } from './messages';

export const HomePage: React.FC = () => {
  const { formatMessage } = useIntl();
  const { data, error, loading } = useBackend({
    channel: PROMISE_CHANNEL.LoadConfiguration,
  });
  useSetGlobalConfig(data);
  const globalConfig = useGlobalConfig();
  const [status, setStatus] = useState<AppStatus>('idle');
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!globalConfig) {
    return (
      <div style={{ padding: 'var(--hb-space-xl)' }}>
        {loading && <span>{formatMessage(homeMessages.loading)}</span>}
        {error && (
          <Alert variant="danger">
            {formatMessage(homeMessages.loadFailed)}: {error.message}
          </Alert>
        )}
      </div>
    );
  }

  const activeProfile =
    globalConfig.configs[globalConfig.selected_config]?.name ?? 'Default';

  return (
    <>
      <ToastContainer
        position="top-center"
        autoClose={2000}
        newestOnTop
        closeOnClick
        pauseOnHover
        theme="light"
      />

      <AppShell
        status={status}
        profileName={activeProfile}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        <VersionWarning oldVersion={data?.version_message} />
        <RunScreen config={globalConfig} onStatusChange={setStatus} />
      </AppShell>

      <Offcanvas
        show={settingsOpen}
        onHide={() => setSettingsOpen(false)}
        placement="end"
        style={{ width: 520 }}
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>{formatMessage(homeMessages.settings)}</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          <BatchTab config={globalConfig} />
          <SystemSettings config={globalConfig} />
        </Offcanvas.Body>
        <div style={{ padding: 'var(--hb-space-lg)', borderTop: '1px solid var(--hb-border)' }}>
          <Button variant="secondary" onClick={() => setSettingsOpen(false)}>
            {formatMessage(homeMessages.close)}
          </Button>
        </div>
      </Offcanvas>
    </>
  );
};
