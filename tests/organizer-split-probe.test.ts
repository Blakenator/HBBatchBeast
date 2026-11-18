import { describe, expect, it, vi } from 'vitest';
import { findKeyframesNear } from '../src/backend/organizer/split/probe';

describe('findKeyframesNear', () => {
  it('lists every keyframe in the window as an alternative', async () => {
    const readWindow = async (
      _path: string,
      seconds: number,
      _windowSeconds: number,
    ) => (seconds === 60 ? [66, 48, 60.5, 55, 60.5] : []);

    const cuts = await findKeyframesNear(
      '/media/tv/episode.mkv',
      [60],
      { windowSeconds: 10 },
      { readWindow },
    );

    expect(cuts).toEqual([
      {
        requestedSeconds: 60,
        keyframeSeconds: 60.5,
        deltaSeconds: 0.5,
        candidates: [48, 55, 60.5, 66],
      },
    ]);
  });

  it('shifts the read window and the results by the video start offset', async () => {
    const readWindow = vi.fn(
      async (_path: string, _seconds: number, _window: number) => [49, 55, 61],
    );

    const cuts = await findKeyframesNear(
      '/media/tv/episode.mkv',
      [60],
      { windowSeconds: 5, startTimeSeconds: 5 },
      { readWindow },
    );

    // The editor works relative to the file; ffprobe reads absolute PTS.
    expect(readWindow).toHaveBeenCalledWith('/media/tv/episode.mkv', 65, 5);
    expect(cuts[0]).toEqual({
      requestedSeconds: 60,
      keyframeSeconds: 56,
      deltaSeconds: -4,
      candidates: [44, 50, 56],
    });
  });

  it('still reports candidates when the minimum-gap rule moves the cut', async () => {
    const readWindow = async (_path: string, seconds: number) =>
      seconds === 20 ? [10, 19, 20] : [30, 40, 42];

    const cuts = await findKeyframesNear(
      '/media/tv/episode.mkv',
      [20, 30],
      { minGapSeconds: 15 },
      { readWindow },
    );

    expect(cuts[0].keyframeSeconds).toBe(20);
    // 30 is closer, but 20 + 15 s leaves 40 as the first usable keyframe.
    expect(cuts[1].keyframeSeconds).toBe(40);
    expect(cuts[1].candidates).toEqual([30, 40, 42]);
  });
});
