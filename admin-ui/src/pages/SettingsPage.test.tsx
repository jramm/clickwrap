import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audiencesFixture } from '../test/handlers';
import { server } from '../test/server';
import { renderWithProviders } from '../test/renderWithProviders';
import { SettingsPage } from './SettingsPage';

const BASE = 'http://localhost:3000';

describe('SettingsPage — category CRUD', () => {
  let audiences: { id: string; key: string; name: string }[];

  beforeEach(() => {
    audiences = audiencesFixture.map((a) => ({ ...a }));
    server.use(http.get(`${BASE}/admin/audiences`, () => HttpResponse.json(audiences)));
  });

  it('lists existing audiences and document types', async () => {
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText('Operator')).toBeInTheDocument();
    expect(screen.getByText('Partner')).toBeInTheDocument();
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    expect(screen.getByText('Data Processing Agreement')).toBeInTheDocument();
  });

  it('shows slug validation feedback for an invalid key', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Operator');

    const keyField = screen.getAllByLabelText('Key')[0];
    await user.type(keyField, 'Not A Slug');

    expect(
      screen.getAllByText(/lowercase letters, numbers and hyphens only/i).length,
    ).toBeGreaterThan(0);
  });

  it('creates a new audience via POST and refetches the list', async () => {
    let posted: unknown = null;
    server.use(
      http.post(`${BASE}/admin/audiences`, async ({ request }) => {
        posted = await request.json();
        const created = { id: 'aud-new', key: 'reseller', name: 'Reseller' };
        audiences.push(created);
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Operator');

    await user.type(screen.getAllByLabelText('Key')[0], 'reseller');
    await user.type(screen.getAllByLabelText('Name')[0], 'Reseller');
    await user.click(screen.getAllByRole('button', { name: 'Add' })[0]);

    await waitFor(() => expect(posted).toEqual({ key: 'reseller', name: 'Reseller' }));
    expect(await screen.findByText('Reseller')).toBeInTheDocument();
  });

  it('renders per-document-type template selects (notification + reminder)', async () => {
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Data Processing Agreement');
    // Two selects per document type (2 document types → 4 comboboxes).
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(4));
  });

  it('assigns a notification template to a document type via PATCH', async () => {
    let patched: Record<string, unknown> | null = null;
    server.use(
      http.patch(`${BASE}/admin/document-types/:id`, async ({ params, request }) => {
        patched = { id: params.id, ...((await request.json()) as object) };
        return HttpResponse.json({ id: params.id, key: 'terms', name: 'Terms of Service', notificationTemplateId: 'tpl-custom' });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Data Processing Agreement');
    await waitFor(() => expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(4));

    // First combobox = first document type's notification template select.
    await user.click(screen.getAllByRole('combobox')[0]);
    await user.click(await screen.findByRole('option', { name: 'Friendly welcome' }));

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched).toMatchObject({ notificationTemplateId: 'tpl-custom' });
  });

  it('surfaces the 422 "still in use" error on delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.use(
      http.delete(`${BASE}/admin/audiences/:id`, () =>
        HttpResponse.json({ code: 'INVALID_STATE' }, { status: 422 }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Operator');

    const row = screen.getByText('Operator').closest('tr');
    if (!row) throw new Error('row not found');
    await user.click(within(row as HTMLElement).getByLabelText('Delete'));

    expect(
      await screen.findByText(/still in use and cannot be deleted/i),
    ).toBeInTheDocument();
  });
});
