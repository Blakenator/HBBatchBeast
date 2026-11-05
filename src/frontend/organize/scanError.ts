interface ErrorLike {
  message?: unknown;
  inner?: unknown;
  cause?: unknown;
}

const FALLBACK = 'Organize scan failed. Check the diagnostics log for details.';

/**
 * Async backend errors arrive as `AppError('error', { inner })`, so the outer
 * message is generic. Walk the chain and keep the most specific message: the
 * wrapper ("Organize scan failed") only wins when it is all we have. Never
 * return an empty message — an empty toast is worse than a generic fallback.
 */
export function describeOrganizeScanError(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error.trim();
  const seen = new Set<unknown>();
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!current || typeof current !== 'object' || seen.has(current)) break;
    seen.add(current);
    const { message, inner, cause } = current as ErrorLike;
    if (typeof message === 'string') {
      const text = message.trim();
      if (text && text !== 'error') messages.push(text);
    }
    current = inner ?? cause;
  }
  if (messages.length === 0) return FALLBACK;
  return messages[messages.length - 1];
}
