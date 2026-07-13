import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessageKey } from '../api/errors';
import { useCustomers, useDocumentTypes, useEvents } from '../api/hooks';
import type { Event, EventActorKind, EventCategory } from '../api/hooks';
import { customerDisplayName } from '../lib/customerDisplayName';
import { documentLabel } from '../lib/eventDocumentLabel';
import { useTranslation } from '../i18n';
import { Button, Card, DataTable, PageHeader, Select, TextField, useIsMobile } from '../ui';
import type { GridColDef, SelectOption } from '../ui';

/**
 * Legal event / audit log: one normalized, chronological (newest-first), paginated, filterable list
 * aggregating every append-only source (e-mails sent, page access, acceptances/objections, admin &
 * system actions). Actor-kind and channel are DISPLAYED, not filters. On desktop a DataGrid, on
 * phones a card list. `?customerId=` prefills the customer filter (deep-linked from the customer
 * detail page).
 */
const PAGE_SIZE = 50;

const CATEGORIES: EventCategory[] = ['COMMUNICATION', 'ACCESS', 'CONSENT', 'ADMINISTRATION'];

const CATEGORY_CHIP_COLOR: Record<EventCategory, 'info' | 'secondary' | 'success' | 'warning'> = {
  COMMUNICATION: 'info',
  ACCESS: 'secondary',
  CONSENT: 'success',
  ADMINISTRATION: 'warning',
};

/** A date-only `<input type="date">` value → full ISO date-time (the API/generated client want that). */
const isoStartOfDay = (dateOnly: string): string | undefined =>
  dateOnly ? new Date(`${dateOnly}T00:00:00.000Z`).toISOString() : undefined;
/** `to` widens to the END of the chosen day so a single-day range still matches that day's events. */
const isoEndOfDay = (dateOnly: string): string | undefined =>
  dateOnly ? new Date(`${dateOnly}T23:59:59.999Z`).toISOString() : undefined;

export function EventsPage() {
  const { t, language } = useTranslation();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [customerId, setCustomerId] = useState(searchParams.get('customerId') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('');
  const [documentType, setDocumentType] = useState('');

  // Any filter change resets to the first page (the old page may not exist in the new result).
  useEffect(() => {
    setPage(1);
  }, [customerId, from, to, category, documentType]);

  const { data, isLoading, isError, error } = useEvents(page, {
    customerId: customerId || undefined,
    from: isoStartOfDay(from),
    to: isoEndOfDay(to),
    category: (category || undefined) as EventCategory | undefined,
    documentType: documentType || undefined,
  });

  // First page of customers powers a simple customer select (see the module note — acceptable MVP).
  const { data: customerData } = useCustomers(1);
  const { data: documentTypes = [] } = useDocumentTypes();

  const allOption: SelectOption = { value: '', label: t('events.filterAll') };
  const customerOptions: SelectOption[] = [
    allOption,
    ...(customerData?.items ?? []).map((c) => ({ value: c.id, label: customerDisplayName(c) || c.externalRef })),
  ];
  const categoryOptions: SelectOption[] = [
    allOption,
    ...CATEGORIES.map((value) => ({ value, label: t(`events.category.${value}`) })),
  ];
  const documentTypeOptions: SelectOption[] = [
    allOption,
    ...documentTypes.map((d) => ({ value: d.key, label: d.name })),
  ];
  const documentTypeName = useMemo(() => {
    const map = new Map(documentTypes.map((d) => [d.key, d.name]));
    return (key: string) => map.get(key) ?? key;
  }, [documentTypes]);

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'occurredAt',
        headerName: t('events.time'),
        flex: 1,
        minWidth: 170,
        valueGetter: (_value, row: Event) => new Date(row.occurredAt).toLocaleString(language),
      },
      {
        field: 'category',
        headerName: t('events.categoryHeader'),
        flex: 0.7,
        minWidth: 140,
        sortable: false,
        renderCell: (params) => <CategoryChip category={(params.row as Event).category} />,
      },
      {
        field: 'type',
        headerName: t('events.type'),
        flex: 0.9,
        minWidth: 160,
        valueGetter: (_value, row: Event) => t(`events.eventType.${row.type}`),
      },
      {
        field: 'actor',
        headerName: t('events.actor'),
        flex: 1,
        minWidth: 170,
        sortable: false,
        renderCell: (params) => <ActorCell kind={(params.row as Event).actorKind} label={(params.row as Event).actorLabel} />,
      },
      {
        field: 'customer',
        headerName: t('events.customer'),
        flex: 1,
        minWidth: 160,
        sortable: false,
        renderCell: (params) => {
          const row = params.row as Event;
          if (!row.customerId) return <Typography variant="body2" color="text.secondary">—</Typography>;
          return (
            <Link
              component={RouterLink}
              to={`/customers/${row.customerId}`}
              onClick={(event) => event.stopPropagation()}
            >
              {row.customerName || row.customerId}
            </Link>
          );
        },
      },
      {
        field: 'document',
        headerName: t('events.document'),
        flex: 1,
        minWidth: 160,
        sortable: false,
        valueGetter: (_value, row: Event) => documentLabel(row, documentTypeName),
      },
      {
        field: 'details',
        headerName: t('events.details'),
        flex: 1.6,
        minWidth: 240,
        sortable: false,
        valueGetter: (_value, row: Event) => row.summary,
      },
    ],
    [language, t, documentTypeName],
  );

  return (
    <Box>
      <PageHeader title={t('events.title')} subtitle={t('events.subtitle')} />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <Box sx={{ minWidth: { md: 200 } }}>
          <Select
            label={t('events.filterCustomer')}
            options={customerOptions}
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          />
        </Box>
        <Box sx={{ minWidth: { md: 160 } }}>
          <TextField
            label={t('events.filterFrom')}
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Box>
        <Box sx={{ minWidth: { md: 160 } }}>
          <TextField
            label={t('events.filterTo')}
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Box>
        <Box sx={{ minWidth: { md: 180 } }}>
          <Select
            label={t('events.filterCategory')}
            options={categoryOptions}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        </Box>
        <Box sx={{ minWidth: { md: 180 } }}>
          <Select
            label={t('events.filterDocumentType')}
            options={documentTypeOptions}
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
          />
        </Box>
      </Stack>

      <Box>
        {isError ? (
          <Card>
            <Typography color="error">
              {error instanceof ApiError ? t(errorMessageKey(error)) : t('events.loadError')}
            </Typography>
          </Card>
        ) : !isLoading && rows.length === 0 ? (
          <Card>
            <Typography color="text.secondary">{t('events.empty')}</Typography>
          </Card>
        ) : isMobile ? (
          <EventCardList rows={rows} loading={isLoading} onOpenCustomer={(id) => navigate(`/customers/${id}`)} />
        ) : (
          <Card disableContentPadding>
            <DataTable rows={rows} columns={columns} loading={isLoading} getRowId={(row: Event) => row.id} hideFooter />
          </Card>
        )}
      </Box>

      <Stack direction="row" spacing={2} alignItems="center" justifyContent="flex-end" sx={{ mt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('events.pageOf', { page, pages: pageCount, total })}
        </Typography>
        <Button size="small" variant="outlined" disabled={page <= 1} onClick={() => setPage((c) => Math.max(1, c - 1))}>
          {t('events.prev')}
        </Button>
        <Button size="small" variant="outlined" disabled={page >= pageCount} onClick={() => setPage((c) => c + 1)}>
          {t('events.next')}
        </Button>
      </Stack>
    </Box>
  );
}

