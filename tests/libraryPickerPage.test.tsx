// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { getDefaultMessages } from '../src/frontend/allMessages';
import {
  APP_CONFIG_SCHEMA_VERSION,
  AppConfigV2,
  Library,
  defaultFilterExpression,
} from '../src/common';
import { LibraryPickerPage } from '../src/frontend/home/LibraryPickerPage';

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

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof LibraryPickerPage>> = {},
) {
  const onStartLibrary = vi.fn();
  const onQuickStart = vi.fn();
  const onQuickFromLibrary = vi.fn();
  const onOpenSettings = vi.fn();
  render(
    <IntlProvider locale="en" messages={getDefaultMessages()} defaultLocale="en">
      <LibraryPickerPage
        mode="convert"
        config={config}
        selectedLibraryId="library-1"
        onStartLibrary={onStartLibrary}
        onQuickStart={onQuickStart}
        onQuickFromLibrary={onQuickFromLibrary}
        onOpenSettings={onOpenSettings}
        {...overrides}
      />
    </IntlProvider>,
  );
  return { onStartLibrary, onQuickStart, onQuickFromLibrary, onOpenSettings };
}

afterEach(cleanup);

describe('LibraryPickerPage', () => {
  it('starts a saved conversion and exposes the one-off copy', () => {
    const {
      onStartLibrary,
      onQuickStart,
      onQuickFromLibrary,
    } = renderPicker();

    expect(screen.getByText('Choose a library to convert')).toBeTruthy();
    expect(screen.getByText(/Fast 1080p30/)).toBeTruthy();
    expect(screen.getByText('Last used')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStartLibrary).toHaveBeenCalledWith('library-1');

    fireEvent.click(
      screen.getByRole('button', { name: 'Set up a one-off conversion' }),
    );
    expect(onQuickStart).toHaveBeenCalledTimes(1);

    const menuButton = screen.getByRole('button', {
      name: 'More actions for Films',
    });
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(menuButton);
    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Use a one-off copy' }),
    );
    expect(onQuickFromLibrary).toHaveBeenCalledWith(library);
  });

  it('starts a saved organize session and exposes the one-off copy', () => {
    const {
      onStartLibrary,
      onQuickStart,
      onQuickFromLibrary,
    } = renderPicker({ mode: 'organize' });

    expect(screen.getByText('Choose a library to organize')).toBeTruthy();
    expect(screen.getByText(/Plex metadata/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onStartLibrary).toHaveBeenCalledWith('library-1');

    fireEvent.click(
      screen.getByRole('button', { name: 'Set up a one-off organize' }),
    );
    expect(onQuickStart).toHaveBeenCalledTimes(1);

    const menuButton = screen.getByRole('button', {
      name: 'More actions for Films',
    });
    fireEvent.click(menuButton);
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Use a one-off copy' }),
    );
    expect(onQuickFromLibrary).toHaveBeenCalledWith(library);
  });

  it('blocks conversion when no presets exist', () => {
    const { onOpenSettings } = renderPicker({
      config: { ...config, presets: [] },
    });

    expect(screen.getByText('No conversion presets yet')).toBeTruthy();
    const oneOff = screen.getByRole('button', {
      name: 'Set up a one-off conversion',
    }) as HTMLButtonElement;
    expect(oneOff.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('offers a one-off session when there are no libraries', () => {
    const { onOpenSettings } = renderPicker({
      config: { ...config, libraries: [] },
    });

    expect(screen.getByText('No libraries yet')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Set up a one-off conversion' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('marks an incomplete library and still lets the user review it', () => {
    const { onStartLibrary } = renderPicker({
      config: {
        ...config,
        libraries: [{ ...library, folders: [] }],
      },
    });

    expect(screen.getByText('Needs folders')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review setup' }));
    expect(onStartLibrary).toHaveBeenCalledWith('library-1');
  });
});
