import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from '../src/backend/organizer/concurrency';

describe('mapWithConcurrency', () => {
  it('keeps input order while bounding concurrent work', async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, index) => index);
    const results = await mapWithConcurrency(items, 3, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return item * 2;
    });

    expect(results).toEqual(items.map((item) => item * 2));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('handles empty input and a limit larger than the item count', async () => {
    await expect(mapWithConcurrency([], 4, async () => 1)).resolves.toEqual([]);
    await expect(
      mapWithConcurrency([1, 2], 40, async (item) => item + 1),
    ).resolves.toEqual([2, 3]);
  });
});
