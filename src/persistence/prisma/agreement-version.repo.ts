/**
 * Prisma implementation of AgreementVersionRepo. Semantics exactly like
 * src/persistence/inmemory/agreement-version.repo.ts:
 * - `save` does not check aggregate consistency (document must exist) manually like the fake,
 *   but relies on the real FK constraint documentId → AgreementDocument.id; a violation
 *   surfaces as P2003 and is translated into the same DomainError('INVALID_STATE', …).
 * - `findCurrentPublished` implements the hot path (newest PUBLISHED version with
 *   validFrom <= now) as a join over documentId (via AgreementDocument.type/audience) + sort.
 * - `delete` remains a "read-then-act" like the fake (no DB constraint for VERSION_IMMUTABLE) —
 *   see docs/PERSISTENCE.md.
 */
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors';
import type { AgreementVersionRepo } from '../../domain/ports';
import type { AgreementVersion } from '../../domain/types';
import { toDomain, toUpsertData } from './mappers/agreement-version.mapper';
import { isForeignKeyConstraintError } from './prisma-errors';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaAgreementVersionRepo implements AgreementVersionRepo {
  constructor(private readonly prisma: PrismaService) {}

  async save(version: AgreementVersion): Promise<AgreementVersion> {
    const data = toUpsertData(version);
    try {
      const row = await this.prisma.agreementVersion.upsert({
        where: { id: version.id },
        create: data,
        update: data,
      });
      return toDomain(row);
    } catch (err) {
      if (isForeignKeyConstraintError(err)) {
        throw new DomainError('INVALID_STATE', `Document ${version.documentId} does not exist`);
      }
      throw err;
    }
  }

  async findById(id: string): Promise<AgreementVersion | undefined> {
    const row = await this.prisma.agreementVersion.findUnique({ where: { id } });
    return row ? toDomain(row) : undefined;
  }

  async findByDocument(documentId: string): Promise<AgreementVersion[]> {
    const rows = await this.prisma.agreementVersion.findMany({ where: { documentId } });
    return rows.map(toDomain);
  }

  async findCurrentPublished(
    typeKey: string,
    audienceKey: string,
    now: Date,
  ): Promise<AgreementVersion | undefined> {
    const document = await this.prisma.agreementDocument.findUnique({
      where: { type_audience: { type: typeKey, audience: audienceKey } },
    });
    if (!document) {
      return undefined;
    }
    const row = await this.prisma.agreementVersion.findFirst({
      where: { documentId: document.id, status: 'PUBLISHED', validFrom: { lte: now } },
      // Tie-break like the fake: newest validFrom first, on a tie newest publishedAt first
      // (nulls: 'last', so a missing publishedAt is not wrongly preferred — Postgres would
      // otherwise sort NULL first for DESC by default).
      orderBy: [{ validFrom: 'desc' }, { publishedAt: { sort: 'desc', nulls: 'last' } }],
    });
    return row ? toDomain(row) : undefined;
  }

  async findUpcomingPublished(
    typeKey: string,
    audienceKey: string,
    now: Date,
  ): Promise<AgreementVersion | undefined> {
    const document = await this.prisma.agreementDocument.findUnique({
      where: { type_audience: { type: typeKey, audience: audienceKey } },
    });
    if (!document) {
      return undefined;
    }
    const row = await this.prisma.agreementVersion.findFirst({
      where: { documentId: document.id, status: 'PUBLISHED', validFrom: { gt: now } },
      // Next flip first (smallest validFrom); tie-break like the fake: newest publishedAt —
      // the version findCurrentPublished would pick once the flip has happened.
      orderBy: [{ validFrom: 'asc' }, { publishedAt: { sort: 'desc', nulls: 'last' } }],
    });
    return row ? toDomain(row) : undefined;
  }

  async delete(id: string): Promise<void> {
    const version = await this.prisma.agreementVersion.findUnique({ where: { id } });
    if (!version) {
      throw new DomainError('VERSION_NOT_FOUND');
    }
    if (version.status !== 'DRAFT') {
      throw new DomainError('VERSION_IMMUTABLE', 'Only DRAFTs may be deleted');
    }
    await this.prisma.agreementVersion.delete({ where: { id } });
  }
}
