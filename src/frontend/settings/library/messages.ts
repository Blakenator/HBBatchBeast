import { createMessages } from '../../core/utils';

export const libraryMessages = createMessages({
  library: { defaultMessage: 'Library' },
  add: { defaultMessage: 'New library' },
  duplicate: { defaultMessage: 'Duplicate' },
  remove: { defaultMessage: 'Delete' },
  name: { defaultMessage: 'Library name' },
  type: { defaultMessage: 'Library type' },
  movies: { defaultMessage: 'Movies' },
  tv: { defaultMessage: 'TV shows' },
  cancel: { defaultMessage: 'Cancel' },
  untitled: { defaultMessage: 'Untitled library' },
  noDefaultPreset: { defaultMessage: 'No default preset' },
  cannotDeleteLast: { defaultMessage: 'Keep at least one library' },
  deleteTitle: { defaultMessage: 'Delete library' },
  deleteBody: {
    defaultMessage:
      'Delete “{name}”? Its folders, filters, mapping rules and organizer settings are removed. This cannot be undone.',
  },
});
