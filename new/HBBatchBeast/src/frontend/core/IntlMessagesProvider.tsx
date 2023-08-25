import React, { PropsWithChildren, useEffect, useState } from 'react';
import { IntlProvider } from 'react-intl';

export const IntlMessagesProvider: React.FC<PropsWithChildren> = ({
  children,
}) => {
  const [messages, setMessages] = useState({});

  useEffect(() => {
    import(
      `../../translations/${(navigator.language ?? 'en-US').split('-')[0]}.json`
    ).then((parsed) => {
      setMessages(parsed?.default);
    });
  }, [navigator.language]);

  return (
    <IntlProvider
      messages={messages}
      locale={navigator.language}
      defaultLocale="en"
    >
      {children}
    </IntlProvider>
  );
};
