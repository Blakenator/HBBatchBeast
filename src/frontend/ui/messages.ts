import { createMessages } from '../core/utils';

export const shellMessages = createMessages({
  settings: { defaultMessage: 'Settings' },
  noMatches: { defaultMessage: 'No matches' },
  useCustomValue: { defaultMessage: 'Press Enter to use “{value}”' },
});

export const tokenListMessages = createMessages({
  removeToken: { defaultMessage: 'Remove {token}' },
  addCommonValues: { defaultMessage: 'Add common values' },
});
