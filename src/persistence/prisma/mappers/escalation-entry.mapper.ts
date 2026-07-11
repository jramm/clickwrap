import type { EscalationEntry as PrismaEscalationEntry } from '@prisma/client';
import type { EscalationEntry } from '../../../common/escalation/escalation-log.js';
import { extractActor } from './actor.mapper.js';
import { nullToUndefined } from './null.js';

/** Prisma row → port type. Actor only if actorUserId is set (OBJECTION_AFTER_PERIOD only). */
export const toDomain = (row: PrismaEscalationEntry): EscalationEntry => ({
  id: row.id,
  kind: row.kind,
  customerId: nullToUndefined(row.customerId),
  versionId: nullToUndefined(row.versionId),
  occurredAt: row.occurredAt,
  actor:
    row.actorUserId !== null
      ? extractActor({
          actorUserId: row.actorUserId,
          actorName: row.actorName,
          actorEmail: row.actorEmail,
          actorPortalRole: row.actorPortalRole,
        })
      : undefined,
  reason: nullToUndefined(row.reason),
  note: nullToUndefined(row.note),
  recipient: nullToUndefined(row.recipient),
  inactivatedEmail: nullToUndefined(row.inactivatedEmail),
});

/** Port type → Prisma create data (append-only). */
export const toCreateData = (entry: EscalationEntry) => ({
  id: entry.id,
  kind: entry.kind,
  customerId: entry.customerId ?? null,
  versionId: entry.versionId ?? null,
  occurredAt: entry.occurredAt,
  actorUserId: entry.actor?.userId ?? null,
  actorName: entry.actor?.name ?? null,
  actorEmail: entry.actor?.email ?? null,
  actorPortalRole: entry.actor?.portalRole ?? null,
  reason: entry.reason ?? null,
  note: entry.note ?? null,
  recipient: entry.recipient ?? null,
  inactivatedEmail: entry.inactivatedEmail ?? null,
});
