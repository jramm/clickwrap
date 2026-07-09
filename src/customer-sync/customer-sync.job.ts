import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { selectedCustomerSourceKey } from '../plugins/registry/selection';
import { CustomerSyncService } from './customer-sync.service';

/** Kill switch mirroring SWEEPER_ENABLED: CUSTOMER_SYNC_ENABLED=false disables the scheduled sync. */
const isCustomerSyncEnabled = (): boolean => process.env.CUSTOMER_SYNC_ENABLED !== 'false';

/**
 * Thin 12-hour cron registration — the reconcile logic (testable without Nest) lives in
 * {@link CustomerSyncService}. Gated: a run is a full no-op unless a real source is configured
 * (CUSTOMER_SOURCE !== 'none') and the kill switch is on. `sync()` is never even called for the
 * default `none` source.
 */
@Injectable()
export class CustomerSyncJob {
  private readonly logger = new Logger(CustomerSyncJob.name);

  constructor(private readonly service: CustomerSyncService) {}

  @Cron(CronExpression.EVERY_12_HOURS)
  async run(): Promise<void> {
    if (!isCustomerSyncEnabled() || selectedCustomerSourceKey() === 'none') {
      return;
    }
    try {
      await this.service.sync();
    } catch (err) {
      // A whole-run failure (e.g. the source is unreachable) must not crash the scheduler.
      this.logger.error('Customer sync run failed', err instanceof Error ? err.stack : String(err));
    }
  }
}
