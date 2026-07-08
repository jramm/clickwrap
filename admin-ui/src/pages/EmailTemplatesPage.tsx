import DeleteIcon from '@mui/icons-material/DeleteOutline';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ApiError, errorMessageKey } from '../api/errors';
import { useDeleteEmailTemplate, useEmailTemplates } from '../api/hooks';
import type { EmailTemplate } from '../api/hooks';
import { EmailTemplateEditorDialog } from '../components/EmailTemplateEditorDialog';
import { useTranslation } from '../i18n';
import { Button, Card, PageHeader, useToast } from '../ui';

/**
 * E-mail templates management: list with kind + default badges, create/edit via the Unlayer
 * editor dialog, and delete (surfacing the "in use" / "default" 422 cleanly). Templates are
 * selectable per document type under Settings.
 */
export function EmailTemplatesPage() {
  const { t } = useTranslation();
  const { data: templates = [], isLoading, isError } = useEmailTemplates();
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <Box>
      <PageHeader
        title={t('emailTemplates.title')}
        subtitle={t('emailTemplates.subtitle')}
        actions={<Button onClick={() => setCreating(true)}>{t('emailTemplates.new')}</Button>}
      />

      <Card disableContentPadding>
        {isError ? (
          <Typography color="error" sx={{ p: 3 }}>
            {t('emailTemplates.loadError')}
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
                  <TableCell>{t('emailTemplates.name')}</TableCell>
                  <TableCell>{t('emailTemplates.kind')}</TableCell>
                  <TableCell>{t('emailTemplates.subject')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {templates.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography color="text.secondary">{t('emailTemplates.empty')}</Typography>
                    </TableCell>
                  </TableRow>
                )}
                {templates.map((template) => (
                  <EmailTemplateRow key={template.id} template={template} onEdit={() => setEditing(template)} />
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Card>

      {creating && <EmailTemplateEditorDialog open onClose={() => setCreating(false)} />}
      {editing && (
        <EmailTemplateEditorDialog open template={editing} onClose={() => setEditing(null)} />
      )}
    </Box>
  );
}

function EmailTemplateRow({ template, onEdit }: { template: EmailTemplate; onEdit: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const remove = useDeleteEmailTemplate();

  const handleDelete = () => {
    if (!window.confirm(t('emailTemplates.confirmDelete', { name: template.name }))) return;
    remove.mutate(template.id, {
      onSuccess: () => toast.success(t('emailTemplates.deleted')),
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'INVALID_STATE') {
          toast.error(t('emailTemplates.deleteBlocked'));
        } else {
          toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('emailTemplates.deleteFailed'));
        }
      },
    });
  };

  return (
    <TableRow>
      <TableCell>
        <Stack direction="row" spacing={1} alignItems="center">
          <span>{template.name}</span>
          {template.isDefault && <Chip size="small" color="info" label={t('emailTemplates.defaultBadge')} />}
        </Stack>
      </TableCell>
      <TableCell>
        <Chip
          size="small"
          label={
            template.kind === 'VERSION_NOTIFICATION'
              ? t('emailTemplates.kindNotification')
              : t('emailTemplates.kindReminder')
          }
        />
      </TableCell>
      <TableCell sx={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {template.subject}
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
          <Button size="small" variant="outlined" onClick={onEdit}>
            {t('common.edit')}
          </Button>
          <IconButton
            size="small"
            color="error"
            onClick={handleDelete}
            disabled={remove.isPending || template.isDefault}
            aria-label={t('common.delete')}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      </TableCell>
    </TableRow>
  );
}
