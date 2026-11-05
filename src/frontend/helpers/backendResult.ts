/**
 * IPC hooks hand back the serialized `AppError` string instead of the instance
 * their types promise, and resolve to `undefined` when the bridge rejects.
 * Without unwrapping both, failures end up as empty toasts or `TypeError`s.
 */
interface BackendResultLike {
  error?: unknown;
}

function messageFromSerializedError(serialized: string): string {
  try {
    const parsed = JSON.parse(serialized) as {
      message?: unknown;
      inner?: { message?: unknown };
    };
    const inner =
      typeof parsed.inner?.message === 'string' && parsed.inner.message
        ? parsed.inner.message
        : undefined;
    if (inner) return inner;
    if (typeof parsed.message === 'string' && parsed.message) {
      return parsed.message;
    }
  } catch {
    // Not JSON: the IPC layer passed the error text through unchanged.
  }
  return serialized;
}

/** Best-effort text for any error shape an IPC call can produce. */
export function backendErrorMessage(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  if (typeof error === 'string') return messageFromSerializedError(error);
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return undefined;
}

/**
 * Message to show for a failed backend call, or `undefined` when it succeeded.
 * A missing result counts as a failure because the hook swallows rejections.
 */
export function backendFailure(
  result: BackendResultLike | undefined,
  fallback: string,
): string | undefined {
  if (!result) return fallback;
  if (!result.error) return undefined;
  return backendErrorMessage(result.error) ?? fallback;
}
