import { CustomerSyncJob } from './customer-sync.job';
import type { CustomerSyncService } from './customer-sync.service';

describe('CustomerSyncJob', () => {
  const original = { source: process.env.CUSTOMER_SOURCE, enabled: process.env.CUSTOMER_SYNC_ENABLED };

  afterEach(() => {
    process.env.CUSTOMER_SOURCE = original.source;
    process.env.CUSTOMER_SYNC_ENABLED = original.enabled;
  });

  const jobWith = (): { job: CustomerSyncJob; sync: jest.Mock } => {
    const sync = jest.fn().mockResolvedValue({ created: 0, updated: 0, reactivated: 0, deleted: 0, errors: 0 });
    const job = new CustomerSyncJob({ sync } as unknown as CustomerSyncService);
    return { job, sync };
  };

  it('calls CustomerSyncService.sync() when a real source is configured', async () => {
    process.env.CUSTOMER_SOURCE = 'metergrid';
    delete process.env.CUSTOMER_SYNC_ENABLED;
    const { job, sync } = jobWith();

    await job.run();

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when CUSTOMER_SOURCE=none (sync is never called)', async () => {
    process.env.CUSTOMER_SOURCE = 'none';
    const { job, sync } = jobWith();

    await job.run();

    expect(sync).not.toHaveBeenCalled();
  });

  it('is a no-op when CUSTOMER_SYNC_ENABLED=false (kill switch)', async () => {
    process.env.CUSTOMER_SOURCE = 'metergrid';
    process.env.CUSTOMER_SYNC_ENABLED = 'false';
    const { job, sync } = jobWith();

    await job.run();

    expect(sync).not.toHaveBeenCalled();
  });
});
