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
  noQueue: { defaultMessage: 'Scan first to build a queue' },
  failures: { defaultMessage: 'Failures' },
});
