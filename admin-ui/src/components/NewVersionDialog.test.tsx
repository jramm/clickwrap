import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgreementDocument, CreateVersionInput } from '../api/hooks';
import { renderWithProviders } from '../test/renderWithProviders';
import { NewVersionDialog } from './NewVersionDialog';

/**
 * The create-version request is a browser-built multipart FormData, which jsdom/msw cannot
 * round-trip. We therefore assert the component's contract at the hook boundary: what
 * {@link CreateVersionInput} the form hands to the mutation — in particular that ACTIVE sends
 * `hardDeadlineAt` as a full ISO date-time (never a raw YYYY-MM-DD) and PASSIVE sends
 * `objectionPeriodDays` with no `hardDeadlineAt`.
 */
const mutate = vi.fn();

vi.mock('../api/hooks', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../api/hooks')>();
  return { ...mod, useCreateVersion: () => ({ mutate, isPending: false }) };
});

const doc = {
  id: 'doc-dpa-customer',
  type: 'dpa',
  audience: 'customer',
  name: 'DPA — Customers',
  currentVersion: null,
  upcomingVersions: [],
  latestPdfUrl: null,
} as unknown as AgreementDocument;

const selectPdf = async (user: ReturnType<typeof userEvent.setup>) => {
  const file = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' });
  await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, file);
};

const lastInput = (): CreateVersionInput => mutate.mock.calls.at(-1)?.[0] as CreateVersionInput;

describe('NewVersionDialog', () => {
  beforeEach(() => mutate.mockClear());

  it('ACTIVE: sends hardDeadlineAt as a full ISO date-time (not the raw date input) and no gracePeriodDays', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewVersionDialog document={doc} open onClose={() => {}} />);

    await selectPdf(user);
    await user.type(screen.getByLabelText(/Version label/), 'June 2026 edition');
    await user.type(screen.getByLabelText(/Change summary/), 'New sub-processor.');
    await user.type(screen.getByLabelText(/Consent text/), 'I agree.');
    fireEvent.change(screen.getByLabelText(/Acceptance deadline/), { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByLabelText(/Valid from/), { target: { value: '2026-07-01' } });
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const input = lastInput();
    expect(input.acceptanceMode).toBe('ACTIVE');
    expect(input.hardDeadlineAt).toBe('2026-08-01T00:00:00.000Z');
    expect(input.hardDeadlineAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(input.consentText).toBe('I agree.');
    expect(input.objectionPeriodDays).toBeUndefined();
    expect((input as unknown as { gracePeriodDays?: number }).gracePeriodDays).toBeUndefined();
  });

  it('ACTIVE: blocks submit when the acceptance deadline is missing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewVersionDialog document={doc} open onClose={() => {}} />);

    await selectPdf(user);
    await user.type(screen.getByLabelText(/Version label/), 'June 2026 edition');
    await user.type(screen.getByLabelText(/Change summary/), 'New sub-processor.');
    await user.type(screen.getByLabelText(/Consent text/), 'I agree.');
    fireEvent.change(screen.getByLabelText(/Valid from/), { target: { value: '2026-07-01' } });
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText('Acceptance deadline is required for ACTIVE mode.')).toBeInTheDocument();
  });

  it('PASSIVE: sends objectionPeriodDays and no hardDeadlineAt', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NewVersionDialog document={doc} open onClose={() => {}} />);

    await user.click(screen.getByLabelText(/Acceptance mode/));
    const listbox = await screen.findByRole('listbox');
    await user.click(within(listbox).getByText(/PASSIVE/));

    await selectPdf(user);
    await user.type(screen.getByLabelText(/Version label/), 'June 2026 edition');
    await user.type(screen.getByLabelText(/Change summary/), 'New sub-processor.');
    fireEvent.change(screen.getByLabelText(/Objection period days/), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/Valid from/), { target: { value: '2026-07-01' } });
    await user.click(screen.getByRole('button', { name: 'Create draft' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const input = lastInput();
    expect(input.acceptanceMode).toBe('PASSIVE');
    expect(input.objectionPeriodDays).toBe(30);
    expect(input.hardDeadlineAt).toBeUndefined();
  });
});
