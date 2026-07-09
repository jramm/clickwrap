import type { Actor } from '../common/auth/actor';
import { PLUGIN_DI_TOKENS } from '../plugin-sdk';

/**
 * DI tokens for the customer-sync module.
 *  - `CustomerSource`: the active {@link CustomerSource} plugin instance (bound by
 *    CustomerSyncModule.forRoot from the registry, exactly like EmailModule binds the e-mail
 *    provider). Reuses the SDK string token so an external customer-source plugin could @Inject it.
 *  - `Config`: the resolved {@link CustomerSyncConfig} (source key + default roles from env).
 */
export const CUSTOMER_SYNC_TOKENS = {
  CustomerSource: PLUGIN_DI_TOKENS.CustomerSource,
  Config: Symbol('CustomerSyncConfig'),
} as const;

/** Resolved runtime configuration of the sync (see CustomerSyncModule.forRoot). */
export interface CustomerSyncConfig {
  /** The active customer-source key — tags created customers and scopes the reconcile set. */
  sourceKey: string;
  /** Default audience keys assigned to newly-created customers (CUSTOMER_SYNC_DEFAULT_ROLES; [] = none). */
  defaultRoles: string[];
}

/**
 * Actor for customers created/updated/deleted by the scheduled sync — no human involvement. The
 * recorder stamps SYSTEM events; this userId is the actorLabel / audit actor.
 */
export const CUSTOMER_SYNC_SYSTEM_ACTOR: Actor = {
  userId: 'customer-sync',
  name: 'Customer-Sync',
};
