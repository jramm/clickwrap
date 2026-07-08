import type { AcceptanceLink as PrismaAcceptanceLink, Prisma } from '@prisma/client';
import type { AcceptanceLink } from '../../../domain/types';
import { nullToUndefined } from './null';

/** Prisma row → domain type. */
export const toDomain = (row: PrismaAcceptanceLink): AcceptanceLink => ({
  id: row.id,
  tokenHash: row.tokenHash,
  customerId: row.customerId,
  kind: row.kind,
  audienceKey: nullToUndefined(row.audienceKey),
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  expiresAt: nullToUndefined(row.expiresAt),
  revokedAt: nullToUndefined(row.revokedAt),
  lastUsedAt: nullToUndefined(row.lastUsedAt),
});

/** Domain type → Prisma create data for `create` (the raw token is never part of the row). */
export const toCreateData = (link: AcceptanceLink): Prisma.AcceptanceLinkUncheckedCreateInput => ({
  id: link.id,
  tokenHash: link.tokenHash,
  customerId: link.customerId,
  kind: link.kind,
  audienceKey: link.audienceKey ?? null,
  createdBy: link.createdBy,
  createdAt: link.createdAt,
  expiresAt: link.expiresAt ?? null,
  revokedAt: link.revokedAt ?? null,
  lastUsedAt: link.lastUsedAt ?? null,
});
