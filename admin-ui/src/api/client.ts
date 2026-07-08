import { z } from 'zod';
import { clearToken, getDevAdminToken, getToken, notifyAuthError } from '../auth/tokenStore';
import { ApiError, toApiError } from './errors';

/**
 * Typed API client. Attaches the Google ID token as `Authorization: Bearer
 * <idToken>` to every call (internal SSO). If the dev fallback
 * `VITE_DEV_ADMIN_TOKEN` is set, `x-admin-token` is sent as well (backend dev
 * stub, see README). 401/403 -> discard token and trigger logout. Responses are
 * validated with zod (PARSE_ERROR otherwise).
 */

/** Base URL of the backend (trailing slash stripped). Shared with kubbClient. */
export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const DEV_ADMIN_TOKEN = import.meta.env.VITE_DEV_ADMIN_TOKEN;

export function buildHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // Runtime dev token (login "token" method) wins over the build-time fallback.
  const devToken = getDevAdminToken() ?? DEV_ADMIN_TOKEN;
  if (devToken) headers.set('x-admin-token', devToken);
  return headers;
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** JSON body (sets Content-Type automatically). */
  json?: unknown;
  /** FormData body (multipart, e.g. PDF upload — do NOT set Content-Type!). */
  form?: FormData;
  /** Query parameters. */
  query?: Record<string, string | number | boolean | undefined>;
  // zod schema for the expected response. If absent, nothing is parsed.
  // Input type is intentionally `any`: otherwise the input side of schemas with
  // .default()/.nullish() would distort the inference of T (output).
  schema?: z.ZodType<T, z.ZodTypeDef, any>;
}

function buildUrl(path: string, query?: RequestOptions<unknown>['query']): string {
  const url = new URL(`${API_URL}${path}`, API_URL || window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiRequest<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const { method = 'GET', json, form, query, schema } = options;

  const headers = buildHeaders();
  let body: BodyInit | undefined;
  if (form) {
    body = form; // The browser sets Content-Type/boundary itself.
  } else if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), { method, headers, body });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'NETWORK_ERROR');
  }

  if (response.status === 401 || response.status === 403) {
    clearToken();
    notifyAuthError();
    const errBody = await safeJson(response);
    throw toApiError(response.status, errBody);
  }

  if (!response.ok) {
    throw toApiError(response.status, await safeJson(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const data = await safeJson(response);
  if (!schema) return data as T;

  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(response.status, 'PARSE_ERROR', 'PARSE_ERROR');
  }
  return parsed.data;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}
