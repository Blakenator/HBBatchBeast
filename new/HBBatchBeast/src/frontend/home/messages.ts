import { createMessages } from '../core/utils';

export const homeMessages = createMessages({
  loading: { defaultMessage: 'Loading configuration…' },
  loadFailed: { defaultMessage: 'Could not load configuration' },
  settings: { defaultMessage: 'Settings' },
  close: { defaultMessage: 'Close' },
});

export const batchOperationResultsMessages = createMessages({
  index: { defaultMessage: 'Index' },
  filePath: { defaultMessage: 'File Path' },
  preset: { defaultMessage: 'Preset' },
  extraActions: { defaultMessage: 'Extra Action' },
  skippedFilter: { defaultMessage: 'Skip (Due to word filter)' },
  copyFilter: { defaultMessage: 'Copy (Due to word filter)' },
  copySRT: { defaultMessage: 'Copy srt' },
});
