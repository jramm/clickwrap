import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/renderWithProviders';
import { CustomerDetailPage } from './CustomerDetailPage';

function renderAt(customerId: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/customers/:id" element={<CustomerDetailPage />} />
    </Routes>,
    { route: `/customers/${customerId}` },
  );
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
});
