/**
 * Plugin-backed customer sync.
 *
 * `CustomerSyncModule.forRoot()` selects the customer-source plugin from env CUSTOMER_SOURCE
 * (default `none` → sync disabled) via the plugin REGISTRY — built-ins (`none`) and installed
 * third-party packages (e.g. a metergrid adapter) go through the exact same mechanism as the e-mail
 * provider (see docs/PLUGINS.md). The selected plugin's `create(ctx)` result is bound to
 * CUSTOMER_SYNC_TOKENS.CustomerSource, exactly like EmailModule binds the e-mail provider; an
 * unknown key is a boot error listing the available keys.
 *
 * The reconcile engine (CustomerSyncService) and the 12-hour cron (CustomerSyncJob) are always
 * wired; the job no-ops for the `none` source. CustomerAdminService comes from the imported
 * CustomerServiceModule; the domain repos / Clock / EventRecorder come from the @Global
 * RepositoryModule. Provider-only (not @Global) — imported once by AppModule.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { CustomerServiceModule } from '../customers/customer-service.module';
import type { CustomerSource } from '../plugin-sdk';
import { createPluginContext } from '../plugins/registry/plugin-context';
import { getPluginRegistry } from '../plugins/registry/plugin-registry';
import { selectedCustomerSourceKey } from '../plugins/registry/selection';
import { CustomerSyncJob } from './customer-sync.job';
import { CustomerSyncService } from './customer-sync.service';
import { CUSTOMER_SYNC_TOKENS, type CustomerSyncConfig } from './ports';

/** Reads and validates CUSTOMER_SOURCE against the registry (default: none — sync disabled). */
export const customerSource = (): string => {
  const key = selectedCustomerSourceKey();
  getPluginRegistry().select('customer-source', key, 'CUSTOMER_SOURCE');
  return key;
};

/** Default audience keys assigned to synced customers — CUSTOMER_SYNC_DEFAULT_ROLES (empty ⇒ none). */
export const customerSyncConfig = (): CustomerSyncConfig => ({
  sourceKey: selectedCustomerSourceKey(),
  defaultRoles: (process.env.CUSTOMER_SYNC_DEFAULT_ROLES ?? '')
    .split(',')
    .map((role) => role.trim())
    .filter((role) => role.length > 0),
});

/** Builds the selected CustomerSource via the registry plugin's create(ctx). */
export const customerSourceFactory = (): CustomerSource => {
  const plugin = getPluginRegistry().select('customer-source', selectedCustomerSourceKey(), 'CUSTOMER_SOURCE');
  return plugin.create(createPluginContext(plugin));
};

@Module({})
export class CustomerSyncModule {
  static forRoot(): DynamicModule {
    return {
      module: CustomerSyncModule,
      imports: [CustomerServiceModule],
      providers: [
        { provide: CUSTOMER_SYNC_TOKENS.CustomerSource, useFactory: customerSourceFactory },
        { provide: CUSTOMER_SYNC_TOKENS.Config, useFactory: customerSyncConfig },
        CustomerSyncService,
        CustomerSyncJob,
      ],
      exports: [CustomerSyncService],
    };
  }
}
