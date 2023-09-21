import { createMessages } from '../../core';

export const actionMessages = createMessages({
  scanOnly: {
    defaultMessage: 'Scan Only',
  },
  scanComplete: {
    defaultMessage: 'Scan complete',
  },
  filesDiscovered: {
    defaultMessage: '{num} Files Discovered',
  },
  queueScan: {
    defaultMessage: 'Analyzed files - {num} / {total}',
  },
});
