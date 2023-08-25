import * as ReactDOM from 'react-dom';
import React from 'react';
import { HomePage } from './home/HomePage';
import { IntlMessagesProvider } from './core/IntlMessagesProvider';

function render() {
  ReactDOM.render(
    <IntlMessagesProvider>
      <HomePage />
    </IntlMessagesProvider>,
    document.body,
  );
}

render();
