// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { getDefaultMessages } from '../src/frontend/allMessages';
import { RunCharts } from '../src/frontend/run/RunCharts';
import { RunStatePayload } from '../src/frontend/run/types';
import { RunTelemetry } from '../src/frontend/run/useRunTelemetry';

Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get: () => 392,
});
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get: () => 900,
});

afterEach(cleanup);

const now = Date.now();
const state: RunStatePayload = {
  status: 'running',
  items: [
    {
      path: '/media/a.mkv',
      preset: 'Fast',
      state: 'success',
      startedAt: now - 60_000,
      finishedAt: now - 30_000,
      sourceBytes: 10 * 1024 * 1024,
      outputBytes: 4 * 1024 * 1024,
    },
    {
      path: '/media/b.mkv',
      preset: 'Fast',
      state: 'running',
      sourceBytes: 10 * 1024 * 1024,
      writtenBytes: 2 * 1024 * 1024,
      progress: { percent: 40 },
    },
    { path: '/media/c.mkv', preset: 'Fast', state: 'pending' },
  ],
  counts: {
    total: 3,
    pending: 1,
    running: 1,
    success: 1,
    error: 0,
    cancelled: 0,
    skipped: 0,
  },
  logs: [],
  workerCount: 2,
  startedAt: now - 60_000,
};

const telemetry: RunTelemetry = {
  work: 1.4,
  total: 3,
  fraction: 1.4 / 3,
  processedBytes: 5 * 1024 * 1024,
  knownBytes: 10 * 1024 * 1024,
  fps: 42,
  filesPerMinute: 3.5,
  bytesPerSecond: 2 * 1024 * 1024,
  etaSeconds: 90,
  finishAt: now + 90_000,
  elapsedSeconds: 60,
  stalled: false,
  points: [
    { at: now - 2000, filesPerMinute: 2, bytesPerSecond: 1024 * 1024, fps: 30 },
    { at: now, filesPerMinute: 3, bytesPerSecond: 2 * 1024 * 1024, fps: 42 },
  ],
};

describe('RunCharts', () => {
  it('renders the live status, completion, speed and ETA cards', () => {
    render(
      <IntlProvider locale="en" messages={getDefaultMessages()} defaultLocale="en">
        <RunCharts state={state} telemetry={telemetry} />
      </IntlProvider>,
    );

    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('Completion')).toBeTruthy();
    expect(screen.getByText('Files per minute')).toBeTruthy();
    expect(screen.getByText('Data throughput')).toBeTruthy();
    expect(screen.getByText('Frames per second')).toBeTruthy();
    expect(screen.getByText('Time remaining')).toBeTruthy();
    expect(screen.getByText('1m 30s')).toBeTruthy();
    expect(screen.getByText('Before / after sizes')).toBeTruthy();
    expect(
      screen.getByText('Total: 10.0 MB → 4.0 MB · 6.0 MB saved (−60%)'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Expected total (incl. 1 in progress): 20.0 MB → 9.0 MB · 11.0 MB saved (−55%)',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Across 1 file · 1 in progress (expected)'),
    ).toBeTruthy();
    // ECharts mounts an SVG per chart.
    expect(document.querySelectorAll('svg').length).toBeGreaterThanOrEqual(5);
  });

  it('reports a paused run without an ETA', () => {
    render(
      <IntlProvider locale="en" messages={getDefaultMessages()} defaultLocale="en">
        <RunCharts
          state={{ ...state, status: 'paused' }}
          telemetry={{ ...telemetry, etaSeconds: 60 }}
        />
      </IntlProvider>,
    );
    expect(screen.getByText('Paused')).toBeTruthy();
  });
});
