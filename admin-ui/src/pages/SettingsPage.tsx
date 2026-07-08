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
import { Fragment } from 'react';
import {
  useAssignDocumentTypeTemplates,
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useEmailTemplates,
  useRenameCategory,
} from '../api/hooks';
import type { Category, CategoryKind, DocumentType } from '../api/hooks';
import { useTranslation } from '../i18n';
import { Button, Card, PageHeader, Select, TextField, useToast } from '../ui';

/**
 * Settings / categories management. Two sections — audiences and document types
 * — each supporting list, create (key + name with slug validation), rename
 * (name only; the key is immutable) and delete (surfacing the 422 "in use"
 * error cleanly).
 */
const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <Box>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <Stack spacing={3}>
        <CategorySection kind="audiences" titleKey="settings.audiences" />
        <CategorySection kind="document-types" titleKey="settings.documentTypes" />
      </Stack>
    </Box>
  );
}

/**
 * Per-document-type e-mail template assignment (rendered inside each document-type row): two
 * selects (notification / reminder). An empty selection ("Default template") clears the assignment
 * so the built-in default template is used.
 */
function DocumentTypeTemplateControls({ documentType }: { documentType: DocumentType }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: templates = [] } = useEmailTemplates();
  const assign = useAssignDocumentTypeTemplates();

  const optionsFor = (kind: 'VERSION_NOTIFICATION' | 'REMINDER' | 'ACCEPTANCE_CONFIRMATION') => [
    { value: '', label: t('settings.templateDefault') },
    ...templates
      .filter((template) => template.kind === kind)
      .map((template) => ({
        value: template.id,
        label: template.isDefault ? `${template.name} (${t('emailTemplates.defaultBadge')})` : template.name,
      })),
  ];

  const handleAssign = (
    field: 'notificationTemplateId' | 'reminderTemplateId' | 'acceptanceConfirmationTemplateId',
    value: string,
  ) => {
    assign.mutate(
      { id: documentType.id, [field]: value === '' ? null : value },
      {
        onSuccess: () => toast.success(t('settings.assignmentSaved')),
        onError: (err) =>
          toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('settings.assignmentFailed')),
      },
    );
  };

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ maxWidth: 640 }}>
      <Select
        label={t('settings.notificationTemplate')}
        value={documentType.notificationTemplateId ?? ''}
        onChange={(event) => handleAssign('notificationTemplateId', event.target.value)}
        options={optionsFor('VERSION_NOTIFICATION')}
      />
      <Select
        label={t('settings.reminderTemplate')}
        value={documentType.reminderTemplateId ?? ''}
        onChange={(event) => handleAssign('reminderTemplateId', event.target.value)}
        options={optionsFor('REMINDER')}
      />
      <Select
        label={t('settings.acceptanceConfirmationTemplate')}
        value={documentType.acceptanceConfirmationTemplateId ?? ''}
        onChange={(event) => handleAssign('acceptanceConfirmationTemplateId', event.target.value)}
        options={optionsFor('ACCEPTANCE_CONFIRMATION')}
      />
    </Stack>
  );
}

function CategorySection({ kind, titleKey }: { kind: CategoryKind; titleKey: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: items = [], isLoading, isError } = useCategories(kind);
  const create = useCreateCategory(kind);

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const slugInvalid = key.length > 0 && !SLUG_PATTERN.test(key);

  const handleCreate = () => {
    setFieldError(null);
    if (!key.trim()) return setFieldError(t('settings.validationKey'));
    if (slugInvalid) return setFieldError(t('settings.slugInvalid'));
    if (!name.trim()) return setFieldError(t('settings.validationName'));

    create.mutate(
      { key: key.trim(), name: name.trim() },
      {
        onSuccess: () => {
          toast.success(t('settings.created'));
          setKey('');
          setName('');
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('settings.createFailed')),
      },
    );
  };

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
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={3}>
                  <Typography color="text.secondary">{t('settings.empty')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {items.map((item) => (
              <CategoryRow key={item.id} kind={kind} item={item} />
            ))}
          </TableBody>
        </Table>
        </Box>
      )}

      <Box sx={{ p: 2.5, borderTop: 1, borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
          <TextField
            label={t('settings.newKey')}
            placeholder={t('settings.newKeyPlaceholder')}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            error={slugInvalid}
            helperText={slugInvalid ? t('settings.slugInvalid') : t('settings.slugHint')}
          />
          <TextField
            label={t('settings.newName')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button onClick={handleCreate} loading={create.isPending} sx={{ mt: { sm: 0.5 } }}>
            {t('settings.add')}
          </Button>
        </Stack>
        {fieldError && (
          <Typography color="error" variant="body2" sx={{ mt: 1 }}>
            {fieldError}
          </Typography>
        )}
      </Box>
    </Card>
  );
}

function CategoryRow({ kind, item }: { kind: CategoryKind; item: Category }) {
  const { t } = useTranslation();
  const toast = useToast();
  const rename = useRenameCategory(kind);
  const remove = useDeleteCategory(kind);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);

  const handleSave = () => {
    if (!name.trim()) return;
    rename.mutate(
      { id: item.id, name: name.trim() },
      {
        onSuccess: () => {
          toast.success(t('settings.renamed'));
          setEditing(false);
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('settings.renameFailed')),
      },
    );
  };

  const handleDelete = () => {
    if (!window.confirm(t('settings.confirmDelete', { name: item.name }))) return;
    remove.mutate(item.id, {
      onSuccess: () => toast.success(t('settings.deleted')),
      onError: (err) => {
        // 422 INVALID_STATE means the category is still referenced.
        if (err instanceof ApiError && err.code === 'INVALID_STATE') {
          toast.error(t('settings.inUse'));
        } else {
          toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('settings.deleteFailed'));
        }
      },
    });
  };

  return (
    <Fragment>
    <TableRow>
      <TableCell>
        <Chip size="small" label={item.key} title={t('settings.keyImmutable')} />
      </TableCell>
      <TableCell>
        {editing ? (
          <TextField
            value={name}
            onChange={(event) => setName(event.target.value)}
            sx={{ maxWidth: 280 }}
          />
        ) : (
          item.name
        )}
      </TableCell>
      <TableCell align="right">
        <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
          {editing ? (
            <>
              <Button size="small" onClick={handleSave} loading={rename.isPending}>
                {t('common.save')}
              </Button>
              <Button
                size="small"
                variant="text"
                color="inherit"
                onClick={() => {
                  setName(item.name);
                  setEditing(false);
                }}
              >
                {t('common.cancel')}
              </Button>
            </>
          ) : (
            <Button size="small" variant="outlined" onClick={() => setEditing(true)}>
              {t('common.edit')}
            </Button>
          )}
          <IconButton
            size="small"
            color="error"
            onClick={handleDelete}
            disabled={remove.isPending}
            aria-label={t('common.delete')}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      </TableCell>
    </TableRow>
      {kind === 'document-types' && (
        <TableRow>
          <TableCell colSpan={3} sx={{ pt: 0, borderBottom: 0 }}>
            <DocumentTypeTemplateControls documentType={item as unknown as DocumentType} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
