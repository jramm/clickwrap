import type { NotificationEvent as PrismaNotificationEvent, Prisma } from '@prisma/client';
import type { NotificationEvent } from '../../../domain/types';
import { nullToUndefined } from './null';

/** Prisma row → domain type (createdAt is an infrastructure-only field). */
export const toDomain = (row: PrismaNotificationEvent): NotificationEvent => ({
  id: row.id,
  customerVersionStateId: row.customerVersionStateId,
  channel: row.channel,
  recipient: row.recipient,
  occurredAt: row.occurredAt,
  providerRef: nullToUndefined(row.providerRef),
});

/** Domain type → Prisma create data for `append` (append-only, see notification-event.repo.ts). */
export const toCreateData = (event: NotificationEvent): Prisma.NotificationEventUncheckedCreateInput => ({
  id: event.id,
  customerVersionStateId: event.customerVersionStateId,
  channel: event.channel,
  recipient: event.recipient,
  occurredAt: event.occurredAt,
  providerRef: event.providerRef ?? null,
});
