import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessageKey } from '../api/errors';
import {
  useAudiences,
  useCreateAcceptanceLink,
  useDocumentTypes,
  useDocuments,
  useOverview,
} from '../api/hooks';
import type { Category, OverviewItem, OverviewParams } from '../api/hooks';
import { useTranslation } from '../i18n';
import { copyTextToClipboard } from '../lib/clipboard';
import {
  Button,
  Card,
  DataTable,
  PageHeader,
  SearchField,
  Select,
  StatusChip,
  useDebouncedValue,
  useIsMobile,
  useToast,
} from '../ui';
import type { GridColDef } from '../ui';

/**
 * Overview / acceptance matrix. Columns are derived dynamically from the
 * audiences × document types that actually exist as documents — no hardcoded
 * type/audience keys. On desktop this is a DataGrid; on phones/tablets it
 * collapses to a tappable card list (one card per customer). A row/card click
 * opens the customer detail page.
 */
const STATUS_FILTERS = [
  'non_compliant',
  'pending',
  'objected',
  'unreachable',
  'deadline_lt_7d',
] as const;

/** Cell key convention: `${TYPE}_${AUDIENCE}` from uppercased category keys. */
function cellKey(typeKey: string, audienceKey: string): string {
  return `${typeKey.toUpperCase()}_${audienceKey.toUpperCase()}`;
}

interface Combo {
  key: string;
  header: string;
}

export function OverviewPage() {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const toast = useToast();
  const createAcceptanceLink = useCreateAcceptanceLink();
  // Preselect the documentType / audience filters from the URL — the dashboard cards link here with
  // `?documentType=…&audience=…` so a tap lands on the pre-filtered matrix.
  const [searchParams] = useSearchParams();
  const [filter, setFilter] = useState('');
  const [documentType, setDocumentType] = useState(searchParams.get('documentType') ?? '');
  const [audience, setAudience] = useState(searchParams.get('audience') ?? '');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const params: OverviewParams = useMemo(
    () => ({
      filter: filter || undefined,
      documentType: documentType || undefined,
      audience: audience || undefined,
      search: debouncedSearch || undefined,
    }),
    [filter, documentType, audience, debouncedSearch],
  );

  const { data, isLoading, isError, error } = useOverview(params);

  // "Copy acceptance link": mints a hosted acceptance link for the whole customer (no audience
  // scope) and puts the URL on the clipboard — prompt fallback when the Clipboard API is
  // unavailable. The toast shows the expiry so the admin knows how long the link works.
  const handleCopyAcceptanceLink = useCallback(
    async (customerId: string) => {
      try {
        const link = await createAcceptanceLink.mutateAsync({ customerId });
        const copied = await copyTextToClipboard(link.url, t('overview.copyLinkPrompt'));
        const expires = new Date(link.expiresAt).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB');
        toast.success(t(copied ? 'overview.copyLinkSuccess' : 'overview.copyLinkManual', { expires }));
      } catch (err) {
        // The PUBLIC_BASE_URL hint from the backend is actionable — surface it verbatim.
        if (err instanceof ApiError && err.message.includes('PUBLIC_BASE_URL')) {
          toast.error(err.message);
        } else {
          toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('overview.copyLinkFailed'));
        }
      }
    },
    [createAcceptanceLink, language, t, toast],
  );
  const { data: audiences = [] } = useAudiences();
  const { data: documentTypes = [] } = useDocumentTypes();
  const { data: documents = [] } = useDocuments();

  const audienceName = useMemo(() => {
    const map = new Map(audiences.map((a) => [a.key, a.name]));
    return (key: string) => map.get(key) ?? key;
  }, [audiences]);

  // The set of (type, audience) combinations that exist as documents drives
  // which matrix columns are shown.
  const combos = useMemo<Combo[]>(() => {
    const existing = new Set(documents.map((doc) => cellKey(doc.type, doc.audience)));
    const result: Combo[] = [];
    for (const type of documentTypes) {
      for (const aud of audiences) {
        const key = cellKey(type.key, aud.key);
        if (existing.has(key)) result.push({ key, header: `${type.name} · ${aud.name}` });
      }
    }
    return result;
  }, [documents, documentTypes, audiences]);

  const columns: GridColDef[] = useMemo(
    () => [
      { field: 'customerName', headerName: t('overview.customer'), flex: 1.4, minWidth: 220 },
      {
        field: 'roles',
        headerName: t('overview.roles'),
        flex: 0.8,
        minWidth: 140,
        sortable: false,
        valueGetter: (_value, row: OverviewItem) =>
          (row.roles ?? []).map((key) => audienceName(key)).join(', '),
      },
      ...combos.map<GridColDef>((combo) => ({
        field: combo.key,
        headerName: combo.header,
        flex: 1,
        minWidth: 150,
        sortable: false,
        renderCell: (cellParams) => {
          const cell = (cellParams.row as OverviewItem).cells?.[combo.key];
          if (!cell?.state) {
            return (
              <Typography variant="body2" color="text.disabled">
                {t('common.none')}
              </Typography>
            );
          }
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
              <StatusChip state={cell.state} />
            </Box>
          );
        },
      })),
      {
        field: 'acceptanceLink',
        headerName: '',
        width: 64,
        sortable: false,
        renderCell: (cellParams) => (
          <IconButton
            aria-label={t('overview.copyLink')}
            title={t('overview.copyLink')}
            size="small"
            onClick={(event) => {
              event.stopPropagation(); // do not open the customer detail row
              void handleCopyAcceptanceLink((cellParams.row as OverviewItem).customerId);
            }}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        ),
      },
    ],
    [combos, audienceName, t, handleCopyAcceptanceLink],
  );

  const rows: OverviewItem[] = data?.items ?? [];

  const documentTypeOptions = [
    { value: '', label: t('overview.allTypes') },
    ...documentTypes.map((type: Category) => ({ value: type.key, label: type.name })),
  ];
  const audienceOptions = [
    { value: '', label: t('overview.allAudiences') },
    ...audiences.map((aud: Category) => ({ value: aud.key, label: aud.name })),
  ];
  const filterOptions = [
    { value: '', label: t('overview.filters.all') },
    ...STATUS_FILTERS.map((key) => ({ value: key, label: t(`overview.filters.${key}`) })),
  ];

  return (
    <Box>
      <PageHeader
        title={t('overview.title')}
        subtitle={
          data ? t('overview.subtitleCount', { count: data.total }) : t('overview.subtitleDefault')
        }
      />

      <Card title={t('overview.filter')}>
        <Stack spacing={2}>
          <SearchField
            label={t('overview.searchLabel')}
            placeholder={t('overview.searchPlaceholder')}
            clearLabel={t('overview.searchClear')}
            value={search}
            onChange={setSearch}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Select
              label={t('overview.statusFilter')}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              options={filterOptions}
            />
            <Select
              label={t('overview.documentType')}
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value)}
              options={documentTypeOptions}
            />
            <Select
              label={t('overview.audience')}
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
              options={audienceOptions}
            />
          </Stack>
        </Stack>
      </Card>

      <Box sx={{ mt: 3 }}>
        {isError ? (
          <Card>
            <Typography color="error">
              {error instanceof ApiError ? t(errorMessageKey(error)) : t('overview.loadError')}
            </Typography>
          </Card>
        ) : isMobile ? (
          <OverviewCardList
            rows={rows}
            combos={combos}
            audienceName={audienceName}
            loading={isLoading}
            onOpen={(customerId) => navigate(`/customers/${customerId}`)}
            onCopyLink={(customerId) => void handleCopyAcceptanceLink(customerId)}
          />
        ) : (
          <Card disableContentPadding>
            <DataTable
              rows={rows}
              columns={columns}
              loading={isLoading}
              onRowClick={(rowParams) => navigate(`/customers/${rowParams.id}`)}
              getRowId={(row: OverviewItem) => row.customerId}
            />
          </Card>
        )}
      </Box>
    </Box>
  );
}

