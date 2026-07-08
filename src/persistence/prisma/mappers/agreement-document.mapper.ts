import type { AgreementDocument as PrismaAgreementDocument } from '@prisma/client';
import type { AgreementDocument } from '../../../domain/types';

/** Prisma row → domain type (createdAt/updatedAt are infrastructure-only fields). */
export const toDomain = (row: PrismaAgreementDocument): AgreementDocument => ({
  id: row.id,
  type: row.type,
  audience: row.audience,
  name: row.name,
});

/** Domain type → Prisma create/update data (identical, AgreementDocument has no optional fields). */
export const toUpsertData = (
  document: AgreementDocument,
): { type: string; audience: string; name: string } => ({
  type: document.type,
  audience: document.audience,
  name: document.name,
});
