// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { getDefaultMessages } from '../src/frontend/allMessages';
import {
  APP_CONFIG_SCHEMA_VERSION,
  AppConfigV2,
  defaultFilterExpression,
} from '../src/common';
import { SettingsForm } from '../src/frontend/settings/SettingsForm';

vi.mock('../src/frontend/helpers', () => ({
  useBackend: () => ({
    loading: false,
    error: undefined,
    data: undefined,
    refetch: vi.fn().mockResolvedValue({ data: undefined }),
  }),
  useBackendAsync: () => ({
    loading: false,
    error: undefined,
    completeData: undefined,
    lastProgressData: undefined,
    refetch: vi.fn(),
  }),
}));

const config: AppConfigV2 = {
  schema_version: APP_CONFIG_SCHEMA_VERSION,
  lang: 'en',
  version_message: 'test',
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
      name: 'Movies',
      folders: [{ id: 'folder-1', source: '/src', destination: '/dst' }],
      filters: defaultFilterExpression(),
      encoder: 'handbrake',
      container: '.mkv',
      defaultPresetId: 'preset-1',
      mappingRules: [],
      defaults: { temp_marker_toggle: 1 },
    },
  ],
};

describe('SettingsForm', () => {
  it('renders the library editor and preset manager tabs', () => {
    render(
      <IntlProvider locale="en" messages={getDefaultMessages()} defaultLocale="en">
        <SettingsForm config={config} />
      </IntlProvider>,
    );

    expect(screen.getAllByDisplayValue('Movies').length).toBeGreaterThan(0);
    expect(screen.getByText('Default mapping rules')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeTruthy();

    fireEvent.click(screen.getByText('Presets'));
    expect(screen.getAllByDisplayValue('Fast 1080p30').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: 'Add FFmpeg preset' }),
    ).toBeTruthy();

    cleanup();
  });
});

describe('SettingsForm mapping rules', () => {
  it('adds a rule stage without breaking the editor', () => {
    render(
      <IntlProvider locale="en" messages={getDefaultMessages()} defaultLocale="en">
        <SettingsForm config={config} />
      </IntlProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add stage' })[0]);
    expect(screen.getByRole('region', { name: 'Add stage' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Folder/ }));
    expect(screen.getByRole('combobox', { name: 'Library folder' })).toBeTruthy();

    cleanup();
  });
});
