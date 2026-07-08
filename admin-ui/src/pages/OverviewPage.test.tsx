import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acceptanceLinkFixture, overviewFixture } from '../test/handlers';
import { server } from '../test/server';
import { setMatchMediaMatches } from '../test/matchMedia';
import { renderWithProviders } from '../test/renderWithProviders';
import { OverviewPage } from './OverviewPage';

const BASE = 'http://localhost:3000';

/**
 * jsdom has no navigator.clipboard — install a mock and return its spy.
 * IMPORTANT: call AFTER userEvent.setup(), which installs its own clipboard stub.
 */
function mockClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  return writeText;
}

describe('OverviewPage', () => {
  it('renders the acceptance matrix with mock data and status chips', async () => {
    renderWithProviders(<OverviewPage />);

    expect(await screen.findByText('Example Utility Ltd')).toBeInTheDocument();
    expect(screen.getByText('Sample Energy Inc')).toBeInTheDocument();

    // Subtitle from data.total
    expect(screen.getByText(/2 customers in the acceptance matrix/i)).toBeInTheDocument();

    // Colored status chips (English labels from StatusChip)
    expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0);
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Objected')).toBeInTheDocument();
    // PENDING_NOTIFICATION maps to the "Pending" label (review-findings cleanup).
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('derives matrix columns dynamically from the audiences × document types that exist as documents', async () => {
    renderWithProviders(<OverviewPage />);

    // All four combos exist as documents -> four dynamic columns.
    expect(await screen.findByText('Terms of Service · Operator')).toBeInTheDocument();
    expect(screen.getByText('Data Processing Agreement · Operator')).toBeInTheDocument();
    expect(screen.getByText('Terms of Service · Partner')).toBeInTheDocument();
    expect(screen.getByText('Data Processing Agreement · Partner')).toBeInTheDocument();
  });

  it('omits columns for combinations that do not exist as documents', async () => {
    // Only one document -> only that single combo becomes a column.
    server.use(
      http.get(`${BASE}/admin/documents`, () =>
        HttpResponse.json({
          items: [
            { id: 'doc-terms-op', type: 'terms', audience: 'operator', name: 'ToS — Operator' },
          ],
        }),
      ),
    );

    renderWithProviders(<OverviewPage />);

    expect(await screen.findByText('Terms of Service · Operator')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Data Processing Agreement · Partner')).not.toBeInTheDocument(),
    );
  });

  describe('copy acceptance link', () => {
    afterEach(() => {
      // Remove the clipboard mock so other tests see the pristine jsdom navigator.
      delete (navigator as unknown as Record<string, unknown>).clipboard;
    });

    it('desktop row action: calls the create endpoint and copies the URL to the clipboard', async () => {
      const created: string[] = [];
      server.use(
        http.post(`${BASE}/admin/customers/:id/acceptance-links`, ({ params }) => {
          created.push(String(params.id));
          return HttpResponse.json(acceptanceLinkFixture, { status: 201 });
        }),
      );
      const user = userEvent.setup();
      const writeText = mockClipboard();
      renderWithProviders(<OverviewPage />);

      await screen.findByText('Example Utility Ltd');
      await user.click(screen.getAllByRole('button', { name: 'Copy acceptance link' })[0]);

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(acceptanceLinkFixture.url));
      expect(created).toEqual(['c-123']);
      // Success toast including the expiry date of the link.
      expect(await screen.findByText(/Acceptance link copied/)).toBeInTheDocument();
      expect(screen.getByText(/07\/08\/2026/)).toBeInTheDocument();
    });

    it('mobile card button: same endpoint + clipboard flow', async () => {
      setMatchMediaMatches(true);
      const user = userEvent.setup();
      const writeText = mockClipboard();
      renderWithProviders(<OverviewPage />);

      await screen.findByTestId('overview-card-list');
      await user.click(screen.getAllByRole('button', { name: 'Copy acceptance link' })[0]);

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(acceptanceLinkFixture.url));
    });

    it('falls back to window.prompt when the Clipboard API is unavailable', async () => {
      const prompt = vi.spyOn(window, 'prompt').mockReturnValue(null);
      const user = userEvent.setup();
      // No writeText available (userEvent's stub is replaced by an empty object).
      Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true });
      renderWithProviders(<OverviewPage />);

      await screen.findByText('Example Utility Ltd');
      await user.click(screen.getAllByRole('button', { name: 'Copy acceptance link' })[0]);

      await waitFor(() =>
        expect(prompt).toHaveBeenCalledWith('Copy the acceptance link:', acceptanceLinkFixture.url),
      );
      prompt.mockRestore();
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
      renderWithProviders(<OverviewPage />);

      await screen.findByText('Example Utility Ltd');
      await user.click(screen.getAllByRole('button', { name: 'Copy acceptance link' })[0]);

      expect(await screen.findByText(/PUBLIC_BASE_URL is not configured/)).toBeInTheDocument();
    });
  });

  it('renders a card list instead of the DataGrid on small viewports', async () => {
    setMatchMediaMatches(true); // simulate a phone-width viewport

    renderWithProviders(<OverviewPage />);

    expect(await screen.findByTestId('overview-card-list')).toBeInTheDocument();
    expect(screen.getByText('Example Utility Ltd')).toBeInTheDocument();
    // The desktop DataGrid must not be mounted.
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('debounces the search term into the overview request', async () => {
    const searches: (string | null)[] = [];
    server.use(
      http.get(`${BASE}/admin/overview`, ({ request }) => {
        searches.push(new URL(request.url).searchParams.get('search'));
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<OverviewPage />);
    await user.type(screen.getByLabelText('Search customers'), 'globex');

    await waitFor(() => expect(searches).toContain('globex'));
  });

  it('preselects the documentType/audience filters from the URL query params', async () => {
    const requests: { documentType: string | null; audience: string | null }[] = [];
    server.use(
      http.get(`${BASE}/admin/overview`, ({ request }) => {
        const url = new URL(request.url);
        requests.push({ documentType: url.searchParams.get('documentType'), audience: url.searchParams.get('audience') });
        return HttpResponse.json(overviewFixture);
      }),
    );

    renderWithProviders(<OverviewPage />, { route: '/overview?documentType=dpa&audience=operator' });

    await waitFor(() =>
      expect(requests).toContainEqual({ documentType: 'dpa', audience: 'operator' }),
    );
  });
});
