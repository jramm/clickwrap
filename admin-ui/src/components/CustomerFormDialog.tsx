import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, errorMessageKey } from '../api/errors';
import { useAudiences, useCreateCustomer, useDocuments, useUpdateCustomer } from '../api/hooks';
import type { CustomerRow } from '../api/hooks';
import type { AcceptedVersionImportModel } from '../gen';
import { useTranslation } from '../i18n';
import { Button, Dialog, TextField, useToast } from '../ui';

/**
 * Create/edit dialog for a customer.
 *  - create: externalRef, firstName/lastName (contact person), companyName,
 *    roles (from audiences), contactEmails (chips) plus the signed-offer
 *    onboarding section — the current published versions matching the chosen
 *    roles can be marked as already accepted (IMPORT) with an optional
 *    signature date + reference, mapped to `acceptedVersions`.
 *  - edit: firstName/lastName, companyName, roles, contactEmails (externalRef is immutable).
 */
interface Props {
  mode: 'create' | 'edit';
  customer?: CustomerRow;
  open: boolean;
  onClose: () => void;
}

interface AcceptedSelection {
  checked: boolean;
  acceptedAt: string;
  reference: string;
}

export function CustomerFormDialog({ mode, customer, open, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: audiences = [] } = useAudiences();
  const { data: documents = [] } = useDocuments();
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();

  const [externalRef, setExternalRef] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [contactEmails, setContactEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [accepted, setAccepted] = useState<Record<string, AcceptedSelection>>({});
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Initialize form state whenever the dialog opens (or the target customer changes).
  useEffect(() => {
    if (!open) return;
    setExternalRef(customer?.externalRef ?? '');
    setFirstName(customer?.firstName ?? '');
    setLastName(customer?.lastName ?? '');
    setCompanyName(customer?.companyName ?? '');
    setRoles(customer?.roles ?? []);
    setContactEmails(customer?.contactEmails ?? []);
    setEmailInput('');
    setAccepted({});
    setFieldError(null);
  }, [open, customer]);

  // Published versions whose audience is one of the selected roles — the offer
  // the customer signed as part of onboarding.
  const acceptableDocuments = useMemo(
    () =>
      documents.filter(
        (doc) => doc.currentVersion != null && roles.includes(doc.audience),
      ),
    [documents, roles],
  );

  const toggleRole = (key: string) => {
    setRoles((current) =>
      current.includes(key) ? current.filter((role) => role !== key) : [...current, key],
    );
  };

  const addEmail = () => {
    const value = emailInput.trim();
    if (!value) return;
    setContactEmails((current) => (current.includes(value) ? current : [...current, value]));
    setEmailInput('');
  };

  const removeEmail = (value: string) => {
    setContactEmails((current) => current.filter((email) => email !== value));
  };

  const setAcceptedField = (versionId: string, patch: Partial<AcceptedSelection>) => {
    setAccepted((current) => ({
      ...current,
      [versionId]: {
        checked: current[versionId]?.checked ?? false,
        acceptedAt: current[versionId]?.acceptedAt ?? '',
        reference: current[versionId]?.reference ?? '',
        ...patch,
      },
    }));
  };

  const buildAcceptedVersions = (): AcceptedVersionImportModel[] =>
    acceptableDocuments
      .map((doc) => doc.currentVersion!)
      .filter((version) => accepted[version.id]?.checked)
      .map((version) => {
        const selection = accepted[version.id];
        return {
          versionId: version.id,
          acceptedAt: selection.acceptedAt ? new Date(selection.acceptedAt).toISOString() : undefined,
          reference: selection.reference || undefined,
        };
      });

  const isPending = createCustomer.isPending || updateCustomer.isPending;

  const handleClose = () => {
    if (isPending) return;
    onClose();
  };

  const handleSubmit = () => {
    setFieldError(null);
    // Fold a not-yet-added typed email into the list on submit.
    const emails = emailInput.trim()
      ? Array.from(new Set([...contactEmails, emailInput.trim()]))
      : contactEmails;

    if (mode === 'create') {
      if (!externalRef.trim()) return setFieldError(t('customers.validationExternalRef'));
      const acceptedVersions = buildAcceptedVersions();
      createCustomer.mutate(
        {
          externalRef: externalRef.trim(),
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          companyName: companyName.trim() || undefined,
          roles,
          contactEmails: emails,
          acceptedVersions: acceptedVersions.length > 0 ? acceptedVersions : undefined,
        },
        {
          onSuccess: () => {
            toast.success(t('customers.created'));
            onClose();
          },
          onError: (err) =>
            toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('customers.saveFailed')),
        },
      );
      return;
    }

    if (!customer) return;
    updateCustomer.mutate(
      {
        id: customer.id,
        data: { firstName: firstName.trim(), lastName: lastName.trim(), companyName: companyName.trim(), roles, contactEmails: emails },
      },
      {
        onSuccess: () => {
          toast.success(t('customers.updated'));
          onClose();
        },
        onError: (err) =>
          toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('customers.saveFailed')),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      title={mode === 'create' ? t('customers.newCustomer') : t('customers.editCustomer')}
      actions={
        <>
          <Button variant="text" color="inherit" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={isPending}>
            {mode === 'create' ? t('customers.create') : t('common.save')}
          </Button>
        </>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <TextField
          label={t('customers.externalRef')}
          value={externalRef}
          onChange={(event) => setExternalRef(event.target.value)}
          disabled={mode === 'edit'}
          required={mode === 'create'}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label={t('customers.firstName')}
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            fullWidth
          />
          <TextField
            label={t('customers.lastName')}
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            fullWidth
          />
        </Stack>
        <TextField
          label={t('customers.companyName')}
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
        />

        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('customers.roles')}
          </Typography>
          {audiences.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('customers.noAudiences')}
            </Typography>
          ) : (
            <FormGroup>
              {audiences.map((audience) => (
                <FormControlLabel
                  key={audience.id}
                  control={
                    <Checkbox
                      checked={roles.includes(audience.key)}
                      onChange={() => toggleRole(audience.key)}
                    />
                  }
                  label={audience.name}
                />
              ))}
            </FormGroup>
          )}
        </Box>

        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('customers.contactEmails')}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="flex-start">
            <TextField
              label={t('customers.addEmail')}
              type="email"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addEmail();
                }
              }}
            />
            <Button variant="outlined" onClick={addEmail} sx={{ mt: { sm: 0.25 } }}>
              {t('customers.add')}
            </Button>
          </Stack>
          {contactEmails.length > 0 && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 1, gap: 0.5 }}>
              {contactEmails.map((email) => (
                <Chip key={email} label={email} onDelete={() => removeEmail(email)} />
              ))}
            </Stack>
          )}
        </Box>

        {mode === 'create' && (
          <>
            <Divider />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t('customers.acceptedTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('customers.acceptedHint')}
              </Typography>
              {roles.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('customers.acceptedChooseRoles')}
                </Typography>
              ) : acceptableDocuments.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('customers.acceptedNone')}
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  {acceptableDocuments.map((doc) => {
                    const version = doc.currentVersion!;
                    const selection = accepted[version.id];
                    const checked = selection?.checked ?? false;
                    return (
                      <Box key={version.id}>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={checked}
                              onChange={(event) =>
                                setAcceptedField(version.id, { checked: event.target.checked })
                              }
                            />
                          }
                          label={`${doc.name} — ${version.versionLabel ?? version.id}`}
                        />
                        {checked && (
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            sx={{ pl: 4, pb: 1 }}
                          >
                            <TextField
                              label={t('customers.acceptedAt')}
                              type="date"
                              value={selection?.acceptedAt ?? ''}
                              onChange={(event) =>
                                setAcceptedField(version.id, { acceptedAt: event.target.value })
                              }
                              InputLabelProps={{ shrink: true }}
                            />
                            <TextField
                              label={t('customers.acceptedReference')}
                              value={selection?.reference ?? ''}
                              onChange={(event) =>
                                setAcceptedField(version.id, { reference: event.target.value })
                              }
                            />
                          </Stack>
                        )}
                      </Box>
                    );
                  })}
                </Stack>
              )}
            </Box>
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
