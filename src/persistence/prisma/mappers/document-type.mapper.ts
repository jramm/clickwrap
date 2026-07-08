import type { DocumentTypeDef as PrismaDocumentTypeDef } from '@prisma/client';
import type { DocumentTypeDef } from '../../../domain/types';
import { nullToUndefined } from './null';

/** Prisma row → domain type (createdAt/updatedAt are infrastructure-only fields). */
export const toDomain = (row: PrismaDocumentTypeDef): DocumentTypeDef => ({
  id: row.id,
  key: row.key,
  name: row.name,
  external: row.external,
  notificationTemplateId: nullToUndefined(row.notificationTemplateId),
  reminderTemplateId: nullToUndefined(row.reminderTemplateId),
  acceptanceConfirmationTemplateId: nullToUndefined(row.acceptanceConfirmationTemplateId),
});

/** Domain type → Prisma create/update data. `external` is written on create and never changed. */
export const toUpsertData = (
  documentType: DocumentTypeDef,
): {
  key: string;
  name: string;
  external: boolean;
  notificationTemplateId: string | null;
  reminderTemplateId: string | null;
  acceptanceConfirmationTemplateId: string | null;
} => ({
  key: documentType.key,
  name: documentType.name,
  external: documentType.external ?? false,
  notificationTemplateId: documentType.notificationTemplateId ?? null,
  reminderTemplateId: documentType.reminderTemplateId ?? null,
  acceptanceConfirmationTemplateId: documentType.acceptanceConfirmationTemplateId ?? null,
});
