import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { ApiError, errorMessageKey } from '../api/errors';
import {
  useAudiences,
  useDeleteVersion,
  useDocumentTypes,
  useDocuments,
  useVersions,
} from '../api/hooks';
import type { AgreementDocument, Version } from '../api/hooks';
import { NewDocumentDialog } from '../components/NewDocumentDialog';
import { NewVersionDialog } from '../components/NewVersionDialog';
import { PublishDialog } from '../components/PublishDialog';
import { useTranslation } from '../i18n';
import { copyTextToClipboard } from '../lib/clipboard';
import { Button, Card, PageHeader, useToast } from '../ui';

/**
 * Documents & versions: list of documents with their current version, the
 * version history per document, "New document", "New version", delete draft and
 * publish. Document types and audiences are dynamic categories.
 */
export function DocumentsPage() {
  const { t } = useTranslation();
  const { data: documents, isLoading, isError, error } = useDocuments();
  const { data: documentTypes = [] } = useDocumentTypes();
  const { data: audiences = [] } = useAudiences();
  const [newDocOpen, setNewDocOpen] = useState(false);

  const typeName = useMemo(() => {
    const map = new Map(documentTypes.map((item) => [item.key, item.name]));
    return (key: string) => map.get(key) ?? key;
  }, [documentTypes]);
  const audienceName = useMemo(() => {
    const map = new Map(audiences.map((item) => [item.key, item.name]));
    return (key: string) => map.get(key) ?? key;
  }, [audiences]);

  return (
    <Box>
      <PageHeader
        title={t('documents.title')}
        subtitle={t('documents.subtitle')}
        actions={<Button onClick={() => setNewDocOpen(true)}>{t('documents.newDocument')}</Button>}
      />
      {isError && (
        <Typography color="error">
          {error instanceof ApiError ? t(errorMessageKey(error)) : t('documents.loadError')}
        </Typography>
      )}
      {isLoading && <Typography color="text.secondary">{t('documents.loading')}</Typography>}
      {!isLoading && (documents?.length ?? 0) === 0 && (
        <Typography color="text.secondary">{t('documents.empty')}</Typography>
      )}
      <Stack spacing={2}>
        {(documents ?? []).map((doc) => (
          <DocumentCard
            key={doc.id}
            document={doc}
            typeLabel={typeName(doc.type)}
            audienceLabel={audienceName(doc.audience)}
          />
        ))}
      </Stack>
      <NewDocumentDialog open={newDocOpen} onClose={() => setNewDocOpen(false)} />
    </Box>
  );
}

function DocumentCard({
  document,
  typeLabel,
  audienceLabel,
}: {
  document: AgreementDocument;
  typeLabel: string;
  audienceLabel: string;
}) {
  const { t, language } = useTranslation();
  const toast = useToast();
  const [newOpen, setNewOpen] = useState(false);

  // Stable public URL that always serves the latest effective PDF — meant to be pasted into
  // offers; present only when the backend has both a published version and PUBLIC_BASE_URL.
  const handleCopyPdfLink = async () => {
    if (!document.latestPdfUrl) return;
    const copied = await copyTextToClipboard(document.latestPdfUrl, t('documents.copyPdfLinkPrompt'));
    toast.success(t(copied ? 'documents.pdfLinkCopied' : 'documents.pdfLinkCopiedManual'));
  };

  return (
    <>
      <Card
        title={
          <Box>
            <Typography variant="h5" component="h2">
              {document.name}
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
              <Chip size="small" label={typeLabel} />
              <Chip size="small" label={audienceLabel} variant="outlined" />
              {document.currentVersion && (
                <Chip
                  size="small"
                  color="success"
                  label={t('documents.current', {
                    label: document.currentVersion.versionLabel ?? document.currentVersion.id,
                  })}
                />
              )}
              {document.upcomingVersions.map((upcoming) => (
                <Chip
                  key={upcoming.id}
                  size="small"
                  color="info"
                  label={t('documents.upcoming', {
                    label: upcoming.versionLabel ?? upcoming.id,
                    date: upcoming.validFrom
                      ? new Date(upcoming.validFrom).toLocaleDateString(language)
                      : '',
                  })}
                />
              ))}
            </Stack>
          </Box>
        }
        action={
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            {document.latestPdfUrl && (
              <Button
                variant="text"
                startIcon={<ContentCopyIcon />}
                onClick={() => void handleCopyPdfLink()}
                aria-label={t('documents.copyPdfLink')}
              >
                {t('documents.copyPdfLink')}
              </Button>
            )}
            <Button onClick={() => setNewOpen(true)}>{t('documents.newVersion')}</Button>
          </Stack>
        }
        disableContentPadding
      >
        <VersionHistory document={document} />
      </Card>
      <NewVersionDialog document={document} open={newOpen} onClose={() => setNewOpen(false)} />
    </>
  );
}

function VersionHistory({ document }: { document: AgreementDocument }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { data: versions, isLoading } = useVersions(document.id, expanded);

  return (
    <Accordion
      expanded={expanded}
      onChange={(_event, value) => setExpanded(value)}
      disableGutters
      elevation={0}
      sx={{ '&:before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="body1">{t('documents.versionHistory')}</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        {isLoading ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            {t('documents.loadingVersions')}
          </Typography>
        ) : (versions?.length ?? 0) === 0 ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            {t('documents.noVersions')}
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('documents.columnVersion')}</TableCell>
                <TableCell>{t('documents.columnStatus')}</TableCell>
                <TableCell>{t('documents.columnMode')}</TableCell>
                <TableCell>{t('documents.columnValidFrom')}</TableCell>
                <TableCell>{t('documents.columnPdf')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {versions?.map((version) => (
                <VersionRow key={version.id} documentId={document.id} version={version} />
              ))}
            </TableBody>
          </Table>
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

const STATUS_COLOR: Record<Version['status'], 'default' | 'success' | 'warning'> = {
  DRAFT: 'warning',
  PUBLISHED: 'success',
  RETIRED: 'default',
};

function VersionRow({ documentId, version }: { documentId: string; version: Version }) {
  const { t } = useTranslation();
  const toast = useToast();
  const deleteVersion = useDeleteVersion(documentId);
  const [publishOpen, setPublishOpen] = useState(false);

  const handleDelete = () => {
    deleteVersion.mutate(version.id, {
      onSuccess: () => toast.success(t('documents.draftDeleted')),
      onError: (err) =>
        toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('documents.deleteFailed')),
    });
  };

  return (
    <TableRow>
      <TableCell>{version.versionLabel ?? version.id}</TableCell>
      <TableCell>
        <Chip size="small" color={STATUS_COLOR[version.status]} label={version.status} />
      </TableCell>
      <TableCell>{version.acceptanceMode ?? t('common.none')}</TableCell>
      <TableCell>{version.validFrom ?? t('common.none')}</TableCell>
      <TableCell>
        {version.pdfUrl ? (
          <Link href={version.pdfUrl} target="_blank" rel="noreferrer">
            {version.fileName ?? t('common.download')}
          </Link>
        ) : (
          t('common.none')
        )}
      </TableCell>
      <TableCell align="right">
        {version.status === 'DRAFT' && (
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button size="small" onClick={() => setPublishOpen(true)}>
              {t('documents.publish')}
            </Button>
            <Button
              size="small"
              variant="text"
              color="error"
              onClick={handleDelete}
              loading={deleteVersion.isPending}
            >
              {t('common.delete')}
            </Button>
          </Stack>
        )}
      </TableCell>
      <PublishDialog
        documentId={documentId}
        version={version}
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
      />
    </TableRow>
  );
}
