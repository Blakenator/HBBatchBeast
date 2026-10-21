import { createGlobalStyle } from 'styled-components';
import { tokens } from './theme';

type ColorTokens = { [K in keyof typeof tokens.color.light]: string };

/**
 * Bootstrap reads its palette from `--bs-*` variables. Without this mapping its
 * components (offcanvas, form controls, alerts) keep the stock light palette and
 * render white-on-white inside the dark app shell.
 */
const bootstrapVars = (color: ColorTokens) => `
    --bs-body-bg: ${color.background};
    --bs-body-color: ${color.text};
    --bs-emphasis-color: ${color.text};
    --bs-secondary-color: ${color.textMuted};
    --bs-heading-color: ${color.text};
    --bs-border-color: ${color.border};
    --bs-border-color-translucent: ${color.border};
    --bs-secondary-bg: ${color.surfaceMuted};
    --bs-tertiary-bg: ${color.surface};
    --bs-link-color: ${color.accent};
    --bs-link-hover-color: ${color.accent};
    --bs-focus-ring-color: ${color.focus};
`;

const tokenVars = (color: ColorTokens) =>
  Object.entries(color)
    .map(([key, value]) => `--hb-${key}: ${value};`)
    .join('\n    ');

const scaleVars = `
    ${Object.entries(tokens.space)
      .map(([key, value]) => `--hb-space-${key}: ${value};`)
      .join('\n    ')}
    ${Object.entries(tokens.radius)
      .map(([key, value]) => `--hb-radius-${key}: ${value};`)
      .join('\n    ')}
    ${Object.entries(tokens.font.size)
      .map(([key, value]) => `--hb-font-${key}: ${value};`)
      .join('\n    ')}
`;

/** Maps tokens onto CSS variables, with a dark-scheme block. */
export const GlobalStyle = createGlobalStyle`
  :root {
    ${tokenVars(tokens.color.light)}
    ${scaleVars}
    ${bootstrapVars(tokens.color.light)}
    color-scheme: light dark;
  }

  :root[data-theme='light'] {
    ${tokenVars(tokens.color.light)}
    ${bootstrapVars(tokens.color.light)}
  }

  :root[data-theme='dark'] {
    ${tokenVars(tokens.color.dark)}
    ${bootstrapVars(tokens.color.dark)}
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme='light']) {
      ${tokenVars(tokens.color.dark)}
      ${bootstrapVars(tokens.color.dark)}
    }
  }

  html,
  body,
  #root {
    height: 100%;
  }

  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica,
      Arial, sans-serif;
    background: var(--hb-background);
    color: var(--hb-text);
    font-variant-numeric: tabular-nums;
  }

  :focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`;
