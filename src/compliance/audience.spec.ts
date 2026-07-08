import { DomainError } from '../common/errors';
import { anAudience } from '../domain/testing/fixtures';
import { InMemoryAgreementDocumentRepo, InMemoryAudienceRepo, InMemoryCustomerRepo } from '../persistence/inmemory';
import { resolveAudienceKey } from './audience';

describe('resolveAudienceKey', () => {
  let audiences: InMemoryAudienceRepo;

  beforeEach(async () => {
    audiences = new InMemoryAudienceRepo(new InMemoryAgreementDocumentRepo(), new InMemoryCustomerRepo());
    await audiences.save(anAudience({ id: 'aud-customer', key: 'customer' }));
    await audiences.save(anAudience({ id: 'aud-partner', key: 'partner', name: 'Partners' }));
  });

  it('returns undefined when no parameter was given (aggregation across all roles)', async () => {
    await expect(resolveAudienceKey(audiences, undefined)).resolves.toBeUndefined();
  });

  it.each(['customer', 'partner'])('accepts the known audience key %s', async (key) => {
    await expect(resolveAudienceKey(audiences, key)).resolves.toBe(key);
  });

  it('throws UNKNOWN_AUDIENCE for a key that does not exist in the repo', async () => {
    await expect(resolveAudienceKey(audiences, 'admin')).rejects.toThrow(DomainError);
    await expect(resolveAudienceKey(audiences, 'admin')).rejects.toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
  });

  it('throws UNKNOWN_AUDIENCE for an empty string', async () => {
    await expect(resolveAudienceKey(audiences, '')).rejects.toMatchObject({ code: 'UNKNOWN_AUDIENCE' });
  });
});
