import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ApiError, errorMessageKey } from '../api/errors';
import { usePatchCustomerVersionState } from '../api/hooks';
import type { HistoryState } from '../api/hooks';
import { useTranslation } from '../i18n';
import { Button, Dialog, TextField, useToast } from '../ui';

/**
 * Dialog "Extend deadline / suspend block" (PATCH
 * /admin/customer-version-states/:id) with a mandatory reason (audit log).
 */
type Mode = 'extend' | 'unblock';

interface Props {
  customerId: string;
  state: HistoryState;
  mode: Mode;
  open: boolean;
  onClose: () => void;
}

export function StateActionDialog({ customerId, state, mode, open, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const patch = usePatchCustomerVersionState(customerId);
  const [reason, setReason] = useState('');
  const [deadlineAt, setDeadlineAt] = useState(state.deadlineAt?.slice(0, 10) ?? '');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const title = mode === 'extend' ? t('stateAction.extendTitle') : t('stateAction.unblockTitle');

  const handleSubmit = () => {
    setFieldError(null);
    if (!reason.trim()) return setFieldError(t('stateAction.validationReason'));
    if (mode === 'extend' && !deadlineAt) return setFieldError(t('stateAction.validationDeadline'));

    patch.mutate(
      {
        stateId: state.id,
        reason: reason.trim(),
        deadlineAt: mode === 'extend' ? deadlineAt : undefined,
        suspendBlock: mode === 'unblock' ? true : undefined,
      },
      {
        onSuccess: () => {
          toast.success(mode === 'extend' ? t('stateAction.extended') : t('stateAction.unblocked'));
          setReason('');
          onClose();
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('stateAction.failed')),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      actions={
        <>
          <Button variant="text" color="inherit" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={patch.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {[state.documentType, state.versionLabel ?? state.versionId].filter(Boolean).join(' · ')}
        </Typography>
        {mode === 'extend' && (
          <TextField
            label={t('stateAction.newDeadline')}
            type="date"
            value={deadlineAt}
            onChange={(event) => setDeadlineAt(event.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        )}
        <TextField
          label={t('stateAction.reason')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          multiline
          minRows={3}
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
