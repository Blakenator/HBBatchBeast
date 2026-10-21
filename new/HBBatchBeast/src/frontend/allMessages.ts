import { settingsMessages } from './settings/messages';
import { commonButtonMessages } from './core/messages';
import { versionWarningMessages } from './versionWarning/messages';
import { batchOperationResultsMessages } from './home/messages';
import { runMessages } from './run/messages';
import { systemMessages } from './settings/systemSettings/messages';

export const allMessages = {
  settingsMessages,
  commonButtonMessages,
  versionWarningMessages,
  batchOperationResultsMessages,
  runMessages,
  systemMessages,
};

/**
 * Flattens the in-code catalogs into an `id -> defaultMessage` map.
 *
 * react-intl logs an error for every id it cannot find in `messages`. The
 * locale JSONs we ship are keyed by legacy sentences, so without this fallback
 * every render logs a MISSING_TRANSLATION error. Locale files still win when
 * they contain the id.
 */
export function getDefaultMessages(): Record<string, string> {
  const defaults: Record<string, string> = {};

  const catalogs = Object.values(allMessages) as Record<
    string,
    { id?: string; defaultMessage: string }
  >[];

  for (const catalog of catalogs) {
    for (const message of Object.values(catalog)) {
      defaults[message.id ?? message.defaultMessage] = message.defaultMessage;
    }
  }

  return defaults;
}
