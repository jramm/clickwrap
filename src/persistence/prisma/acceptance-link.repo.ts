/**
 * Prisma implementation of AcceptanceLinkRepo. Semantics exactly like
 * src/persistence/inmemory/acceptance-link.repo.ts: `create` rejects duplicate id/tokenHash
 * (unique capability); `touch` is a best-effort no-op for unknown ids (a page render must never
 * fail on it); `revoke` is idempotent — the first revocation wins (revokedAt is evidence of WHEN
 * the capability was withdrawn, `updateMany` with `revokedAt: null` guard).
 */
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors';
import type { AcceptanceLinkRepo } from '../../domain/ports';
import type { AcceptanceLink } from '../../domain/types';
import { toCreateData, toDomain } from './mappers/acceptance-link.mapper';
import { isUniqueConstraintError } from './prisma-errors';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaAcceptanceLinkRepo implements AcceptanceLinkRepo {
  constructor(private readonly prisma: PrismaService) {}

  async create(link: AcceptanceLink): Promise<AcceptanceLink> {
    try {
      const row = await this.prisma.acceptanceLink.create({ data: toCreateData(link) });
      return toDomain(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new DomainError('INVALID_STATE', `AcceptanceLink ${link.id} collides on id or tokenHash`);
      }
      throw err;
    }
  }

  async findByTokenHash(tokenHash: string): Promise<AcceptanceLink | undefined> {
    const row = await this.prisma.acceptanceLink.findUnique({ where: { tokenHash } });
    return row ? toDomain(row) : undefined;
  }

  async touch(id: string, lastUsedAt: Date): Promise<void> {
    await this.prisma.acceptanceLink.updateMany({ where: { id }, data: { lastUsedAt } });
  }

  async revoke(id: string, revokedAt: Date): Promise<AcceptanceLink | undefined> {
    // UPDATE … WHERE id = $1 AND "revokedAt" IS NULL — the first revocation wins.
    await this.prisma.acceptanceLink.updateMany({ where: { id, revokedAt: null }, data: { revokedAt } });
    const row = await this.prisma.acceptanceLink.findUnique({ where: { id } });
    return row ? toDomain(row) : undefined;
  }

  async listByCustomer(customerId: string): Promise<AcceptanceLink[]> {
    const rows = await this.prisma.acceptanceLink.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }
}
