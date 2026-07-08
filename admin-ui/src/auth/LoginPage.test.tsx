import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { server } from '../test/server';
import { renderWithProviders } from '../test/renderWithProviders';
import { LoginPage } from './LoginPage';
import { clearToken } from './tokenStore';

const BASE = 'http://localhost:3000';

afterEach(() => clearToken());

describe('LoginPage — dynamic methods', () => {
  it('renders one option per discovered method (google + token)', async () => {
    renderWithProviders(<LoginPage />);

    expect(await screen.findByTestId('login-method-google')).toBeInTheDocument();
    expect(screen.getByTestId('login-method-token')).toBeInTheDocument();
    expect(screen.getByLabelText('Admin token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with token' })).toBeInTheDocument();
  });

  it('signs in via the token method and reaches the dashboard', async () => {
    server.use(
      http.get(`${BASE}/admin/auth/methods`, () =>
        HttpResponse.json({
          methods: [{ key: 'token', flow: 'token', label: 'Developer token', params: {} }],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<App />, { route: '/login' });

    await user.type(await screen.findByLabelText('Admin token'), 'dev-secret');
    await user.click(screen.getByRole('button', { name: 'Sign in with token' }));

    // Landing page after login is the dashboard.
    expect(await screen.findByTestId('dashboard-grid')).toBeInTheDocument();
  });

  it('falls back to the legacy Google flow with a warning when the endpoint 404s', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    server.use(
      http.get(`${BASE}/admin/auth/methods`, () => new HttpResponse(null, { status: 404 })),
    );

    renderWithProviders(<LoginPage />);

    expect(await screen.findByTestId('login-method-google')).toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
