import { DomainError } from '../../common/errors';
import type { ObjectionRepo } from '../../domain/ports';
import type { Objection, ObjectionResolution } from '../../domain/types';
import { deepCopy } from './clone';

export class InMemoryObjectionRepo implements ObjectionRepo {
  private readonly objections = new Map<string, Objection>();

  async append(objection: Objection): Promise<Objection> {
    if (this.objections.has(objection.id)) {
      throw new DomainError('INVALID_STATE', `Objection ${objection.id} already exists (append-only)`);
    }
    this.objections.set(objection.id, deepCopy(objection));
    return deepCopy(objection);
  }

  async findById(id: string): Promise<Objection | undefined> {
    return deepCopy(this.objections.get(id));
  }

  async findByCustomerAndVersion(customerId: string, versionId: string): Promise<Objection[]> {
    return deepCopy(
      [...this.objections.values()].filter((o) => o.customerId === customerId && o.versionId === versionId),
    );
  }

  async findByCustomer(customerId: string): Promise<Objection[]> {
    return deepCopy([...this.objections.values()].filter((o) => o.customerId === customerId));
  }

  /** All objections in insertion order (append-only store). */
  async findAll(): Promise<Objection[]> {
    return deepCopy([...this.objections.values()]);
  }

  async resolve(
    id: string,
    resolution: ObjectionResolution,
    resolvedBy: string,
    resolvedAt: Date,
  ): Promise<Objection> {
    const stored = this.objections.get(id);
    if (!stored) {
      throw new DomainError('INVALID_STATE', `Objection ${id} does not exist`);
    }
    const updated: Objection = { ...stored, resolution, resolvedBy, resolvedAt: new Date(resolvedAt.getTime()) };
    this.objections.set(id, updated);
    return deepCopy(updated);
  }
}
