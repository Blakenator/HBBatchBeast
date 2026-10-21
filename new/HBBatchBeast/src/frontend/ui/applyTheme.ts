/**
 * Keeps the global theme attributes in sync with the OS colour scheme. Our
 * tokens read `[data-theme]`, Bootstrap components read `[data-bs-theme]`.
 */
export function applyThemeMode(): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const sync = () => {
    const mode = query.matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.bsTheme = mode;
  };
  sync();
  query.addEventListener('change', sync);
}
