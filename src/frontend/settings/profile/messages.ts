import { createMessages } from '../../core/utils';

export const profileMessages = createMessages({
  active: { defaultMessage: 'Active profile' },
  add: { defaultMessage: 'New' },
  duplicate: { defaultMessage: 'Duplicate' },
  rename: { defaultMessage: 'Rename' },
  remove: { defaultMessage: 'Delete' },
  name: { defaultMessage: 'Profile name' },
  save: { defaultMessage: 'Save' },
  cancel: { defaultMessage: 'Cancel' },
  cannotDeleteLast: { defaultMessage: 'Keep at least one profile' },
});
