import {
  ConversionItem,
  DiagnosticsInfo,
  HandBrakePresetScan,
  MediaInfo,
  GlobalAppConfig,
  PathPickerRequest,
  PathPickerResult,
  TrayStatus,
  RunBatchOperationProps,
  RunBatchOperationResult,
} from './types';
import type { AppConfigV2, Library } from './library';
import type { DetectedShow } from './organizer/shows';
import type {
  OrganizeApplyResult,
  OrganizeJournalSummary,
  OrganizePendingResult,
  OrganizePlan,
  OrganizePlexCheck,
  OrganizePlexFixResult,
  OrganizeScanProgress,
  OrganizeScanScope,
  OrganizePlexEnvironment,
  TvdbEpisode,
  TvdbMovie,
  TvdbSeriesRef,
} from './organizer/types';
import type { RunState } from '../backend/run/runManager';

import {
  BackendAsyncApiType,
  BackendSyncApiType,
} from '@superflag/super-ipc-core';

export enum PROMISE_CHANNEL {
  LoadConfiguration = 'LOAD_CONFIGURATION',
  SaveConfiguration = 'SAVE_CONFIGURATION',
  GetRunState = 'GET_RUN_STATE',
  PauseRun = 'PAUSE_RUN',
  ResumeRun = 'RESUME_RUN',
  StopRun = 'STOP_RUN',
  CancelRunItem = 'CANCEL_RUN_ITEM',
  SetTrayStatus = 'SET_TRAY_STATUS',
  GetDiagnostics = 'GET_DIAGNOSTICS',
  OpenAppPath = 'OPEN_APP_PATH',
  OpenFolder = 'OPEN_FOLDER',
  ClearCaches = 'CLEAR_CACHES',
  ClearRunJournal = 'CLEAR_RUN_JOURNAL',
  ProbeMedia = 'PROBE_MEDIA',
  PickPath = 'PICK_PATH',
  ListHandBrakePresets = 'LIST_HANDBRAKE_PRESETS',
  OrganizeGetPlexEnvironment = 'ORGANIZE_GET_PLEX_ENVIRONMENT',
  OrganizeCheckPlex = 'ORGANIZE_CHECK_PLEX',
  OrganizeControlPlex = 'ORGANIZE_CONTROL_PLEX',
  OrganizeFixPlex = 'ORGANIZE_FIX_PLEX',
  OrganizeSearchSeries = 'ORGANIZE_SEARCH_SERIES',
  OrganizeSearchMovies = 'ORGANIZE_SEARCH_MOVIES',
  OrganizeLoadEpisodes = 'ORGANIZE_LOAD_EPISODES',
  OrganizeDetectShows = 'ORGANIZE_DETECT_SHOWS',
  OrganizeApplyPlan = 'ORGANIZE_APPLY_PLAN',
  OrganizeUndo = 'ORGANIZE_UNDO',
  OrganizeCompletePending = 'ORGANIZE_COMPLETE_PENDING',
  OrganizeReadJournal = 'ORGANIZE_READ_JOURNAL',
}

export enum ASYNC_CHANNEL {
  RunBatchOperation = 'RUN_BATCH_OPERATION',
  RunConversion = 'RUN_CONVERSION',
  OrganizeScan = 'ORGANIZE_SCAN',
}

