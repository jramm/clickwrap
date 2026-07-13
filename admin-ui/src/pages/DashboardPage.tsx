import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import { ApiError, errorMessageKey } from '../api/errors';
import { useDashboard } from '../api/hooks';
import type { VersionStats } from '../api/hooks';
import { useTranslation } from '../i18n';
import { Card, PageHeader } from '../ui';

/**
 * Per-version acceptance dashboard — the landing page after login. One card per relevant version
 * (current + upcoming published versions of every document) with a progress bar, the acceptance
 * counters as chips and a channel breakdown. Tapping a card opens the per-version customer list
 * (`/versions/:id/customers`), which reports each customer's status FOR THAT version — so an upcoming version
 * shows who has (not) accepted it, rather than only the currently effective version.
 * Cards stack on narrow viewports.
 */
export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useDashboard();

  const items = data?.items ?? [];

  return (
    <Box>
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />

      {isError ? (
        <Card>
          <Typography color="error">
            {error instanceof ApiError ? t(errorMessageKey(error)) : t('dashboard.loadError')}
          </Typography>
        </Card>
      ) : isLoading ? (
        <Typography color="text.secondary" sx={{ p: 1 }}>
          {t('dashboard.loading')}
        </Typography>
      ) : items.length === 0 ? (
        <Card>
          <Typography color="text.secondary">{t('dashboard.empty')}</Typography>
        </Card>
      ) : (
        <Box
          data-testid="dashboard-grid"
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(320px, 1fr))' },
          }}
        >
          {items.map((item) => (
            <VersionStatsCard
              key={item.versionId}
              item={item}
              onOpen={() => navigate(`/versions/${encodeURIComponent(item.versionId)}/customers`)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

interface VersionStatsCardProps {
  item: VersionStats;
  onOpen: () => void;
}

function VersionStatsCard({ item, onOpen }: VersionStatsCardProps) {
  const { t } = useTranslation();
  const { stats } = item;
  const percent = Math.round(stats.acceptanceRate * 100);

  return (
    <Box
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onOpen();
      }}
      sx={{ cursor: 'pointer', minHeight: 44, height: '100%' }}
    >
      <Card>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <Typography variant="h5" component="h2">
            {item.documentName}
          </Typography>
          {item.upcoming && (
            <Chip size="small" color="info" variant="outlined" label={t('dashboard.upcoming')} />
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {item.versionLabel}
        </Typography>

        <Box sx={{ mt: 2 }}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t('dashboard.progressLabel', { accepted: stats.accepted, total: stats.totalCustomers })}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {t('dashboard.percent', { percent })}
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={percent}
            color="success"
            aria-label={t('dashboard.progressLabel', { accepted: stats.accepted, total: stats.totalCustomers })}
            sx={{ height: 8, borderRadius: 4 }}
          />
        </Box>

        <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 2, gap: 0.5 }}>
          <Chip size="small" color="success" label={t('dashboard.acceptedCount', { count: stats.accepted })} />
          <Chip size="small" color="warning" label={t('dashboard.pendingCount', { count: stats.pending })} />
          <Chip size="small" color="error" label={t('dashboard.blockedCount', { count: stats.blocked })} />
          <Chip size="small" color="info" label={t('dashboard.objectedCount', { count: stats.objected })} />
        </Stack>

        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>
          {t('dashboard.channels')}: PORTAL {stats.acceptedByChannel.PORTAL} · LINK{' '}
          {stats.acceptedByChannel.LINK} · ADMIN {stats.acceptedByChannel.ADMIN} · SYSTEM{' '}
          {stats.acceptedByChannel.SYSTEM}
        </Typography>
      </Card>
    </Box>
  );
}
