/**
 * Custom kubb client. This is the fetcher the generated react-query hooks
 * (src/gen/hooks) call. It wraps the shared auth behavior:
 *  - base URL from VITE_API_URL,
 *  - `Authorization: Bearer <token>` from the token store,
 *  - the `x-admin-token` dev fallback,
 *  - 401/403 -> discard token + trigger logout,
 *  - typed error bodies `{ code, message }` -> ApiError (translated by the UI).
 *
 * The signature matches @kubb/plugin-client's fetch client contract so the
 * generated hooks can import it via `client.importPath` (see kubb.config.ts).
 */
import { clearToken, notifyAuthError } from '../auth/tokenStore';
import { API_URL, buildHeaders } from './client';
import { ApiError, toApiError } from './errors';

type RequestMethod = 'GET' | 'PUT' | 'PATCH' | 'POST' | 'DELETE' | 'OPTIONS' | 'HEAD';

export interface RequestConfig<TData = unknown> {
  baseURL?: string;
  url?: string;
  method?: RequestMethod;
  params?: unknown;
  data?: TData | FormData;
  responseType?: 'arraybuffer' | 'blob' | 'document' | 'json' | 'text' | 'stream';
  signal?: AbortSignal;
  headers?: [string, string][] | Record<string, string>;
}

export interface ResponseConfig<TData = unknown> {
  data: TData;
  status: number;
  statusText: string;
  headers: Headers;
}

export type ResponseErrorConfig<TError = unknown> = TError;

export type Client = <TResponseData, _TError = unknown, TRequestData = unknown>(
  config: RequestConfig<TRequestData>,
) => Promise<ResponseConfig<TResponseData>>;

function buildUrl(config: RequestConfig): string {
  const base = config.baseURL ?? API_URL;
  // Origin as the URL base so a relative sub-path base (e.g. "/api") resolves; an absolute base
  // still wins via the already-absolute first argument. (Mirrors client.ts buildUrl.)
  const url = new URL(`${base}${config.url ?? ''}`, window.location.origin);
  const params = config.params;
  if (params && typeof params === 'object') {
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

export async function client<TResponseData, _TError = unknown, TRequestData = unknown>(
  config: RequestConfig<TRequestData>,
): Promise<ResponseConfig<TResponseData>> {
  const method = (config.method ?? 'GET').toUpperCase() as RequestMethod;
  const headers = buildHeaders(
    Array.isArray(config.headers) ? Object.fromEntries(config.headers) : config.headers,
  );

  let body: BodyInit | undefined;
  if (config.data instanceof FormData) {
    body = config.data; // The browser sets Content-Type/boundary itself.
  } else if (config.data !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(config.data);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(config), { method, headers, body, signal: config.signal });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'NETWORK_ERROR');
  }

  if (response.status === 401 || response.status === 403) {
    clearToken();
    notifyAuthError();
    throw toApiError(response.status, await safeJson(response));
  }

  if (!response.ok) {
    throw toApiError(response.status, await safeJson(response));
  }

  const data = [204, 205, 304].includes(response.status)
    ? (undefined as TResponseData)
    : ((await safeJson(response)) as TResponseData);

  return { data, status: response.status, statusText: response.statusText, headers: response.headers };
}

export default client;
