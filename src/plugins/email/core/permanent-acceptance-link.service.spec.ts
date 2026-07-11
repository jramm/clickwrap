import { FixedClock } from '../../../domain/clock.js';
import { isAcceptanceLinkUsable } from '../../../domain/acceptance-links.js';
import { InMemoryAcceptanceLinkRepo } from '../../../persistence/inmemory/acceptance-link.repo.js';
import { InMemoryEventRepo } from '../../../persistence/inmemory/index.js';
import { EventRecorder } from '../../../events/event-recorder.js';
import type { NotificationConfig } from './email-delivery-provider.js';
import { PermanentAcceptanceLinkService } from './permanent-acceptance-link.service.js';

const config: NotificationConfig = {
  appName: 'Clickwrap',
  publicBaseUrl: 'https://clickwrap.example.org/',
  acceptanceLinkSecret: 'test-secret',
};

describe('PermanentAcceptanceLinkService', () => {
  let links: InMemoryAcceptanceLinkRepo;
  let clock: FixedClock;
  let eventRepo: InMemoryEventRepo;
  let service: PermanentAcceptanceLinkService;

  beforeEach(() => {
    links = new InMemoryAcceptanceLinkRepo();
    clock = new FixedClock(new Date('2026-07-08T09:00:00Z'));
    eventRepo = new InMemoryEventRepo();
    service = new PermanentAcceptanceLinkService(links, clock, config, new EventRecorder(eventRepo, clock));
  });

  it('creates one permanent, non-expiring link and reuses it across calls (same customer)', async () => {
    const first = await service.ensureForCustomer('c-1');
    const second = await service.ensureForCustomer('c-1');

    expect(first.id).toBe(second.id);
    expect(first.kind).toBe('PERMANENT');
    expect(first.expiresAt).toBeUndefined();
    expect(await links.listByCustomer('c-1')).toHaveLength(1);
  });

  it('records ACCEPTANCE_LINK_CREATED once on first creation and not on the idempotent second call', async () => {
    await service.ensureForCustomer('c-1');

    const afterFirst = await eventRepo.query({});
    expect(afterFirst.total).toBe(1);
    expect(afterFirst.items[0]).toMatchObject({ type: 'ACCEPTANCE_LINK_CREATED', actorKind: 'SYSTEM' });

    await service.ensureForCustomer('c-1');
    expect((await eventRepo.query({})).total).toBe(1);
  });

  it('the permanent link never expires (usable far in the future)', async () => {
    const link = await service.ensureForCustomer('c-1');
    expect(isAcceptanceLinkUsable(link, new Date('2099-01-01T00:00:00Z'))).toBe(true);
  });

  it('revocation kills the reused link (subsequent ensure returns the revoked row)', async () => {
    const link = await service.ensureForCustomer('c-1');
    await links.revoke(link.id, new Date('2026-07-09T00:00:00Z'));

    const again = await service.ensureForCustomer('c-1');
    expect(again.revokedAt).toBeDefined();
    expect(isAcceptanceLinkUsable(again, new Date('2026-07-10T00:00:00Z'))).toBe(false);
    expect(await links.listByCustomer('c-1')).toHaveLength(1);
  });

  it('urlFor is deterministic and resolves against the stored tokenHash', async () => {
    const url = service.urlFor('c-1');
    expect(url).toBe(service.urlFor('c-1'));
    expect(url.startsWith('https://clickwrap.example.org/accept/')).toBe(true);

    const link = await service.ensureForCustomer('c-1');
    const { acceptanceLinkTokenHash } = await import('../../../domain/acceptance-links.js');
    const token = url.split('/accept/')[1];
    expect(acceptanceLinkTokenHash(token)).toBe(link.tokenHash);
  });

  it('urlFor returns empty when PUBLIC_BASE_URL is unconfigured', () => {
    const svc = new PermanentAcceptanceLinkService(links, clock, { ...config, publicBaseUrl: '' });
    expect(svc.urlFor('c-1')).toBe('');
  });
});
