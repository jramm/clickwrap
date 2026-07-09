import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { ApiError, errorMessageKey } from '../api/errors';
import { useVersionCustomers } from '../api/hooks';
import type { VersionCustomerRow, VersionStats } from '../api/hooks';
import { useTranslation } from '../i18n';
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  SearchField,
  StatusChip,
  useDebouncedValue,
  useIsMobile,
} from '../ui';
import type { GridColDef } from '../ui';

/**
 * Per-version customer status page (`/versions/:id`). Reached from the dashboard cards. Every row
 * shows the customer's state and acceptance FOR THIS version (rather than only the currently
 * effective one), so drilling into an upcoming version
 * correctly shows who has (not) accepted THAT version. Desktop DataGrid / mobile card list; state
 * filter tabs + search; a row/card tap opens the customer detail page.
 */
const STATE_FILTERS = ['', 'accepted', 'pending', 'blocked', 'objected'] as const;
type StateFilter = (typeof STATE_FILTERS)[number];

function fmtDate(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale);
}

export function VersionCustomersPage() {
  const { t, language } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<StateFilter>('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isLoading, isError, error } = useVersionCustomers(id, {
    state: filter || undefined,
    search: debouncedSearch || undefined,
  });

  const rows: VersionCustomerRow[] = data?.items ?? [];
  const stats = data?.stats;
  const locale = language === 'de' ? 'de-DE' : 'en-GB';

  const columns: GridColDef[] = useMemo(
    () => [
      { field: 'customerName', headerName: t('versionCustomers.customer'), flex: 1.4, minWidth: 200 },
      { field: 'externalRef', headerName: t('versionCustomers.externalRef'), flex: 0.8, minWidth: 140 },
      {
        field: 'state',
        headerName: t('versionCustomers.status'),
        flex: 0.8,
        minWidth: 140,
        sortable: false,
        renderCell: (params) => (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <StatusChip state={(params.row as VersionCustomerRow).state} />
          </Box>
        ),
      },
      {
        field: 'detail',
        headerName: t('versionCustomers.detail'),
        flex: 1.6,
        minWidth: 240,
        sortable: false,
        renderCell: (params) => <RowDetail row={params.row as VersionCustomerRow} locale={locale} />,
      },
    ],
    [t, locale],
  );

  return (
    <Box>
      <Button
        component={RouterLink}
        to="/"
        variant="text"
        color="inherit"
        startIcon={<ArrowBackIcon />}
        sx={{ mb: 1 }}
      >
        {t('versionCustomers.backToDashboard')}
      </Button>

      <PageHeader
        title={stats?.documentName ?? t('versionCustomers.title')}
        subtitle={stats?.versionLabel}
      />

      {isError ? (
        <Card>
          <Typography color="error">
            {error instanceof ApiError ? t(errorMessageKey(error)) : t('versionCustomers.loadError')}
          </Typography>
        </Card>
      ) : (
        <Stack spacing={3}>
          {stats && <VersionHeaderCard stats={stats} locale={locale} />}

          <Card disableContentPadding>
            <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, pt: 1 }}>
              <Tabs
                value={filter}
                onChange={(_event, value: StateFilter) => setFilter(value)}
                variant="scrollable"
                scrollButtons="auto"
                aria-label={t('versionCustomers.statusFilter')}
              >
                {STATE_FILTERS.map((key) => (
                  <Tab key={key || 'all'} value={key} label={t(`versionCustomers.filters.${key || 'all'}`)} />
                ))}
              </Tabs>
            </Box>
            <Box sx={{ p: 2 }}>
              <SearchField
                label={t('versionCustomers.searchLabel')}
                placeholder={t('versionCustomers.searchPlaceholder')}
                clearLabel={t('versionCustomers.searchClear')}
                value={search}
                onChange={setSearch}
              />
            </Box>

            {isMobile ? (
              <VersionCustomerCardList
                rows={rows}
                locale={locale}
                loading={isLoading}
                onOpen={(customerId) => navigate(`/customers/${customerId}`)}
              />
            ) : (
              <DataTable
                rows={rows}
                columns={columns}
                loading={isLoading}
                onRowClick={(params) => navigate(`/customers/${params.id}`)}
                getRowId={(row: VersionCustomerRow) => row.customerId}
              />
            )}
          </Card>
        </Stack>
      )}
    </Box>
  );
}

