import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ApiError, errorMessageKey } from '../api/errors';
import { useDocumentTypes, useUploadSignedDocument } from '../api/hooks';
import type { DocumentType } from '../api/hooks';
import { useTranslation } from '../i18n';
import { Button, Dialog, Select, TextField, useToast } from '../ui';

/**
 * Dialog "Upload signed document": PDF upload (multipart field `file`) + metadata. The document
 * type select is limited to EXTERNAL (signed) document types — non-external types use the
 * clickwrap version flow. The result is an immutable SignedDocument (pure evidence, never part of
 * the compliance gate).
 */
interface Props {
  customerId: string;
  open: boolean;
  onClose: () => void;
}

export function SignedDocumentUploadDialog({ customerId, open, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const upload = useUploadSignedDocument();
  const { data: documentTypes = [] } = useDocumentTypes();
  // useDocumentTypes returns the document-type rows (DocumentTypeModel) — narrow to read `external`.
  const externalTypes = (documentTypes as DocumentType[]).filter((type) => type.external);

  const [file, setFile] = useState<File | null>(null);
  const [documentTypeKey, setDocumentTypeKey] = useState('');
  const [signedAt, setSignedAt] = useState('');
  const [signerName, setSignerName] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setDocumentTypeKey('');
    setSignedAt('');
    setSignerName('');
    setReference('');
    setNote('');
    setFieldError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    setFieldError(null);
    if (!file) return setFieldError(t('signedDocumentUpload.fileRequired'));
    if (!documentTypeKey) return setFieldError(t('signedDocumentUpload.typeRequired'));
    if (!signedAt) return setFieldError(t('signedDocumentUpload.signedAtRequired'));

    upload.mutate(
      {
        customerId,
        file,
        documentTypeKey,
        // <input type="date"> yields YYYY-MM-DD; send an ISO date-time.
        signedAt: new Date(signedAt).toISOString(),
        signerName: signerName.trim() || undefined,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success(t('signedDocumentUpload.uploaded'));
          handleClose();
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('signedDocumentUpload.uploadFailed')),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t('signedDocumentUpload.title')}
      maxWidth="sm"
      actions={
        <>
          <Button variant="text" onClick={handleClose} color="inherit">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={upload.isPending} disabled={externalTypes.length === 0}>
            {t('signedDocumentUpload.upload')}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        {externalTypes.length === 0 ? (
          <Typography color="text.secondary" variant="body2">
            {t('signedDocumentUpload.noExternalTypes')}
          </Typography>
        ) : (
          <>
            <Button variant="outlined" component="label">
              {file ? file.name : t('signedDocumentUpload.file')}
              <input
                hidden
                type="file"
                accept="application/pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Button>

            <Select
              label={t('signedDocumentUpload.documentType')}
              value={documentTypeKey}
              onChange={(event) => setDocumentTypeKey(event.target.value)}
              helperText={t('signedDocumentUpload.documentTypeHint')}
              options={externalTypes.map((type) => ({ value: type.key, label: `${type.name} (${type.key})` }))}
            />

            <TextField
              label={t('signedDocumentUpload.signedAt')}
              type="date"
              value={signedAt}
              onChange={(event) => setSignedAt(event.target.value)}
              InputLabelProps={{ shrink: true }}
              required
            />
            <TextField
              label={t('signedDocumentUpload.signerName')}
              value={signerName}
              onChange={(event) => setSignerName(event.target.value)}
            />
            <TextField
              label={t('signedDocumentUpload.reference')}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
            <TextField
              label={t('signedDocumentUpload.note')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              multiline
              minRows={2}
            />
          </>
        )}

        {fieldError && (
          <Typography color="error" variant="body2">
            {fieldError}
          </Typography>
        )}
      </Stack>
    </Dialog>
  );
}
