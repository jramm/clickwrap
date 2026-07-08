import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ApiError, errorMessageKey } from '../api/errors';
import { useAudiences, useCreateDocument, useDocumentTypes } from '../api/hooks';
import { useTranslation } from '../i18n';
import { Button, Dialog, Select, TextField, useToast } from '../ui';

/**
 * Dialog "New document": pick a document type and audience (both fed from the
 * dynamic category endpoints) plus a display name, then POST /admin/documents.
 */
interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewDocumentDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const createDocument = useCreateDocument();
  const { data: audiences = [] } = useAudiences();
  const { data: documentTypes = [] } = useDocumentTypes();

  const [type, setType] = useState('');
  const [audience, setAudience] = useState('');
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const reset = () => {
    setType('');
    setAudience('');
    setName('');
    setFieldError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    setFieldError(null);
    if (!type) return setFieldError(t('newDocument.validationType'));
    if (!audience) return setFieldError(t('newDocument.validationAudience'));
    if (!name.trim()) return setFieldError(t('newDocument.validationName'));

    createDocument.mutate(
      { type, audience, name: name.trim() },
      {
        onSuccess: () => {
          toast.success(t('newDocument.created'));
          handleClose();
        },
        onError: (err) =>
          toast.error(
            err instanceof ApiError ? t(errorMessageKey(err)) : t('newDocument.createFailed'),
          ),
      },
    );
  };

  const noCategories = documentTypes.length === 0 || audiences.length === 0;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t('newDocument.title')}
      actions={
        <>
          <Button variant="text" onClick={handleClose} color="inherit">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={createDocument.isPending} disabled={noCategories}>
            {t('newDocument.create')}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        {noCategories && (
          <Typography color="text.secondary" variant="body2">
            {t('newDocument.noCategories')}
          </Typography>
        )}
        <Select
          label={t('newDocument.type')}
          value={type}
          onChange={(event) => setType(event.target.value)}
          options={[
            { value: '', label: t('newDocument.selectType') },
            ...documentTypes.map((item) => ({ value: item.key, label: item.name })),
          ]}
        />
        <Select
          label={t('newDocument.audience')}
          value={audience}
          onChange={(event) => setAudience(event.target.value)}
          options={[
            { value: '', label: t('newDocument.selectAudience') },
            ...audiences.map((item) => ({ value: item.key, label: item.name })),
          ]}
        />
        <TextField
          label={t('newDocument.name')}
          placeholder={t('newDocument.namePlaceholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        {fieldError && (
          <Typography color="error" variant="body2">
            {fieldError}
          </Typography>
        )}
      </Stack>
    </Dialog>
  );
}
