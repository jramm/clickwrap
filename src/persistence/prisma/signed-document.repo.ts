/**
 * Prisma implementation of SignedDocumentRepo. Semantics exactly like
 * src/persistence/inmemory/signed-document.repo.ts: append-only (`append` is a create; no
 * update/delete), `findByCustomer` returns newest first (uploadedAt desc, id desc tie-break).
 */
import { Injectable } from '@nestjs/common';
import type { SignedDocumentRepo } from '../../domain/ports.js';
import type { SignedDocument } from '../../domain/types.js';
import { toCreateData, toDomain } from './mappers/signed-document.mapper.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaSignedDocumentRepo implements SignedDocumentRepo {
  constructor(private readonly prisma: PrismaService) {}

  async append(document: SignedDocument): Promise<SignedDocument> {
    const row = await this.prisma.signedDocument.create({ data: toCreateData(document) });
    return toDomain(row);
  }

  async findById(id: string): Promise<SignedDocument | undefined> {
    const row = await this.prisma.signedDocument.findUnique({ where: { id } });
    return row ? toDomain(row) : undefined;
  }

  async findByCustomer(customerId: string): Promise<SignedDocument[]> {
    const rows = await this.prisma.signedDocument.findMany({
      where: { customerId },
      orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toDomain);
  }
}
