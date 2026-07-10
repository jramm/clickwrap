/**
 * Explicit plugin activation via env — discovery never activates anything by itself:
 *  - EMAIL_PROVIDER   (default noop)     → one active email-provider plugin
 *  - FILE_STORAGE     (default memory)   → one active file-storage plugin
 *  - ADMIN_AUTH       (default google-sso,static-token) → ORDERED list of admin-auth plugins
 *  - CUSTOMER_SOURCE  (default none)     → one active customer-source plugin (none = sync disabled)
 *  - ACCEPTANCE_PAGE  (default default)  → one active acceptance-page renderer plugin
 */

export const selectedEmailProviderKey = (): string => (process.env.EMAIL_PROVIDER ?? 'noop').trim().toLowerCase();

export const selectedFileStorageKey = (): string => (process.env.FILE_STORAGE ?? 'memory').trim().toLowerCase();

export const selectedCustomerSourceKey = (): string => (process.env.CUSTOMER_SOURCE ?? 'none').trim().toLowerCase();

export const selectedAcceptancePageKey = (): string =>
  (process.env.ACCEPTANCE_PAGE ?? 'default').trim().toLowerCase();

export const selectedAdminAuthKeys = (): string[] =>
  (process.env.ADMIN_AUTH ?? 'google-sso,static-token')
    .split(',')
    .map((key) => key.trim().toLowerCase())
    .filter((key) => key.length > 0);
