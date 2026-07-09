/**
 * Prisma implementation of ObjectionRepo. Semantics exactly like
 * src/persistence/inmemory/objection.repo.ts:
 * - `append` is append-only (no upsert) — a duplicate id is a programming error (P2002 on the PK)
 *   → DomainError('INVALID_STATE', …).
 * - `findByCustomerAndVersion`/`findByCustomer` sort by `createdAt` instead of the business-level
 *   `objectedAt` (a mapping decision): the fake preserves pure insertion order (Map iteration);
 *   `objectedAt` is a business date set by the application layer that does not sort uniquely for
 *   multiple entries on the same day — `createdAt` (auto timestamp per INSERT) deterministically
 *   reproduces the insertion order.
 * - `resolve` is the only permitted correction operation (UPDATE resolution/resolvedBy/
 *   resolvedAt) — see the column-scoped GRANT exception in prisma/partial-indexes.sql.
 */
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors';
import type { ObjectionRepo } from '../../domain/ports';
import type { Objection, ObjectionResolution } from '../../domain/types';
import { toCreateData, toDomain } from './mappers/objection.mapper';
import { isRecordNotFoundError, isUniqueConstraintError } from './prisma-errors';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaObjectionRepo implements ObjectionRepo {
  constructor(private readonly prisma: PrismaService) {}

  async append(objection: Objection): Promise<Objection> {
    try {
      const row = await this.prisma.objection.create({ data: toCreateData(objection) });
      return toDomain(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new DomainError('INVALID_STATE', `Objection ${objection.id} already exists (append-only)`);
      }
      throw err;
    }
  }

  async findById(id: string): Promise<Objection | undefined> {
    const row = await this.prisma.objection.findUnique({ where: { id } });
    return row ? toDomain(row) : undefined;
  }

  async findByCustomerAndVersion(customerId: string, versionId: string): Promise<Objection[]> {
    const rows = await this.prisma.objection.findMany({
      where: { customerId, versionId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }

  async findByCustomer(customerId: string): Promise<Objection[]> {
    const rows = await this.prisma.objection.findMany({ where: { customerId }, orderBy: { createdAt: 'asc' } });
    return rows.map(toDomain);
  }

  /** All objections in append order (createdAt asc — insertion-order analog, see findByCustomer). */
  async findAll(): Promise<Objection[]> {
    const rows = await this.prisma.objection.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toDomain);
  }

  async resolve(
    id: string,
    resolution: ObjectionResolution,
    resolvedBy: string,
    resolvedAt: Date,
  ): Promise<Objection> {
    try {
      const row = await this.prisma.objection.update({
        where: { id },
        data: { resolution, resolvedBy, resolvedAt },
      });
      return toDomain(row);
    } catch (err) {
      if (isRecordNotFoundError(err)) {
        throw new DomainError('INVALID_STATE', `Objection ${id} does not exist`);
      }
      throw err;
    }
  }
}
