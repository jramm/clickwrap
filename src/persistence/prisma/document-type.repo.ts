/**
 * Prisma implementation of DocumentTypeRepo. Semantics exactly like
 * src/persistence/inmemory/document-type.repo.ts: `save` is an upsert-by-id with slug
 * validation; key uniqueness is enforced by the real DB unique constraint (`key @unique`) —
 * a violation surfaces as P2002 and is translated into DomainError('INVALID_STATE', …).
 * `deleteIfUnused` checks references in AgreementDocument.type before deleting (application-
 * level referential integrity — no FK on purpose, see prisma/schema.prisma). The
 * check-then-delete is not transactional; acceptable for an admin-only operation.
 */
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors.js';
import { assertValidEntityKey } from '../../domain/keys.js';
import type { DocumentTypeRepo } from '../../domain/ports.js';
import type { DocumentTypeDef } from '../../domain/types.js';
import { toDomain, toUpsertData } from './mappers/document-type.mapper.js';
import { isUniqueConstraintError } from './prisma-errors.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaDocumentTypeRepo implements DocumentTypeRepo {
  constructor(private readonly prisma: PrismaService) {}

  async save(documentType: DocumentTypeDef): Promise<DocumentTypeDef> {
    assertValidEntityKey(documentType.key, 'document type');
    const data = toUpsertData(documentType);
    try {
      const row = await this.prisma.documentTypeDef.upsert({
        where: { id: documentType.id },
        create: { id: documentType.id, ...data },
        update: data,
      });
      return toDomain(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new DomainError('INVALID_STATE', `A document type with key "${documentType.key}" already exists`);
      }
      throw err;
    }
  }

  async findByKey(key: string): Promise<DocumentTypeDef | undefined> {
    const row = await this.prisma.documentTypeDef.findUnique({ where: { key } });
    return row ? toDomain(row) : undefined;
  }

  async findAll(): Promise<DocumentTypeDef[]> {
    const rows = await this.prisma.documentTypeDef.findMany();
    return rows.map(toDomain);
  }

  async deleteIfUnused(key: string): Promise<boolean> {
    const existing = await this.prisma.documentTypeDef.findUnique({ where: { key } });
    if (!existing) {
      return false;
    }
    const referencingDocuments = await this.prisma.agreementDocument.count({ where: { type: key } });
    if (referencingDocuments > 0) {
      return false;
    }
    await this.prisma.documentTypeDef.delete({ where: { key } });
    return true;
  }
}
