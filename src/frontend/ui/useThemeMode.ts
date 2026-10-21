import { useEffect, useState } from 'react';
import { ThemeMode } from './theme';

function currentMode(): ThemeMode {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/**
 * `applyThemeMode` writes the resolved mode onto `<html data-theme>`; charts
 * need the concrete token values, so re-read them whenever that attribute
 * changes (OS scheme switch, or a future manual override).
 */
export function useThemeMode(): ThemeMode {
  const [mode, setMode] = useState<ThemeMode>(currentMode);

  useEffect(() => {
    const observer = new MutationObserver(() => setMode(currentMode()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return mode;
}
