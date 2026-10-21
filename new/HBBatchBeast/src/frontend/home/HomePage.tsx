import React, { useEffect, useState } from 'react';
import { Alert, Offcanvas } from 'react-bootstrap';
import { ToastContainer } from 'react-toastify';
import { useIntl } from 'react-intl';
import { useBackend } from '../helpers';
import { PROMISE_CHANNEL } from '../../common';
import { VersionWarning } from '../versionWarning/VersionWarning';
import { SettingsForm } from '../settings/SettingsForm';
import { ProfileBar } from '../settings/profile/ProfileBar';
import { LanguageSelect } from '../settings/LanguageSelect';
import { useGlobalConfig, useSetGlobalConfigDirect } from '../core/stores';
import { AppShell } from '../ui/AppShell';
import { AppStatus } from '../ui/StatusPill';
import { Button } from '../ui/Button';
import { RunScreen } from '../run/RunScreen';
import { homeMessages } from './messages';

export const HomePage: React.FC = () => {
  const { formatMessage } = useIntl();
  const { data, error, loading } = useBackend({
    channel: PROMISE_CHANNEL.LoadConfiguration,
  });
  const setGlobalConfig = useSetGlobalConfigDirect();
  const globalConfig = useGlobalConfig();
  const [status, setStatus] = useState<AppStatus>('idle');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Only mirror a *new* fetch result into the store: mirroring on every render
  // would undo in-memory edits made by the settings drawer and profile bar.
  useEffect(() => {
    if (data) setGlobalConfig(data);
  }, [data, setGlobalConfig]);

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
        <RunScreen
          config={globalConfig}
          onStatusChange={setStatus}
          onOpenSettings={() => setSettingsOpen(true)}
        />
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
          <ProfileBar />
          <div style={{ marginTop: 'var(--hb-space-md)' }}>
            <LanguageSelect config={globalConfig} />
          </div>
          <div style={{ marginTop: 'var(--hb-space-md)' }}>
            <SettingsForm config={globalConfig} />
          </div>
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