export interface BackendPromiseApi extends BackendSyncApiType<PROMISE_CHANNEL> {
  [PROMISE_CHANNEL.LoadConfiguration]: {
    props: void;
    result: AppConfigV2;
  };
  [PROMISE_CHANNEL.SaveConfiguration]: {
    props: AppConfigV2;
    result: void;
  };
  [PROMISE_CHANNEL.GetRunState]: {
    props: void;
    result: RunState | null;
  };
  [PROMISE_CHANNEL.PauseRun]: {
    props: void;
    result: RunState | null;
  };
  [PROMISE_CHANNEL.ResumeRun]: {
    props: void;
    result: RunState | null;
  };
  [PROMISE_CHANNEL.StopRun]: {
    props: void;
    result: RunState | null;
  };
  [PROMISE_CHANNEL.CancelRunItem]: {
    props: { index: number };
    result: RunState | null;
  };
  [PROMISE_CHANNEL.SetTrayStatus]: {
    props: { status: TrayStatus };
    result: void;
  };
  [PROMISE_CHANNEL.GetDiagnostics]: {
    props: void;
    result: DiagnosticsInfo;
  };
  [PROMISE_CHANNEL.OpenAppPath]: {
    props: { path: string };
    result: void;
  };
  [PROMISE_CHANNEL.OpenFolder]: {
    props: { path: string };
    result: void;
  };
  [PROMISE_CHANNEL.ClearCaches]: {
    props: void;
    result: { cleared: string[] };
  };
  [PROMISE_CHANNEL.ClearRunJournal]: {
    props: void;
    result: void;
  };
  [PROMISE_CHANNEL.ProbeMedia]: {
    props: { path: string };
    result: MediaInfo;
  };
  [PROMISE_CHANNEL.PickPath]: {
    props: PathPickerRequest;
    result: PathPickerResult;
  };
  [PROMISE_CHANNEL.ListHandBrakePresets]: {
    props: { refresh?: boolean };
    result: HandBrakePresetScan;
  };
  [PROMISE_CHANNEL.OrganizeGetPlexEnvironment]: {
    props: void;
    result: OrganizePlexEnvironment;
  };
  [PROMISE_CHANNEL.OrganizeCheckPlex]: {
    props: { path: string };
    result: OrganizePlexCheck;
  };
  [PROMISE_CHANNEL.OrganizeControlPlex]: {
    props: { action: 'status' | 'stop' | 'start'; path: string };
    result: OrganizePlexCheck;
  };
  [PROMISE_CHANNEL.OrganizeFixPlex]: {
    props: { path: string };
    result: OrganizePlexFixResult;
  };
  [PROMISE_CHANNEL.OrganizeSearchSeries]: {
    props: { query: string };
    result: TvdbSeriesRef[];
  };
  [PROMISE_CHANNEL.OrganizeSearchMovies]: {
    props: { query: string };
    result: TvdbMovie[];
  };
  [PROMISE_CHANNEL.OrganizeLoadEpisodes]: {
    props: { slug: string };
    result: TvdbEpisode[];
  };
  [PROMISE_CHANNEL.OrganizeDetectShows]: {
    props: { library: Library };
    result: { folders: DetectedShow[]; warnings: string[] };
  };
  [PROMISE_CHANNEL.OrganizeApplyPlan]: {
    props: { library: Library; plan: OrganizePlan; updatePlex: boolean };
    result: OrganizeApplyResult;
  };
  [PROMISE_CHANNEL.OrganizeUndo]: {
    props: { restorePlex?: boolean };
    result: { reversed: number; warnings: string[] };
  };
  [PROMISE_CHANNEL.OrganizeCompletePending]: {
    props: { dbPath: string };
    result: OrganizePendingResult;
  };
  [PROMISE_CHANNEL.OrganizeReadJournal]: {
    props: void;
    result: OrganizeJournalSummary | undefined;
  };
}

export interface BackendAsyncApi extends BackendAsyncApiType<ASYNC_CHANNEL> {
  [ASYNC_CHANNEL.RunBatchOperation]: {
    props: RunBatchOperationProps;
    initResult: RunBatchOperationResult;
    progressResult: RunBatchOperationResult;
    completeResult: RunBatchOperationResult;
  };
  [ASYNC_CHANNEL.RunConversion]: {
    props: { config: GlobalAppConfig; items: ConversionItem[] };
    initResult: RunState;
    progressResult: RunState;
    completeResult: RunState;
  };
  [ASYNC_CHANNEL.OrganizeScan]: {
    props: {
      library: Library;
      scope?: OrganizeScanScope[];
      /** Reuse cached discovery data from a previous scan. */
      reuseScanId?: string;
      /** Absolute folders to walk again for a partial rescan. */
      rescanFolders?: string[];
    };
    initResult: OrganizeScanProgress;
    progressResult: OrganizeScanProgress;
    completeResult: OrganizePlan;
  };
}
