// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ApplyProgress } from '../src/frontend/organize/ApplyProgress';

afterEach(cleanup);

const progress = {
  phase: 'splitting' as const,
  completed: 3,
  total: 6,
  currentPath: '/media/tv/Blue Planet II/S01E01-E02.mkv',
  currentKind: 'split' as const,
  currentPercent: 0.4,
  splitCompleted: 1,
  splitTotal: 2,
  elapsedMs: 30_000,
  etaMs: 60_000,
  warnings: ['Subtitles stay with the original.'],
};

describe('ApplyProgress', () => {
  it('shows an overall bar, the current split and an ETA', () => {
    render(
      <ApplyProgress
        progress={progress}
        applying
        cancelling={false}
        onCancel={vi.fn()}
      />,
    );
    const bars = screen.getAllByRole('progressbar');
    expect(bars[0].getAttribute('aria-valuenow')).toBe('50');
    expect(bars[1].getAttribute('aria-valuenow')).toBe('40');
    expect(screen.getByText(/3 of 6 result files/)).toBeTruthy();
    expect(screen.getByText(/about 1m 00s left/)).toBeTruthy();
    expect(screen.getByText(/Source files: 1 of 2 done/)).toBeTruthy();
    expect(screen.getByText(/S01E01-E02\.mkv/)).toBeTruthy();
    expect(screen.getByText(/Subtitles stay with the original/)).toBeTruthy();
  });

  it('counts result files while one source file splits into many', () => {
    render(
      <ApplyProgress
        progress={{
          ...progress,
          completed: 2.1,
          total: 14,
          splitCompleted: 0,
          splitTotal: 1,
          currentPercent: 0.15,
        }}
        applying
        cancelling={false}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/2 of 14 result files · 15%/)).toBeTruthy();
    expect(screen.queryByText(/Source files:/)).toBeNull();
  });

  it('cancels through the callback and disables while cancelling', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <ApplyProgress
        progress={progress}
        applying
        cancelling={false}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Cancel apply/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <ApplyProgress
        progress={progress}
        applying
        cancelling
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('button', { name: /Cancelling/ })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('renders a starting state before the first progress event', () => {
    render(<ApplyProgress applying cancelling={false} onCancel={vi.fn()} />);
    expect(screen.getByText('Starting apply…')).toBeTruthy();
    expect(screen.getAllByRole('progressbar')[0]).toBeTruthy();
  });
});