interface OverviewCardListProps {
  rows: OverviewItem[];
  combos: Combo[];
  audienceName: (key: string) => string;
  loading: boolean;
  onOpen: (customerId: string) => void;
  onCopyLink: (customerId: string) => void;
}

function OverviewCardList({ rows, combos, audienceName, loading, onOpen, onCopyLink }: OverviewCardListProps) {
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
        {t('overview.empty')}
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5} data-testid="overview-card-list">
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
            <Typography variant="h5" component="h2">
              {row.customerName || t('overview.customer')}
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5, mb: 1, gap: 0.5 }}>
              {(row.roles ?? []).map((roleKey) => (
                <Chip key={roleKey} size="small" label={audienceName(roleKey)} variant="outlined" />
              ))}
            </Stack>
            <Stack spacing={1}>
              {combos.map((combo) => {
                const cell = row.cells?.[combo.key];
                return (
                  <Stack
                    key={combo.key}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <Typography variant="body2" color="text.secondary">
                      {combo.header}
                    </Typography>
                    {cell?.state ? (
                      <StatusChip state={cell.state} />
                    ) : (
                      <Typography variant="body2" color="text.disabled">
                        {t('common.none')}
                      </Typography>
                    )}
                  </Stack>
                );
              })}
            </Stack>
            <Button
              variant="outlined"
              size="small"
              fullWidth
              startIcon={<ContentCopyIcon fontSize="small" />}
              sx={{ mt: 1.5, minHeight: 44 }}
              onClick={(event) => {
                event.stopPropagation(); // the surrounding card opens the customer detail page
                onCopyLink(row.customerId);
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              {t('overview.copyLink')}
            </Button>
          </Card>
        </Box>
      ))}
    </Stack>
  );
}
