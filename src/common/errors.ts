/**
 * Business errors of the domain — the codes form the stable, public error contract of the API.
 * The domain throws DomainError; HTTP mapping is done by DomainErrorFilter (no Nest import here).
 */
export type DomainErrorCode =
  | 'FORBIDDEN'
  | 'VERSION_NOT_FOUND'
  | 'VERSION_IMMUTABLE'
  | 'ALREADY_ACCEPTED'
  | 'VERSION_NOT_CURRENT'
  | 'CHANGE_SUMMARY_REQUIRED'
  | 'CONSENT_TEXT_REQUIRED'
  | 'UNKNOWN_AUDIENCE'
  | 'UNKNOWN_DOCUMENT_TYPE'
  | 'DOCUMENT_TYPE_EXTERNAL'
  | 'DOCUMENT_TYPE_NOT_EXTERNAL'
  | 'ROLE_MISMATCH'
  | 'CONSENT_TEXT_MISMATCH'
  | 'OBJECTION_NOT_APPLICABLE'
  | 'OBJECTION_PERIOD_EXPIRED'
  | 'CUSTOMER_NOT_FOUND'
  | 'LINK_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INVALID_STATE';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
  }
}

export const HTTP_STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  FORBIDDEN: 403,
  VERSION_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  // Uniform for unknown/expired/revoked acceptance links — never reveals which case it was.
  LINK_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  VERSION_IMMUTABLE: 409,
  ALREADY_ACCEPTED: 409,
  VERSION_NOT_CURRENT: 422,
  CHANGE_SUMMARY_REQUIRED: 422,
  CONSENT_TEXT_REQUIRED: 422,
  UNKNOWN_AUDIENCE: 422,
  UNKNOWN_DOCUMENT_TYPE: 422,
  // A version/document operation targeted an external document type (use the signed-documents flow).
  DOCUMENT_TYPE_EXTERNAL: 422,
  // A signed-document upload targeted a non-external document type (use the version/clickwrap flow).
  DOCUMENT_TYPE_NOT_EXTERNAL: 422,
  ROLE_MISMATCH: 422,
  CONSENT_TEXT_MISMATCH: 422,
  OBJECTION_NOT_APPLICABLE: 422,
  OBJECTION_PERIOD_EXPIRED: 422,
  INVALID_STATE: 422,
};
