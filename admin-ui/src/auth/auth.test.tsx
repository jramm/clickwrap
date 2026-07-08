import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import { server } from '../test/server';
import { renderWithProviders } from '../test/renderWithProviders';
import { clearToken, setToken } from './tokenStore';

const BASE = 'http://localhost:3000';

/** Builds an (unsigned) fake JWT with decodable claims for the tests. */
function makeToken(claims: Record<string, unknown>): string {
  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.sig`;
}

afterEach(() => clearToken());

describe('Auth flow', () => {
  it('redirects to the login page without a token', async () => {
    renderWithProviders(<App />, { route: '/' });

    expect(await screen.findByText(/Please sign in to continue/i)).toBeInTheDocument();
  });

  it('logs out on 401 and shows the login page again', async () => {
    setToken(makeToken({ sub: 'u-1', name: 'Test Admin', email: 'a@example.test', exp: 4102444800 }));
    // The landing page after login is the dashboard — its request is what 401s here.
    server.use(
      http.get(`${BASE}/admin/dashboard`, () =>
        HttpResponse.json({ code: 'FORBIDDEN' }, { status: 401 }),
      ),
    );

    renderWithProviders(<App />, { route: '/' });

    await waitFor(() =>
      expect(screen.getByText(/Please sign in to continue/i)).toBeInTheDocument(),
    );
  });
});
