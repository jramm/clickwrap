import { aSignedDocument } from '../../domain/testing/fixtures';
import { InMemorySignedDocumentRepo } from './signed-document.repo';

describe('InMemorySignedDocumentRepo', () => {
  let repo: InMemorySignedDocumentRepo;

  beforeEach(() => {
    repo = new InMemorySignedDocumentRepo();
  });

  it('append + findById roundtrip (immutable copy)', async () => {
    const doc = aSignedDocument({ id: 'sd-1' });
    await repo.append(doc);

    const found = await repo.findById('sd-1');
    expect(found).toEqual(doc);
    // Stored copy is independent of the caller's object.
    doc.signerName = 'mutated';
    expect((await repo.findById('sd-1'))?.signerName).toBe('Jane Doe');
  });

  it('findById returns undefined for an unknown id', async () => {
    expect(await repo.findById('nope')).toBeUndefined();
  });

  it('findByCustomer returns only the customer’s documents, newest first', async () => {
    await repo.append(aSignedDocument({ id: 'sd-old', customerId: 'c-1', uploadedAt: new Date('2026-07-01T00:00:00Z') }));
    await repo.append(aSignedDocument({ id: 'sd-new', customerId: 'c-1', uploadedAt: new Date('2026-07-05T00:00:00Z') }));
    await repo.append(aSignedDocument({ id: 'sd-mid', customerId: 'c-1', uploadedAt: new Date('2026-07-03T00:00:00Z') }));
    await repo.append(aSignedDocument({ id: 'sd-other', customerId: 'c-2' }));

    const list = await repo.findByCustomer('c-1');
    expect(list.map((d) => d.id)).toEqual(['sd-new', 'sd-mid', 'sd-old']);
  });

  it('findByCustomer returns an empty array for an unknown customer', async () => {
    expect(await repo.findByCustomer('c-none')).toEqual([]);
  });
});
