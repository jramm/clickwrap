import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/renderWithProviders';
import { SettingsPage } from './SettingsPage';

/**
 * Audiences and document types are READ-ONLY in the admin UI — declared in the legal-entities
 * config file and reconciled at boot. The page only lists them and shows the managed-via-config
 * note; there are no create/edit/delete controls.
 */
describe('SettingsPage — read-only', () => {
  it('lists existing audiences and document types', async () => {
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText('Operator')).toBeInTheDocument();
    expect(screen.getByText('Partner')).toBeInTheDocument();
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    expect(screen.getByText('Data Processing Agreement')).toBeInTheDocument();
    expect(screen.getByText('Signed offer')).toBeInTheDocument();
  });

  it('shows the "managed via configuration file" note', async () => {
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText(/Managed via configuration file/i)).toBeInTheDocument();
  });

  it('renders no create / edit / delete controls', async () => {
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Operator');

    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByLabelText('Delete')).toBeNull();
    // No key/name entry fields and no external-type checkbox.
    expect(screen.queryByLabelText('Key')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'External signed document type' })).toBeNull();
  });

  it('shows the external badge on an external document type', async () => {
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Signed offer');

    const row = screen.getByText('Signed offer').closest('tr');
    if (!row) throw new Error('row not found');
    expect(within(row).getByText('Signed documents')).toBeInTheDocument();
  });

  it("shows a document type's e-mail template assignment read-only", async () => {
    renderWithProviders(<SettingsPage />);
    await screen.findByText('Data Processing Agreement');

    // dpa has notificationTemplateId=tpl-default-notification → its name is rendered as text.
    expect(await screen.findByText(/Default — version notification/)).toBeInTheDocument();
  });
});
