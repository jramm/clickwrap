import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptanceLinkFixture } from '../test/handlers';
import { server } from '../test/server';
import { renderWithProviders } from '../test/renderWithProviders';
import { CustomerDetailPage } from './CustomerDetailPage';

const BASE = 'http://localhost:3000';

function renderAt(customerId: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/customers/:id" element={<CustomerDetailPage />} />
    </Routes>,
    { route: `/customers/${customerId}` },
  );
}

/**
 * jsdom has no navigator.clipboard — install a mock and return its spy.
 * IMPORTANT: call AFTER userEvent.setup(), which installs its own clipboard stub.
 */
function mockClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

describe('CustomerDetailPage', () => {
  it('renders the customer display name in the header, with externalRef, role chips and a demoted id', async () => {
    renderAt('c-123');

    // Header shows the derived display name (companyName), not the raw UUID.
    expect(await screen.findByRole('heading', { name: 'Example Utility Ltd' })).toBeInTheDocument();
    // Sub-line: external reference, role chip and the (still present) customer id.
    expect(screen.getByText('Ref: crm-4711')).toBeInTheDocument();
    expect(screen.getByText('operator')).toBeInTheDocument();
    expect(screen.getByText('Customer ID: c-123')).toBeInTheDocument();
  });

  it('lists the customer’s signed documents with a download link', async () => {
    renderAt('c-123');

    expect(await screen.findByText('Signed documents')).toBeInTheDocument();
    expect(await screen.findByText('signed-offer.pdf')).toBeInTheDocument();
    // Signer + reference are surfaced in the meta line (labels scope it to the signed-doc row).
    expect(screen.getByText(/Signer: Jane Doe/)).toBeInTheDocument();
    expect(screen.getByText(/Reference: HubSpot deal 12345/)).toBeInTheDocument();
    // The download link points at the presigned pdfUrl.
    const download = screen.getByRole('link', { name: 'Download' });
    expect(download).toHaveAttribute('href', 'https://example.test/sd-1.pdf');
  });

  it('shows the customer’s recent events section with a link into the Events page', async () => {
    renderAt('c-123');

    expect(await screen.findByTestId('customer-events-section')).toBeInTheDocument();
    // The events section renders the fixture rows (summary text) and links to the full log.
    expect(await screen.findByText(/Version April 2026 edition accepted/)).toBeInTheDocument();
    const viewAll = screen.getByRole('link', { name: 'View all in Events' });
    expect(viewAll).toHaveAttribute('href', '/events?customerId=c-123');
  });

  it('opens the signed-document upload dialog limited to external document types', async () => {
    renderAt('c-123');

    await userEvent.click(await screen.findByRole('button', { name: 'Upload signed document' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Only external (signed) document types are available.')).toBeInTheDocument();

    // Opening the type select lists only the external "signed-offer" type (dpa/terms excluded).
    await userEvent.click(within(dialog).getByRole('combobox'));
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Signed offer (signed-offer)');
  });

  describe('copy acceptance link (agreements section action)', () => {
    afterEach(() => {
      // Remove the clipboard mock so other tests see the pristine jsdom navigator.
      delete (navigator as unknown as Record<string, unknown>).clipboard;
    });

    it('mints the customer link and copies the URL to the clipboard with an expiry toast', async () => {
      const created: string[] = [];
      server.use(
        http.post(`${BASE}/admin/customers/:id/acceptance-links`, ({ params }) => {
          created.push(String(params.id));
          return HttpResponse.json(acceptanceLinkFixture, { status: 201 });
        }),
      );
      const user = userEvent.setup();
      const writeText = mockClipboard();
      renderAt('c-123');

      await screen.findByText('Agreements & status');
      await user.click(screen.getByRole('button', { name: 'Copy acceptance link' }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(acceptanceLinkFixture.url));
      // One permanent per-customer link — minted for exactly this customer.
      expect(created).toEqual(['c-123']);
      expect(await screen.findByText(/Acceptance link copied/)).toBeInTheDocument();
      expect(screen.getByText(/07\/08\/2026/)).toBeInTheDocument();
    });

    it('surfaces the PUBLIC_BASE_URL configuration error verbatim', async () => {
      server.use(
        http.post(`${BASE}/admin/customers/:id/acceptance-links`, () =>
          HttpResponse.json(
            { code: 'INVALID_STATE', message: 'PUBLIC_BASE_URL is not configured — set it and retry.' },
            { status: 422 },
          ),
        ),
      );
      const user = userEvent.setup();
      renderAt('c-123');

      await screen.findByText('Agreements & status');
      await user.click(screen.getByRole('button', { name: 'Copy acceptance link' }));

      expect(await screen.findByText(/PUBLIC_BASE_URL is not configured/)).toBeInTheDocument();
    });
  });
});
