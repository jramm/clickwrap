/**
 * Explicit plugin activation via env — discovery never activates anything by itself:
 *  - EMAIL_PROVIDER  (default noop)     → one active email-provider plugin
 *  - FILE_STORAGE    (default memory)   → one active file-storage plugin
 *  - ADMIN_AUTH      (default google-sso,static-token) → ORDERED list of admin-auth plugins
 */

export const selectedEmailProviderKey = (): string => (process.env.EMAIL_PROVIDER ?? 'noop').trim().toLowerCase();

export const selectedFileStorageKey = (): string => (process.env.FILE_STORAGE ?? 'memory').trim().toLowerCase();

export const selectedAdminAuthKeys = (): string[] =>
  (process.env.ADMIN_AUTH ?? 'google-sso,static-token')
    .split(',')
    .map((key) => key.trim().toLowerCase())
    .filter((key) => key.length > 0);
