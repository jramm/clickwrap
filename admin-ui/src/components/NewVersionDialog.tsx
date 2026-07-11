import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ApiError, errorMessageKey } from '../api/errors';
import { useCreateVersion } from '../api/hooks';
import type { AgreementDocument } from '../api/hooks';
import { useTranslation } from '../i18n';
import { Button, Dialog, Select, TextField, useToast } from '../ui';

/**
 * Dialog "New version": PDF upload (multipart field `file`) + metadata.
 * ACTIVE requires consentText + an absolute "Acceptance deadline" (hardDeadlineAt); PASSIVE
 * requires an objection period (days). The result is a DRAFT version.
 */
interface Props {
  document: AgreementDocument;
  open: boolean;
  onClose: () => void;
}

export function NewVersionDialog({ document, open, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const createVersion = useCreateVersion();

  const [file, setFile] = useState<File | null>(null);
  const [versionLabel, setVersionLabel] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [acceptanceMode, setAcceptanceMode] = useState<'ACTIVE' | 'PASSIVE'>('ACTIVE');
  const [consentText, setConsentText] = useState('');
  const [objectionPeriodDays, setObjectionPeriodDays] = useState('14');
  const [objectionConsequence, setObjectionConsequence] = useState('');
  const [hardDeadlineAt, setHardDeadlineAt] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setVersionLabel('');
    setChangeSummary('');
    setAcceptanceMode('ACTIVE');
    setConsentText('');
    setObjectionPeriodDays('14');
    setObjectionConsequence('');
    setHardDeadlineAt('');
    setValidFrom('');
    setFieldError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    setFieldError(null);
    if (!file) return setFieldError(t('newVersion.validationFile'));
    if (!versionLabel.trim()) return setFieldError(t('newVersion.validationLabel'));
    if (!changeSummary.trim()) return setFieldError(t('newVersion.validationSummary'));
    if (!validFrom) return setFieldError(t('newVersion.validationValidFrom'));
    if (acceptanceMode === 'ACTIVE' && !consentText.trim())
      return setFieldError(t('newVersion.validationConsent'));
    if (acceptanceMode === 'ACTIVE' && !hardDeadlineAt)
      return setFieldError(t('newVersion.validationHardDeadline'));

    createVersion.mutate(
      {
        documentId: document.id,
        file,
        versionLabel: versionLabel.trim(),
        changeSummary: changeSummary.trim(),
        acceptanceMode,
        validFrom,
        consentText: acceptanceMode === 'ACTIVE' ? consentText.trim() : undefined,
        objectionPeriodDays:
          acceptanceMode === 'PASSIVE' ? Number(objectionPeriodDays) : undefined,
        // PASSIVE only: the version-specific consequence shown to a customer next to the objection
        // button on the acceptance page (#30). Optional — omit when blank.
        objectionConsequence:
          acceptanceMode === 'PASSIVE' && objectionConsequence.trim()
            ? objectionConsequence.trim()
            : undefined,
        // <input type="date"> yields a date-only string ("YYYY-MM-DD"); the API contract validates
        // with z.string().datetime() — widen to a full ISO date-time (UTC midnight) before sending.
        hardDeadlineAt:
          acceptanceMode === 'ACTIVE' ? new Date(hardDeadlineAt).toISOString() : undefined,
      },
      {
        onSuccess: () => {
          toast.success(t('newVersion.created'));
          handleClose();
        },
        onError: (err) =>
          toast.error(
            err instanceof ApiError ? t(errorMessageKey(err)) : t('newVersion.createFailed'),
          ),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t('newVersion.title', { name: document.name })}
      maxWidth="md"
      actions={
        <>
          <Button variant="text" onClick={handleClose} color="inherit">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={createVersion.isPending}>
            {t('newVersion.createDraft')}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <Button variant="outlined" component="label">
          {file ? file.name : t('newVersion.selectPdf')}
          <input
            hidden
            type="file"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Button>

        <TextField
          label={t('newVersion.versionLabel')}
          placeholder={t('newVersion.versionLabelPlaceholder')}
          value={versionLabel}
          onChange={(event) => setVersionLabel(event.target.value)}
          required
        />
        <TextField
          label={t('newVersion.changeSummary')}
          value={changeSummary}
          onChange={(event) => setChangeSummary(event.target.value)}
          multiline
          minRows={2}
          inputProps={{ maxLength: 500 }}
          required
        />
        <Select
          label={t('newVersion.acceptanceMode')}
          value={acceptanceMode}
          onChange={(event) => setAcceptanceMode(event.target.value as 'ACTIVE' | 'PASSIVE')}
          options={[
            { value: 'ACTIVE', label: t('newVersion.modeActive') },
            { value: 'PASSIVE', label: t('newVersion.modePassive') },
          ]}
        />

        {acceptanceMode === 'ACTIVE' ? (
          <>
            <TextField
              label={t('newVersion.consentText')}
              value={consentText}
              onChange={(event) => setConsentText(event.target.value)}
              multiline
              minRows={2}
              required
            />
            <TextField
              label={t('newVersion.hardDeadlineAt')}
              type="date"
              value={hardDeadlineAt}
              onChange={(event) => setHardDeadlineAt(event.target.value)}
              InputLabelProps={{ shrink: true }}
              required
            />
          </>
        ) : (
          <>
            <TextField
              label={t('newVersion.objectionPeriodDays')}
              type="number"
              value={objectionPeriodDays}
              onChange={(event) => setObjectionPeriodDays(event.target.value)}
            />
            <TextField
              label={t('newVersion.objectionConsequence')}
              placeholder={t('newVersion.objectionConsequencePlaceholder')}
              value={objectionConsequence}
              onChange={(event) => setObjectionConsequence(event.target.value)}
              multiline
              minRows={2}
              inputProps={{ maxLength: 500 }}
            />
          </>
        )}

        <TextField
          label={t('newVersion.validFrom')}
          type="date"
          value={validFrom}
          onChange={(event) => setValidFrom(event.target.value)}
          InputLabelProps={{ shrink: true }}
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
