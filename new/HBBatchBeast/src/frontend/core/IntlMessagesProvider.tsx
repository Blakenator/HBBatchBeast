import React, { PropsWithChildren, useEffect, useState } from 'react';
import { IntlProvider } from 'react-intl';
import { getDefaultMessages } from '../allMessages';

export const IntlMessagesProvider: React.FC<PropsWithChildren> = ({
  children,
}) => {
  const [localeMessages, setLocaleMessages] = useState<Record<string, string>>(
    {},
  );
  const defaults = getDefaultMessages();
  const locale = (navigator.language ?? 'en-US').split('-')[0];

  useEffect(() => {
    import(`../../translations/${locale}.json`)
      .then((parsed) =>
        setLocaleMessages((parsed?.default ?? {}) as Record<string, string>),
      )
      .catch(() => setLocaleMessages({}));
  }, [locale]);

  return (
    <IntlProvider
      messages={{ ...defaults, ...localeMessages }}
      locale={navigator.language}
      defaultLocale="en"
      // Only surface real formatting problems; missing ids fall back to defaults.
      onError={(error) => {
        if (error.code !== 'MISSING_TRANSLATION') {
          console.error(error);
        }
      }}
    >
      {children}
    </IntlProvider>
  );
};
