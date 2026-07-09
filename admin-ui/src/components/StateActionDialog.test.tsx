import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { HistoryState } from '../api/hooks';
import { renderWithProviders } from '../test/renderWithProviders';
import { server } from '../test/server';
import { StateActionDialog } from './StateActionDialog';

const BASE = 'http://localhost:3000';

const notifiedState: HistoryState = {
  id: 'cvs-1',
  versionId: 'v-1',
  documentType: 'dpa',
  versionLabel: 'V1',
  state: 'NOTIFIED',
  deadlineAt: '2026-07-10T00:00:00.000Z',
  remindersSent: 0,
};

const blockedState: HistoryState = {
  id: 'cvs-2',
  versionId: 'v-2',
  documentType: 'dpa',
  versionLabel: 'V1',
  state: 'EXPIRED_BLOCKING',
  deadlineAt: '2026-07-01T00:00:00.000Z',
  remindersSent: 1,
};

/** Capture every PATCH body; echo back a schema-valid CustomerVersionStateModel. */
function capturePatchBodies(): Array<Record<string, unknown>> {
  const bodies: Array<Record<string, unknown>> = [];
  server.use(
    http.patch(`${BASE}/admin/customer-version-states/:id`, async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return HttpResponse.json({
        id: params.id,
        customerId: 'c-1',
        versionId: 'v-1',
        state: 'NOTIFIED',
        remindersSent: 0,
        deadlineAt: body.deadlineAt as string,
      });
    }),
  );
  return bodies;
}

describe('StateActionDialog', () => {
  it('sends the deadline as a full ISO date-time, not the raw date-only input (regression: "Action failed")', async () => {
    const bodies = capturePatchBodies();
    const user = userEvent.setup();
    renderWithProviders(
      <StateActionDialog customerId="c-1" state={notifiedState} mode="extend" open onClose={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText(/New deadline/), { target: { value: '2026-07-20' } });
    await user.type(screen.getByLabelText(/Reason/), 'Customer asked for an extension');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // Success toast proves the generated client's request-body validation accepted the payload.
    expect(await screen.findByText('Deadline extended.')).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    const sent = bodies[0].deadlineAt as string;
    expect(sent).not.toBe('2026-07-20');
    expect(sent).toBe('2026-07-20T00:00:00.000Z');
    expect(sent).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('unblock mode shows the deadline field and sends suspendBlock with an ISO deadline', async () => {
    const bodies = capturePatchBodies();
    const user = userEvent.setup();
    renderWithProviders(
      <StateActionDialog customerId="c-1" state={blockedState} mode="unblock" open onClose={() => {}} />,
    );

    // Regression: the deadline field used to be hidden in unblock mode, so the block could never
    // be suspended (the server requires a fresh deadline).
    const deadlineField = screen.getByLabelText(/New deadline/);
    fireEvent.change(deadlineField, { target: { value: '2026-08-01' } });
    await user.type(screen.getByLabelText(/Reason/), 'Grace granted after a call');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Block suspended.')).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].suspendBlock).toBe(true);
    expect(bodies[0].deadlineAt).toBe('2026-08-01T00:00:00.000Z');
  });
});
