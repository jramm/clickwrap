/**
 * Error model of the API client. Maps the typed backend error responses
 * (see ../docs/API.md §7) onto an app class. UI text is not stored here — the
 * `code` is translated at display time via the i18n `errors.*` namespace
 * (see `errorMessageKey`), so this module stays language-neutral.
 */

/** Known error codes from ../docs/API.md §7 (+ transport codes). */
export type ApiErrorCode =
  | 'FORBIDDEN'
  | 'VERSION_NOT_FOUND'
  | 'VERSION_IMMUTABLE'
  | 'ALREADY_ACCEPTED'
  | 'VERSION_NOT_CURRENT'
  | 'CHANGE_SUMMARY_REQUIRED'
  | 'UNKNOWN_AUDIENCE'
  | 'ROLE_MISMATCH'
  | 'CONSENT_TEXT_MISMATCH'
  | 'OBJECTION_NOT_APPLICABLE'
  | 'OBJECTION_PERIOD_EXPIRED'
  | 'INVALID_STATE'
  | 'UNAUTHORIZED'
  | 'NETWORK_ERROR'
  | 'PARSE_ERROR'
  | 'UNKNOWN';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** 401/403 -> back to login. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

const KNOWN_CODES = new Set<ApiErrorCode>([
  'FORBIDDEN',
  'VERSION_NOT_FOUND',
  'VERSION_IMMUTABLE',
  'ALREADY_ACCEPTED',
  'VERSION_NOT_CURRENT',
  'CHANGE_SUMMARY_REQUIRED',
  'UNKNOWN_AUDIENCE',
  'ROLE_MISMATCH',
  'CONSENT_TEXT_MISMATCH',
  'OBJECTION_NOT_APPLICABLE',
  'OBJECTION_PERIOD_EXPIRED',
  'INVALID_STATE',
  'UNAUTHORIZED',
  'NETWORK_ERROR',
  'PARSE_ERROR',
  'UNKNOWN',
]);

/** i18n key for an error, for use with `t()`. Falls back to a generic key. */
export function errorMessageKey(err: unknown): string {
  return err instanceof ApiError ? `errors.${err.code}` : 'common.unknownError';
}

/**
 * Maps an HTTP status + optional backend body onto an ApiError. Expects the
 * error format `{ code, message }` (or `{ error: { code } }`). The `message`
 * kept here is only a non-localized fallback; the UI translates by `code`.
 */
export function toApiError(status: number, body: unknown): ApiError {
  const rawCode =
    isRecord(body) && typeof body.code === 'string'
      ? body.code
      : isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string'
        ? body.error.code
        : undefined;

  const code: ApiErrorCode =
    rawCode && KNOWN_CODES.has(rawCode as ApiErrorCode)
      ? (rawCode as ApiErrorCode)
      : status === 401 || status === 403
        ? 'FORBIDDEN'
        : 'UNKNOWN';

  const serverMessage =
    isRecord(body) && typeof body.message === 'string' ? body.message : code;

  return new ApiError(status, code, serverMessage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
