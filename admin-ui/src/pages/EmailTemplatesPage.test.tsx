import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { forwardRef, useImperativeHandle } from 'react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderWithProviders } from '../test/renderWithProviders';
import { EmailTemplatesPage } from './EmailTemplatesPage';

// The Unlayer editor is an iframe wrapper (loads from a CDN) — mock it and expose a fixed export.
vi.mock('../components/UnlayerEditor', () => ({
  UnlayerEditor: forwardRef((_props: unknown, ref: React.Ref<unknown>) => {
    useImperativeHandle(ref, () => ({
      export: async () => ({ design: '{"exported":true}', html: '<p>Exported {{customerName}}</p>' }),
    }));
    return <div data-testid="unlayer-editor" />;
  }),
}));

const BASE = 'http://localhost:3000';

describe('EmailTemplatesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists templates with kind and default badges', async () => {
    renderWithProviders(<EmailTemplatesPage />);

    expect(await screen.findByText('Default — version notification')).toBeInTheDocument();
    expect(screen.getByText('Friendly welcome')).toBeInTheDocument();
    // Default rows carry a Default badge.
    expect(screen.getAllByText('Default').length).toBeGreaterThan(0);
  });

  it('creates a template: exports design+html from the editor and POSTs them', async () => {
    let posted: Record<string, unknown> | null = null;
    server.use(
      http.post(`${BASE}/admin/email-templates`, async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            id: 'tpl-new',
            name: posted.name,
            kind: posted.kind,
            subject: posted.subject,
            design: posted.design,
            html: posted.html,
            isDefault: false,
            createdAt: '2026-07-03T00:00:00Z',
            updatedAt: '2026-07-03T00:00:00Z',
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<EmailTemplatesPage />);
    await screen.findByText('Friendly welcome');

    await user.click(screen.getByRole('button', { name: 'New template' }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText('Name'), 'My template');
    // Placeholder helper: clicking a chip inserts {{var}} into the subject.
    await user.click(within(dialog).getByText('{{customerName}}'));

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      name: 'My template',
      kind: 'VERSION_NOTIFICATION',
      subject: '{{customerName}}',
      design: '{"exported":true}',
      html: '<p>Exported {{customerName}}</p>',
    });
  });

  it('renders a live preview via the preview endpoint when editing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<EmailTemplatesPage />);
    await screen.findByText('Friendly welcome');

    const row = screen.getByText('Friendly welcome').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Refresh preview' }));

    await waitFor(() =>
      expect(within(dialog).getByTitle('Preview')).toBeInTheDocument(),
    );
  });

  it('disables delete for a default template', async () => {
    renderWithProviders(<EmailTemplatesPage />);
    await screen.findByText('Default — version notification');

    const row = screen.getByText('Default — version notification').closest('tr') as HTMLElement;
    expect(within(row).getByLabelText('Delete')).toBeDisabled();
  });

  it('deletes a custom template', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let deleted = false;
    server.use(
      http.delete(`${BASE}/admin/email-templates/tpl-custom`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<EmailTemplatesPage />);
    await screen.findByText('Friendly welcome');

    const row = screen.getByText('Friendly welcome').closest('tr') as HTMLElement;
    await user.click(within(row).getByLabelText('Delete'));

    await waitFor(() => expect(deleted).toBe(true));
  });

  it('surfaces the 422 "in use / default" error on delete', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    server.use(
      http.delete(`${BASE}/admin/email-templates/tpl-custom`, () =>
        HttpResponse.json({ code: 'INVALID_STATE' }, { status: 422 }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<EmailTemplatesPage />);
    await screen.findByText('Friendly welcome');

    const row = screen.getByText('Friendly welcome').closest('tr') as HTMLElement;
    await user.click(within(row).getByLabelText('Delete'));

    expect(await screen.findByText(/cannot be deleted/i)).toBeInTheDocument();
  });
});
