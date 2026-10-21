import { createMessages } from '../../core/utils';

export const systemMessages = createMessages({
  workerCount: { defaultMessage: 'Worker processes' },
  queueViewLimit: { defaultMessage: 'Queue view limit' },
  verboseLogs: { defaultMessage: 'Save verbose worker logs' },
});
