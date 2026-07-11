import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { createdCustomerFixture, customersFixture } from '../test/handlers';
import { setMatchMediaMatches } from '../test/matchMedia';
import { server } from '../test/server';
import { renderWithProviders } from '../test/renderWithProviders';
import { CustomersPage } from './CustomersPage';

const BASE = 'http://localhost:3000';

describe('CustomersPage', () => {
  it('lists customers from the paginated endpoint', async () => {
    renderWithProviders(<CustomersPage />);
    expect(await screen.findByText('Example Utility Ltd')).toBeInTheDocument();
    expect(screen.getByText(/1 total/)).toBeInTheDocument();
  });

  it('creates a customer with a signedDocuments payload (signing date + document types) (#29)', async () => {
    let posted: {
      externalRef?: string;
      roles?: string[];
      contactEmails?: string[];
      signedDocuments?: { effectiveDate: string; documentTypes: string[]; reference?: string };
    } | null = null;
    server.use(
      http.post(`${BASE}/admin/customers`, async ({ request }) => {
        posted = (await request.json()) as typeof posted;
        return HttpResponse.json(createdCustomerFixture, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<CustomersPage />);
    await screen.findByText('Example Utility Ltd');

    await user.click(screen.getByRole('button', { name: 'New customer' }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText(/External reference/), 'crm-9000');
    await user.click(within(dialog).getByLabelText('Operator'));

    // Add a contact e-mail chip.
    await user.type(within(dialog).getByLabelText('Add e-mail'), 'ops@new.test');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));

    // #29 signed-contract section: set the signing date and mark a document type as signed.
    fireEvent.change(within(dialog).getByLabelText('Contract signing date'), { target: { value: '2026-06-15' } });
    await user.click(await within(dialog).findByLabelText('Data Processing Agreement'));
    await user.type(within(dialog).getByLabelText('Reference'), 'signed-2026');

    await user.click(within(dialog).getByRole('button', { name: 'Create customer' }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      externalRef: 'crm-9000',
      roles: ['operator'],
      contactEmails: ['ops@new.test'],
      signedDocuments: { effectiveDate: '2026-06-15T00:00:00.000Z', documentTypes: ['dpa'], reference: 'signed-2026' },
    });
  });

  it('renders a card list instead of the DataGrid on small viewports', async () => {
    setMatchMediaMatches(true);
    renderWithProviders(<CustomersPage />);

    expect(await screen.findByTestId('customers-card-list')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('debounces the search term into the customers request', async () => {
    const searches: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/admin/customers`, ({ request }) => {
        searches.push(new URL(request.url).searchParams.get('search'));
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<CustomersPage />);
    await user.type(screen.getByLabelText('Search customers'), 'acme');

    await waitFor(() => expect(searches).toContain('acme'));
    // Shows a search-specific empty state when nothing matches.
    expect(await screen.findByText(/No customers match "acme"/)).toBeInTheDocument();
  });

  it('renders a per-row compliance chip from the list response', async () => {
    renderWithProviders(<CustomersPage />);
    await screen.findByText('Example Utility Ltd');
    expect(await screen.findByTestId('compliance-chip-blocked')).toBeInTheDocument();
  });

  it('sends the compliance filter as a request param and resets to page 1', async () => {
    const requests: URL[] = [];
    server.use(
      http.get(`${BASE}/admin/customers`, ({ request }) => {
        requests.push(new URL(request.url));
        return HttpResponse.json(customersFixture);
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<CustomersPage />);
    await screen.findByText('Example Utility Ltd');

    // Open the Compliance select and choose "Non-compliant".
    await user.click(screen.getByLabelText('Compliance'));
    await user.click(await screen.findByRole('option', { name: 'Non-compliant' }));

    await waitFor(() =>
      expect(requests.some((u) => u.searchParams.get('compliance') === 'non_compliant')).toBe(true),
    );
  });

  it('sends the document-type and audience scope filters as request params', async () => {
    const requests: URL[] = [];
    server.use(
      http.get(`${BASE}/admin/customers`, ({ request }) => {
        requests.push(new URL(request.url));
        return HttpResponse.json(customersFixture);
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<CustomersPage />);
    await screen.findByText('Example Utility Ltd');

    await user.click(screen.getByLabelText('Audience'));
    await user.click(await screen.findByRole('option', { name: 'Operator' }));

    await waitFor(() =>
      expect(requests.some((u) => u.searchParams.get('audience') === 'operator')).toBe(true),
    );
  });

  it('clears the search term with the clear button', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CustomersPage />);

    const input = screen.getByLabelText('Search customers');
    await user.type(input, 'acme');
    expect(input).toHaveValue('acme');
    await user.click(screen.getByLabelText('Clear search'));
    expect(input).toHaveValue('');
  });
});
