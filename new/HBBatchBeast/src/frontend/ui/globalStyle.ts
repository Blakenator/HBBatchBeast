import { createGlobalStyle } from 'styled-components';
import { tokens } from './theme';

/** Maps tokens onto CSS variables, with a dark-scheme block. */
export const GlobalStyle = createGlobalStyle`
  :root {
    ${Object.entries(tokens.color.light)
      .map(([key, value]) => `--hb-${key}: ${value};`)
      .join('\n    ')}
    ${Object.entries(tokens.space)
      .map(([key, value]) => `--hb-space-${key}: ${value};`)
      .join('\n    ')}
    ${Object.entries(tokens.radius)
      .map(([key, value]) => `--hb-radius-${key}: ${value};`)
      .join('\n    ')}
    ${Object.entries(tokens.font.size)
      .map(([key, value]) => `--hb-font-${key}: ${value};`)
      .join('\n    ')}

    color-scheme: light dark;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      ${Object.entries(tokens.color.dark)
        .map(([key, value]) => `--hb-${key}: ${value};`)
        .join('\n      ')}
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
