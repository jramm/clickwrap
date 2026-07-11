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
import { useAudiences, useCreateCustomer, useDocuments, useDocumentTypes, useUpdateCustomer } from '../api/hooks';
import type { CustomerRow } from '../api/hooks';
import { useTranslation } from '../i18n';
import { Button, Dialog, TextField, useToast } from '../ui';

/**
 * Create/edit dialog for a customer.
 *  - create: externalRef, firstName/lastName (contact person), companyName,
 *    roles (from audiences), contactEmails (chips) plus the signed-contract
 *    onboarding section (#29): a single contract signing date + the document
 *    types the contract covered. The backend records the customer as having
 *    accepted, for each chosen type, the version that was effective at that
 *    date — sent as `signedDocuments`.
 *  - edit: firstName/lastName, companyName, roles, contactEmails (externalRef is immutable).
 */
interface Props {
  mode: 'create' | 'edit';
  customer?: CustomerRow;
  open: boolean;
  onClose: () => void;
}

export function CustomerFormDialog({ mode, customer, open, onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: audiences = [] } = useAudiences();
  const { data: documents = [] } = useDocuments();
  const { data: documentTypes = [] } = useDocumentTypes();
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();

  const [externalRef, setExternalRef] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [contactEmails, setContactEmails] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  // #29 signed-contract onboarding: one signing date + the covered document types.
  const [signingDate, setSigningDate] = useState('');
  const [signedReference, setSignedReference] = useState('');
  const [signedTypes, setSignedTypes] = useState<string[]>([]);
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
    setSigningDate('');
    setSignedReference('');
    setSignedTypes([]);
    setFieldError(null);
  }, [open, customer]);

  const documentTypeName = (key: string): string => documentTypes.find((dt) => dt.key === key)?.name ?? key;

  // Document types the customer's chosen roles cover — the contract can mark any of these as
  // signed. The version effective at the signing date is resolved server-side, so a type is
  // offered whenever a matching document exists (regardless of its current version).
  const availableTypes = useMemo(() => {
    const keys = new Set<string>();
    for (const doc of documents) {
      if (roles.includes(doc.audience)) keys.add(doc.type);
    }
    return [...keys].sort().map((key) => ({ key, name: documentTypeName(key) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, roles, documentTypes]);

  const toggleRole = (key: string) => {
    setRoles((current) => (current.includes(key) ? current.filter((role) => role !== key) : [...current, key]));
  };

  const toggleType = (key: string) => {
    setSignedTypes((current) => (current.includes(key) ? current.filter((type) => type !== key) : [...current, key]));
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

  // Only offer types that are still available for the current roles.
  const effectiveSignedTypes = signedTypes.filter((type) => availableTypes.some((available) => available.key === type));

  const buildSignedDocuments = () => {
    if (effectiveSignedTypes.length === 0) return undefined;
    return {
      effectiveDate: new Date(signingDate).toISOString(),
      documentTypes: effectiveSignedTypes,
      reference: signedReference.trim() || undefined,
    };
  };

  const isPending = createCustomer.isPending || updateCustomer.isPending;

  const handleClose = () => {
    if (isPending) return;
    onClose();
  };

  const handleSubmit = () => {
    setFieldError(null);
    // Fold a not-yet-added typed email into the list on submit.
    const emails = emailInput.trim() ? Array.from(new Set([...contactEmails, emailInput.trim()])) : contactEmails;

    if (mode === 'create') {
      if (!externalRef.trim()) return setFieldError(t('customers.validationExternalRef'));
      // A signing date is required as soon as any document type is marked as signed.
      if (effectiveSignedTypes.length > 0 && !signingDate) {
        return setFieldError(t('customers.validationSigningDate'));
      }
      createCustomer.mutate(
        {
          externalRef: externalRef.trim(),
          firstName: firstName.trim() || undefined,
          lastName: lastName.trim() || undefined,
          companyName: companyName.trim() || undefined,
          roles,
          contactEmails: emails,
          signedDocuments: buildSignedDocuments(),
        },
        {
          onSuccess: () => {
            toast.success(t('customers.created'));
            onClose();
          },
          onError: (err) => toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('customers.saveFailed')),
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
        onError: (err) => toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('customers.saveFailed')),
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
                  control={<Checkbox checked={roles.includes(audience.key)} onChange={() => toggleRole(audience.key)} />}
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
                {t('customers.signedTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('customers.signedHint')}
              </Typography>
              {roles.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('customers.signedChooseRoles')}
                </Typography>
              ) : availableTypes.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('customers.signedNone')}
                </Typography>
              ) : (
                <Stack spacing={1.5}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <TextField
                      label={t('customers.signingDate')}
                      type="date"
                      value={signingDate}
                      onChange={(event) => setSigningDate(event.target.value)}
                      InputLabelProps={{ shrink: true }}
                      required={effectiveSignedTypes.length > 0}
                    />
                    <TextField
                      label={t('customers.acceptedReference')}
                      value={signedReference}
                      onChange={(event) => setSignedReference(event.target.value)}
                      fullWidth
                    />
                  </Stack>
                  <FormGroup>
                    {availableTypes.map((type) => (
                      <FormControlLabel
                        key={type.key}
                        control={
                          <Checkbox checked={signedTypes.includes(type.key)} onChange={() => toggleType(type.key)} />
                        }
                        label={type.name}
                      />
                    ))}
                  </FormGroup>
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
