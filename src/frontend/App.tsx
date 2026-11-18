import React from 'react';
import { HomePage } from './home/HomePage';
import { IntlMessagesProvider } from './core/IntlMessagesProvider';
import { GlobalStyle } from './ui/globalStyle';

/**
 * The application root. It lives in its own module so React Fast Refresh can
 * swap it (and any component below it) without reloading the window.
 */
export const App: React.FC = () => (
  <IntlMessagesProvider>
    <GlobalStyle />
    <HomePage />
  </IntlMessagesProvider>
);

export default App;
