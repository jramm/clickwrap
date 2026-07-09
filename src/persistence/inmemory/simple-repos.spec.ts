import { DomainError } from '../../common/errors';
import { aCustomer, aDocument, aNotification, anObjection } from '../../domain/testing/fixtures';
import { InMemoryAgreementDocumentRepo } from './agreement-document.repo';
import { InMemoryCustomerRepo } from './customer.repo';
import { InMemoryNotificationEventRepo } from './notification-event.repo';
import { InMemoryObjectionRepo } from './objection.repo';

describe('InMemoryAgreementDocumentRepo', () => {
  let repo: InMemoryAgreementDocumentRepo;

  beforeEach(() => {
    repo = new InMemoryAgreementDocumentRepo();
  });

  it('save + findById/findByTypeAndAudience/findAll', async () => {
    await repo.save(aDocument({ id: 'd-1', type: 'dpa', audience: 'customer' }));
    await repo.save(aDocument({ id: 'd-2', type: 'dpa', audience: 'partner' }));
    expect(await repo.findById('d-1')).toMatchObject({ id: 'd-1' });
    expect((await repo.findByTypeAndAudience('dpa', 'partner'))?.id).toBe('d-2');
    expect(await repo.findByTypeAndAudience('terms', 'customer')).toBeUndefined();
    expect(await repo.findAll()).toHaveLength(2);
  });

  it('invariant: exactly one document per (type, audience) — a second one is rejected', async () => {
    await repo.save(aDocument({ id: 'd-1' }));
    await expect(repo.save(aDocument({ id: 'd-2' }))).rejects.toBeInstanceOf(DomainError);
  });

  it('returns deep copies', async () => {
    await repo.save(aDocument({ id: 'd-1' }));
    const found = await repo.findById('d-1');
    if (!found) {
      throw new Error('Document is missing');
    }
    found.name = 'mutated';
    expect((await repo.findById('d-1'))?.name).toBe('DPA — Customers');
  });
});

describe('InMemoryCustomerRepo', () => {
  let repo: InMemoryCustomerRepo;

  beforeEach(() => {
    repo = new InMemoryCustomerRepo();
  });

  it('findByRole returns only customers with a matching role (rollout invariant)', async () => {
    await repo.save(aCustomer({ id: 'c-c', roles: ['customer'] }));
    await repo.save(aCustomer({ id: 'c-p', roles: ['partner'] }));
    await repo.save(aCustomer({ id: 'c-both', roles: ['customer', 'partner'] }));
    await repo.save(aCustomer({ id: 'c-none', roles: [] }));
    expect((await repo.findByRole('customer')).map((c) => c.id).sort()).toEqual(['c-both', 'c-c']);
    expect((await repo.findByRole('partner')).map((c) => c.id).sort()).toEqual(['c-both', 'c-p']);
  });

  it('save updates existing customers (role sync)', async () => {
    await repo.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
    await repo.save(aCustomer({ id: 'c-1', roles: ['customer', 'partner'] }));
    expect((await repo.findById('c-1'))?.roles).toEqual(['customer', 'partner']);
    expect(await repo.findAll()).toHaveLength(1);
  });

  it('returns deep copies (including the roles array)', async () => {
    await repo.save(aCustomer({ id: 'c-1', roles: ['customer'] }));
    const found = await repo.findById('c-1');
    if (!found) {
      throw new Error('Customer is missing');
    }
    found.roles.push('partner');
    expect((await repo.findById('c-1'))?.roles).toEqual(['customer']);
  });

  it('findAllByExternalRef returns every customer sharing a ref (externalRef is not globally unique)', async () => {
    await repo.save(aCustomer({ id: 'c-c', externalRef: 'X', roles: ['customer'] }));
    await repo.save(aCustomer({ id: 'c-p', externalRef: 'X', roles: ['partner'] }));
    await repo.save(aCustomer({ id: 'c-other', externalRef: 'Y', roles: ['customer'] }));
    expect((await repo.findAllByExternalRef('X')).map((c) => c.id).sort()).toEqual(['c-c', 'c-p']);
    expect(await repo.findAllByExternalRef('missing')).toEqual([]);
  });
});

