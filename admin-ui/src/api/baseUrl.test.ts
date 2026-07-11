import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';

/**
 * A RELATIVE VITE_API_URL sub-path (e.g. "/api", used when a reverse proxy serves the backend
 * under /api/*) must resolve against the page origin. API_URL is captured at module load, so we
 * stub the env and re-import the client fresh. jsdom's origin is http://localhost:3000.
 */
describe('apiRequest — relative /api base', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('prefixes requests with the relative base and resolves against the origin', async () => {
    vi.stubEnv('VITE_API_URL', '/api');
    vi.resetModules();
    const { apiRequest } = await import('./client');

    let seenUrl: string | null = null;
    server.use(
      http.get('http://localhost:3000/api/admin/documents', ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json({ items: [] });
      }),
    );

    await apiRequest('/admin/documents');
    expect(seenUrl).toBe('http://localhost:3000/api/admin/documents');
  });
});
