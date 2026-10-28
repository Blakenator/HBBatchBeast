// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { getDefaultMessages } from '../src/frontend/allMessages';
import {
  ASYNC_CHANNEL,
  AppConfigV2,
  Library,
  defaultFilterExpression,
} from '../src/common';
import { useSetBatchResultDirect } from '../src/frontend/core/stores';
import { RunScreen } from '../src/frontend/run/RunScreen';

const scanMounts = vi.fn();

vi.mock('../src/frontend/helpers', () => ({
  useBackend: () => ({
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
  useBackendAsync: (props: { channel: string }) => {
    if (props.channel === ASYNC_CHANNEL.RunBatchOperation) {
      scanMounts();
      return {
        loading: true,
        error: undefined,
        completeData: undefined,
        lastProgressData: undefined,
        refetch: vi.fn(),
      };
    }
    return {
      loading: false,
      error: undefined,
      completeData: undefined,
      lastProgressData: undefined,
      refetch: vi.fn(),
    };
  },
}));

Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value() {
    return {
      width: 900,
      height: 392,
      top: 0,
      left: 0,
      right: 900,
      bottom: 392,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  },
});
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get: () => 392,
});
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get: () => 900,
});

afterEach(() => {
  cleanup();
  scanMounts.mockClear();
});

const library: Library = {
  id: 'library-default',
  name: 'Default',
  folders: [{ id: 'folder-1', source: '/src', destination: '/dst' }],
  filters: defaultFilterExpression(),
  encoder: 'handbrake',
  container: '.mkv',
  defaultPresetId: 'preset-1',
  mappingRules: [],
  defaults: { included_file_types: 'mkv', temp_marker_toggle: 0 },
};

const config: AppConfigV2 = {
  schema_version: 2,
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

function Harness() {
  const setBatchResult = useSetBatchResultDirect();
  useEffect(() => {
    setBatchResult({
      fileList: [
        {
          path: '/src/a.mkv',
          preset: 'Fast 1080p30',
          destinationPath: '/dst/a.mkv',
          action: 'encode',
          extraActions: {},
        },
      ],
      totalCount: 1,
      unconvertedFilesCount: 1,
      discoveredQueueCount: 1,
    });
  }, [setBatchResult]);
  return (
    <RunScreen
      config={config}
      library={library}
      onStatusChange={vi.fn()}
      onOpenSettings={vi.fn()}
    />
  );
}

function renderScreen() {
  return render(
    <IntlProvider locale="en" messages={getDefaultMessages()} defaultLocale="en">
      <Harness />
    </IntlProvider>,
  );
}

describe('RunScreen rescan confirmation', () => {
  it('warns before replacing populated scan data', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));

    expect(await screen.findByText('Rescan source folders?')).toBeTruthy();
    expect(screen.getByText(/will be replaced by a fresh scan/)).toBeTruthy();
    expect(scanMounts).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByText('Rescan source folders?')).toBeNull(),
    );
    expect(scanMounts).not.toHaveBeenCalled();
  });

  it('starts a fresh scan only after confirmation', async () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Scan' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rescan' }));

    expect(scanMounts).toHaveBeenCalled();
    expect(await screen.findByText('Scanning source folders…')).toBeTruthy();
  });
});
