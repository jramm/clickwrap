import type { OutboundEmail as PrismaOutboundEmail } from '@prisma/client';
import type { OutboundEmail } from '../../../plugins/email/core/outbound-email.js';
import { nullToUndefined } from './null.js';

/** Prisma row → port type (the DB column `messageId` maps to the agnostic `providerRef`; createdAt is infra-only). */
export const toDomain = (row: PrismaOutboundEmail): OutboundEmail => ({
  providerRef: row.messageId,
  customerId: row.customerId,
  versionId: row.versionId,
  recipient: row.recipient,
  sentAt: row.sentAt,
  deliveredAt: nullToUndefined(row.deliveredAt),
});

/** Port type → Prisma create/update data (providerRef is written via the `messageId` column in the repo). */
export const toUpsertData = (email: OutboundEmail) => ({
  customerId: email.customerId,
  versionId: email.versionId,
  recipient: email.recipient,
  sentAt: email.sentAt,
  deliveredAt: email.deliveredAt ?? null,
});
