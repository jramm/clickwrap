import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderWithProviders } from '../test/renderWithProviders';
import { DashboardPage } from './DashboardPage';

const BASE = 'http://localhost:3000';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

describe('DashboardPage', () => {
  it('renders one card per version with progress and counters', async () => {
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByTestId('dashboard-grid')).toBeInTheDocument();
    // Both versions of the DPA appear (current + upcoming).
    expect(screen.getAllByText('Data Processing Agreement — Operator')).toHaveLength(2);
    expect(screen.getByText('April 2026 edition')).toBeInTheDocument();
    expect(screen.getByText('September 2026 edition')).toBeInTheDocument();

    // Progress + counters of the current version.
    expect(screen.getByText('4 of 8 accepted')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Accepted 4')).toBeInTheDocument();
    expect(screen.getByText('Pending 2')).toBeInTheDocument();
    expect(screen.getByText('Blocked 1')).toBeInTheDocument();
    expect(screen.getByText('Objected 1')).toBeInTheDocument();
  });

  it('flags the upcoming version with a badge', async () => {
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText('Upcoming')).toBeInTheDocument();
  });

  it('navigates to the per-version customer list when a card is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardPage />);

    await screen.findByTestId('dashboard-grid');
    await user.click(screen.getByText('April 2026 edition'));

    expect(navigateMock).toHaveBeenCalledWith('/versions/v-100/customers');
  });

  it('shows an empty state when there are no versions', async () => {
    server.use(http.get(`${BASE}/admin/dashboard`, () => HttpResponse.json({ items: [] })));
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText('No published versions yet.')).toBeInTheDocument();
  });

  it('shows an error state when the request fails', async () => {
    server.use(http.get(`${BASE}/admin/dashboard`, () => new HttpResponse(null, { status: 500 })));
    renderWithProviders(<DashboardPage />);
    // A 500 surfaces as a mapped ApiError message (same pattern as the other pages).
    expect(await screen.findByText('An unknown error occurred.')).toBeInTheDocument();
  });
});
