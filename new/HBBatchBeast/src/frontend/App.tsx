import React from 'react';
import { HomePage } from './home/HomePage';
import { IntlMessagesProvider } from './core/IntlMessagesProvider';

import { createRoot } from 'react-dom/client';

const domNode = document.getElementById('root');
const root = createRoot(domNode);
root.render(
  <IntlMessagesProvider>
    <HomePage />
  </IntlMessagesProvider>,
);
