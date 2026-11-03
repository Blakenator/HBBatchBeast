interface ErrorLike {
  message?: unknown;
  inner?: unknown;
}

const FALLBACK = 'Organize scan failed. Check the diagnostics log for details.';

/**
 * Async backend errors arrive as `AppError('error', { inner })`, so the outer
 * message is generic. Walk the chain for a meaningful message and never return
 * an empty one — an empty toast is worse than a generic fallback.
 */
export function describeOrganizeScanError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== 'object' || seen.has(current)) break;
    seen.add(current);
    const { message, inner } = current as ErrorLike;
    if (typeof message === 'string') {
      const text = message.trim();
      if (text && text !== 'error') return text;
    }
    current = inner;
  }
  return FALLBACK;
}
