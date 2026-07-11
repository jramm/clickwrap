import type { AgreementVersion as PrismaAgreementVersion, Prisma } from '@prisma/client';
import type { AgreementVersion } from '../../../domain/types.js';
import { nullToUndefined } from './null.js';

/** Prisma row → domain type (createdAt/updatedAt/relations are infrastructure-only fields). */
export const toDomain = (row: PrismaAgreementVersion): AgreementVersion => ({
  id: row.id,
  documentId: row.documentId,
  versionLabel: row.versionLabel,
  status: row.status,
  acceptanceMode: row.acceptanceMode,
  objectionPeriodDays: nullToUndefined(row.objectionPeriodDays),
  gracePeriodDays: nullToUndefined(row.gracePeriodDays),
  hardDeadlineAt: nullToUndefined(row.hardDeadlineAt),
  changeSummary: row.changeSummary,
  consentText: nullToUndefined(row.consentText),
  storageKey: row.storageKey,
  fileName: row.fileName,
  contentHash: row.contentHash,
  fileSize: row.fileSize,
  validFrom: row.validFrom,
  publishedAt: nullToUndefined(row.publishedAt),
  publishedBy: nullToUndefined(row.publishedBy),
});

/** Domain type → Prisma create/update data (identical: AgreementVersion has no special aggregate-upsert field). */
export const toUpsertData = (version: AgreementVersion): Prisma.AgreementVersionUncheckedCreateInput => ({
  id: version.id,
  documentId: version.documentId,
  versionLabel: version.versionLabel,
  status: version.status,
  acceptanceMode: version.acceptanceMode,
  objectionPeriodDays: version.objectionPeriodDays ?? null,
  gracePeriodDays: version.gracePeriodDays ?? null,
  hardDeadlineAt: version.hardDeadlineAt ?? null,
  changeSummary: version.changeSummary,
  consentText: version.consentText ?? null,
  storageKey: version.storageKey,
  fileName: version.fileName,
  contentHash: version.contentHash,
  fileSize: version.fileSize,
  validFrom: version.validFrom,
  publishedAt: version.publishedAt ?? null,
  publishedBy: version.publishedBy ?? null,
});
