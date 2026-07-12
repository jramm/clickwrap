import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Vite + Vitest for the admin UI. The test block uses jsdom + a global setup
// (MSW server, jest-dom matchers). The dev server uses Vite's default port 5173.
export default defineConfig({
  // Base public path. '/' by default; the "combined" Docker image builds with VITE_BASE=/ui/
  // so the SPA is served under /ui by the backend (ServeStaticModule) at the same origin.
  base: process.env.VITE_BASE ?? '/',
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
