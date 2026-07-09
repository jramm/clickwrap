import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { ApiError, errorMessageKey } from '../api/errors';
import {
  useCreateAcceptanceLink,
  useCustomer,
  useCustomerHistory,
  useDocumentTypes,
  useEvents,
  useRemind,
  useSignedDocuments,
} from '../api/hooks';
import type { Acceptance, Event, HistoryState, SignedDocument } from '../api/hooks';
import { CustomerFormDialog } from '../components/CustomerFormDialog';
import { ManualAcceptanceDialog } from '../components/ManualAcceptanceDialog';
import { SignedDocumentUploadDialog } from '../components/SignedDocumentUploadDialog';
import { StateActionDialog } from '../components/StateActionDialog';
import { useTranslation } from '../i18n';
import { customerDisplayName } from '../lib/customerDisplayName';
import { copyTextToClipboard } from '../lib/clipboard';
import { documentLabel } from '../lib/eventDocumentLabel';
import { Button, Card, PageHeader, StatusChip, useToast } from '../ui';

/**
 * Customer detail: complete history (acceptances incl. evidence, objections,
 * notifications) and operational actions (extend deadline / suspend block /
 * reminder / manual acceptance).
 */
function fmt(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

export function CustomerDetailPage() {
  const { t, language } = useTranslation();
  const { id = '' } = useParams();
  const { data, isLoading, isError, error } = useCustomerHistory(id);
  const { data: customer } = useCustomer(id);
  const toast = useToast();
  const [manualOpen, setManualOpen] = useState(false);
  const [signedUploadOpen, setSignedUploadOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const displayName = customer ? customerDisplayName(customer) : '';
  const headerTitle = displayName || `${t('customerDetail.customer')} ${id}`;

  const handleCopyId = async () => {
    const copied = await copyTextToClipboard(id, t('customerDetail.copyIdPrompt'));
    toast.success(t(copied ? 'customerDetail.idCopied' : 'customerDetail.idCopiedManual'));
  };

  return (
    <Box>
      <Button
        component={RouterLink}
        to="/customers"
        variant="text"
        color="inherit"
        startIcon={<ArrowBackIcon />}
        sx={{ mb: 1 }}
      >
        {t('customerDetail.backToCustomers')}
      </Button>
      <PageHeader
        title={headerTitle}
        actions={
          <>
            {customer && (
              <Button variant="outlined" onClick={() => setEditOpen(true)}>
                {t('customers.editCustomer')}
              </Button>
            )}
            <Button onClick={() => setManualOpen(true)}>{t('manualAcceptance.trigger')}</Button>
          </>
        }
      />
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 0.5, sm: 2 }}
        alignItems={{ sm: 'center' }}
        sx={{ mt: -2, mb: 3, flexWrap: 'wrap', rowGap: 0.5 }}
      >
        {customer?.externalRef && (
          <Typography variant="body2" color="text.secondary">
            {t('customerDetail.externalRef', { ref: customer.externalRef })}
          </Typography>
        )}
        {customer?.roles?.length ? (
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            {customer.roles.map((role) => (
              <Chip key={role} size="small" variant="outlined" label={role} />
            ))}
          </Stack>
        ) : null}
        <Typography
          variant="caption"
          color="text.secondary"
          onClick={() => void handleCopyId()}
          title={t('customerDetail.copyId')}
          sx={{ cursor: 'pointer', fontFamily: 'monospace', opacity: 0.7 }}
        >
          {t('customerDetail.customerId', { id })}
        </Typography>
      </Stack>

      {isError && (
        <Typography color="error">
          {error instanceof ApiError ? t(errorMessageKey(error)) : t('customerDetail.loadError')}
        </Typography>
      )}
      {isLoading && <Typography color="text.secondary">{t('customerDetail.loading')}</Typography>}

      {data && (
        <Stack spacing={3}>
          <OpenStatesSection customerId={id} states={data.states} />

          <CustomerEventsSection customerId={id} />

          <SignedDocumentsSection customerId={id} onUpload={() => setSignedUploadOpen(true)} />


          <Card title={t('customerDetail.acceptances')} disableContentPadding>
            {data.acceptances.length === 0 ? (
              <Typography sx={{ p: 3 }} color="text.secondary">
                {t('customerDetail.noAcceptances')}
              </Typography>
            ) : (
              data.acceptances.map((acceptance, index) => (
                <AcceptanceItem key={`${acceptance.versionId}-${index}`} acceptance={acceptance} />
              ))
            )}
          </Card>

          <Card title={t('customerDetail.objections')}>
            {data.objections.length === 0 ? (
              <Typography color="text.secondary">{t('customerDetail.noObjections')}</Typography>
            ) : (
              <Stack spacing={1.5}>
                {data.objections.map((objection, index) => (
                  <Box key={`${objection.versionId}-${index}`}>
                    <Typography variant="body1">
                      {objection.versionId} — {fmt(objection.objectedAt, language)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {objection.reason ?? t('common.none')}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Card>

          <Card title={t('customerDetail.notifications')}>
            {data.notifications.length === 0 ? (
              <Typography color="text.secondary">{t('customerDetail.noNotifications')}</Typography>
            ) : (
              <Stack spacing={1}>
                {data.notifications.map((notification, index) => (
                  <Stack
                    key={`${notification.versionId}-${index}`}
                    direction="row"
                    spacing={2}
                    alignItems="center"
                  >
                    <Chip size="small" label={notification.channel} />
                    <Typography variant="body2">{notification.versionId}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('customerDetail.delivered', { date: fmt(notification.deliveredAt, language) })}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Card>
        </Stack>
      )}

      <ManualAcceptanceDialog
        customerId={id}
        open={manualOpen}
        onClose={() => setManualOpen(false)}
      />
      <SignedDocumentUploadDialog
        customerId={id}
        open={signedUploadOpen}
        onClose={() => setSignedUploadOpen(false)}
      />
      {customer && (
        <CustomerFormDialog
          mode="edit"
          customer={customer}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}
    </Box>
  );
}

/** Recent events for this customer (first page of GET /admin/events?customerId=), newest first. */
function CustomerEventsSection({ customerId }: { customerId: string }) {
  const { t, language } = useTranslation();
  const { data } = useEvents(1, { customerId });
  const { data: documentTypes = [] } = useDocumentTypes();
  const events = data?.items ?? [];

  const documentTypeName = useMemo(() => {
    const map = new Map(documentTypes.map((d) => [d.key, d.name]));
    return (key: string) => map.get(key) ?? key;
  }, [documentTypes]);

  return (
    <Card
      title={t('events.sectionTitle')}
      action={
        <Button
          size="small"
          variant="outlined"
          component={RouterLink}
          to={`/events?customerId=${customerId}`}
        >
          {t('events.viewAll')}
        </Button>
      }
    >
      {events.length === 0 ? (
        <Typography color="text.secondary">{t('events.empty')}</Typography>
      ) : (
        <Stack spacing={1} divider={<Divider flexItem />} data-testid="customer-events-section">
          {events.map((event: Event) => (
            <Stack key={event.id} direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
              <Chip size="small" label={t(`events.category.${event.category}`)} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t(`events.eventType.${event.type}`)}
              </Typography>
              {documentLabel(event, documentTypeName) && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={documentLabel(event, documentTypeName)}
                />
              )}
              <Typography variant="body2" color="text.secondary">
                {fmt(event.occurredAt, language)}
              </Typography>
              <Typography variant="body2" sx={{ flexBasis: '100%' }}>
                {event.summary}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </Card>
  );
}

function SignedDocumentsSection({ customerId, onUpload }: { customerId: string; onUpload: () => void }) {
  const { t, language } = useTranslation();
  const { data: documents = [] } = useSignedDocuments(customerId);

  return (
    <Card
      title={t('customerDetail.signedDocuments')}
      action={
        <Button size="small" variant="outlined" onClick={onUpload}>
          {t('customerDetail.uploadSignedDocument')}
        </Button>
      }
    >
      {documents.length === 0 ? (
        <Typography color="text.secondary">{t('customerDetail.noSignedDocuments')}</Typography>
      ) : (
        <Stack spacing={1.5} divider={<Divider />}>
          {documents.map((document: SignedDocument) => (
            <Stack
              key={document.id}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 0.5, sm: 2 }}
              justifyContent="space-between"
              alignItems={{ sm: 'center' }}
            >
              <Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                  <Chip size="small" label={document.documentTypeKey} />
                  <Typography variant="body1">{document.fileName}</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {t('customerDetail.signedAt')}: {fmt(document.signedAt, language)}
                  {document.signerName ? ` · ${t('customerDetail.signer')}: ${document.signerName}` : ''}
                  {document.reference ? ` · ${t('customerDetail.reference')}: ${document.reference}` : ''}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('customerDetail.uploadedBy')}: {document.uploadedBy} · {fmt(document.uploadedAt, language)}
                </Typography>
              </Box>
              <Link href={document.pdfUrl} target="_blank" rel="noopener noreferrer" variant="body2">
                {t('common.download')}
              </Link>
            </Stack>
          ))}
        </Stack>
      )}
    </Card>
  );
}

function OpenStatesSection({ customerId, states }: { customerId: string; states: HistoryState[] }) {
  const { t, language } = useTranslation();
  const toast = useToast();
  const remind = useRemind(customerId);
  const createAcceptanceLink = useCreateAcceptanceLink();
  const [action, setAction] = useState<{ state: HistoryState; mode: 'extend' | 'unblock' } | null>(
    null,
  );

  const handleRemind = (stateId: string) => {
    remind.mutate(stateId, {
      onSuccess: () => toast.success(t('customerDetail.reminderSent')),
      onError: (err) =>
        toast.error(
          err instanceof ApiError ? t(errorMessageKey(err)) : t('customerDetail.reminderFailed'),
        ),
    });
  };

  // "Copy acceptance link": mints the customer's permanent, whole-account acceptance link (covering
  // ALL of their outstanding agreements — not per document) and puts the URL on the clipboard, with
  // a window.prompt fallback. The success toast shows the expiry so the admin knows how long it works.
  const handleCopyAcceptanceLink = async () => {
    try {
      const link = await createAcceptanceLink.mutateAsync({ customerId });
      const copied = await copyTextToClipboard(link.url, t('customerDetail.copyLinkPrompt'));
      const expires = new Date(link.expiresAt).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB');
      toast.success(t(copied ? 'customerDetail.copyLinkSuccess' : 'customerDetail.copyLinkManual', { expires }));
    } catch (err) {
      // The PUBLIC_BASE_URL hint from the backend is actionable — surface it verbatim.
      if (err instanceof ApiError && err.message.includes('PUBLIC_BASE_URL')) {
        toast.error(err.message);
      } else {
        toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('customerDetail.copyLinkFailed'));
      }
    }
  };

  const copyLinkAction = (
    <Button
      size="small"
      variant="outlined"
      startIcon={<ContentCopyIcon fontSize="small" />}
      onClick={() => void handleCopyAcceptanceLink()}
      loading={createAcceptanceLink.isPending}
    >
      {t('customerDetail.copyLink')}
    </Button>
  );

  return (
    <Card title={t('customerDetail.agreements')} action={copyLinkAction}>
      {states.length === 0 ? (
        <Typography color="text.secondary">{t('customerDetail.noAgreements')}</Typography>
      ) : (
      <Stack spacing={2} divider={<Divider />}>
        {states.map((state) => (
          <Stack
            key={state.id}
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            justifyContent="space-between"
            alignItems={{ md: 'center' }}
          >
            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                {state.state && <StatusChip state={state.state} />}
                <Typography variant="body1">
                  {[state.documentType, state.versionLabel ?? state.versionId]
                    .filter(Boolean)
                    .join(' · ')}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {t('customerDetail.deadline', { date: fmt(state.deadlineAt, language) })}
                {state.carryOverBlocking ? ` · ${t('customerDetail.blocking')}` : ''}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button
                size="small"
                variant="outlined"
                onClick={() => setAction({ state, mode: 'extend' })}
              >
                {t('customerDetail.extendDeadline')}
              </Button>
              {state.carryOverBlocking && (
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  onClick={() => setAction({ state, mode: 'unblock' })}
                >
                  {t('customerDetail.suspendBlock')}
                </Button>
              )}
              <Button
                size="small"
                variant="text"
                onClick={() => handleRemind(state.id)}
                loading={remind.isPending}
              >
                {t('customerDetail.sendReminder')}
              </Button>
            </Stack>
          </Stack>
        ))}
      </Stack>
      )}
      {action && (
        <StateActionDialog
          customerId={customerId}
          state={action.state}
          mode={action.mode}
          open
          onClose={() => setAction(null)}
        />
      )}
    </Card>
  );
}

function AcceptanceItem({ acceptance }: { acceptance: Acceptance }) {
  const { t, language } = useTranslation();
  const { evidence } = acceptance;
  return (
    <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
          <Chip size="small" label={acceptance.documentType} />
          <Typography variant="body1" sx={{ flexGrow: 1 }}>
            {acceptance.versionLabel}
          </Typography>
          <Chip size="small" variant="outlined" label={acceptance.method} />
          <Typography variant="body2" color="text.secondary">
            {fmt(acceptance.acceptedAt, language)}
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={0.5}>
          <Typography variant="body2">
            <strong>{t('customerDetail.actor')}:</strong> {acceptance.actor?.name ?? t('common.none')}{' '}
            {acceptance.actor?.email ? `(${acceptance.actor.email})` : ''}
          </Typography>
          <Typography variant="body2">
            <strong>{t('customerDetail.channel')}:</strong> {acceptance.channel ?? t('common.none')}
          </Typography>
          {evidence && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {t('customerDetail.evidence')}
              </Typography>
              <Typography variant="body2">
                {t('customerDetail.ip')}: {evidence.ipAddress ?? t('common.none')}
              </Typography>
              <Typography variant="body2">
                {t('customerDetail.userAgent')}: {evidence.userAgent ?? t('common.none')}
              </Typography>
              <Typography variant="body2">
                {t('customerDetail.consentText')}: {evidence.consentText ?? t('common.none')}
              </Typography>
              {evidence.evidenceNote && (
                <Typography variant="body2">
                  {t('customerDetail.evidenceNote')}: {evidence.evidenceNote}
                </Typography>
              )}
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                consentTextHash: {evidence.consentTextHash ?? t('common.none')}
              </Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                contentHash: {evidence.contentHash ?? t('common.none')}
              </Typography>
            </>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
