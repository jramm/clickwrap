/**
 * Core plugin contract: manifest, `definePlugin`, plugin context, and the host DI tokens.
 *
 * A plugin is an npm package whose package.json carries the manifest field
 *
 *   "clickwrap": { "kind": "email-provider" | "file-storage" | "admin-auth" | "customer-source" | "acceptance-page", "key": "<slug>" }
 *
 * and whose main entry default-exports the result of {@link definePlugin} (or a plain object of
 * the same shape — the SDK is not required at runtime). The host discovers manifests in the app's
 * installed dependencies (plus `CLICKWRAP_PLUGIN_PATHS`) and activates plugins per kind via env
 * (`EMAIL_PROVIDER`, `FILE_STORAGE`, `ADMIN_AUTH`, `CUSTOMER_SOURCE`, `ACCEPTANCE_PAGE`).
 */
import type { DynamicModule } from '@nestjs/common';
import type { AcceptancePageRenderer } from './kinds/acceptance-page';
import type { AdminAuthStrategy } from './kinds/admin-auth';
import type { CustomerSource } from './kinds/customer-source';
import type { EmailDeliveryProvider } from './kinds/email';
import type { FileStorage } from './kinds/file-storage';

/** What `create(ctx)` must return, per plugin kind. */
export interface PluginKindImplementations {
  'email-provider': EmailDeliveryProvider;
  'file-storage': FileStorage;
  'admin-auth': AdminAuthStrategy;
  'customer-source': CustomerSource;
  'acceptance-page': AcceptancePageRenderer;
}

export type ClickwrapPluginKind = keyof PluginKindImplementations;

export const CLICKWRAP_PLUGIN_KINDS: readonly ClickwrapPluginKind[] = [
  'email-provider',
  'file-storage',
  'admin-auth',
  'customer-source',
  'acceptance-page',
];

/** The `"clickwrap"` field of a plugin package's package.json. */
export interface ClickwrapPluginManifest {
  kind: ClickwrapPluginKind;
  key: string;
}

export interface PluginLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Host-provided context handed to `create()` — the only way plugins should read configuration. */
export interface PluginContext {
  /** Environment lookup; empty values count as unset and yield the fallback. */
  env(name: string, fallback?: string): string | undefined;
  /** Like `env`, but a missing/empty value is a boot error naming the plugin. */
  requireEnv(name: string): string;
  logger: PluginLogger;
}

export interface ClickwrapPlugin<K extends ClickwrapPluginKind = ClickwrapPluginKind> {
  readonly kind: K;
  /** Selection key, matched against EMAIL_PROVIDER / FILE_STORAGE / ADMIN_AUTH. Lowercase slug. */
  readonly key: string;
  /** Builds the kind implementation. Called once at boot, only when the plugin is active. */
  create(ctx: PluginContext): PluginKindImplementations[K];
  /**
   * Optional Nest module for plugins that need controllers or scheduled jobs (webhooks, polling,
   * local file serving). Mounted by the host ONLY while the plugin is active; its `controllers`,
   * `providers` and `imports` are merged into the host module (`exports` are ignored).
   * Requires `@nestjs/common` as a peer dependency of the plugin package.
   */
  module?(): DynamicModule;
}

/** Union of all concretely-typed plugins (the discovery result type). */
export type AnyClickwrapPlugin = { [K in ClickwrapPluginKind]: ClickwrapPlugin<K> }[ClickwrapPluginKind];

const KEY_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const isPluginKind = (value: unknown): value is ClickwrapPluginKind =>
  typeof value === 'string' && (CLICKWRAP_PLUGIN_KINDS as readonly string[]).includes(value);

/** Structural check for a plugin module's default export (works without SDK identity at runtime). */
export const isClickwrapPlugin = (value: unknown): value is AnyClickwrapPlugin => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { kind?: unknown; key?: unknown; create?: unknown; module?: unknown };
  return (
    isPluginKind(candidate.kind) &&
    typeof candidate.key === 'string' &&
    KEY_PATTERN.test(candidate.key) &&
    typeof candidate.create === 'function' &&
    (candidate.module === undefined || typeof candidate.module === 'function')
  );
};

/**
 * Declares a plugin. Purely declarative — no side effects; validates the shape early so a broken
 * plugin fails at module load, not at first use.
 */
export const definePlugin = <K extends ClickwrapPluginKind>(plugin: ClickwrapPlugin<K>): ClickwrapPlugin<K> => {
  if (!isPluginKind(plugin.kind)) {
    throw new Error(`definePlugin: unknown kind "${String(plugin.kind)}" — allowed: ${CLICKWRAP_PLUGIN_KINDS.join(', ')}`);
  }
  if (typeof plugin.key !== 'string' || !KEY_PATTERN.test(plugin.key)) {
    throw new Error(`definePlugin: key "${String(plugin.key)}" must be a lowercase slug ([a-z0-9-])`);
  }
  if (typeof plugin.create !== 'function') {
    throw new Error(`definePlugin: plugin "${plugin.key}" has no create() function`);
  }
  return Object.freeze({ ...plugin });
};

/**
 * DI tokens the host binds for plugin modules. Deliberately STRINGS (not symbols): an externally
 * installed plugin package must be able to `@Inject('clickwrap:…')` without sharing a symbol
 * instance with the host.
 */
export const PLUGIN_DI_TOKENS = {
  /** The host's inbound delivery-event sink; bound while the plugin is the active e-mail provider. */
  InboundDeliveryEventSink: 'clickwrap:inbound-delivery-event-sink',
  /** The active FileStorage instance; bound while the plugin is the active file storage. */
  FileStorage: 'clickwrap:file-storage',
  /** The active CustomerSource instance; bound while the plugin is the active customer source. */
  CustomerSource: 'clickwrap:customer-source',
  /** The active AcceptancePageRenderer; bound while the plugin is the active acceptance page. */
  AcceptancePageRenderer: 'clickwrap:acceptance-page',
} as const;
