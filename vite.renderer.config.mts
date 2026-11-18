import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    // Fast Refresh keeps the running UI (and its state) when a component file
    // changes. `jsxRuntime: 'classic'` matches `tsconfig.json` (`"jsx": "react"`),
    // so components keep their explicit `React` imports.
    react({ jsxRuntime: 'classic' }),
  ],
  build: {
    sourcemap: 'inline',
  },
});
