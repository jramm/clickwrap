import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { eventsFixture } from '../test/handlers';
import { setMatchMediaMatches } from '../test/matchMedia';
import { server } from '../test/server';
import { renderWithProviders } from '../test/renderWithProviders';
import { EventsPage } from './EventsPage';

const BASE = 'http://localhost:3000';

describe('EventsPage', () => {
  it('renders event rows with a category chip and the type label', async () => {
    renderWithProviders(<EventsPage />);
    expect(await screen.findByText('Version April 2026 edition accepted (ACTIVE_CONSENT, PORTAL)')).toBeInTheDocument();
    // The CONSENT category chip is rendered (two CONSENT rows in the fixture).
    expect((await screen.findAllByTestId('category-chip-CONSENT')).length).toBeGreaterThan(0);
    expect(screen.getByText(/4 total/)).toBeInTheDocument();
  });

  it('sends the category filter as a request param and resets to page 1', async () => {
    const requests: URL[] = [];
    server.use(
      http.get(`${BASE}/admin/events`, ({ request }) => {
        requests.push(new URL(request.url));
        return HttpResponse.json(eventsFixture);
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<EventsPage />);
    await screen.findByText(/Version April 2026 edition accepted/);

    await user.click(screen.getByLabelText('Category'));
    await user.click(await screen.findByRole('option', { name: 'Access' }));

    await waitFor(() => expect(requests.some((u) => u.searchParams.get('category') === 'ACCESS')).toBe(true));
    // Page is reset to 1 on filter change.
    expect(requests.at(-1)?.searchParams.get('page')).toBe('1');
  });

  it('widens the date filter to a full ISO date-time (not a raw YYYY-MM-DD)', async () => {
    const requests: URL[] = [];
    server.use(
      http.get(`${BASE}/admin/events`, ({ request }) => {
        requests.push(new URL(request.url));
        return HttpResponse.json(eventsFixture);
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<EventsPage />);
    await screen.findByText(/Version April 2026 edition accepted/);

    await user.type(screen.getByLabelText('From'), '2026-07-01');

    await waitFor(() => expect(requests.some((u) => u.searchParams.get('from')?.includes('T'))).toBe(true));
    const from = requests.map((u) => u.searchParams.get('from')).find((value) => value);
    expect(from).toBe('2026-07-01T00:00:00.000Z');
    // Never the raw date-only value the generated client would reject / the backend would misread.
    expect(from).not.toBe('2026-07-01');
  });

  it('prefills the customer filter from the ?customerId= query param', async () => {
    const requests: URL[] = [];
    server.use(
      http.get(`${BASE}/admin/events`, ({ request }) => {
        requests.push(new URL(request.url));
        return HttpResponse.json(eventsFixture);
      }),
    );

    renderWithProviders(<EventsPage />, { route: '/events?customerId=c-123' });

    await waitFor(() => expect(requests.some((u) => u.searchParams.get('customerId') === 'c-123')).toBe(true));
  });

  it('renders a card list instead of the DataGrid on small viewports', async () => {
    setMatchMediaMatches(true);
    renderWithProviders(<EventsPage />);
    expect(await screen.findByTestId('events-card-list')).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });
});
