// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { getDefaultMessages } from '../src/frontend/allMessages';
import { QueueRow, QueueTable } from '../src/frontend/run/QueueTable';

const messages = getDefaultMessages();

// jsdom reports zero-size elements; the virtualizer needs a viewport to render.
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

afterEach(cleanup);

function renderTable(
  rows: QueueRow[],
  onOpenLog = vi.fn(),
  onCancel?: (row: QueueRow) => void,
) {
  return render(
    <IntlProvider locale="en" messages={messages} defaultLocale="en">
      <QueueTable rows={rows} onOpenLog={onOpenLog} onCancel={onCancel} />
    </IntlProvider>,
  );
}

const rows: QueueRow[] = [
  {
    index: 0,
    path: '/media/movies/b.mkv',
    preset: 'Fast 1080p30',
    state: 'success',
    progress: { percent: 100, fps: 42 },
    startedAt: 1000,
    finishedAt: 5000,
    sourceBytes: 10 * 1024 * 1024,
  },
  {
    index: 1,
    path: '/media/movies/a.mkv',
    preset: 'Very Fast 720p30',
    state: 'error',
    reason: 'Encoder crashed:\nstack trace line',
  },
  {
    index: 2,
    path: '/media/movies/c.mkv',
    state: 'running',
    progress: { percent: 42.5, fps: 30, etaSeconds: 90 },
  },
];

function dragColumnOnto(source: HTMLElement, target: HTMLElement) {
  const dataTransfer = {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: vi.fn(),
    getData: () => '',
  };
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  fireEvent.dragEnd(source, { dataTransfer });
}

function dataRowTexts(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent ?? '');
}

describe('QueueTable', () => {
  it('renders rows and opens the log from the row action', () => {
    const onOpenLog = vi.fn();
    renderTable(rows, onOpenLog);

    expect(screen.getByText('b.mkv')).toBeTruthy();
    expect(screen.getByText('a.mkv')).toBeTruthy();

    const logButtons = screen.getAllByRole('button', { name: /show the log/i });
    fireEvent.click(logButtons[1]);
    expect(onOpenLog).toHaveBeenCalledWith(rows[1]);
  });

  it('sorts by column header in both directions', () => {
    renderTable(rows);
    const pathHeader = screen.getByRole('columnheader', { name: 'File' });

    fireEvent.click(pathHeader);
    expect(dataRowTexts()[0]).toContain('a.mkv');

    fireEvent.click(pathHeader);
    expect(dataRowTexts()[0]).toContain('c.mkv');
  });

  it('filters with the status chips', () => {
    renderTable(rows);
    fireEvent.click(screen.getByRole('button', { name: 'Error' }));
    expect(screen.getByText('a.mkv')).toBeTruthy();
    expect(screen.queryByText('b.mkv')).toBeNull();
  });

  it('hides columns from the Bootstrap columns popover', async () => {
    renderTable(rows);
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));

    const checkbox = await screen.findByRole('checkbox', { name: 'Preset' });
    fireEvent.click(checkbox);

    expect(screen.queryByRole('columnheader', { name: 'Preset' })).toBeNull();
  });

  it('reorders columns from the columns popover', async () => {
    renderTable(rows);
    const labels = () =>
      screen
        .getAllByRole('columnheader')
        .map((header) => header.getAttribute('aria-label'));

    expect(labels().slice(0, 3)).toEqual(['#', 'File', 'Preset']);
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Move File right' }),
    );
    expect(labels().slice(0, 3)).toEqual(['#', 'Preset', 'File']);
  });

  it('reorders columns by dragging a header onto another header', () => {
    renderTable(rows);
    const headers = () => screen.getAllByRole('columnheader');
    const labels = () => headers().map((header) => header.getAttribute('aria-label'));

    expect(labels().slice(0, 3)).toEqual(['#', 'File', 'Preset']);
    dragColumnOnto(headers()[1], headers()[2]);
    expect(labels().slice(0, 3)).toEqual(['#', 'Preset', 'File']);
    dragColumnOnto(headers()[0], headers()[1]);
    expect(labels().slice(0, 2)).toEqual(['Preset', '#']);
  });

  it('shows the preset name and keeps raw arguments in a hidden column', () => {
    renderTable([
      {
        index: 0,
        path: '/media/movies/a.mkv',
        preset: '-Z "H.265 MKV 1080p30"',
        state: 'pending',
      },
    ]);

    expect(screen.getByText('H.265 MKV 1080p30')).toBeTruthy();
    expect(screen.queryByText('-Z "H.265 MKV 1080p30"')).toBeNull();
  });

  it('shows raw arguments once the Arguments column is enabled', async () => {
    renderTable([
      {
        index: 0,
        path: '/media/movies/a.mkv',
        preset: '-Z "H.265 MKV 1080p30"',
        state: 'pending',
      },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Arguments' }));

    expect(screen.getByText('-Z "H.265 MKV 1080p30"')).toBeTruthy();
  });

  it('offers cancel for in-flight rows while a run is active', () => {
    const onCancel = vi.fn();
    renderTable(rows, vi.fn(), onCancel);

    const cancelButtons = screen.getAllByRole('button', { name: /cancel this file/i });
    fireEvent.click(cancelButtons[0]);
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows the aggregate failure reason in its column', () => {
    renderTable(rows);
    expect(screen.getByText('Encoder crashed:')).toBeTruthy();
  });
});
