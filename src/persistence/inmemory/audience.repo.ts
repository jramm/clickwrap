import { DomainError } from '../../common/errors';
import { assertValidEntityKey } from '../../domain/keys';
import type { AgreementDocumentRepo, AudienceRepo, CustomerRepo } from '../../domain/ports';
import type { Audience } from '../../domain/types';
import { deepCopy } from './clone';

/**
 * In-memory fake of AudienceRepo — mirrors src/persistence/prisma/audience.repo.ts.
 * `save` upserts by id, validates the key slug and enforces key uniqueness across audiences.
 * `deleteIfUnused` checks references in AgreementDocument.audience and Customer.roles.
 */
export class InMemoryAudienceRepo implements AudienceRepo {
  private readonly audiences = new Map<string, Audience>();

  constructor(
    private readonly documents: AgreementDocumentRepo,
    private readonly customers: CustomerRepo,
  ) {}

  async save(audience: Audience): Promise<Audience> {
    assertValidEntityKey(audience.key, 'audience');
    const duplicate = [...this.audiences.values()].find((a) => a.id !== audience.id && a.key === audience.key);
    if (duplicate) {
      throw new DomainError('INVALID_STATE', `An audience with key "${audience.key}" already exists`);
    }
    this.audiences.set(audience.id, deepCopy(audience));
    return deepCopy(audience);
  }

  async findByKey(key: string): Promise<Audience | undefined> {
    return deepCopy([...this.audiences.values()].find((a) => a.key === key));
  }

  async findAll(): Promise<Audience[]> {
    return deepCopy([...this.audiences.values()]);
  }

  async deleteIfUnused(key: string): Promise<boolean> {
    const existing = [...this.audiences.values()].find((a) => a.key === key);
    if (!existing) {
      return false;
    }
    const documents = await this.documents.findAll();
    if (documents.some((d) => d.audience === key)) {
      return false;
    }
    const customers = await this.customers.findAll();
    if (customers.some((c) => c.roles.includes(key))) {
      return false;
    }
    this.audiences.delete(existing.id);
    return true;
  }
}
