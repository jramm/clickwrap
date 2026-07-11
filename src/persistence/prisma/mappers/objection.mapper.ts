import type { Objection as PrismaObjection, Prisma } from '@prisma/client';
import type { Objection } from '../../../domain/types.js';
import { embedActor, extractActor } from './actor.mapper.js';
import { nullToUndefined } from './null.js';

/** Prisma row → domain type (createdAt is an infrastructure-only field). */
export const toDomain = (row: PrismaObjection): Objection => ({
  id: row.id,
  customerId: row.customerId,
  versionId: row.versionId,
  objectedAt: row.objectedAt,
  actor: extractActor(row),
  reason: nullToUndefined(row.reason),
  channel: row.channel,
  resolution: nullToUndefined(row.resolution),
  resolvedBy: nullToUndefined(row.resolvedBy),
  resolvedAt: nullToUndefined(row.resolvedAt),
});

/** Domain type → Prisma create data for `append` (append-only, see objection.repo.ts). */
export const toCreateData = (objection: Objection): Prisma.ObjectionUncheckedCreateInput => ({
  id: objection.id,
  customerId: objection.customerId,
  versionId: objection.versionId,
  objectedAt: objection.objectedAt,
  ...embedActor(objection.actor),
  reason: objection.reason ?? null,
  channel: objection.channel,
  resolution: objection.resolution ?? null,
  resolvedBy: objection.resolvedBy ?? null,
  resolvedAt: objection.resolvedAt ?? null,
});