function badgeFor(stats: VersionStats): { key: 'upcoming' | 'retired' | 'current'; color: 'info' | 'default' | 'success' } {
  if (stats.upcoming) return { key: 'upcoming', color: 'info' };
  if (stats.status === 'RETIRED') return { key: 'retired', color: 'default' };
  return { key: 'current', color: 'success' };
}

function VersionHeaderCard({ stats, locale }: { stats: VersionStats; locale: string }) {
  const { t } = useTranslation();
  const percent = Math.round(stats.stats.acceptanceRate * 100);
  const badge = badgeFor(stats);

  return (
    <Card>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
        <Chip size="small" color={badge.color} variant="outlined" label={t(`versionCustomers.badge.${badge.key}`)} />
        <Typography variant="body2" color="text.secondary">
          {t('versionCustomers.validFrom', { date: fmtDate(stats.validFrom as unknown as string, locale) })}
        </Typography>
      </Stack>

      <Box sx={{ mt: 2 }}>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            {t('versionCustomers.progressLabel', {
              accepted: stats.stats.accepted,
              total: stats.stats.totalCustomers,
            })}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {t('versionCustomers.percent', { percent })}
          </Typography>
        </Stack>
        <LinearProgress
          variant="determinate"
          value={percent}
          color="success"
          sx={{ height: 8, borderRadius: 4 }}
        />
      </Box>

      <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 2, gap: 0.5 }}>
        <Chip size="small" color="success" label={t('versionCustomers.acceptedCount', { count: stats.stats.accepted })} />
        <Chip size="small" color="warning" label={t('versionCustomers.pendingCount', { count: stats.stats.pending })} />
        <Chip size="small" color="error" label={t('versionCustomers.blockedCount', { count: stats.stats.blocked })} />
        <Chip size="small" color="info" label={t('versionCustomers.objectedCount', { count: stats.stats.objected })} />
      </Stack>
    </Card>
  );
}

function RowDetail({ row, locale }: { row: VersionCustomerRow; locale: string }) {
  const { t } = useTranslation();
  if (row.acceptance) {
    const { acceptance } = row;
    return (
      <Box sx={{ py: 0.5 }}>
        <Typography variant="body2">
          {t('versionCustomers.acceptedOn', { date: fmtDate(acceptance.acceptedAt, locale) })}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {acceptance.method} · {acceptance.channel}
          {acceptance.actorName ? ` · ${t('versionCustomers.by', { name: acceptance.actorName })}` : ''}
        </Typography>
      </Box>
    );
  }
  if (row.deadlineAt) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('versionCustomers.deadline', { date: fmtDate(row.deadlineAt, locale) })}
      </Typography>
    );
  }
  return (
    <Typography variant="body2" color="text.disabled">
      {t('common.none')}
    </Typography>
  );
}

interface CardListProps {
  rows: VersionCustomerRow[];
  locale: string;
  loading: boolean;
  onOpen: (customerId: string) => void;
}

function VersionCustomerCardList({ rows, locale, loading, onOpen }: CardListProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        {t('common.loading')}
      </Typography>
    );
  }
  if (rows.length === 0) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        {t('versionCustomers.empty')}
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5} sx={{ p: 2 }} data-testid="version-customers-card-list">
      {rows.map((row) => (
        <Box
          key={row.customerId}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(row.customerId)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onOpen(row.customerId);
          }}
          sx={{ cursor: 'pointer', minHeight: 44 }}
        >
          <Card>
            <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
              <Box>
                <Typography variant="h5" component="h2">
                  {row.customerName || row.customerId}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {row.externalRef}
                </Typography>
              </Box>
              <StatusChip state={row.state} />
            </Stack>
            <Box sx={{ mt: 1 }}>
              <RowDetail row={row} locale={locale} />
            </Box>
          </Card>
        </Box>
      ))}
    </Stack>
  );
}
