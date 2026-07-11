import { Prisma } from '@prisma/client';
import type { Event as PrismaEvent } from '@prisma/client';
import type { DomainEvent, EventActorKind, EventCategory, EventType } from '../../../domain/types.js';
import { nullToUndefined } from './null.js';

/** Prisma row → port type. The union columns are stored as text; the domain layer owns the unions. */
export const toDomain = (row: PrismaEvent): DomainEvent => ({
  id: row.id,
  type: row.type as EventType,
  category: row.category as EventCategory,
  occurredAt: row.occurredAt,
  actorKind: row.actorKind as EventActorKind,
  actorLabel: row.actorLabel,
  customerId: nullToUndefined(row.customerId),
  customerName: nullToUndefined(row.customerName),
  versionId: nullToUndefined(row.versionId),
  documentType: nullToUndefined(row.documentType),
  audience: nullToUndefined(row.audience),
  versionLabel: nullToUndefined(row.versionLabel),
  channel: nullToUndefined(row.channel),
  recipient: nullToUndefined(row.recipient),
  summary: row.summary,
  metadata: nullToUndefined(row.metadata as Record<string, unknown> | null),
});

/** Port type → Prisma create data (append-only; id/occurredAt are supplied by the recorder). */
export const toCreateData = (event: DomainEvent): Prisma.EventCreateInput => ({
  id: event.id,
  type: event.type,
  category: event.category,
  occurredAt: event.occurredAt,
  actorKind: event.actorKind,
  actorLabel: event.actorLabel,
  customerId: event.customerId ?? null,
  customerName: event.customerName ?? null,
  versionId: event.versionId ?? null,
  documentType: event.documentType ?? null,
  audience: event.audience ?? null,
  versionLabel: event.versionLabel ?? null,
  channel: event.channel ?? null,
  recipient: event.recipient ?? null,
  summary: event.summary,
  metadata: (event.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
});
