// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  name: 'Movies',
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

function renderLauncher() {
  const onQuickConvert = vi.fn();
  const onQuickFromLibrary = vi.fn();
  const onOpenLibrary = vi.fn();
  render(
    <IntlProvider locale="en" messages={getDefaultMessages()} defaultLocale="en">
      <LauncherPage
        config={config}
        onOpenLibrary={onOpenLibrary}
        onQuickConvert={onQuickConvert}
        onQuickFromLibrary={onQuickFromLibrary}
        onOpenSettings={vi.fn()}
      />
    </IntlProvider>,
  );
  return { onQuickConvert, onQuickFromLibrary, onOpenLibrary };
}

describe('LauncherPage', () => {
  it('opens a library', () => {
    const { onOpenLibrary } = renderLauncher();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpenLibrary).toHaveBeenCalledWith('library-1');
    cleanup();
  });

  it('starts a blank or library-backed quick conversion', () => {
    const { onQuickConvert, onQuickFromLibrary } = renderLauncher();
    fireEvent.click(
      screen.getByRole('button', { name: 'Start a quick conversion' }),
    );
    expect(onQuickConvert).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Use as quick run' }));
    expect(onQuickFromLibrary).toHaveBeenCalledWith(library);
    cleanup();
  });
});
