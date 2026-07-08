import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ApiError, errorMessageKey } from '../api/errors';
import { usePublishVersion } from '../api/hooks';
import type { PublishResult, Version } from '../api/hooks';
import { useTranslation } from '../i18n';
import { Button, Dialog, useToast } from '../ui';

/**
 * Confirmation dialog for publishing. After publishing, the actual rollout count
 * (rolloutCustomers) from the response is shown. A FUTURE validFrom is announced as scheduled
 * effectiveness: rollout happens now, the current version stays required until the flip.
 */
interface Props {
  documentId: string;
  version: Version;
  open: boolean;
  onClose: () => void;
}

export function PublishDialog({ documentId, version, open, onClose }: Props) {
  const { t, language } = useTranslation();
  const toast = useToast();
  const publish = usePublishVersion(documentId);
  const [result, setResult] = useState<PublishResult | null>(null);

  const label = version.versionLabel ?? version.id;
  const validFrom = version.validFrom ? new Date(version.validFrom) : null;
  const isScheduled = validFrom !== null && validFrom.getTime() > Date.now();

  const handleClose = () => {
    setResult(null);
    onClose();
  };

  const handlePublish = () => {
    publish.mutate(version.id, {
      onSuccess: (data) => {
        setResult(data);
        toast.success(t('publish.toast', { count: data.rolloutCustomers }));
      },
      onError: (err) =>
        toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('publish.failed')),
    });
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t('publish.title')}
      actions={
        result ? (
          <Button onClick={handleClose}>{t('common.close')}</Button>
        ) : (
          <>
            <Button variant="text" color="inherit" onClick={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button color="warning" onClick={handlePublish} loading={publish.isPending}>
              {t('publish.publishNow')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <Alert severity="success">
          {result.publishedAt
            ? t('publish.successAt', {
                label,
                count: result.rolloutCustomers,
                date: new Date(result.publishedAt).toLocaleString(language),
              })
            : t('publish.success', { label, count: result.rolloutCustomers })}
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Typography>{t('publish.immutableWarning', { label })}</Typography>
          {isScheduled && validFrom ? (
            <Alert severity="info">
              {t('publish.scheduledInfo', { date: validFrom.toLocaleDateString(language) })}
            </Alert>
          ) : (
            <Alert severity="warning">{t('publish.rolloutWarning')}</Alert>
          )}
        </Stack>
      )}
    </Dialog>
  );
}
