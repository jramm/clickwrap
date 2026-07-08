/**
 * Prisma implementation of AgreementDocumentRepo. Semantics exactly like
 * src/persistence/inmemory/agreement-document.repo.ts: `save` is an upsert-by-id; the
 * invariant "exactly one active document per (type key, audience key)" is enforced by the real
 * DB unique constraint `@@unique([type, audience])` — a violation surfaces as P2002 and is
 * translated into DomainError('INVALID_STATE', …) here (counterpart of the manual check in the
 * fake).
 */
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors';
import type { AgreementDocumentRepo } from '../../domain/ports';
import type { AgreementDocument } from '../../domain/types';
import { toDomain, toUpsertData } from './mappers/agreement-document.mapper';
import { isUniqueConstraintError } from './prisma-errors';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaAgreementDocumentRepo implements AgreementDocumentRepo {
  constructor(private readonly prisma: PrismaService) {}

  async save(document: AgreementDocument): Promise<AgreementDocument> {
    const data = toUpsertData(document);
    try {
      const row = await this.prisma.agreementDocument.upsert({
        where: { id: document.id },
        create: { id: document.id, ...data },
        update: data,
      });
      return toDomain(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new DomainError(
          'INVALID_STATE',
          `A document for (${document.type}, ${document.audience}) already exists`,
        );
      }
      throw err;
    }
  }

  async findById(id: string): Promise<AgreementDocument | undefined> {
    const row = await this.prisma.agreementDocument.findUnique({ where: { id } });
    return row ? toDomain(row) : undefined;
  }

  async findByTypeAndAudience(typeKey: string, audienceKey: string): Promise<AgreementDocument | undefined> {
    const row = await this.prisma.agreementDocument.findUnique({
      where: { type_audience: { type: typeKey, audience: audienceKey } },
    });
    return row ? toDomain(row) : undefined;
  }

  async findAll(): Promise<AgreementDocument[]> {
    const rows = await this.prisma.agreementDocument.findMany();
    return rows.map(toDomain);
  }
}