describe('InMemoryObjectionRepo', () => {
  let repo: InMemoryObjectionRepo;

  beforeEach(() => {
    repo = new InMemoryObjectionRepo();
  });

  it('append + findByCustomerAndVersion/findByCustomer (append-only, multiple entries possible)', async () => {
    await repo.append(anObjection({ id: 'o-1' }));
    await repo.append(anObjection({ id: 'o-2' }));
    await repo.append(anObjection({ id: 'o-3', versionId: 'v-2' }));
    expect((await repo.findByCustomerAndVersion('c-123', 'v-1')).map((o) => o.id)).toEqual(['o-1', 'o-2']);
    expect(await repo.findByCustomer('c-123')).toHaveLength(3);
  });

  it('rejects a duplicate id (append-only)', async () => {
    await repo.append(anObjection({ id: 'o-1' }));
    await expect(repo.append(anObjection({ id: 'o-1' }))).rejects.toBeInstanceOf(DomainError);
  });

  it('resolve sets resolution/resolvedBy/resolvedAt (no dead-end state)', async () => {
    await repo.append(anObjection({ id: 'o-1' }));
    const resolved = await repo.resolve('o-1', 'RESOLVED_ACCEPTED', 'admin-1', new Date('2026-07-15T00:00:00Z'));
    expect(resolved).toMatchObject({
      resolution: 'RESOLVED_ACCEPTED',
      resolvedBy: 'admin-1',
      resolvedAt: new Date('2026-07-15T00:00:00Z'),
    });
  });

  it('resolve on an unknown id → DomainError', async () => {
    await expect(repo.resolve('missing', 'WITHDRAWN', 'admin-1', new Date())).rejects.toBeInstanceOf(DomainError);
  });

  it('findAll returns every objection across customers/versions in insertion order', async () => {
    await repo.append(anObjection({ id: 'o-1' }));
    await repo.append(anObjection({ id: 'o-2', versionId: 'v-2' }));
    await repo.append(anObjection({ id: 'o-3', customerId: 'c-9' }));
    expect((await repo.findAll()).map((o) => o.id)).toEqual(['o-1', 'o-2', 'o-3']);
  });
});

describe('InMemoryNotificationEventRepo', () => {
  let repo: InMemoryNotificationEventRepo;

  beforeEach(() => {
    repo = new InMemoryNotificationEventRepo();
  });

  it('append + findByState (append-only delivery evidence)', async () => {
    await repo.append(aNotification({ id: 'n-1' }));
    await repo.append(aNotification({ id: 'n-2', channel: 'PORTAL', providerRef: undefined }));
    await repo.append(aNotification({ id: 'n-3', customerVersionStateId: 'cvs-2' }));
    expect((await repo.findByState('cvs-1')).map((n) => n.id)).toEqual(['n-1', 'n-2']);
  });

  it('findByProviderRef correlates Postmark MessageIDs; unknown refs → undefined (review environments)', async () => {
    await repo.append(aNotification({ id: 'n-1', providerRef: 'pm-abc' }));
    expect((await repo.findByProviderRef('pm-abc'))?.id).toBe('n-1');
    expect(await repo.findByProviderRef('pm-foreign')).toBeUndefined();
  });

  it('rejects a duplicate id (append-only)', async () => {
    await repo.append(aNotification({ id: 'n-1' }));
    await expect(repo.append(aNotification({ id: 'n-1' }))).rejects.toBeInstanceOf(DomainError);
  });

  it('returns deep copies', async () => {
    await repo.append(aNotification({ id: 'n-1' }));
    const events = await repo.findByState('cvs-1');
    events[0].recipient = 'mutated';
    expect((await repo.findByState('cvs-1'))[0].recipient).toBe('jane@customer.example');
  });

  it('findAll returns every event across states in insertion order', async () => {
    await repo.append(aNotification({ id: 'n-1' }));
    await repo.append(aNotification({ id: 'n-2', channel: 'LINK', customerVersionStateId: 'cvs-2' }));
    await repo.append(aNotification({ id: 'n-3', customerVersionStateId: 'cvs-1' }));
    expect((await repo.findAll()).map((n) => n.id)).toEqual(['n-1', 'n-2', 'n-3']);
  });
});
