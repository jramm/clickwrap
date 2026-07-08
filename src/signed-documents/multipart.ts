/**
 * Shared multipart/base64 PDF upload helpers for the signed-document controllers (both surfaces).
 * Primary path: multipart/form-data (field `file`); fallback: base64 JSON (`file` + `fileName`).
 * Mirrors the version-upload handling in agreements-admin.controller.ts.
 */
import { BadRequestException } from '@nestjs/common';
import type { PdfUpload } from '../agreements/ports';
import type { UploadSignedDocumentInput } from './signed-document.service';

/** PDF max. 20 MB (same limit as version uploads). */
export const MAX_SIGNED_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Signed-document upload body — shared by both surfaces. With multipart all metadata arrives as
 * strings; the PDF is the multipart `file` field (or, as a fallback, base64 `file` + `fileName`).
 */
export interface SignedDocumentUploadBody {
  /** Fallback: PDF as base64 string (only without a multipart `file`). */
  file?: string;
  fileName?: string;
  documentTypeKey?: string;
  signedAt?: string;
  signerName?: string;
  reference?: string;
  audience?: string;
  note?: string;
}

/** Prefer the multipart `file`; otherwise the base64 fallback from the JSON body; otherwise undefined. */
export const resolveSignedUpload = (
  multipartFile: Express.Multer.File | undefined,
  base64File: unknown,
  base64FileName: unknown,
): PdfUpload | undefined => {
  if (multipartFile) {
    return { buffer: multipartFile.buffer, fileName: multipartFile.originalname };
  }
  if (typeof base64File === 'string' && typeof base64FileName === 'string') {
    return { buffer: Buffer.from(base64File, 'base64'), fileName: base64FileName };
  }
  return undefined;
};

/**
 * Builds the shared {@link UploadSignedDocumentInput} from the request body + multipart file.
 * Throws 400 when the PDF is missing or `documentTypeKey`/`signedAt` are absent — the business
 * validations (customer/type/audience) happen in the service.
 */
export const buildUploadInput = (
  body: SignedDocumentUploadBody,
  multipartFile: Express.Multer.File | undefined,
): UploadSignedDocumentInput => {
  const upload = resolveSignedUpload(multipartFile, body.file, body.fileName);
  if (!upload) {
    throw new BadRequestException('PDF missing: multipart field `file` or base64 `file`+`fileName` required');
  }
  if (typeof body.documentTypeKey !== 'string' || body.documentTypeKey === '') {
    throw new BadRequestException('documentTypeKey is required');
  }
  if (typeof body.signedAt !== 'string' || body.signedAt === '') {
    throw new BadRequestException('signedAt is required');
  }
  return {
    documentTypeKey: body.documentTypeKey,
    signedAt: new Date(body.signedAt),
    file: upload,
    signerName: body.signerName,
    reference: body.reference,
    audience: body.audience,
    note: body.note,
  };
};
