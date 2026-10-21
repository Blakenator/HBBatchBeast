import { createMessages } from '../core/utils';

export const diagnosticsMessages = createMessages({
  title: { defaultMessage: 'Logs & diagnostics' },
  logFiles: { defaultMessage: 'Log files' },
  openLogFolder: { defaultMessage: 'Open log folder' },
  open: { defaultMessage: 'Open' },
  openConfigFolder: { defaultMessage: 'Open config folder' },
  noLogs: { defaultMessage: 'No log files yet.' },
  caches: { defaultMessage: 'Caches' },
  clearCaches: { defaultMessage: 'Clear caches' },
  cachesTitle: { defaultMessage: 'Clear conversion caches?' },
  cachesBody: {
    defaultMessage:
      'The healthy-file and replaced-file lists are deleted and rebuilt on the next scan. Log files are kept.',
  },
  clearedCaches: { defaultMessage: 'Cleared: {names}' },
  nothingToClear: { defaultMessage: 'Nothing to clear' },
  journalCleared: { defaultMessage: 'Recovered run state cleared' },
  runJournal: { defaultMessage: 'Recovered run state' },
  clearJournal: { defaultMessage: 'Clear recovered run state' },
  journalPresent: {
    defaultMessage: 'A run journal exists, so the last run was interrupted.',
  },
  journalAbsent: { defaultMessage: 'No interrupted run recorded.' },
  journalFinished: {
    defaultMessage: 'The last run finished ({status}); its journal is only kept for recovery.',
  },
  clear: { defaultMessage: 'Clear' },
  cancel: { defaultMessage: 'Cancel' },
  loadFailed: { defaultMessage: 'Could not read the app folders' },
});
