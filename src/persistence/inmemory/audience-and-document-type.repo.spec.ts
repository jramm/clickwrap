import { DomainError } from '../../common/errors';
import { aCustomer, aDocument, aDocumentTypeDef, anAudience } from '../../domain/testing/fixtures';
import { InMemoryAgreementDocumentRepo } from './agreement-document.repo';
import { InMemoryAudienceRepo } from './audience.repo';
import { InMemoryCustomerRepo } from './customer.repo';
import { InMemoryDocumentTypeRepo } from './document-type.repo';

describe('InMemoryAudienceRepo', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let customers: InMemoryCustomerRepo;
  let repo: InMemoryAudienceRepo;

  beforeEach(() => {
    documents = new InMemoryAgreementDocumentRepo();
    customers = new InMemoryCustomerRepo();
    repo = new InMemoryAudienceRepo(documents, customers);
  });

  it('saves and finds an audience by key', async () => {
    await repo.save(anAudience({ id: 'aud-1', key: 'customer', name: 'Customers' }));
    const found = await repo.findByKey('customer');
    expect(found).toEqual({ id: 'aud-1', key: 'customer', name: 'Customers' });
  });

  it('returns undefined for an unknown key', async () => {
    expect(await repo.findByKey('nope')).toBeUndefined();
  });

  it('lists all audiences', async () => {
    await repo.save(anAudience({ id: 'aud-1', key: 'customer' }));
    await repo.save(anAudience({ id: 'aud-2', key: 'partner', name: 'Partners' }));
    const all = await repo.findAll();
    expect(all.map((a) => a.key).sort()).toEqual(['customer', 'partner']);
  });

  it('upserts by id (rename keeps the same entity)', async () => {
    await repo.save(anAudience({ id: 'aud-1', key: 'customer', name: 'Customers' }));
    await repo.save(anAudience({ id: 'aud-1', key: 'customer', name: 'End customers' }));
    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('End customers');
  });

  it('rejects a duplicate key on a different id with INVALID_STATE', async () => {
    await repo.save(anAudience({ id: 'aud-1', key: 'customer' }));
    await expect(repo.save(anAudience({ id: 'aud-2', key: 'customer' }))).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it.each(['', 'a', 'Customer', 'has space', 'café', 'under_score', 'x'.repeat(33)])(
    'rejects the invalid key %j with INVALID_STATE',
    async (key) => {
      await expect(repo.save(anAudience({ key }))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    },
  );

  it.each(['ab', 'customer', 'end-user', 'a1-b2', 'x'.repeat(32)])(
    'accepts the valid slug key %j',
    async (key) => {
      await expect(repo.save(anAudience({ id: `aud-${key}`, key }))).resolves.toMatchObject({ key });
    },
  );

  describe('deleteIfUnused', () => {
    it('deletes an unreferenced audience and reports true', async () => {
      await repo.save(anAudience({ key: 'customer' }));
      expect(await repo.deleteIfUnused('customer')).toBe(true);
      expect(await repo.findByKey('customer')).toBeUndefined();
    });

    it('returns false for an unknown key', async () => {
      expect(await repo.deleteIfUnused('ghost')).toBe(false);
    });

    it('keeps an audience referenced by a document', async () => {
      await repo.save(anAudience({ key: 'customer' }));
      await documents.save(aDocument({ audience: 'customer' }));
      expect(await repo.deleteIfUnused('customer')).toBe(false);
      expect(await repo.findByKey('customer')).toBeDefined();
    });

    it('keeps an audience referenced by a customer role', async () => {
      await repo.save(anAudience({ key: 'customer' }));
      await customers.save(aCustomer({ roles: ['customer'] }));
      expect(await repo.deleteIfUnused('customer')).toBe(false);
      expect(await repo.findByKey('customer')).toBeDefined();
    });
  });

  it('returns defensive copies (mutating a result does not change the store)', async () => {
    await repo.save(anAudience({ key: 'customer', name: 'Customers' }));
    const found = await repo.findByKey('customer');
    found!.name = 'mutated';
    expect((await repo.findByKey('customer'))!.name).toBe('Customers');
  });
});

describe('InMemoryDocumentTypeRepo', () => {
  let documents: InMemoryAgreementDocumentRepo;
  let repo: InMemoryDocumentTypeRepo;

  beforeEach(() => {
    documents = new InMemoryAgreementDocumentRepo();
    repo = new InMemoryDocumentTypeRepo(documents);
  });

  it('saves and finds a document type by key', async () => {
    await repo.save(aDocumentTypeDef({ id: 'dt-1', key: 'terms', name: 'Terms of Service' }));
    expect(await repo.findByKey('terms')).toEqual({ id: 'dt-1', key: 'terms', name: 'Terms of Service' });
  });

  it('lists all document types', async () => {
    await repo.save(aDocumentTypeDef({ id: 'dt-1', key: 'terms', name: 'Terms of Service' }));
    await repo.save(aDocumentTypeDef({ id: 'dt-2', key: 'dpa' }));
    expect((await repo.findAll()).map((t) => t.key).sort()).toEqual(['dpa', 'terms']);
  });

  it('rejects a duplicate key on a different id with INVALID_STATE', async () => {
    await repo.save(aDocumentTypeDef({ id: 'dt-1', key: 'terms' }));
    await expect(repo.save(aDocumentTypeDef({ id: 'dt-2', key: 'terms' }))).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('rejects an invalid key with INVALID_STATE', async () => {
    await expect(repo.save(aDocumentTypeDef({ key: 'NOT A SLUG' }))).rejects.toBeInstanceOf(DomainError);
  });

  describe('deleteIfUnused', () => {
    it('deletes an unreferenced type and reports true', async () => {
      await repo.save(aDocumentTypeDef({ key: 'terms' }));
      expect(await repo.deleteIfUnused('terms')).toBe(true);
      expect(await repo.findByKey('terms')).toBeUndefined();
    });

    it('returns false for an unknown key', async () => {
      expect(await repo.deleteIfUnused('ghost')).toBe(false);
    });

    it('keeps a type referenced by a document', async () => {
      await repo.save(aDocumentTypeDef({ key: 'dpa' }));
      await documents.save(aDocument({ type: 'dpa' }));
      expect(await repo.deleteIfUnused('dpa')).toBe(false);
      expect(await repo.findByKey('dpa')).toBeDefined();
    });
  });
});
