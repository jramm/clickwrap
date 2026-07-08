import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, errorMessageKey } from '../api/errors';
import { useAudiences, useCustomers } from '../api/hooks';
import type { CustomerRow } from '../api/hooks';
import { CustomerFormDialog } from '../components/CustomerFormDialog';
import { useTranslation } from '../i18n';
import { Button, Card, DataTable, PageHeader, SearchField, useDebouncedValue, useIsMobile } from '../ui';
import type { GridColDef } from '../ui';

/**
 * Customers list with pagination and create/edit dialogs. On desktop a DataGrid;
 * on phones/tablets a tappable card list. Row/card click opens the edit dialog.
 */
const PAGE_SIZE = 50;

export function CustomersPage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);

  // A new search term always resets to the first page (the old page may not exist in the result).
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const { data, isLoading, isError, error } = useCustomers(page, debouncedSearch);
  const { data: audiences = [] } = useAudiences();

  const audienceName = useMemo(() => {
    const map = new Map(audiences.map((a) => [a.key, a.name]));
    return (key: string) => map.get(key) ?? key;
  }, [audiences]);

  const rows = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: GridColDef[] = useMemo(
    () => [
      { field: 'name', headerName: t('customers.name'), flex: 1.2, minWidth: 180 },
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

      <Box sx={{ mb: 2, maxWidth: 420 }}>
        <SearchField
          label={t('customers.searchLabel')}
          placeholder={t('customers.searchPlaceholder')}
          clearLabel={t('customers.searchClear')}
          value={search}
          onChange={setSearch}
        />
      </Box>

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
            onOpen={(customer) => setEditing(customer)}
          />
        ) : (
          <Card disableContentPadding>
            <DataTable
              rows={rows}
              columns={columns}
              loading={isLoading}
              onRowClick={(rowParams) => {
                const customer = rows.find((row) => row.id === rowParams.id);
                if (customer) setEditing(customer);
              }}
              getRowId={(row: CustomerRow) => row.id}
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
      <CustomerFormDialog
        mode="edit"
        customer={editing ?? undefined}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
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
            <Typography variant="h5" component="h2">
              {customer.name || customer.externalRef}
            </Typography>
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
