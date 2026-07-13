import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, errorMessageKey } from '../api/errors';
import { useAudiences, useCustomers, useDocumentTypes } from '../api/hooks';
import type { ComplianceFilter, ComplianceStatus, CustomerRow } from '../api/hooks';
import { CustomerFormDialog } from '../components/CustomerFormDialog';
import { customerDisplayName } from '../lib/customerDisplayName';
import { useTranslation } from '../i18n';
import { Button, Card, DataTable, PageHeader, SearchField, Select, useDebouncedValue, useIsMobile } from '../ui';
import type { GridColDef, SelectOption } from '../ui';

/**
 * Customers list with pagination and a create dialog (edit lives on the detail page). On desktop a DataGrid;
 * on phones/tablets a tappable card list. Row/card click navigates to the customer detail page; edit is a button there.
 *
 * A filter bar (next to the search) scopes the per-row compliance indicator and filters the rows: a
 * document-type select, an audience select and a compliance-status select — the three filters the
 * former global Overview page offered, now folded into the customers list.
 */
const PAGE_SIZE = 50;

const COMPLIANCE_FILTERS: ComplianceFilter[] = ['compliant', 'non_compliant', 'pending', 'blocked', 'objected'];

const COMPLIANCE_CHIP_COLOR: Record<ComplianceStatus, 'success' | 'warning' | 'info' | 'error'> = {
  compliant: 'success',
  pending: 'warning',
  objected: 'info',
  blocked: 'error',
};

export function CustomersPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [documentType, setDocumentType] = useState('');
  const [audience, setAudience] = useState('');
  const [compliance, setCompliance] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();

  // A new search term or filter always resets to the first page (the old page may not exist in the result).
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, documentType, audience, compliance]);

  const { data, isLoading, isError, error } = useCustomers(page, debouncedSearch, {
    documentType: documentType || undefined,
    audience: audience || undefined,
    compliance: (compliance || undefined) as ComplianceFilter | undefined,
  });
  const { data: audiences = [] } = useAudiences();
  const { data: documentTypes = [] } = useDocumentTypes();

  const audienceName = useMemo(() => {
    const map = new Map(audiences.map((a) => [a.key, a.name]));
    return (key: string) => map.get(key) ?? key;
  }, [audiences]);

  const allOption: SelectOption = { value: '', label: t('customers.filterAll') };
  const documentTypeOptions: SelectOption[] = [allOption, ...documentTypes.map((d) => ({ value: d.key, label: d.name }))];
  const audienceOptions: SelectOption[] = [allOption, ...audiences.map((a) => ({ value: a.key, label: a.name }))];
  const complianceOptions: SelectOption[] = [
    allOption,
    ...COMPLIANCE_FILTERS.map((value) => ({ value, label: t(`customers.compliance.${value}`) })),
  ];

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'name',
        headerName: t('customers.name'),
        flex: 1.2,
        minWidth: 180,
        valueGetter: (_value, row: CustomerRow) => customerDisplayName(row),
      },
      { field: 'externalRef', headerName: t('customers.externalRef'), flex: 1, minWidth: 140 },
      {
        field: 'roles',
        headerName: t('customers.roles'),
        flex: 1,
        minWidth: 160,
        sortable: false,
        valueGetter: (_value, row: CustomerRow) =>
          (row.roles ?? []).map((key) => audienceName(key)).join(', '),
      },
      {
        field: 'contactEmails',
        headerName: t('customers.contactEmails'),
        flex: 1.4,
        minWidth: 200,
        sortable: false,
        valueGetter: (_value, row: CustomerRow) => (row.contactEmails ?? []).join(', '),
      },
      {
        field: 'complianceStatus',
        headerName: t('customers.complianceHeader'),
        flex: 0.8,
        minWidth: 140,
        sortable: false,
        renderCell: (params) => <ComplianceChip status={(params.row as CustomerRow).complianceStatus} />,
      },
    ],
    [audienceName, t],
  );

  return (
    <Box>
      <PageHeader
        title={t('customers.title')}
        subtitle={t('customers.subtitle')}
        actions={<Button onClick={() => setCreateOpen(true)}>{t('customers.newCustomer')}</Button>}
      />

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ mb: 2 }}
        alignItems={{ xs: 'stretch', md: 'flex-start' }}
      >
        <Box sx={{ flex: 1, maxWidth: { md: 420 } }}>
          <SearchField
            label={t('customers.searchLabel')}
            placeholder={t('customers.searchPlaceholder')}
            clearLabel={t('customers.searchClear')}
            value={search}
            onChange={setSearch}
          />
        </Box>
        <Box sx={{ minWidth: { md: 180 } }}>
          <Select
            label={t('customers.filterDocumentType')}
            options={documentTypeOptions}
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
          />
        </Box>
        <Box sx={{ minWidth: { md: 180 } }}>
          <Select
            label={t('customers.filterAudience')}
            options={audienceOptions}
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
          />
        </Box>
        <Box sx={{ minWidth: { md: 180 } }}>
          <Select
            label={t('customers.filterCompliance')}
            options={complianceOptions}
            value={compliance}
            onChange={(event) => setCompliance(event.target.value)}
          />
        </Box>
      </Stack>

      <Box>
        {isError ? (
          <Card>
            <Typography color="error">
              {error instanceof ApiError ? t(errorMessageKey(error)) : t('customers.loadError')}
            </Typography>
          </Card>
        ) : !isLoading && rows.length === 0 ? (
          <Card>
            <Typography color="text.secondary">
              {debouncedSearch ? t('customers.searchEmpty', { term: debouncedSearch }) : t('customers.empty')}
            </Typography>
          </Card>
        ) : isMobile ? (
          <CustomerCardList
            rows={rows}
            audienceName={audienceName}
            loading={isLoading}
            onOpen={(customer) => navigate(`/customers/${customer.id}`)}
          />
        ) : (
          <Card disableContentPadding>
            <DataTable
              rows={rows}
              columns={columns}
              loading={isLoading}
              onRowClick={(rowParams) => navigate(`/customers/${rowParams.id}`)}
              getRowId={(row: CustomerRow) => row.id}
              hideFooter
            />
          </Card>
        )}
      </Box>

      <Stack
        direction="row"
        spacing={2}
        alignItems="center"
        justifyContent="flex-end"
        sx={{ mt: 2 }}
      >
        <Typography variant="body2" color="text.secondary">
          {t('customers.pageOf', { page, pages: pageCount, total })}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          {t('customers.prev')}
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={page >= pageCount}
          onClick={() => setPage((current) => current + 1)}
        >
          {t('customers.next')}
        </Button>
      </Stack>

      <CustomerFormDialog mode="create" open={createOpen} onClose={() => setCreateOpen(false)} />
    </Box>
  );
}

