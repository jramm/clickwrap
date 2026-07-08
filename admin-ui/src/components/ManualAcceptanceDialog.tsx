import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { ApiError, errorMessageKey } from '../api/errors';
import { useDocuments, useManualAcceptance, useVersionsForDocuments } from '../api/hooks';
import { fileToBase64 } from '../lib/file';
import { useTranslation } from '../i18n';
import { Button, Dialog, Select, TextField, useToast } from '../ui';

/**
 * Dialog "Manual acceptance" (POST /admin/customers/:id/acceptances).
 * method ACTIVE_CONSENT|IMPORT, reason required, evidence PDF as file -> base64.
 * By default the select offers each document's current version; "show older versions" adds the
 * RETIRED history (the backend allows recording them — existence + role check only). Recording a
 * retired version leaves the current one outstanding, which the hint below the select explains.
 */
interface Props {
  customerId: string;
  open: boolean;
  onClose: () => void;
}

export function ManualAcceptanceDialog({ customerId, open, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const manual = useManualAcceptance(customerId);
  const documents = useDocuments();

  const [versionId, setVersionId] = useState('');
  const [method, setMethod] = useState<'ACTIVE_CONSENT' | 'IMPORT'>('ACTIVE_CONSENT');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showOlderVersions, setShowOlderVersions] = useState(false);

  const docs = documents.data ?? [];
  // Version histories are only fetched once the admin opts into older versions.
  const histories = useVersionsForDocuments(
    docs.map((doc) => doc.id),
    open && showOlderVersions,
  );

  // One option per document that has a published current version — the common case for
  // recording an acceptance. The backend still validates role coverage (ROLE_MISMATCH).
  const currentOptions = docs
    .filter((doc) => doc.currentVersion)
    .map((doc) => ({
      value: doc.currentVersion!.id,
      label: `${doc.name} — ${doc.currentVersion!.versionLabel}`,
    }));

  // Upcoming (published, future validFrom) versions are acceptable in advance — e.g. a signed
  // offer already covering the next revision (same rule as the portal/link advance acceptance).
  const upcomingOptions = docs
    .filter((doc) => doc.upcomingVersion)
    .map((doc) => ({
      value: doc.upcomingVersion!.id,
      label: `${doc.name} — ${doc.upcomingVersion!.versionLabel} (${t('manualAcceptance.upcomingLabel', {
        date: doc.upcomingVersion!.validFrom ? new Date(doc.upcomingVersion!.validFrom).toLocaleDateString() : '',
      })})`,
    }));

  // "Show older versions": RETIRED history per document (e.g. a signed offer covering a
  // superseded revision). DRAFTs stay hidden — they were never in force.
  const retiredIds = new Set<string>();
  const retiredOptions = showOlderVersions
    ? docs.flatMap((doc) =>
        (histories.versionsByDocument.get(doc.id) ?? [])
          .filter((version) => version.status === 'RETIRED')
          .map((version) => {
            retiredIds.add(version.id);
            return {
              value: version.id,
              label: `${doc.name} — ${version.versionLabel} (${t('manualAcceptance.retiredLabel')})`,
            };
          }),
      )
    : [];
  const versionOptions = [...currentOptions, ...upcomingOptions, ...retiredOptions];
  const retiredSelected = retiredIds.has(versionId);

  const reset = () => {
    setVersionId('');
    setMethod('ACTIVE_CONSENT');
    setReason('');
    setFile(null);
    setFieldError(null);
    setShowOlderVersions(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    setFieldError(null);
    if (!versionId.trim()) return setFieldError(t('manualAcceptance.validationVersion'));
    if (!reason.trim()) return setFieldError(t('manualAcceptance.validationReason'));
    if (!file) return setFieldError(t('manualAcceptance.validationEvidence'));

    setBusy(true);
    try {
      const evidenceDocument = await fileToBase64(file);
      await manual.mutateAsync({
        versionId: versionId.trim(),
        method,
        reason: reason.trim(),
        evidenceDocument,
        evidenceFileName: file.name,
      });
      toast.success(t('manualAcceptance.success'));
      handleClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('manualAcceptance.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t('manualAcceptance.title')}
      actions={
        <>
          <Button variant="text" color="inherit" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} loading={busy}>
            {t('manualAcceptance.submit')}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <Select
          label={t('manualAcceptance.versionId')}
          value={versionId}
          onChange={(event) => setVersionId(event.target.value)}
          options={versionOptions}
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={showOlderVersions}
              onChange={(event) => setShowOlderVersions(event.target.checked)}
            />
          }
          label={t('manualAcceptance.showOlderVersions')}
        />
        {retiredSelected && (
          <Typography variant="body2" color="text.secondary">
            {t('manualAcceptance.retiredHint')}
          </Typography>
        )}
        <Select
          label={t('manualAcceptance.method')}
          value={method}
          onChange={(event) => setMethod(event.target.value as 'ACTIVE_CONSENT' | 'IMPORT')}
          options={[
            { value: 'ACTIVE_CONSENT', label: t('manualAcceptance.methodActiveConsent') },
            { value: 'IMPORT', label: t('manualAcceptance.methodImport') },
          ]}
        />
        <TextField
          label={t('manualAcceptance.reason')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          multiline
          minRows={2}
          required
        />
        <Button variant="outlined" component="label">
          {file ? file.name : t('manualAcceptance.selectEvidence')}
          <input
            hidden
            type="file"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Button>
        {fieldError && (
          <Typography color="error" variant="body2">
            {fieldError}
          </Typography>
        )}
      </Stack>
    </Dialog>
  );
}
