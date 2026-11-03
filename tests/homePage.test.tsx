// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { getDefaultMessages } from '../src/frontend/allMessages';

const { config } = vi.hoisted(() => ({
  config: {
    schema_version: 4,
    lang: 'en',
    version_message: '2.1.5',
    selected_library: 'library-1',
    presets: [
      {
        id: 'preset-1',
        name: 'Fast 1080p30',
        handbrake: { preset: 'Fast 1080p30' },
      },
    ],
    libraries: [
      {
        id: 'library-1',
        name: 'Films',
        mediaType: 'movies',
        folders: [{ id: 'folder-1', source: '/src', destination: '/dst' }],
        filters: {
          version: 1,
          root: { id: 'root', kind: 'group', combinator: 'and', children: [] },
        },
        encoder: 'handbrake',
        container: '.mkv',
        defaultPresetId: 'preset-1',
        mappingRules: [],
        defaults: {},
      },
    ],
  },
}));

vi.mock('../src/frontend/helpers', () => ({
  useBackend: (options: { channel?: string }) => ({
    loading: false,
    error: undefined,
    data: options.channel === 'LOAD_CONFIGURATION' ? config : undefined,
    refetch: vi.fn().mockResolvedValue({ data: undefined }),
  }),
}));

vi.mock('../src/frontend/core/stores', () => {
  const setGlobalConfig = vi.fn();
  return {
    useGlobalConfig: () => config,
    useSetGlobalConfigDirect: () => setGlobalConfig,
  };
});

vi.mock('../src/frontend/versionWarning/VersionWarning', () => ({
  VersionWarning: () => null,
}));

import { HomePage } from '../src/frontend/home/HomePage';

function renderHome() {
  render(
    <IntlProvider locale="en" messages={getDefaultMessages()} defaultLocale="en">
      <HomePage />
    </IntlProvider>,
  );
}

afterEach(cleanup);

describe('HomePage', () => {
  it('moves from the doors to each picker and back home', () => {
    renderHome();
    expect(screen.getByText('What do you want to do?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    expect(screen.getByText('Choose a library to convert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByText('What do you want to do?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Organize' }));
    expect(screen.getByText('Choose a library to organize')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByText('What do you want to do?')).toBeTruthy();
  });
});
