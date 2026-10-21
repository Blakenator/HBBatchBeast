type DefaultMessage = {
  defaultMessage: string;
  id?: string;
  idOverridden?: boolean;
};

export function createMessages<
  K extends string,
  T extends Record<K, DefaultMessage>,
>(messages: T): T {
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]: [K, DefaultMessage]) => [
      key,
      {
        // TODO replace with key
        id: value.defaultMessage,
        idOverridden: !!value.id,
        ...value,
      },
    ]),
  ) as T;
}

/**
 * Renderer clipboard helper. Electron may serve the app from `file://`, where
 * `navigator.clipboard` is not always available, so fall back to the legacy
 * selection-based copy.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the DOM fallback
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
