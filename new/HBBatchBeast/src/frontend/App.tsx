import React from 'react';
import { HomePage } from './home/HomePage';
import { IntlMessagesProvider } from './core/IntlMessagesProvider';
import { GlobalStyle } from './ui/globalStyle';
import { applyThemeMode } from './ui/applyTheme';

import { createRoot } from 'react-dom/client';

applyThemeMode();

const domNode = document.getElementById('root');
const root = createRoot(domNode);
root.render(
  <IntlMessagesProvider>
    <GlobalStyle />
    <HomePage />
  </IntlMessagesProvider>,
);
