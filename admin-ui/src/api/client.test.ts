import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { overviewResponseModelSchema } from '../gen';
import { clearToken, getToken, setAuthErrorListener, setToken } from '../auth/tokenStore';
import { server } from '../test/server';
import { apiRequest } from './client';
import { ApiError } from './errors';

const BASE = 'http://localhost:3000';

afterEach(() => {
  clearToken();
  setAuthErrorListener(null);
});

describe('apiRequest — auth headers', () => {
  it('attaches the Google ID token as Bearer and the dev fallback x-admin-token', async () => {
    setToken('id-token-xyz');
    let seenAuth: string | null = null;
    let seenAdmin: string | null = null;
    server.use(
      http.get(`${BASE}/admin/documents`, ({ request }) => {
        seenAuth = request.headers.get('authorization');
        seenAdmin = request.headers.get('x-admin-token');
        return HttpResponse.json({ items: [] });
      }),
    );

    await apiRequest('/admin/documents');

    expect(seenAuth).toBe('Bearer id-token-xyz');
    expect(seenAdmin).toBe('dev-token-abc');
  });
});

describe('apiRequest — error mapping', () => {
  it('maps a typed backend error onto ApiError', async () => {
    server.use(
      http.post(`${BASE}/admin/versions/:id/publish`, () =>
        HttpResponse.json({ code: 'VERSION_IMMUTABLE', message: 'schon publiziert' }, { status: 409 }),
      ),
    );

    await expect(apiRequest('/admin/versions/v-1/publish', { method: 'POST' })).rejects.toMatchObject(
      { code: 'VERSION_IMMUTABLE', status: 409 } satisfies Partial<ApiError>,
    );
  });

  it('discards the token and reports an auth error on 401', async () => {
    setToken('soon-invalid');
    const onAuthError = vi.fn();
    setAuthErrorListener(onAuthError);
    server.use(
      http.get(`${BASE}/admin/overview`, () =>
        HttpResponse.json({ code: 'FORBIDDEN' }, { status: 401 }),
      ),
    );

    await expect(apiRequest('/admin/overview')).rejects.toBeInstanceOf(ApiError);
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(getToken()).toBeNull();
  });

  it('reports PARSE_ERROR when the response violates the generated schema', async () => {
    server.use(http.get(`${BASE}/admin/overview`, () => HttpResponse.json({ nonsense: true })));

    await expect(
      apiRequest('/admin/overview', { schema: overviewResponseModelSchema }),
    ).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });
});
