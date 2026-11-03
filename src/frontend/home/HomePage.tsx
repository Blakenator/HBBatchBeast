import React, { useEffect, useState } from 'react';
import { Alert } from 'react-bootstrap';
import { ToastContainer, toast } from 'react-toastify';
import { useIntl } from 'react-intl';
import { useBackend } from '../helpers';
import {
  AppConfigV2,
  Library,
  PROMISE_CHANNEL,
  TrayStatus,
  createQuickLibrary,
  createQuickOrganizeLibrary,
} from '../../common';
import { VersionWarning } from '../versionWarning/VersionWarning';
import { SettingsForm } from '../settings/SettingsForm';
import { useGlobalConfig, useSetGlobalConfigDirect } from '../core/stores';
import { AppShell } from '../ui/AppShell';
import { AppStatus } from '../ui/StatusPill';
import { RunScreen } from '../run/RunScreen';
import { LauncherPage } from './LauncherPage';
import { OrganizePage } from '../organize/OrganizePage';
import { QuickConvertPage } from './QuickConvertPage';
import { homeMessages } from './messages';

type View = 'home' | 'quick' | 'run' | 'settings' | 'organize';

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
  const [organizeLibraryId, setOrganizeLibraryId] = useState<
    string | undefined
  >();
  const [quickLibrary, setQuickLibrary] = useState<Library | null>(null);
  const [quickOrganizeLibrary, setQuickOrganizeLibrary] =
    useState<Library | null>(null);
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
    return saveConfig.refetch(next);
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
    setQuickOrganizeLibrary(null);
    setActiveLibraryId(libraryId);
    if (globalConfig.selected_library !== libraryId) {
      persist({ ...globalConfig, selected_library: libraryId });
    }
    setView('run');
  };

  /** Organize a saved library: edits persist to that library. */
  const openOrganize = (libraryId: string) => {
    setQuickLibrary(null);
    setQuickOrganizeLibrary(null);
    setOrganizeLibraryId(libraryId);
    setActiveLibraryId(libraryId);
    setView('organize');
  };

  const startQuickConvert = () => {
    setQuickOrganizeLibrary(null);
    setQuickLibrary(createQuickLibrary(globalConfig.presets));
    setActiveLibraryId(undefined);
    setView('quick');
  };

  const startQuickFromLibrary = (source: Library) => {
    setQuickOrganizeLibrary(null);
    setQuickLibrary(createQuickLibrary(globalConfig.presets, source));
    setActiveLibraryId(undefined);
    setView('quick');
  };

  /** Quick organize: an unsaved copy of a library, or a blank TV session. */
  const startQuickOrganize = (source?: Library) => {
    setQuickLibrary(null);
    setQuickOrganizeLibrary(createQuickOrganizeLibrary({ source }));
    setView('organize');
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

  const updateOrganizeLibrary = (next: Library) => {
    if (quickOrganizeLibrary) {
      setQuickOrganizeLibrary(next);
      return;
    }
    return persist({
      ...globalConfig,
      libraries: globalConfig.libraries.map((candidate) =>
        candidate.id === next.id ? next : candidate,
      ),
    });
  };

  const saveOrganizeAsLibrary = (next: Library) => {
    const saved: Library = {
      ...next,
      name:
        next.name === 'Quick organize' ? 'Organized library' : next.name,
    };
    persist({
      ...globalConfig,
      libraries: [...globalConfig.libraries, saved],
      selected_library: saved.id,
    });
    setQuickOrganizeLibrary(null);
    setOrganizeLibraryId(saved.id);
    setActiveLibraryId(saved.id);
    toast.success('Saved the organizer session as a library.');
    return Promise.resolve(saved);
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
    if (view === 'organize') {
      setQuickOrganizeLibrary(null);
      setView('home');
      return;
    }
    if (view === 'run' && canGoHome) setView('home');
  };

  const backLabel = view === 'settings' ? 'Back' : 'Home';
  const organizeLibrary =
    quickOrganizeLibrary ??
    globalConfig.libraries.find(
      (candidate) => candidate.id === organizeLibraryId,
    ) ??
    globalConfig.libraries.find(
      (candidate) => candidate.id === globalConfig.selected_library,
    ) ??
    globalConfig.libraries[0];
  const pageName =
    view === 'settings'
      ? 'Settings'
      : view === 'quick'
        ? 'Quick conversion'
        : view === 'organize'
          ? organizeLibrary?.name
          : view === 'run'
            ? library?.name
            : undefined;
  const showBack =
    view === 'settings' ||
    view === 'quick' ||
    view === 'organize' ||
    (view === 'run' && canGoHome);

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
        ) : view === 'organize' && organizeLibrary ? (
          <OrganizePage
            key={organizeLibrary.id}
            config={globalConfig}
            library={organizeLibrary}
            isQuick={Boolean(quickOrganizeLibrary)}
            onUpdateLibrary={updateOrganizeLibrary}
            onSaveAsLibrary={
              quickOrganizeLibrary ? saveOrganizeAsLibrary : undefined
            }
            onBack={back}
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
            onQuickOrganize={() => startQuickOrganize()}
            onQuickOrganizeFromLibrary={(source) => startQuickOrganize(source)}
            onOrganizeLibrary={openOrganize}
            onOpenSettings={openSettings}
          />
        )}
      </AppShell>
    </>
  );
};
