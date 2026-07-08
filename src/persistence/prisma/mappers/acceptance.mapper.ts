import type { Acceptance as PrismaAcceptance, Prisma } from '@prisma/client';
import type { Acceptance } from '../../../domain/types';
import { embedActor, extractActor } from './actor.mapper';
import { nullToUndefined } from './null';

/** Prisma row → domain type (createdAt is an infrastructure-only field). */
export const toDomain = (row: PrismaAcceptance): Acceptance => ({
  id: row.id,
  customerId: row.customerId,
  versionId: row.versionId,
  method: row.method,
  channel: row.channel,
  acceptedAt: row.acceptedAt,
  actor: extractActor(row),
  isEffective: row.isEffective,
  supersededByAcceptanceId: nullToUndefined(row.supersededByAcceptanceId),
  consentText: nullToUndefined(row.consentText),
  consentTextHash: nullToUndefined(row.consentTextHash),
  contentHash: row.contentHash,
  ipAddress: nullToUndefined(row.ipAddress),
  userAgent: nullToUndefined(row.userAgent),
  evidenceNote: nullToUndefined(row.evidenceNote),
});

/**
 * Domain type → Prisma create data for `append` (append-only, see acceptance.repo.ts).
 *
 * Mapping decision (see docs/PERSISTENCE.md): `contentHash` is optional in the domain type but
 * required in the DB column (an audit record without a hash is worthless). This mapping layer
 * therefore ALWAYS populates the field — falling back to an empty string if the domain layer
 * (which should not happen in practice, since the application layer always populates the hash
 * from the accepted AgreementVersion) exceptionally does not supply a contentHash.
 */
export const toCreateData = (acceptance: Acceptance): Prisma.AcceptanceUncheckedCreateInput => ({
  id: acceptance.id,
  customerId: acceptance.customerId,
  versionId: acceptance.versionId,
  method: acceptance.method,
  channel: acceptance.channel,
  acceptedAt: acceptance.acceptedAt,
  ...embedActor(acceptance.actor),
  isEffective: acceptance.isEffective,
  supersededByAcceptanceId: acceptance.supersededByAcceptanceId ?? null,
  consentText: acceptance.consentText ?? null,
  consentTextHash: acceptance.consentTextHash ?? null,
  contentHash: acceptance.contentHash ?? '',
  ipAddress: acceptance.ipAddress ?? null,
  userAgent: acceptance.userAgent ?? null,
  evidenceNote: acceptance.evidenceNote ?? null,
});
