import { createMessages } from '../core';

export const batchOperationResultsMessages = createMessages({
  index: {
    defaultMessage: 'Index',
  },
  filePath: {
    defaultMessage: 'File Path',
  },
  preset: {
    defaultMessage: 'Preset',
  },
  extraActions: {
    defaultMessage: 'Extra Action',
  },
  skippedFilter: {
    defaultMessage: 'Skip (Due to word filter)',
  },
  copyFilter: {
    defaultMessage: 'Copy (Due to word filter)',
  },
  copySRT: {
    defaultMessage: 'Copy srt',
  },
});
