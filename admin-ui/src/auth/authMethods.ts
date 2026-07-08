import { z } from 'zod';
import { API_URL } from '../api/client';

/**
 * Unauthenticated discovery of the available admin login methods.
 *
 * TODO(kubb): this endpoint (`GET /admin/auth/methods`) is not yet part of the
 * committed openapi.admin.json. Once the backend adds it, delete this local
 * schema/fetcher and consume the generated hook from src/gen instead.
 */
export const authMethodSchema = z.object({
  key: z.string(),
  flow: z.enum(['google', 'token', 'oidc-redirect']),
  label: z.string(),
  params: z
    .object({
      clientId: z.string().optional(),
      authorizeUrl: z.string().optional(),
    })
    .partial()
    .default({}),
});
export type AuthMethod = z.infer<typeof authMethodSchema>;

export const authMethodsResponseSchema = z.object({
  methods: z.array(authMethodSchema),
});
export type AuthMethodsResponse = z.infer<typeof authMethodsResponseSchema>;

/** Fetches the login methods. Throws on a non-2xx response or a schema mismatch. */
export async function fetchAuthMethods(signal?: AbortSignal): Promise<AuthMethod[]> {
  const response = await fetch(`${API_URL}/admin/auth/methods`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`auth/methods responded ${response.status}`);
  }
  const body = await response.json();
  return authMethodsResponseSchema.parse(body).methods;
}
