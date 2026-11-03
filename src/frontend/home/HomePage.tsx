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
import { LibraryPickerPage } from './LibraryPickerPage';
import { OrganizePage } from '../organize/OrganizePage';
import { QuickConvertPage } from './QuickConvertPage';
import { homeMessages } from './messages';
import type { HomeMode } from './types';

type View =
  | 'home'
  | 'convert-picker'
  | 'organize-picker'
  | 'quick'
  | 'run'
  | 'settings'
  | 'organize';

export const HomePage: React.FC = () => {
  const { formatMessage } = useIntl();
  const { data, error, loading } = useBackend({
    channel: PROMISE_CHANNEL.LoadConfiguration,
  });
  const setGlobalConfig = useSetGlobalConfigDirect();
  const globalConfig = useGlobalConfig();
  const [status, setStatus] = useState<AppStatus>('idle');
  const [view, setView] = useState<View>('home');
  const [lastLibraryByMode, setLastLibraryByMode] = useState<
    Partial<Record<HomeMode, string>>
  >({});
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
    setLastLibraryByMode((current) => ({ ...current, convert: libraryId }));
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
    setLastLibraryByMode((current) => ({ ...current, organize: libraryId }));
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

  /** One-off organize: an unsaved copy of a library, or a blank TV session. */
  const startQuickOrganize = (source?: Library) => {
    setQuickLibrary(null);
    setQuickOrganizeLibrary(createQuickOrganizeLibrary({ source }));
    setView('organize');
  };

  const chooseMode = (mode: HomeMode) => {
    setQuickLibrary(null);
    setQuickOrganizeLibrary(null);
    setView(mode === 'convert' ? 'convert-picker' : 'organize-picker');
  };

  const cancelQuickConvert = () => {
    setQuickLibrary(null);
    setView('convert-picker');
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
      name: next.name.trim() || 'One-off conversion',
    };
    persist({
      ...globalConfig,
      libraries: [...globalConfig.libraries, saved],
      selected_library: saved.id,
    });
    setQuickLibrary(null);
    setActiveLibraryId(saved.id);
    setLastLibraryByMode((current) => ({ ...current, convert: saved.id }));
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
        next.name === 'One-off organize' ? 'Organized library' : next.name,
    };
    persist({
      ...globalConfig,
      libraries: [...globalConfig.libraries, saved],
      selected_library: saved.id,
    });
    setQuickOrganizeLibrary(null);
    setOrganizeLibraryId(saved.id);
    setActiveLibraryId(saved.id);
    setLastLibraryByMode((current) => ({ ...current, organize: saved.id }));
    toast.success('Saved the organizer session as a library.');
    return Promise.resolve(saved);
  };

  const back = () => {
    if (view === 'settings') {
      setView(settingsReturn);
      return;
    }
    if (view === 'convert-picker' || view === 'organize-picker') {
      setView('home');
      return;
    }
    if (view === 'quick') {
      setQuickLibrary(null);
      setView('convert-picker');
      return;
    }
    if (view === 'organize') {
      setQuickOrganizeLibrary(null);
      setView('organize-picker');
      return;
    }
    if (view === 'run' && canGoHome) {
      setQuickLibrary(null);
      setView('convert-picker');
    }
  };

  const backLabel =
    view === 'settings'
      ? formatMessage(homeMessages.back)
      : view === 'convert-picker' || view === 'organize-picker'
        ? formatMessage(homeMessages.home)
        : view === 'organize'
          ? formatMessage(homeMessages.organizeTitle)
          : formatMessage(homeMessages.convertTitle);
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
      ? formatMessage(homeMessages.settings)
      : view === 'convert-picker'
        ? formatMessage(homeMessages.convertTitle)
        : view === 'organize-picker'
          ? formatMessage(homeMessages.organizeTitle)
          : view === 'quick'
            ? formatMessage(homeMessages.oneOffPage)
            : view === 'organize'
              ? organizeLibrary?.name
              : view === 'run'
                ? library?.name
                : undefined;
  const showBack =
    view === 'settings' ||
    view === 'convert-picker' ||
    view === 'organize-picker' ||
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
        ) : view === 'home' ? (
          <LauncherPage
            config={globalConfig}
            lastLibraryByMode={{
              convert:
                lastLibraryByMode.convert ?? globalConfig.selected_library,
              organize:
                lastLibraryByMode.organize ?? globalConfig.selected_library,
            }}
            onChooseMode={chooseMode}
            onContinue={(mode, libraryId) =>
              mode === 'convert'
                ? openLibrary(libraryId)
                : openOrganize(libraryId)
            }
          />
        ) : view === 'organize-picker' ? (
          <LibraryPickerPage
            mode="organize"
            config={globalConfig}
            selectedLibraryId={
              lastLibraryByMode.organize ?? globalConfig.selected_library
            }
            onStartLibrary={openOrganize}
            onQuickStart={() => startQuickOrganize()}
            onQuickFromLibrary={(source) => startQuickOrganize(source)}
            onOpenSettings={openSettings}
          />
        ) : (
          <LibraryPickerPage
            mode="convert"
            config={globalConfig}
            selectedLibraryId={
              lastLibraryByMode.convert ?? globalConfig.selected_library
            }
            onStartLibrary={openLibrary}
            onQuickStart={startQuickConvert}
            onQuickFromLibrary={startQuickFromLibrary}
            onOpenSettings={openSettings}
          />
        )}
      </AppShell>
    </>
  );
};
