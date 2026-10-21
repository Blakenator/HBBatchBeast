import { createMessages } from '../core/utils';

export const runMessages = createMessages({
  startConversion: { defaultMessage: 'Start conversion' },
  pause: { defaultMessage: 'Pause' },
  resume: { defaultMessage: 'Resume' },
  stop: { defaultMessage: 'Stop' },
  status: { defaultMessage: 'Status: {status}' },
  progress: {
    defaultMessage: '{done} of {total} done · {failed} failed · {cancelled} cancelled',
  },
  allConverted: {
    defaultMessage:
      'Nothing to convert — {total} matching files already have output at the destination.',
  },
  noMatchingFiles: {
    defaultMessage: 'No files matched the current filters in the source folders.',
  },
  failures: { defaultMessage: 'Failures' },
  console: { defaultMessage: 'Console output' },
  all: { defaultMessage: 'All' },
  pending: { defaultMessage: 'Pending' },
  running: { defaultMessage: 'Running' },
  success: { defaultMessage: 'Success' },
  error: { defaultMessage: 'Error' },
  cancelled: { defaultMessage: 'Cancelled' },
  skipped: { defaultMessage: 'Skipped' },
  search: { defaultMessage: 'Filter by path' },
  folders: { defaultMessage: 'Folders' },
  encoding: { defaultMessage: 'Encoding' },
  filters: { defaultMessage: 'Filters' },
  noPreset: { defaultMessage: 'no preset set' },
  blockingIssues: { defaultMessage: 'Fix these before running' },
  scan: { defaultMessage: 'Scan' },
  queue: { defaultMessage: 'Queue' },
  queueCount: { defaultMessage: '{count} files' },
  confirmTitle: { defaultMessage: 'Confirm destructive options' },
  confirmIntro: { defaultMessage: 'This run will also:' },
  confirmDeleteSource: { defaultMessage: 'delete source files after a successful conversion' },
  confirmReplaceAlways: { defaultMessage: 'replace the original file regardless of size' },
  confirmReplaceSmaller: { defaultMessage: 'replace the original file when the result is smaller' },
  confirmStart: { defaultMessage: 'Start run' },
  cancel: { defaultMessage: 'Cancel' },
  emptyTitle: { defaultMessage: 'Point HBBatchBeast at your videos' },
  emptyBody: {
    defaultMessage:
      'Choose a source folder to scan and a destination for the converted files. Nothing is converted until you press Start conversion.',
  },
  emptyCta: { defaultMessage: 'Choose folders' },
  scanFirst: { defaultMessage: 'Scan to build the queue' },
});
