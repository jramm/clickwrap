import { InMemoryAdminAuditRepo } from '../agreements/audit.js';
import { FixedClock } from '../domain/clock.js';
import { acceptanceLinkTokenHash } from '../domain/acceptance-links.js';
import { aCustomer, anAudience } from '../domain/testing/fixtures.js';
import {
  InMemoryAcceptanceLinkRepo,
  InMemoryAgreementDocumentRepo,
  InMemoryAudienceRepo,
  InMemoryCustomerRepo,
  InMemoryEventRepo,
} from '../persistence/inmemory/index.js';
import { EventRecorder } from '../events/event-recorder.js';
import { AcceptanceLinkAdminService } from './acceptance-link-admin.service.js';

const NOW = new Date('2026-07-08T08:00:00Z');

describe('AcceptanceLinkAdminService', () => {
  let customers: InMemoryCustomerRepo;
  let audiences: InMemoryAudienceRepo;
  let links: InMemoryAcceptanceLinkRepo;
  let audit: InMemoryAdminAuditRepo;
  let eventRepo: InMemoryEventRepo;
  let service: AcceptanceLinkAdminService;
  const envBackup = process.env.PUBLIC_BASE_URL;

  beforeEach(async () => {
    process.env.PUBLIC_BASE_URL = 'https://clickwrap.example.org';
    customers = new InMemoryCustomerRepo();
    const documents = new InMemoryAgreementDocumentRepo();
    audiences = new InMemoryAudienceRepo(documents, customers);
    links = new InMemoryAcceptanceLinkRepo();
    audit = new InMemoryAdminAuditRepo();
    eventRepo = new InMemoryEventRepo();
    service = new AcceptanceLinkAdminService(
      customers,
      audiences,
      links,
      audit,
      new FixedClock(NOW),
      new EventRecorder(eventRepo, new FixedClock(NOW)),
    );
    await customers.save(aCustomer());
    await audiences.save(anAudience());
  });

  afterEach(() => {
    if (envBackup === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = envBackup;
    }
  });

  it('mints a link: URL under PUBLIC_BASE_URL, default expiry 30 days, only the token hash is persisted', async () => {
    const result = await service.create('c-123', {}, 'admin-1');

    expect(result.url).toMatch(/^https:\/\/clickwrap\.example\.org\/accept\/[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt).toEqual(new Date('2026-08-07T08:00:00Z'));

    const token = result.url.split('/accept/')[1];
    const stored = await links.findByTokenHash(acceptanceLinkTokenHash(token));
    expect(stored).toMatchObject({
      id: result.linkId,
      customerId: 'c-123',
      createdBy: 'admin-1',
      createdAt: NOW,
      expiresAt: result.expiresAt,
    });
    // The raw token never appears anywhere in the stored record.
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('a trailing slash on PUBLIC_BASE_URL does not produce a double slash', async () => {
    process.env.PUBLIC_BASE_URL = 'https://clickwrap.example.org/';
    const result = await service.create('c-123', {}, 'admin-1');
    expect(result.url).toMatch(/^https:\/\/clickwrap\.example\.org\/accept\/[A-Za-z0-9_-]{43}$/);
  });

  it('stores the optional audience scope and honours a custom expiry', async () => {
    const result = await service.create('c-123', { audienceKey: 'customer', expiresInDays: 7 }, 'admin-1');
    expect(result.expiresAt).toEqual(new Date('2026-07-15T08:00:00Z'));
    const token = result.url.split('/accept/')[1];
    expect((await links.findByTokenHash(acceptanceLinkTokenHash(token)))?.audienceKey).toBe('customer');
  });

  it('writes an ACCEPTANCE_LINK_CREATE audit entry (without token material)', async () => {
    const result = await service.create('c-123', { audienceKey: 'customer' }, 'admin-1');
    const entries = await audit.findAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'ACCEPTANCE_LINK_CREATE',
      actor: 'admin-1',
      targetType: 'AcceptanceLink',
      targetId: result.linkId,
      createdAt: NOW,
    });
    const token = result.url.split('/accept/')[1];
    expect(JSON.stringify(entries[0])).not.toContain(token);
    expect(JSON.stringify(entries[0])).not.toContain(acceptanceLinkTokenHash(token));
  });

  it('records an ACCEPTANCE_LINK_CREATED event', async () => {
    await service.create('c-123', { audienceKey: 'customer' }, 'admin-1');
    const { items } = await eventRepo.query({});
    expect(items[0]).toMatchObject({
      type: 'ACCEPTANCE_LINK_CREATED',
      category: 'ADMINISTRATION',
      actorKind: 'ADMIN',
    });
  });

  it('PUBLIC_BASE_URL unset → INVALID_STATE with an actionable message, nothing persisted', async () => {
    process.env.PUBLIC_BASE_URL = '';
    await expect(service.create('c-123', {}, 'admin-1')).rejects.toMatchObject({
      code: 'INVALID_STATE',
      message: expect.stringContaining('PUBLIC_BASE_URL'),
    });
    expect(await links.listByCustomer('c-123')).toHaveLength(0);
    expect(await audit.findAll()).toHaveLength(0);
  });

  it('unknown customer → CUSTOMER_NOT_FOUND', async () => {
    await expect(service.create('c-unknown', {}, 'admin-1')).rejects.toMatchObject({
      code: 'CUSTOMER_NOT_FOUND',
    });
  });

  it('unknown audience scope → UNKNOWN_AUDIENCE', async () => {
    await expect(service.create('c-123', { audienceKey: 'nope' }, 'admin-1')).rejects.toMatchObject({
      code: 'UNKNOWN_AUDIENCE',
    });
  });

  it.each([0, -1, 366, 1.5])('expiresInDays=%p → INVALID_STATE (allowed: integer 1..365)', async (days) => {
    await expect(service.create('c-123', { expiresInDays: days }, 'admin-1')).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('expiresInDays=365 (the maximum) is accepted', async () => {
    const result = await service.create('c-123', { expiresInDays: 365 }, 'admin-1');
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() + 365 * 24 * 60 * 60 * 1000));
  });
});