interface CustomerCardListProps {
  rows: CustomerRow[];
  audienceName: (key: string) => string;
  loading: boolean;
  onOpen: (customer: CustomerRow) => void;
}

function CustomerCardList({ rows, audienceName, loading, onOpen }: CustomerCardListProps) {
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
        {t('customers.empty')}
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5} data-testid="customers-card-list">
      {rows.map((customer) => (
        <Box
          key={customer.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(customer)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onOpen(customer);
          }}
          sx={{ cursor: 'pointer', minHeight: 44 }}
        >
          <Card>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
              <Typography variant="h5" component="h2">
                {customerDisplayName(customer) || customer.externalRef}
              </Typography>
              <ComplianceChip status={customer.complianceStatus} />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {customer.externalRef}
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 1, gap: 0.5 }}>
              {(customer.roles ?? []).map((roleKey) => (
                <Chip key={roleKey} size="small" label={audienceName(roleKey)} variant="outlined" />
              ))}
            </Stack>
            {(customer.contactEmails ?? []).length > 0 && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {customer.contactEmails.join(', ')}
              </Typography>
            )}
          </Card>
        </Box>
      ))}
    </Stack>
  );
}

/** Compact per-row compliance indicator; renders nothing when the row carries no status. */
function ComplianceChip({ status }: { status?: ComplianceStatus }) {
  const { t } = useTranslation();
  if (!status) return null;
  return (
    <Chip
      label={t(`customers.compliance.${status}`)}
      color={COMPLIANCE_CHIP_COLOR[status]}
      size="small"
      variant="filled"
      data-testid={`compliance-chip-${status}`}
    />
  );
}
