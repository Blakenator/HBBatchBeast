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
import { QuickConvertPage } from '../src/frontend/home/QuickConvertPage';

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

const library: Library = {
  id: 'library-1',
  name: 'Quick conversion',
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
  selected_library: 'library-saved',
  presets: [
    {
      id: 'preset-1',
      name: 'Fast 1080p30',
      handbrake: { preset: 'Fast 1080p30' },
    },
  ],
  libraries: [library],
};

describe('QuickConvertPage', () => {
  it('exposes folders, mapping rules and filters before scanning', () => {
    const onContinue = vi.fn();
    render(
      <IntlProvider locale="en" messages={getDefaultMessages()} defaultLocale="en">
        <QuickConvertPage
          config={config}
          initialLibrary={library}
          onCancel={vi.fn()}
          onContinue={onContinue}
        />
      </IntlProvider>,
    );

    expect(screen.getByText('Quick conversion')).toBeTruthy();
    expect(screen.getByText('Default mapping rules')).toBeTruthy();
    expect(screen.getByText('Default preset')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeTruthy();
    expect(screen.getByText('Scan filters')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Continue to scan' }));
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        folders: expect.arrayContaining([
          expect.objectContaining({ destination: '/dst' }),
        ]),
      }),
    );
    cleanup();
  });
});