function CategoryChip({ category }: { category: EventCategory }) {
  const { t } = useTranslation();
  return (
    <Chip
      label={t(`events.category.${category}`)}
      color={CATEGORY_CHIP_COLOR[category]}
      size="small"
      variant="filled"
      data-testid={`category-chip-${category}`}
    />
  );
}

function ActorCell({ kind, label }: { kind: EventActorKind; label: string }) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
      <Chip label={t(`events.actorKind.${kind}`)} size="small" variant="outlined" />
      <Typography variant="body2" noWrap>
        {label}
      </Typography>
    </Stack>
  );
}

interface EventCardListProps {
  rows: Event[];
  loading: boolean;
  onOpenCustomer: (customerId: string) => void;
}

function EventCardList({ rows, loading, onOpenCustomer }: EventCardListProps) {
  const { t, language } = useTranslation();

  if (loading) {
    return (
      <Typography color="text.secondary" sx={{ p: 2 }}>
        {t('common.loading')}
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5} data-testid="events-card-list">
      {rows.map((event) => (
        <Card key={event.id}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Typography variant="body2" color="text.secondary">
              {new Date(event.occurredAt).toLocaleString(language)}
            </Typography>
            <CategoryChip category={event.category} />
          </Stack>
          <Typography variant="h5" component="h2" sx={{ mt: 0.5 }}>
            {t(`events.eventType.${event.type}`)}
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {event.summary}
          </Typography>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 1 }}>
            <Chip label={t(`events.actorKind.${event.actorKind}`)} size="small" variant="outlined" />
            <Typography variant="body2" noWrap>
              {event.actorLabel}
            </Typography>
          </Stack>
          {event.customerId && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              <Link
                component="button"
                type="button"
                onClick={() => onOpenCustomer(event.customerId as string)}
              >
                {event.customerName || event.customerId}
              </Link>
            </Typography>
          )}
        </Card>
      ))}
    </Stack>
  );
}
