import { createMessages } from '../core/utils';

export const mediaMessages = createMessages({
  title: { defaultMessage: 'Media info' },
  container: { defaultMessage: 'Container' },
  duration: { defaultMessage: 'Duration' },
  bitRate: { defaultMessage: 'Bit rate' },
  streams: { defaultMessage: 'Streams' },
  type: { defaultMessage: 'Type' },
  codec: { defaultMessage: 'Codec' },
  details: { defaultMessage: 'Details' },
  language: { defaultMessage: 'Language' },
  failed: { defaultMessage: 'Could not read this file' },
  close: { defaultMessage: 'Close' },
  inspect: { defaultMessage: 'Info' },
  inspectTitle: { defaultMessage: 'Show media info' },
});
