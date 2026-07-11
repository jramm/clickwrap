import type { SignedDocument as PrismaSignedDocument } from '@prisma/client';
import type { SignedDocument } from '../../../domain/types.js';
import { nullToUndefined } from './null.js';

/** Prisma row → domain type (createdAt is an infrastructure-only field). */
export const toDomain = (row: PrismaSignedDocument): SignedDocument => ({
  id: row.id,
  customerId: row.customerId,
  documentTypeKey: row.documentTypeKey,
  audience: nullToUndefined(row.audience),
  fileName: row.fileName,
  storageKey: row.storageKey,
  contentHash: row.contentHash,
  fileSize: row.fileSize,
  signedAt: row.signedAt,
  signerName: nullToUndefined(row.signerName),
  reference: nullToUndefined(row.reference),
  note: nullToUndefined(row.note),
  uploadedBy: row.uploadedBy,
  uploadedAt: row.uploadedAt,
});

/** Domain type → Prisma create data. */
export const toCreateData = (document: SignedDocument) => ({
  id: document.id,
  customerId: document.customerId,
  documentTypeKey: document.documentTypeKey,
  audience: document.audience ?? null,
  fileName: document.fileName,
  storageKey: document.storageKey,
  contentHash: document.contentHash,
  fileSize: document.fileSize,
  signedAt: document.signedAt,
  signerName: document.signerName ?? null,
  reference: document.reference ?? null,
  note: document.note ?? null,
  uploadedBy: document.uploadedBy,
  uploadedAt: document.uploadedAt,
});
