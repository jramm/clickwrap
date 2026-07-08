/**
 * Global app configuration derived from build-time environment variables.
 * The brand name shown in the AppBar, page title and login screen is fully
 * configurable via VITE_APP_NAME (defaults to "clickwrap-server").
 */
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'clickwrap-server';
