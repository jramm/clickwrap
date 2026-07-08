import type { DocumentTypeDef as PrismaDocumentTypeDef } from '@prisma/client';
import type { DocumentTypeDef } from '../../../domain/types';
import { nullToUndefined } from './null';

/** Prisma row → domain type (createdAt/updatedAt are infrastructure-only fields). */
export const toDomain = (row: PrismaDocumentTypeDef): DocumentTypeDef => ({
  id: row.id,
  key: row.key,
  name: row.name,
  notificationTemplateId: nullToUndefined(row.notificationTemplateId),
  reminderTemplateId: nullToUndefined(row.reminderTemplateId),
  acceptanceConfirmationTemplateId: nullToUndefined(row.acceptanceConfirmationTemplateId),
});

/** Domain type → Prisma create/update data. */
export const toUpsertData = (
  documentType: DocumentTypeDef,
): {
  key: string;
  name: string;
  notificationTemplateId: string | null;
  reminderTemplateId: string | null;
  acceptanceConfirmationTemplateId: string | null;
} => ({
  key: documentType.key,
  name: documentType.name,
  notificationTemplateId: documentType.notificationTemplateId ?? null,
  reminderTemplateId: documentType.reminderTemplateId ?? null,
  acceptanceConfirmationTemplateId: documentType.acceptanceConfirmationTemplateId ?? null,
});
