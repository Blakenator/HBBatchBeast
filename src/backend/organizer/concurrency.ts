/**
 * Runs an async worker over items with a bounded number of concurrent jobs.
 * Results keep the input order, which keeps plan ordering deterministic.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0) return results;
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

/**
 * Like `mapWithConcurrency`, but stops taking new items once the signal is
 * aborted. Unstarted items keep `undefined` in the result.
 */
export async function mapWithConcurrencyUntil<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<(R | undefined)[]> {
  const results = new Array<R | undefined>(items.length);
  if (items.length === 0) return results;
  const workers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        if (signal?.aborted) return;
        const index = next;
        next += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}
