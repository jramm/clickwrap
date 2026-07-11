import { Prisma } from '@prisma/client';
import type { AdminAuditLog as PrismaAdminAuditLog } from '@prisma/client';
import type { AdminAuditLog } from '../../../agreements/audit.js';
import { nullToUndefined } from './null.js';

/** Prisma row → port type. metadata is Json? — the domain layer knows Record<string, unknown>. */
export const toDomain = (row: PrismaAdminAuditLog): AdminAuditLog => ({
  id: row.id,
  action: row.action,
  actor: row.actor,
  targetType: row.targetType,
  targetId: row.targetId,
  reason: nullToUndefined(row.reason),
  metadata: nullToUndefined(row.metadata as Record<string, unknown> | null),
  createdAt: row.createdAt,
});

/** Port type → Prisma create data (append-only, id/createdAt are supplied by the service). */
export const toCreateData = (log: AdminAuditLog): Prisma.AdminAuditLogCreateInput => ({
  id: log.id,
  action: log.action,
  actor: log.actor,
  targetType: log.targetType,
  targetId: log.targetId,
  reason: log.reason ?? null,
  metadata: (log.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
  createdAt: log.createdAt,
});
