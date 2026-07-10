import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useCategories, useEmailTemplates } from '../api/hooks';
import type { Category, CategoryKind, DocumentType, EmailTemplate } from '../api/hooks';
import { useTranslation } from '../i18n';
import { Card, PageHeader } from '../ui';

/**
 * Settings / categories — READ-ONLY. Audiences and document types (incl. their e-mail-template
 * assignments and the `external` flag) are declared in the legal-entities configuration file
 * (config/legal-entities.json) and reconciled into the store at boot; the admin UI only lists them.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <Box>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <Alert severity="info" sx={{ mb: 3 }}>
        {t('settings.managedViaConfig')}
      </Alert>
      <Stack spacing={3}>
        <CategorySection kind="audiences" titleKey="settings.audiences" />
        <CategorySection kind="document-types" titleKey="settings.documentTypes" />
      </Stack>
    </Box>
  );
}

function CategorySection({ kind, titleKey }: { kind: CategoryKind; titleKey: string }) {
  const { t } = useTranslation();
  const { data: items = [], isLoading, isError } = useCategories(kind);
  const { data: templates = [] } = useEmailTemplates();
  const isDocumentTypes = kind === 'document-types';

  return (
    <Card title={t(titleKey)} disableContentPadding>
      {isError ? (
        <Typography color="error" sx={{ p: 3 }}>
          {t('settings.loadError')}
        </Typography>
      ) : isLoading ? (
        <Typography color="text.secondary" sx={{ p: 3 }}>
          {t('common.loading')}
        </Typography>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('settings.key')}</TableCell>
                <TableCell>{t('settings.name')}</TableCell>
                {isDocumentTypes && <TableCell>{t('settings.templateAssignments')}</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isDocumentTypes ? 3 : 2}>
                    <Typography color="text.secondary">{t('settings.empty')}</Typography>
                  </TableCell>
                </TableRow>
              )}
              {items.map((item) => (
                <CategoryRow key={item.id} isDocumentTypes={isDocumentTypes} item={item} templates={templates} />
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Card>
  );
}

function CategoryRow({
  isDocumentTypes,
  item,
  templates,
}: {
  isDocumentTypes: boolean;
  item: Category;
  templates: EmailTemplate[];
}) {
  const { t } = useTranslation();
  const documentType = item as unknown as DocumentType;
  const templateName = (id: string | null | undefined): string =>
    (id ? templates.find((template) => template.id === id)?.name : undefined) ?? t('settings.templateDefault');

  return (
    <TableRow>
      <TableCell>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Chip size="small" label={item.key} />
          {isDocumentTypes && documentType.external && (
            <Chip size="small" color="secondary" variant="outlined" label={t('customerDetail.signedDocuments')} />
          )}
        </Stack>
      </TableCell>
      <TableCell>{item.name}</TableCell>
      {isDocumentTypes && (
        <TableCell>
          {documentType.external ? (
            <Typography variant="body2" color="text.secondary">
              —
            </Typography>
          ) : (
            <Stack spacing={0.25}>
              <Typography variant="caption" color="text.secondary">
                {t('settings.notificationTemplate')}: {templateName(documentType.notificationTemplateId)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('settings.reminderTemplate')}: {templateName(documentType.reminderTemplateId)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('settings.acceptanceConfirmationTemplate')}:{' '}
                {templateName(documentType.acceptanceConfirmationTemplateId)}
              </Typography>
            </Stack>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}
