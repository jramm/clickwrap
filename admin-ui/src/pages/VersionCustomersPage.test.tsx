import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/renderWithProviders';
import { VersionCustomersPage } from './VersionCustomersPage';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

function renderAt(versionId: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/versions/:id" element={<VersionCustomersPage />} />
    </Routes>,
    { route: `/versions/${versionId}` },
  );
}

describe('VersionCustomersPage', () => {
  it('shows the customer as PENDING for the UPCOMING version (drill-down bug fixed)', async () => {
    // v-300 is the upcoming version — the same customer that accepted the current version is only
    // pending here, and no acceptance is shown.
    renderAt('v-300');

    expect(await screen.findByText('September 2026 edition')).toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    const row = screen.getByText('Example Utility Ltd').closest('.MuiDataGrid-row') as HTMLElement;
    expect(within(row).getByText('Pending')).toBeInTheDocument();
    expect(within(row).queryByText(/Accepted 20/)).not.toBeInTheDocument();
  });

  it('shows the SAME customer as ACCEPTED with acceptance details on the current version', async () => {
    renderAt('v-100');

    expect(await screen.findByText('April 2026 edition')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    const row = screen.getByText('Example Utility Ltd').closest('.MuiDataGrid-row') as HTMLElement;
    expect(within(row).getByText('Accepted')).toBeInTheDocument();
    // Acceptance details: method · channel.
    expect(within(row).getByText(/ACTIVE_CONSENT · PORTAL/)).toBeInTheDocument();
  });

  it('filters the list via the state tabs', async () => {
    const user = userEvent.setup();
    renderAt('v-100');

    // Both customers visible initially (accepted + notified).
    expect(await screen.findByText('Example Utility Ltd')).toBeInTheDocument();
    expect(screen.getByText('Sample Energy Inc')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Accepted' }));

    await waitFor(() => expect(screen.queryByText('Sample Energy Inc')).not.toBeInTheDocument());
    expect(screen.getByText('Example Utility Ltd')).toBeInTheDocument();
  });

  it('opens the customer detail page on a row click', async () => {
    const user = userEvent.setup();
    renderAt('v-100');

    await user.click(await screen.findByText('Example Utility Ltd'));

    expect(navigateMock).toHaveBeenCalledWith('/customers/c-123');
  });
});
