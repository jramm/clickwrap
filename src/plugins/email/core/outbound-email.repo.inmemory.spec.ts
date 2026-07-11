import { InMemoryOutboundEmailRepo } from './outbound-email.repo.inmemory.js';
import type { OutboundEmail } from './outbound-email.js';

const anEmail = (overrides: Partial<OutboundEmail> = {}): OutboundEmail => ({
  providerRef: 'ref-1',
  customerId: 'c-123',
  versionId: 'v-1',
  recipient: 'max@customer.example',
  sentAt: new Date('2026-07-07T09:00:00Z'),
  ...overrides,
});

describe('InMemoryOutboundEmailRepo', () => {
  let repo: InMemoryOutboundEmailRepo;

  beforeEach(() => {
    repo = new InMemoryOutboundEmailRepo();
  });

  it('save + findByProviderRef returns the stored send', async () => {
    await repo.save(anEmail());
    const found = await repo.findByProviderRef('ref-1');
    expect(found?.customerId).toBe('c-123');
    expect(found?.deliveredAt).toBeUndefined();
  });

  it('findByProviderRef returns undefined for an unknown providerRef', async () => {
    expect(await repo.findByProviderRef('unknown')).toBeUndefined();
  });

  it('returns copies — mutating the return value does not change the store', async () => {
    await repo.save(anEmail());
    const found = await repo.findByProviderRef('ref-1');
    found!.recipient = 'other@customer.example';
    const foundAgain = await repo.findByProviderRef('ref-1');
    expect(foundAgain?.recipient).toBe('max@customer.example');
  });

  it('markDelivered sets deliveredAt', async () => {
    await repo.save(anEmail());
    const updated = await repo.markDelivered('ref-1', new Date('2026-07-07T09:05:00Z'));
    expect(updated?.deliveredAt?.toISOString()).toBe('2026-07-07T09:05:00.000Z');
  });

  it('markDelivered is idempotent: a second call does not overwrite the first timestamp', async () => {
    await repo.save(anEmail());
    await repo.markDelivered('ref-1', new Date('2026-07-07T09:05:00Z'));
    await repo.markDelivered('ref-1', new Date('2026-07-07T09:10:00Z'));
    const found = await repo.findByProviderRef('ref-1');
    expect(found?.deliveredAt?.toISOString()).toBe('2026-07-07T09:05:00.000Z');
  });

  it('markDelivered for an unknown providerRef returns undefined', async () => {
    expect(await repo.markDelivered('unknown', new Date())).toBeUndefined();
  });

  it('findPendingOlderThan returns only undelivered sends older than the cutoff', async () => {
    await repo.save(anEmail({ providerRef: 'old-pending', sentAt: new Date('2026-07-01T00:00:00Z') }));
    await repo.save(anEmail({ providerRef: 'recent-pending', sentAt: new Date('2026-07-07T09:01:00Z') }));
    await repo.save(anEmail({ providerRef: 'old-delivered', sentAt: new Date('2026-07-01T00:00:00Z') }));
    await repo.markDelivered('old-delivered', new Date('2026-07-01T00:10:00Z'));

    const pending = await repo.findPendingOlderThan(new Date('2026-07-07T09:00:00Z'));

    expect(pending.map((e) => e.providerRef)).toEqual(['old-pending']);
  });
});
