/**
 * Design tokens for the rewrite (see docs/ui-design-intent.md §5).
 * Everything visual should reference these rather than inline values.
 */
export const tokens = {
  space: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '0.75rem',
    lg: '1rem',
    xl: '1.5rem',
    xxl: '2rem',
  },
  radius: {
    sm: '4px',
    md: '8px',
    lg: '12px',
  },
  font: {
    size: {
      xs: '0.75rem',
      sm: '0.875rem',
      md: '1rem',
      lg: '1.25rem',
      xl: '1.5rem',
    },
    weight: {
      regular: 400,
      medium: 500,
      bold: 600,
    },
  },
  color: {
    light: {
      background: '#f7f7f8',
      surface: '#ffffff',
      surfaceMuted: '#f0f0f2',
      border: '#dcdce0',
      text: '#1c1c1f',
      textMuted: '#5c5c66',
      accent: '#2f6fed',
      accentContrast: '#ffffff',
      success: '#1f7a3d',
      warning: '#9a6700',
      danger: '#b42318',
      focus: '#2f6fed',
    },
    dark: {
      background: '#16161a',
      surface: '#1f1f24',
      surfaceMuted: '#26262c',
      border: '#34343c',
      text: '#f2f2f4',
      textMuted: '#a3a3ad',
      accent: '#6a9bff',
      accentContrast: '#101014',
      success: '#4ade80',
      warning: '#fbbf24',
      danger: '#f87171',
      focus: '#6a9bff',
    },
  },
} as const;

export type ThemeMode = 'light' | 'dark';
export type ThemeTokens = typeof tokens;
