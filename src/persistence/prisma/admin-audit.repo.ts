/**
 * Prisma implementation of AdminAuditRepo (src/agreements/audit.ts). Append-only like the
 * in-memory counterpart (InMemoryAdminAuditRepo): `append` is a plain create — a duplicate id →
 * DomainError('INVALID_STATE'). After the migration, the table is locked down for the app role
 * via REVOKE UPDATE, DELETE (prisma/partial-indexes.sql) to enforce the append-only guarantee.
 */
import { Injectable } from '@nestjs/common';
import type { AdminAuditLog, AdminAuditRepo } from '../../agreements/audit.js';
import { DomainError } from '../../common/errors.js';
import { toCreateData, toDomain } from './mappers/admin-audit.mapper.js';
import { isUniqueConstraintError } from './prisma-errors.js';
import { PrismaService } from './prisma.service.js';

@Injectable()
export class PrismaAdminAuditRepo implements AdminAuditRepo {
  constructor(private readonly prisma: PrismaService) {}

  async append(log: AdminAuditLog): Promise<AdminAuditLog> {
    try {
      const row = await this.prisma.adminAuditLog.create({ data: toCreateData(log) });
      return toDomain(row);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new DomainError('INVALID_STATE', `AdminAuditLog ${log.id} already exists (append-only)`);
      }
      throw err;
    }
  }

  async findAll(): Promise<AdminAuditLog[]> {
    const rows = await this.prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toDomain);
  }

  async findByTarget(targetType: string, targetId: string): Promise<AdminAuditLog[]> {
    const rows = await this.prisma.adminAuditLog.findMany({
      where: { targetType, targetId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }
}
