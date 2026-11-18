// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Filmstrip } from '../src/frontend/organize/Filmstrip';
import type { SplitSegment } from '../src/common';

// jsdom has no layout; a fixed 1000 px strip makes clientX map to a percent.
Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value() {
    return {
      width: 1000,
      height: 104,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 104,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  },
});

afterEach(cleanup);

const episodes = [
  { tag: 'S01E01', name: 'One Ocean', seasonNumber: 1, episodeNumber: 1 },
  { tag: 'S01E02', name: 'The Deep', seasonNumber: 1, episodeNumber: 2 },
];

const segments: SplitSegment[] = [
  { index: 0, startSeconds: 0, endSeconds: 40, episode: episodes[0] },
  { index: 1, startSeconds: 40, endSeconds: 100, episode: episodes[1] },
];

function renderStrip(onPlayheadChange = vi.fn(), onMarkerChange = vi.fn()) {
  return render(
    <Filmstrip
      duration={100}
      windowStart={0}
      windowSeconds={100}
      segments={segments}
      frames={[]}
      playhead={0}
      onPlayheadChange={onPlayheadChange}
      onMarkerChange={onMarkerChange}
    />,
  );
}

describe('Filmstrip scrubbing', () => {
  it('follows the pointer continuously while scrubbing and stops on release', () => {
    const onPlayheadChange = vi.fn();
    renderStrip(onPlayheadChange);
    const strip = screen.getByLabelText('Filmstrip scrubber');

    fireEvent.pointerDown(strip, { button: 0, clientX: 250 });
    expect(onPlayheadChange).toHaveBeenLastCalledWith(25);

    fireEvent.pointerMove(strip, { clientX: 750 });
    expect(onPlayheadChange).toHaveBeenLastCalledWith(75);

    fireEvent.pointerUp(strip);
    onPlayheadChange.mockClear();
    fireEvent.pointerMove(strip, { clientX: 900 });
    expect(onPlayheadChange).not.toHaveBeenCalled();
  });

  it('moves the playhead with a cut marker so its frame stays previewed', () => {
    const onPlayheadChange = vi.fn();
    const onMarkerChange = vi.fn();
    renderStrip(onPlayheadChange, onMarkerChange);

    const marker = screen.getByRole('button', { name: 'Cut before S01E02' });
    fireEvent.pointerDown(marker, { pointerId: 1, button: 0, clientX: 400 });
    expect(onPlayheadChange).toHaveBeenLastCalledWith(40);

    fireEvent.pointerMove(marker, { clientX: 600 });
    expect(onMarkerChange).toHaveBeenCalledWith(1, 60);
    expect(onPlayheadChange).toHaveBeenLastCalledWith(60);
  });

  it('offers copy-mode keyframe alternatives and reports the landing point', () => {
    const onCandidateSelect = vi.fn();
    const onPlayheadChange = vi.fn();
    const onMarkerCommit = vi.fn();
    render(
      <Filmstrip
        duration={100}
        windowStart={0}
        windowSeconds={100}
        segments={segments}
        frames={[]}
        playhead={0}
        cutCandidates={[
          {
            index: 1,
            label: 'S01E02',
            seconds: [35, 45],
            actualSeconds: 38,
            active: true,
          },
        ]}
        onCandidateSelect={onCandidateSelect}
        onPlayheadChange={onPlayheadChange}
        onMarkerChange={vi.fn()}
        onMarkerCommit={onMarkerCommit}
      />,
    );

    expect(screen.getByTitle('Copy cut lands at 0:38.0')).toBeTruthy();
    const tick = screen.getByRole('button', {
      name: 'Use 0:35.0 for the cut before S01E02',
    });
    fireEvent.pointerDown(tick, { clientX: 350 });
    expect(onPlayheadChange).not.toHaveBeenCalled();
    fireEvent.click(tick);
    expect(onCandidateSelect).toHaveBeenCalledWith(1, 35);

    const marker = screen.getByRole('button', { name: 'Cut before S01E02' });
    fireEvent.pointerDown(marker, { pointerId: 1, button: 0, clientX: 400 });
    fireEvent.pointerUp(marker);
    expect(onMarkerCommit).toHaveBeenCalledWith(1);
  });

  it('distinguishes loading samples from a file without frames', () => {
    const { rerender } = render(
      <Filmstrip
        duration={100}
        windowStart={0}
        windowSeconds={100}
        segments={segments}
        frames={[]}
        loading
        playhead={0}
        onPlayheadChange={vi.fn()}
        onMarkerChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Loading frames…')).toBeTruthy();

    rerender(
      <Filmstrip
        duration={100}
        windowStart={0}
        windowSeconds={100}
        segments={segments}
        frames={[]}
        playhead={0}
        onPlayheadChange={vi.fn()}
        onMarkerChange={vi.fn()}
      />,
    );
    expect(screen.getByText('No frames')).toBeTruthy();
  });
});
