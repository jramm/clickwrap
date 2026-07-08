import { DomainError } from '../../common/errors';
import { anAcceptanceLink } from '../../domain/testing/fixtures';
import { InMemoryAcceptanceLinkRepo } from './acceptance-link.repo';

describe('InMemoryAcceptanceLinkRepo', () => {
  let repo: InMemoryAcceptanceLinkRepo;

  beforeEach(() => {
    repo = new InMemoryAcceptanceLinkRepo();
  });

  it('create + findByTokenHash roundtrip', async () => {
    const link = anAcceptanceLink({ id: 'al-1', tokenHash: 'h-1' });
    await repo.create(link);
    expect(await repo.findByTokenHash('h-1')).toEqual(link);
    expect(await repo.findByTokenHash('h-unknown')).toBeUndefined();
  });

  it('rejects a duplicate id (append-only capability record)', async () => {
    await repo.create(anAcceptanceLink({ id: 'al-1', tokenHash: 'h-1' }));
    await expect(repo.create(anAcceptanceLink({ id: 'al-1', tokenHash: 'h-2' }))).rejects.toThrow(DomainError);
  });

  it('rejects a duplicate tokenHash (a capability maps to exactly one link)', async () => {
    await repo.create(anAcceptanceLink({ id: 'al-1', tokenHash: 'h-1' }));
    await expect(repo.create(anAcceptanceLink({ id: 'al-2', tokenHash: 'h-1' }))).rejects.toThrow(DomainError);
  });

  it('returned/stored objects are copies (no shared mutable state)', async () => {
    const link = anAcceptanceLink({ id: 'al-1', tokenHash: 'h-1' });
    await repo.create(link);
    const found = (await repo.findByTokenHash('h-1'))!;
    found.tokenHash = 'mutated';
    expect((await repo.findByTokenHash('h-1'))?.tokenHash).toBe('h-1');
  });

  it('touch sets lastUsedAt; unknown id is a no-op', async () => {
    await repo.create(anAcceptanceLink({ id: 'al-1', tokenHash: 'h-1' }));
    const usedAt = new Date('2026-07-08T10:00:00Z');
    await repo.touch('al-1', usedAt);
    expect((await repo.findByTokenHash('h-1'))?.lastUsedAt).toEqual(usedAt);
    await expect(repo.touch('al-unknown', usedAt)).resolves.toBeUndefined();
  });

  it('revoke sets revokedAt once — the first revocation wins', async () => {
    await repo.create(anAcceptanceLink({ id: 'al-1', tokenHash: 'h-1' }));
    const first = new Date('2026-07-08T10:00:00Z');
    const revoked = await repo.revoke('al-1', first);
    expect(revoked?.revokedAt).toEqual(first);
    const again = await repo.revoke('al-1', new Date('2026-07-09T10:00:00Z'));
    expect(again?.revokedAt).toEqual(first);
    expect(await repo.revoke('al-unknown', first)).toBeUndefined();
  });

  it('listByCustomer filters by customer', async () => {
    await repo.create(anAcceptanceLink({ id: 'al-1', tokenHash: 'h-1', customerId: 'c-1' }));
    await repo.create(anAcceptanceLink({ id: 'al-2', tokenHash: 'h-2', customerId: 'c-2' }));
    await repo.create(anAcceptanceLink({ id: 'al-3', tokenHash: 'h-3', customerId: 'c-1' }));
    const links = await repo.listByCustomer('c-1');
    expect(links.map((l) => l.id).sort()).toEqual(['al-1', 'al-3']);
  });
});
