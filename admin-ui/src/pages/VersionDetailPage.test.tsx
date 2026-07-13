import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/renderWithProviders';
import { VersionDetailPage } from './VersionDetailPage';

function renderAt(versionId: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/versions/:id" element={<VersionDetailPage />} />
    </Routes>,
    { route: `/versions/${versionId}` },
  );
}

describe('VersionDetailPage', () => {
  it('shows the information entered when the version was created', async () => {
    renderAt('v-100');

    // Header = the version label; the creation details are rendered below.
    expect(await screen.findByText('April 2026 edition')).toBeInTheDocument();
    expect(screen.getByText('Initial edition.')).toBeInTheDocument(); // change summary
    expect(screen.getByText('ACTIVE')).toBeInTheDocument(); // acceptance mode
    expect(screen.getByText('sha256:9c1e')).toBeInTheDocument(); // content hash
    expect(screen.getByText('v-100')).toBeInTheDocument(); // version id

    // The PDF is linked from the file field.
    expect(screen.getByRole('link', { name: 'dpa-2026-04.pdf' })).toHaveAttribute(
      'href',
      'https://example.test/v-100.pdf',
    );
  });

  it('links to the per-version customer rollout for a published version', async () => {
    renderAt('v-100');

    const rollout = await screen.findByRole('link', { name: /customer rollout/i });
    expect(rollout).toHaveAttribute('href', '/versions/v-100/customers');
  });

  it('shows a publish button for a DRAFT version (instead of the rollout link)', async () => {
    renderAt('v-draft');

    expect(await screen.findByRole('button', { name: /publish/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /customer rollout/i })).not.toBeInTheDocument();
  });
});
