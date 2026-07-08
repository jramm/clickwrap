import { DomainError } from '../../common/errors';
import type { AcceptanceLinkRepo } from '../../domain/ports';
import type { AcceptanceLink } from '../../domain/types';
import { deepCopy } from './clone';

export class InMemoryAcceptanceLinkRepo implements AcceptanceLinkRepo {
  private readonly links = new Map<string, AcceptanceLink>();

  async create(link: AcceptanceLink): Promise<AcceptanceLink> {
    if (this.links.has(link.id)) {
      throw new DomainError('INVALID_STATE', `AcceptanceLink ${link.id} already exists`);
    }
    if ([...this.links.values()].some((existing) => existing.tokenHash === link.tokenHash)) {
      throw new DomainError('INVALID_STATE', 'An acceptance link with this tokenHash already exists');
    }
    this.links.set(link.id, deepCopy(link));
    return deepCopy(link);
  }

  async findByTokenHash(tokenHash: string): Promise<AcceptanceLink | undefined> {
    return deepCopy([...this.links.values()].find((link) => link.tokenHash === tokenHash));
  }

  async touch(id: string, lastUsedAt: Date): Promise<void> {
    const stored = this.links.get(id);
    if (stored) {
      this.links.set(id, { ...stored, lastUsedAt: new Date(lastUsedAt.getTime()) });
    }
  }

  async revoke(id: string, revokedAt: Date): Promise<AcceptanceLink | undefined> {
    const stored = this.links.get(id);
    if (!stored) {
      return undefined;
    }
    // The first revocation wins — revokedAt is evidence of WHEN the capability was withdrawn.
    if (stored.revokedAt === undefined) {
      this.links.set(id, { ...stored, revokedAt: new Date(revokedAt.getTime()) });
    }
    return deepCopy(this.links.get(id) as AcceptanceLink);
  }

  async listByCustomer(customerId: string): Promise<AcceptanceLink[]> {
    return deepCopy([...this.links.values()].filter((link) => link.customerId === customerId));
  }
}
