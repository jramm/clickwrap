import { DomainError } from '../../common/errors';
import { anAcceptance } from '../../domain/testing/fixtures';
import { InMemoryAcceptanceRepo } from './acceptance.repo';

describe('InMemoryAcceptanceRepo', () => {
  let repo: InMemoryAcceptanceRepo;

  beforeEach(() => {
    repo = new InMemoryAcceptanceRepo();
  });

  it('append + findEffective returns the effective Acceptance per (customer, version)', async () => {
    await repo.append(anAcceptance({ id: 'a-1' }));
    const found = await repo.findEffective('c-123', 'v-1');
    expect(found?.id).toBe('a-1');
  });

  it('partial uniqueness: a second EFFECTIVE Acceptance per (customer, version) → ALREADY_ACCEPTED', async () => {
    await repo.append(anAcceptance({ id: 'a-1' }));
    await expect(repo.append(anAcceptance({ id: 'a-2' }))).rejects.toMatchObject({
      name: 'DomainError',
      code: 'ALREADY_ACCEPTED',
    });
  });

  it('non-effective entries do not violate uniqueness (append-only corrections)', async () => {
    await repo.append(anAcceptance({ id: 'a-1' }));
    await expect(repo.append(anAcceptance({ id: 'a-2', isEffective: false }))).resolves.toMatchObject({ id: 'a-2' });
  });

  it('effective Acceptances coexist across different versions/customers', async () => {
    await repo.append(anAcceptance({ id: 'a-1' }));
    await repo.append(anAcceptance({ id: 'a-2', versionId: 'v-2' }));
    await repo.append(anAcceptance({ id: 'a-3', customerId: 'c-456' }));
    expect((await repo.findByCustomer('c-123')).map((a) => a.id)).toEqual(['a-1', 'a-2']);
  });

  it('findEffectiveByVersion returns only effective acceptances of the version', async () => {
    await repo.append(anAcceptance({ id: 'a-1', customerId: 'c-1', versionId: 'v-1' }));
    await repo.append(anAcceptance({ id: 'a-2', customerId: 'c-2', versionId: 'v-1' }));
    await repo.append(anAcceptance({ id: 'a-ineff', customerId: 'c-3', versionId: 'v-1', isEffective: false }));
    await repo.append(anAcceptance({ id: 'a-other', customerId: 'c-1', versionId: 'v-2' }));

    const effective = await repo.findEffectiveByVersion('v-1');
    expect(effective.map((a) => a.id).sort()).toEqual(['a-1', 'a-2']);
  });

  it('rejects a duplicate id (append-only, no overwriting)', async () => {
    await repo.append(anAcceptance({ id: 'a-1' }));
    await expect(repo.append(anAcceptance({ id: 'a-1', versionId: 'v-9' }))).rejects.toBeInstanceOf(DomainError);
  });

  it('supersede: the old entry becomes non-effective + references its successor; a new effective Acceptance is then allowed', async () => {
    await repo.append(anAcceptance({ id: 'a-1' }));
    const superseded = await repo.supersede('a-1', 'a-2');
    expect(superseded.isEffective).toBe(false);
    expect(superseded.supersededByAcceptanceId).toBe('a-2');

    const replacement = await repo.append(anAcceptance({ id: 'a-2' }));
    expect(replacement.isEffective).toBe(true);
    expect(await repo.findEffective('c-123', 'v-1')).toMatchObject({ id: 'a-2' });
  });

  it('supersede on an unknown id → DomainError', async () => {
    await expect(repo.supersede('missing', 'a-2')).rejects.toBeInstanceOf(DomainError);
  });

  it('returns are deep copies: mutation does not affect the store', async () => {
    await repo.append(anAcceptance({ id: 'a-1' }));
    const found = await repo.findEffective('c-123', 'v-1');
    if (!found) {
      throw new Error('Acceptance is missing');
    }
    found.isEffective = false;
    found.actor.userId = 'tampered';
    expect(await repo.findEffective('c-123', 'v-1')).toMatchObject({ id: 'a-1', actor: { userId: 'u-42' } });
  });

  it('the passed-in entry is also copied: later mutation of the input does not reach the store', async () => {
    const input = anAcceptance({ id: 'a-1' });
    await repo.append(input);
    input.isEffective = false;
    expect((await repo.findEffective('c-123', 'v-1'))?.isEffective).toBe(true);
  });

  it('findByCustomer returns history chronologically by acceptedAt (incl. non-effective entries)', async () => {
    await repo.append(anAcceptance({ id: 'a-new', acceptedAt: new Date('2026-07-10T00:00:00Z'), isEffective: false }));
    await repo.append(anAcceptance({ id: 'a-old', acceptedAt: new Date('2026-07-01T00:00:00Z') }));
    expect((await repo.findByCustomer('c-123')).map((a) => a.id)).toEqual(['a-old', 'a-new']);
  });
});
