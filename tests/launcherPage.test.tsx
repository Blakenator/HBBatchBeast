// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { getDefaultMessages } from '../src/frontend/allMessages';
import {
  APP_CONFIG_SCHEMA_VERSION,
  AppConfigV2,
  Library,
  defaultFilterExpression,
} from '../src/common';
import { LauncherPage } from '../src/frontend/home/LauncherPage';

const library: Library = {
  id: 'library-1',
  name: 'Films',
  mediaType: 'movies',
  folders: [{ id: 'folder-1', source: '/src', destination: '/dst' }],
  filters: defaultFilterExpression(),
  encoder: 'handbrake',
  container: '.mkv',
  defaultPresetId: 'preset-1',
  mappingRules: [],
  defaults: {},
};

const config: AppConfigV2 = {
  schema_version: APP_CONFIG_SCHEMA_VERSION,
  lang: 'en',
  version_message: 'test',
  selected_library: library.id,
  presets: [
    {
      id: 'preset-1',
      name: 'Fast 1080p30',
      handbrake: { preset: 'Fast 1080p30' },
    },
  ],
  libraries: [library],
};

function renderLauncher(
  overrides: Partial<React.ComponentProps<typeof LauncherPage>> = {},
) {
  const onChooseMode = vi.fn();
  const onContinue = vi.fn();
  render(
    <IntlProvider locale="en" messages={getDefaultMessages()} defaultLocale="en">
      <LauncherPage
        config={config}
        lastLibraryByMode={{}}
        onChooseMode={onChooseMode}
        onContinue={onContinue}
        {...overrides}
      />
    </IntlProvider>,
  );
  return { onChooseMode, onContinue };
}

afterEach(cleanup);

describe('LauncherPage', () => {
  it('offers conversion and organizing as the two doors', () => {
    const { onChooseMode } = renderLauncher();

    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    expect(onChooseMode).toHaveBeenCalledWith('convert');

    fireEvent.click(screen.getByRole('button', { name: 'Organize' }));
    expect(onChooseMode).toHaveBeenCalledWith('organize');
  });

  it('shows the library count and continues the selected library', () => {
    const { onContinue } = renderLauncher({
      lastLibraryByMode: { convert: 'library-1' },
    });

    const convertDoor = screen.getByRole('button', { name: 'Convert' });
    expect(within(convertDoor).getByText('1 library')).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'Continue with Films' }),
    );
    expect(onContinue).toHaveBeenCalledWith('convert', 'library-1');
  });

  it('does not put library or preset management on the home surface', () => {
    renderLauncher();
    expect(screen.queryByText('Manage libraries')).toBeNull();
    expect(screen.queryByText('Manage presets')).toBeNull();
  });

  it('handles an empty library list', () => {
    renderLauncher({
      config: { ...config, libraries: [], selected_library: '' },
    });

    expect(screen.getAllByText('No libraries yet')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Continue with/ })).toBeNull();
  });
});
