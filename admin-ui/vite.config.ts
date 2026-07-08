import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Vite + Vitest for the admin UI. The test block uses jsdom + a global setup
// (MSW server, jest-dom matchers). The dev server uses Vite's default port 5173.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    env: {
      VITE_API_URL: 'http://localhost:3000',
      VITE_DEV_ADMIN_TOKEN: 'dev-token-abc',
    },
  },
});
