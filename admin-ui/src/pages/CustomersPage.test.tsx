import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { createdCustomerFixture } from '../test/handlers';
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

  it('creates a customer with an acceptedVersions (signed-offer) payload', async () => {
    let posted: {
      externalRef?: string;
      roles?: string[];
      contactEmails?: string[];
      acceptedVersions?: { versionId: string; reference?: string }[];
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

    // The signed-offer section lists the published operator documents; mark one.
    const acceptedCheckbox = await within(dialog).findByLabelText(
      /Data Processing Agreement — Operator — April 2026 edition/,
    );
    await user.click(acceptedCheckbox);
    await user.type(within(dialog).getByLabelText('Reference'), 'signed-2026');

    await user.click(within(dialog).getByRole('button', { name: 'Create customer' }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      externalRef: 'crm-9000',
      roles: ['operator'],
      contactEmails: ['ops@new.test'],
      acceptedVersions: [{ versionId: 'v-100', reference: 'signed-2026' }],
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
