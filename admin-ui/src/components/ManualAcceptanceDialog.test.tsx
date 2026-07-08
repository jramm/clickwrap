import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/renderWithProviders';
import { server } from '../test/server';
import { ManualAcceptanceDialog } from './ManualAcceptanceDialog';

const BASE = 'http://localhost:3000';

/** Per-document version history incl. a RETIRED revision (default fixture has none). */
function useRetiredVersionsHandler() {
  server.use(
    http.get(`${BASE}/admin/documents/:id/versions`, ({ params }) =>
      HttpResponse.json({
        items:
          params.id === 'doc-dpa-op'
            ? [
                {
                  id: 'v-100',
                  documentId: 'doc-dpa-op',
                  versionLabel: 'April 2026 edition',
                  status: 'PUBLISHED',
                  acceptanceMode: 'ACTIVE',
                  changeSummary: 'Initial edition.',
                  validFrom: '2026-04-01T00:00:00Z',
                  contentHash: 'sha256:9c1e',
                  fileName: 'dpa-2026-04.pdf',
                  pdfUrl: 'https://example.test/v-100.pdf',
                },
                {
                  id: 'v-090',
                  documentId: 'doc-dpa-op',
                  versionLabel: 'Jan 2025 edition',
                  status: 'RETIRED',
                  acceptanceMode: 'ACTIVE',
                  changeSummary: 'Previous edition.',
                  validFrom: '2025-01-01T00:00:00Z',
                  contentHash: 'sha256:0ld1',
                  fileName: 'dpa-2025-01.pdf',
                  pdfUrl: 'https://example.test/v-090.pdf',
                },
              ]
            : [],
      }),
    ),
  );
}

describe('ManualAcceptanceDialog — older versions', () => {
  it('offers only current versions by default; the toggle reveals retired ones', async () => {
    useRetiredVersionsHandler();
    const user = userEvent.setup();
    renderWithProviders(<ManualAcceptanceDialog customerId="c-123" open onClose={() => {}} />);

    // Default: only documents' current versions.
    await user.click(await screen.findByLabelText('Version'));
    let listbox = await screen.findByRole('listbox');
    expect(
      within(listbox).getByText('Data Processing Agreement — Operator — April 2026 edition'),
    ).toBeInTheDocument();
    expect(within(listbox).queryByText(/Jan 2025 edition/)).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    // Toggle "show older versions" -> RETIRED revisions appear, labeled as retired.
    await user.click(screen.getByLabelText('Show older versions'));
    await user.click(screen.getByLabelText('Version'));
    listbox = await screen.findByRole('listbox');
    expect(
      await within(listbox).findByText('Data Processing Agreement — Operator — Jan 2025 edition (retired)'),
    ).toBeInTheDocument();
  });

  it('offers EVERY upcoming (future) version for advance acceptance, not just the next one', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ManualAcceptanceDialog customerId="c-123" open onClose={() => {}} />);

    await user.click(await screen.findByLabelText('Version'));
    const listbox = await screen.findByRole('listbox');
    expect(
      within(listbox).getByText(/September 2026 edition \(upcoming, effective/),
    ).toBeInTheDocument();
    expect(
      within(listbox).getByText(/December 2026 edition \(upcoming, effective/),
    ).toBeInTheDocument();
  });

  it('shows the "current version remains outstanding" hint when a retired version is selected', async () => {
    useRetiredVersionsHandler();
    const user = userEvent.setup();
    renderWithProviders(<ManualAcceptanceDialog customerId="c-123" open onClose={() => {}} />);

    await user.click(await screen.findByLabelText('Show older versions'));
    await user.click(screen.getByLabelText('Version'));
    await user.click(
      await screen.findByText('Data Processing Agreement — Operator — Jan 2025 edition (retired)'),
    );

    expect(await screen.findByText(/current version remains outstanding/i)).toBeInTheDocument();

    // Selecting a current version hides the hint again.
    await user.click(screen.getByLabelText('Version'));
    await user.click(
      await screen.findByText('Data Processing Agreement — Operator — April 2026 edition'),
    );
    expect(screen.queryByText(/current version remains outstanding/i)).not.toBeInTheDocument();
  });
});
