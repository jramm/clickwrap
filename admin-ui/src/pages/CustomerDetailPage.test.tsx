import { screen } from '@testing-library/react';
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
});
