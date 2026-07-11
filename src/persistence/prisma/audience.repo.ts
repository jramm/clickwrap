/**
 * Prisma implementation of AudienceRepo. Semantics exactly like
 * src/persistence/inmemory/audience.repo.ts: `save` is an upsert-by-id with slug validation;
 * key uniqueness is enforced by the real DB unique constraint (`key @unique`) — a violation
 * surfaces as P2002 and is translated into DomainError('INVALID_STATE', …).
 * `deleteIfUnused` checks references in AgreementDocument.audience and Customer.roles before
 * deleting (application-level referential integrity — there is no FK on purpose, see
 * prisma/schema.prisma). The check-then-delete is not transactional; a concurrent insert of a
 * referencing row can race it. Acceptable for an admin-only, low-frequency operation.
 */
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors.js';
import { assertValidEntityKey } from '../../domain/keys.js';
import type { AudienceRepo } from '../../domain/ports.js';
import type { Audience } from '../../domain/types.js';
import { toDomain, toUpsertData } from './mappers/audience.mapper.js';
import { isUniqueConstraintError } from './prisma-errors.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaAudienceRepo implements AudienceRepo {
  constructor(private readonly prisma: PrismaService) {}

  async save(audience: Audience): Promise<Audience> {
    assertValidEntityKey(audience.key, 'audience');
    const data = toUpsertData(audience);
    try {
      const row = await this.prisma.audience.upsert({
        where: { id: audience.id },
        create: { id: audience.id, ...data },
        update: data,
      });
      return toDomain(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new DomainError('INVALID_STATE', `An audience with key "${audience.key}" already exists`);
      }
      throw err;
    }
  }

  async findByKey(key: string): Promise<Audience | undefined> {
    const row = await this.prisma.audience.findUnique({ where: { key } });
    return row ? toDomain(row) : undefined;
  }

  async findAll(): Promise<Audience[]> {
    const rows = await this.prisma.audience.findMany();
    return rows.map(toDomain);
  }

  async deleteIfUnused(key: string): Promise<boolean> {
    const existing = await this.prisma.audience.findUnique({ where: { key } });
    if (!existing) {
      return false;
    }
    const referencingDocuments = await this.prisma.agreementDocument.count({ where: { audience: key } });
    if (referencingDocuments > 0) {
      return false;
    }
    const referencingCustomers = await this.prisma.customer.count({ where: { roles: { has: key } } });
    if (referencingCustomers > 0) {
      return false;
    }
    await this.prisma.audience.delete({ where: { key } });
    return true;
  }
}
