import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { ApiError, errorMessageKey } from '../api/errors';
import { useCustomerHistory, useRemind } from '../api/hooks';
import type { Acceptance, HistoryState } from '../api/hooks';
import { ManualAcceptanceDialog } from '../components/ManualAcceptanceDialog';
import { StateActionDialog } from '../components/StateActionDialog';
import { useTranslation } from '../i18n';
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
  const [manualOpen, setManualOpen] = useState(false);

  return (
    <Box>
      <Button
        component={RouterLink}
        to="/"
        variant="text"
        color="inherit"
        startIcon={<ArrowBackIcon />}
        sx={{ mb: 1 }}
      >
        {t('customerDetail.backToOverview')}
      </Button>
      <PageHeader
        title={`${t('overview.customer')} ${id}`}
        subtitle={t('customerDetail.customerId', { id })}
        actions={<Button onClick={() => setManualOpen(true)}>{t('manualAcceptance.trigger')}</Button>}
      />

      {isError && (
        <Typography color="error">
          {error instanceof ApiError ? t(errorMessageKey(error)) : t('customerDetail.loadError')}
        </Typography>
      )}
      {isLoading && <Typography color="text.secondary">{t('customerDetail.loading')}</Typography>}

      {data && (
        <Stack spacing={3}>
          <OpenStatesSection customerId={id} states={data.states} />

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
    </Box>
  );
}

function OpenStatesSection({ customerId, states }: { customerId: string; states: HistoryState[] }) {
  const { t, language } = useTranslation();
  const toast = useToast();
  const remind = useRemind(customerId);
  const [action, setAction] = useState<{ state: HistoryState; mode: 'extend' | 'unblock' } | null>(
    null,
  );

  if (states.length === 0) return null;

  const handleRemind = (stateId: string) => {
    remind.mutate(stateId, {
      onSuccess: () => toast.success(t('customerDetail.reminderSent')),
      onError: (err) =>
        toast.error(
          err instanceof ApiError ? t(errorMessageKey(err)) : t('customerDetail.reminderFailed'),
        ),
    });
  };

  return (
    <Card title={t('customerDetail.openStates')}>
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
