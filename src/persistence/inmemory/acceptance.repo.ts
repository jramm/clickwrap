import { DomainError } from '../../common/errors';
import type { AcceptanceRepo } from '../../domain/ports';
import type { Acceptance } from '../../domain/types';
import { deepCopy } from './clone';

export class InMemoryAcceptanceRepo implements AcceptanceRepo {
  private readonly acceptances = new Map<string, Acceptance>();

  async append(acceptance: Acceptance): Promise<Acceptance> {
    if (this.acceptances.has(acceptance.id)) {
      throw new DomainError('INVALID_STATE', `Acceptance ${acceptance.id} already exists (append-only)`);
    }
    // Partial uniqueness (WHERE isEffective): exactly one effective entry per (customerId, versionId).
    if (acceptance.isEffective) {
      const effective = this.effectiveFor(acceptance.customerId, acceptance.versionId);
      if (effective) {
        throw new DomainError(
          'ALREADY_ACCEPTED',
          `Effective Acceptance ${effective.id} already exists for (${acceptance.customerId}, ${acceptance.versionId})`,
        );
      }
    }
    this.acceptances.set(acceptance.id, deepCopy(acceptance));
    return deepCopy(acceptance);
  }

  async supersede(acceptanceId: string, byAcceptanceId: string): Promise<Acceptance> {
    const stored = this.acceptances.get(acceptanceId);
    if (!stored) {
      throw new DomainError('INVALID_STATE', `Acceptance ${acceptanceId} does not exist`);
    }
    const updated: Acceptance = { ...stored, isEffective: false, supersededByAcceptanceId: byAcceptanceId };
    this.acceptances.set(acceptanceId, updated);
    return deepCopy(updated);
  }

  async findById(id: string): Promise<Acceptance | undefined> {
    return deepCopy(this.acceptances.get(id));
  }

  async findEffective(customerId: string, versionId: string): Promise<Acceptance | undefined> {
    return deepCopy(this.effectiveFor(customerId, versionId));
  }

  async findEffectiveByVersion(versionId: string): Promise<Acceptance[]> {
    return deepCopy(
      [...this.acceptances.values()].filter((a) => a.versionId === versionId && a.isEffective),
    );
  }

  async findByCustomer(customerId: string): Promise<Acceptance[]> {
    const history = [...this.acceptances.values()]
      .filter((a) => a.customerId === customerId)
      .sort((a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime());
    return deepCopy(history);
  }

  async findAll(): Promise<Acceptance[]> {
    const all = [...this.acceptances.values()].sort((a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime());
    return deepCopy(all);
  }

  private effectiveFor(customerId: string, versionId: string): Acceptance | undefined {
    return [...this.acceptances.values()].find(
      (a) => a.customerId === customerId && a.versionId === versionId && a.isEffective,
    );
  }
}
