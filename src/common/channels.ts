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
  OrganizeApplyProgress,
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
import type {
  OrganizeBlackScanProgress,
  OrganizeSplitPlan,
  OrganizeSplitProbe,
  OrganizeSplitThumbnailFrame,
  SplitBlackInterval,
  SplitFfmpegStatus,
} from './organizer/split';
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
  OrganizeCancelApply = 'ORGANIZE_CANCEL_APPLY',
  OrganizeProbeSplit = 'ORGANIZE_PROBE_SPLIT',
  OrganizeSplitThumbnails = 'ORGANIZE_SPLIT_THUMBNAILS',
  OrganizeEpisodeRuntimes = 'ORGANIZE_EPISODE_RUNTIMES',
  OrganizeFfmpegStatus = 'ORGANIZE_FFMPEG_STATUS',
  OrganizeUndo = 'ORGANIZE_UNDO',
  OrganizeCompletePending = 'ORGANIZE_COMPLETE_PENDING',
  OrganizeReadJournal = 'ORGANIZE_READ_JOURNAL',
}

export enum ASYNC_CHANNEL {
  RunBatchOperation = 'RUN_BATCH_OPERATION',
  RunConversion = 'RUN_CONVERSION',
  OrganizeScan = 'ORGANIZE_SCAN',
  OrganizeApply = 'ORGANIZE_APPLY',
  OrganizeDetectBlackFrames = 'ORGANIZE_DETECT_BLACK_FRAMES',
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
  [PROMISE_CHANNEL.OrganizeEpisodeRuntimes]: {
    props: { slug: string; episodeIds: string[] };
    result: Record<string, number | undefined>;
  };
  [PROMISE_CHANNEL.OrganizeFfmpegStatus]: {
    props: void;
    result: SplitFfmpegStatus;
  };
  [PROMISE_CHANNEL.OrganizeProbeSplit]: {
    props: {
      path: string;
      /** Optional cut markers to snap to nearby video keyframes. */
      markerTimes?: number[];
      keyframeWindowSeconds?: number;
    };
    result: OrganizeSplitProbe;
  };
  [PROMISE_CHANNEL.OrganizeSplitThumbnails]: {
    props: {
      path: string;
      times: number[];
      maxWidth?: number;
      /** Extract at the exact time instead of the 0.25 s cache bucket. */
      exact?: boolean;
    };
    result: { frames: OrganizeSplitThumbnailFrame[] };
  };
  [PROMISE_CHANNEL.OrganizeDetectShows]: {
    props: { library: Library };
    result: { folders: DetectedShow[]; warnings: string[] };
  };
  [PROMISE_CHANNEL.OrganizeCancelApply]: {
    props: void;
    result: { cancelled: boolean };
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
  [ASYNC_CHANNEL.OrganizeApply]: {
    props: {
      library: Library;
      plan: OrganizePlan;
      /** Queued splits, joined to the plan by item id. */
      splits: OrganizeSplitPlan[];
      updatePlex: boolean;
    };
    initResult: OrganizeApplyProgress;
    progressResult: OrganizeApplyProgress;
    completeResult: OrganizeApplyResult;
  };
  [ASYNC_CHANNEL.OrganizeDetectBlackFrames]: {
    props: {
      path: string;
      /** Video timeline offset; defaults to probing the file. */
      startTimeSeconds?: number;
      /** Source length used to turn ffmpeg progress into a percentage. */
      durationSeconds?: number;
      minDurationSeconds?: number;
      pixelThreshold?: number;
    };
    initResult: OrganizeBlackScanProgress;
    progressResult: OrganizeBlackScanProgress;
    completeResult: { intervals: SplitBlackInterval[] };
  };
}
