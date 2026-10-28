// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { getDefaultMessages } from '../src/frontend/allMessages';
import { ASYNC_CHANNEL, GlobalAppConfig, PROMISE_CHANNEL } from '../src/common';
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

const config: GlobalAppConfig = {
  lang: 'en',
  selected_config: 0,
  version_message: 'test',
  configs: [
    {
      name: 'Default',
      tab_batch: {
        path: { source_path: '/src', destination_path: '/dst' },
        preset: 'Fast 1080p30',
        container: '.mkv',
        advanced: { included_file_types: 'mkv', temp_marker_toggle: 0 },
      },
    },
  ],
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
