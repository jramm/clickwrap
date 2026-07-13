import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import GroupIcon from '@mui/icons-material/Group';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useState, type ReactNode } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { ApiError, errorMessageKey } from '../api/errors';
import { useDocuments, useVersion } from '../api/hooks';
import type { Version } from '../api/hooks';
import { PublishDialog } from '../components/PublishDialog';
import { useTranslation } from '../i18n';
import { Button, Card, PageHeader } from '../ui';

/**
 * Version detail (`/versions/:id`) — everything entered when the version was created: label,
 * acceptance mode, change summary, consent text (ACTIVE) or objection period/consequence (PASSIVE),
 * deadlines, validity, the PDF and the content hash. A button leads to the per-version customer
 * rollout (`/versions/:id/customers`). Reached by clicking a version in Documents.
 */
const STATUS_COLOR: Record<Version['status'], 'default' | 'success' | 'warning'> = {
  DRAFT: 'warning',
  PUBLISHED: 'success',
  RETIRED: 'default',
};

function fmtDate(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale);
}

function fmtDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '220px 1fr' },
        gap: { xs: 0.25, sm: 2 },
        py: 1.25,
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 'none' },
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ minWidth: 0 }}>
        {typeof children === 'string' ? <Typography variant="body2">{children}</Typography> : children}
      </Box>
    </Box>
  );
}

export function VersionDetailPage() {
  const { t, language } = useTranslation();
  const { id = '' } = useParams();
  const locale = language === 'de' ? 'de-DE' : 'en-GB';

  const { data: version, isLoading, isError, error } = useVersion(id);
  const { data: documents } = useDocuments();
  const document = documents?.find((entry) => entry.id === version?.documentId);
  const [publishOpen, setPublishOpen] = useState(false);

  const back = (
    <Button component={RouterLink} to="/documents" variant="text" color="inherit" startIcon={<ArrowBackIcon />} sx={{ mb: 1 }}>
      {t('versionDetail.back')}
    </Button>
  );

  if (isLoading) {
    return (
      <Box>
        {back}
        <LinearProgress />
      </Box>
    );
  }

  if (isError || !version) {
    return (
      <Box>
        {back}
        <Card>
          <Typography color="error">
            {error instanceof ApiError ? t(errorMessageKey(error)) : t('versionDetail.loadError')}
          </Typography>
        </Card>
      </Box>
    );
  }

  const isActive = version.acceptanceMode === 'ACTIVE';
  const isPassive = version.acceptanceMode === 'PASSIVE';

  return (
    <Box>
      {back}
      <PageHeader
        title={version.versionLabel || t('versionDetail.title')}
        subtitle={document ? `${document.name} · ${document.type} · ${document.audience}` : undefined}
        actions={
          version.status === 'DRAFT' ? (
            <Button onClick={() => setPublishOpen(true)}>{t('documents.publish')}</Button>
          ) : (
            <Button
              component={RouterLink}
              to={`/versions/${encodeURIComponent(version.id)}/customers`}
              startIcon={<GroupIcon />}
            >
              {t('versionDetail.customerRollout')}
            </Button>
          )
        }
      />

      {version.status === 'DRAFT' && (
        <PublishDialog
          documentId={version.documentId}
          version={version}
          open={publishOpen}
          onClose={() => setPublishOpen(false)}
        />
      )}

      <Stack spacing={3}>
        <Card title={t('versionDetail.overview')}>
          <Field label={t('versionDetail.status')}>
            <Chip size="small" color={STATUS_COLOR[version.status]} label={version.status} />
          </Field>
          <Field label={t('versionDetail.mode')}>{version.acceptanceMode}</Field>
          <Field label={t('versionDetail.validFrom')}>{fmtDate(version.validFrom, locale)}</Field>
          {version.status === 'PUBLISHED' && (
            <Field label={t('versionDetail.publishedAt')}>{fmtDateTime(version.publishedAt, locale)}</Field>
          )}
        </Card>

        <Card title={t('versionDetail.details')}>
          <Field label={t('versionDetail.changeSummary')}>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
              {version.changeSummary || '—'}
            </Typography>
          </Field>

          {isActive && (
            <>
              <Field label={t('versionDetail.consentText')}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                  {version.consentText || '—'}
                </Typography>
              </Field>
              <Field label={t('versionDetail.hardDeadline')}>{fmtDate(version.hardDeadlineAt, locale)}</Field>
            </>
          )}

          {isPassive && (
            <>
              <Field label={t('versionDetail.objectionPeriodDays')}>
                {version.objectionPeriodDays != null ? String(version.objectionPeriodDays) : '—'}
              </Field>
              <Field label={t('versionDetail.objectionConsequence')}>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                  {version.objectionConsequence || '—'}
                </Typography>
              </Field>
            </>
          )}

          {version.gracePeriodDays != null && (
            <Field label={t('versionDetail.gracePeriodDays')}>{String(version.gracePeriodDays)}</Field>
          )}

          <Field label={t('versionDetail.document')}>
            <Link component={RouterLink} to="/documents">
              {document ? `${document.name} (${document.type})` : version.documentId}
            </Link>
          </Field>

          <Field label={t('versionDetail.fileName')}>
            {version.pdfUrl ? (
              <Link href={version.pdfUrl} target="_blank" rel="noreferrer">
                {version.fileName || t('common.download')}
              </Link>
            ) : (
              (version.fileName ?? '—')
            )}
          </Field>

          <Field label={t('versionDetail.contentHash')}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {version.contentHash || '—'}
            </Typography>
          </Field>

          <Field label={t('versionDetail.versionId')}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {version.id}
            </Typography>
          </Field>
        </Card>
      </Stack>
    </Box>
  );
}
