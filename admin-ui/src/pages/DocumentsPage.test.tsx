import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/renderWithProviders';
import { DocumentsPage } from './DocumentsPage';

/**
 * jsdom has no navigator.clipboard — install a mock and return its spy.
 * IMPORTANT: call AFTER userEvent.setup(), which installs its own clipboard stub.
 */
function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

/** The version-history table row containing the given version label. */
async function findVersionRow(label: string): Promise<HTMLElement> {
  const cell = await screen.findByText(label);
  const row = cell.closest('tr');
  if (!row) throw new Error(`No table row for version "${label}"`);
  return row;
}

describe('DocumentsPage — publish flow', () => {
  it('publishes a draft version and shows the rollout count from the response', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DocumentsPage />);

    // Document is loaded (dynamic type/audience resolved to names)
    expect(await screen.findByText('Data Processing Agreement — Operator')).toBeInTheDocument();

    // Expand the first version history -> loads versions
    await user.click(screen.getAllByText('Version history')[0]);

    // Publish on the DRAFT row with a PAST validFrom
    const row = await findVersionRow('June 2026 edition');
    await user.click(within(row).getByRole('button', { name: 'Publish' }));

    // Confirmation dialog — immediate effectiveness: rollout warning, no scheduling note
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/immutable/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/currently published version .* is retired/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/will become effective on/i)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Publish now' }));

    // Result: rolloutCustomers from the response (921)
    await waitFor(() => expect(within(dialog).getByText(/rollout to/i)).toBeInTheDocument());
    expect(within(dialog).getByText(/921/)).toBeInTheDocument();
  });

  it('a draft with a FUTURE validFrom shows the scheduled-effectiveness note instead of the retire warning', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DocumentsPage />);

    expect(await screen.findByText('Data Processing Agreement — Operator')).toBeInTheDocument();
    await user.click(screen.getAllByText('Version history')[0]);

    // Publish on the DRAFT row with a FUTURE validFrom (fixture v-400)
    const row = await findVersionRow('October 2026 edition');
    await user.click(within(row).getByRole('button', { name: 'Publish' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/will become effective on/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/current version stays required until then/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/currently published version .* is retired/i)).not.toBeInTheDocument();
  });
});

describe('DocumentsPage — scheduled effectiveness & public PDF link', () => {
  it('shows an "upcoming" chip next to the current-version chip when a future published version exists', async () => {
    renderWithProviders(<DocumentsPage />);

    expect(await screen.findByText('Data Processing Agreement — Operator')).toBeInTheDocument();
    // Both operator documents carry a current chip …
    expect(await screen.findAllByText(/Current: /)).toHaveLength(2);
    // … but only the DPA (fixture with upcomingVersion) shows the upcoming chip.
    expect(screen.getByText(/Upcoming: September 2026 edition/)).toBeInTheDocument();
    expect(screen.getAllByText(/Upcoming:/)).toHaveLength(1);
  });

  it('copies the stable public PDF link to the clipboard and confirms with a toast', async () => {
    const user = userEvent.setup();
    const writeText = mockClipboard();
    try {
      renderWithProviders(<DocumentsPage />);

      expect(await screen.findByText('Data Processing Agreement — Operator')).toBeInTheDocument();
      // Two documents carry a latestPdfUrl in the fixtures; the two without one get no button.
      const copyButtons = screen.getAllByRole('button', { name: 'Copy public PDF link' });
      expect(copyButtons).toHaveLength(2);

      await user.click(copyButtons[0]);

      await waitFor(() =>
        expect(writeText).toHaveBeenCalledWith('https://clickwrap.example.org/documents/dpa/operator/latest.pdf'),
      );
      expect(await screen.findByText('Public PDF link copied.')).toBeInTheDocument();
    } finally {
      // Remove the clipboard mock so other tests see the pristine jsdom navigator.
      delete (navigator as unknown as Record<string, unknown>).clipboard;
    }
  });
});
