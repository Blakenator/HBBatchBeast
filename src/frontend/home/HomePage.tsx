import React, { useEffect, useState } from 'react';
import { Alert } from 'react-bootstrap';
import { ToastContainer } from 'react-toastify';
import { useIntl } from 'react-intl';
import { useBackend } from '../helpers';
import {
  AppConfigV2,
  Library,
  PROMISE_CHANNEL,
  TrayStatus,
  createQuickLibrary,
} from '../../common';
import { VersionWarning } from '../versionWarning/VersionWarning';
import { SettingsForm } from '../settings/SettingsForm';
import { useGlobalConfig, useSetGlobalConfigDirect } from '../core/stores';
import { AppShell } from '../ui/AppShell';
import { AppStatus } from '../ui/StatusPill';
import { RunScreen } from '../run/RunScreen';
import { LauncherPage } from './LauncherPage';
import { QuickConvertPage } from './QuickConvertPage';
import { homeMessages } from './messages';

type View = 'home' | 'quick' | 'run' | 'settings';

export const HomePage: React.FC = () => {
  const { formatMessage } = useIntl();
  const { data, error, loading } = useBackend({
    channel: PROMISE_CHANNEL.LoadConfiguration,
  });
  const setGlobalConfig = useSetGlobalConfigDirect();
  const globalConfig = useGlobalConfig();
  const [status, setStatus] = useState<AppStatus>('idle');
  const [view, setView] = useState<View>('home');
  const [settingsReturn, setSettingsReturn] = useState<Exclude<View, 'settings'>>(
    'home',
  );
  const [activeLibraryId, setActiveLibraryId] = useState<string | undefined>();
  const [quickLibrary, setQuickLibrary] = useState<Library | null>(null);
  const trayStatus = useBackend({
    channel: PROMISE_CHANNEL.SetTrayStatus,
    skip: true,
  });
  const saveConfig = useBackend({
    channel: PROMISE_CHANNEL.SaveConfiguration,
    skip: true,
  });

  // Keep the tray indicator in step with what the run screen reports.
  useEffect(() => {
    const mapped: TrayStatus =
      status === 'running' || status === 'scanning'
        ? 'running'
        : status === 'paused' || status === 'stopping'
          ? 'paused'
          : status === 'error'
            ? 'error'
            : 'idle';
    void trayStatus.refetch({ status: mapped });
  }, [status]);

  // Only mirror a *new* fetch result into the store: mirroring on every render
  // would undo in-memory edits made by the settings view.
  useEffect(() => {
    if (data) setGlobalConfig(data);
  }, [data, setGlobalConfig]);

  // Switching the selected library in settings should also switch the library
  // the run screen is showing (quick-convert state is independent).
  const selectedFromStore = globalConfig?.selected_library;
  useEffect(() => {
    if (view === 'run' && !quickLibrary && selectedFromStore) {
      setActiveLibraryId(selectedFromStore);
    }
  }, [selectedFromStore, view, quickLibrary]);

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

  const persist = (next: AppConfigV2) => {
    setGlobalConfig(next);
    void saveConfig.refetch(next);
  };

  const library =
    quickLibrary ??
    globalConfig.libraries.find((item) => item.id === activeLibraryId) ??
    globalConfig.libraries.find(
      (item) => item.id === globalConfig.selected_library,
    ) ??
    globalConfig.libraries[0];

  const openSettings = () => {
    setSettingsReturn(view === 'settings' ? 'home' : view);
    setView('settings');
  };

  const openLibrary = (libraryId: string) => {
    setQuickLibrary(null);
    setActiveLibraryId(libraryId);
    if (globalConfig.selected_library !== libraryId) {
      persist({ ...globalConfig, selected_library: libraryId });
    }
    setView('run');
  };

  const startQuickConvert = () => {
    setQuickLibrary(createQuickLibrary(globalConfig.presets));
    setActiveLibraryId(undefined);
    setView('quick');
  };

  const startQuickFromLibrary = (source: Library) => {
    setQuickLibrary(createQuickLibrary(globalConfig.presets, source));
    setActiveLibraryId(undefined);
    setView('quick');
  };

  const cancelQuickConvert = () => {
    setQuickLibrary(null);
    setView('home');
  };

  const continueQuickConvert = (next: Library) => {
    setQuickLibrary(next);
    setView('run');
  };

  const canGoHome =
    status !== 'scanning' &&
    status !== 'running' &&
    status !== 'paused' &&
    status !== 'stopping';

  const saveQuickLibrary = (next: Library) => {
    const saved = {
      ...next,
      name: next.name.trim() || 'Quick conversion',
    };
    persist({
      ...globalConfig,
      libraries: [...globalConfig.libraries, saved],
      selected_library: saved.id,
    });
    setQuickLibrary(null);
    setActiveLibraryId(saved.id);
  };

  const back = () => {
    if (view === 'settings') {
      setView(settingsReturn);
      return;
    }
    if (view === 'quick') {
      setQuickLibrary(null);
      setView('home');
      return;
    }
    if (view === 'run' && canGoHome) setView('home');
  };

  const backLabel = view === 'settings' ? 'Back' : 'Home';
  const pageName =
    view === 'settings'
      ? 'Settings'
      : view === 'quick'
        ? 'Quick conversion'
        : view === 'run'
          ? library?.name
          : undefined;
  const showBack =
    view === 'settings' || view === 'quick' || (view === 'run' && canGoHome);

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
        pageName={pageName}
        onBack={showBack ? back : undefined}
        backLabel={backLabel}
        onOpenSettings={openSettings}
        showSettings={view !== 'settings'}
      >
        <VersionWarning
          oldVersion={data?.version_message}
          onAcknowledged={(version) => {
            if (!globalConfig || globalConfig.version_message === version) return;
            persist({ ...globalConfig, version_message: version });
          }}
        />

        {view === 'settings' ? (
          <SettingsForm config={globalConfig} />
        ) : view === 'quick' && quickLibrary ? (
          <QuickConvertPage
            key={quickLibrary.id}
            config={globalConfig}
            initialLibrary={quickLibrary}
            onCancel={cancelQuickConvert}
            onContinue={continueQuickConvert}
          />
        ) : view === 'run' && library ? (
          <RunScreen
            key={library.id}
            config={globalConfig}
            library={library}
            isQuick={library === quickLibrary}
            onSaveLibrary={saveQuickLibrary}
            onEditQuick={
              library === quickLibrary ? () => setView('quick') : undefined
            }
            onStatusChange={setStatus}
            onOpenSettings={openSettings}
          />
        ) : (
          <LauncherPage
            config={globalConfig}
            onOpenLibrary={openLibrary}
            onQuickConvert={startQuickConvert}
            onQuickFromLibrary={startQuickFromLibrary}
            onOpenSettings={openSettings}
          />
        )}
      </AppShell>
    </>
  );
};
