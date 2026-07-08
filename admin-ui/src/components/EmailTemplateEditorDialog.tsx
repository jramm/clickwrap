import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useRef, useState } from 'react';
import { ApiError, errorMessageKey } from '../api/errors';
import {
  useCreateEmailTemplate,
  usePreviewEmailTemplate,
  useUpdateEmailTemplate,
} from '../api/hooks';
import type { EmailTemplate, EmailTemplateKind } from '../api/hooks';
import { useTranslation } from '../i18n';
import { EMAIL_TEMPLATE_KINDS, kindLabelKey } from '../lib/emailTemplateKinds';
import { PLACEHOLDER_VARIABLES } from '../lib/placeholders';
import { Button, Dialog, Select, TextField, useToast } from '../ui';
import { UnlayerEditor, type UnlayerHandle } from './UnlayerEditor';

/**
 * Create/edit dialog for an e-mail template. The body is authored with the Unlayer editor
 * (design JSON + exported HTML persisted on save); the subject is plain text with a clickable
 * placeholder helper. A live preview renders the server-substituted HTML in a sandboxed iframe.
 */
export function EmailTemplateEditorDialog({
  open,
  onClose,
  template,
}: {
  open: boolean;
  onClose: () => void;
  template?: EmailTemplate;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = template !== undefined;

  const [name, setName] = useState(template?.name ?? '');
  const [kind, setKind] = useState<EmailTemplateKind>(template?.kind ?? 'VERSION_NOTIFICATION');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const editorRef = useRef<UnlayerHandle>(null);
  const create = useCreateEmailTemplate();
  const update = useUpdateEmailTemplate();
  const preview = usePreviewEmailTemplate();
  const saving = create.isPending || update.isPending;

  const insertPlaceholder = (variable: string) => setSubject((current) => `${current}{{${variable}}}`);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error(t('emailTemplates.validationName'));
      return;
    }
    const { design, html } = await editorRef.current!.export();
    const data = { name: name.trim(), kind, subject, design, html };
    const onError = (err: unknown) =>
      toast.error(err instanceof ApiError ? t(errorMessageKey(err)) : t('emailTemplates.saveFailed'));
    if (isEdit) {
      update.mutate(
        { id: template.id, data },
        { onSuccess: () => (toast.success(t('emailTemplates.saved')), onClose()), onError },
      );
    } else {
      create.mutate(
        { name: data.name, kind: data.kind, subject: data.subject, design: data.design, html: data.html },
        { onSuccess: () => (toast.success(t('emailTemplates.saved')), onClose()), onError },
      );
    }
  };

  const handlePreview = () => {
    if (!template) return;
    preview.mutate(
      { id: template.id },
      {
        onSuccess: (result) => setPreviewHtml(result.html),
        onError: () => toast.error(t('emailTemplates.previewFailed')),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      title={isEdit ? t('emailTemplates.editTitle') : t('emailTemplates.newTitle')}
      actions={
        <>
          <Button variant="text" color="inherit" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Stack spacing={2}>
        <TextField
          label={t('emailTemplates.name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Select
          label={t('emailTemplates.kind')}
          value={kind}
          onChange={(event) => setKind(event.target.value as EmailTemplateKind)}
          options={EMAIL_TEMPLATE_KINDS.map((value) => ({ value, label: t(kindLabelKey(value)) }))}
        />
        <TextField
          label={t('emailTemplates.subject')}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />

        <Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('emailTemplates.placeholderHelp')}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {PLACEHOLDER_VARIABLES.map((variable) => (
              <Chip
                key={variable}
                size="small"
                label={`{{${variable}}}`}
                onClick={() => insertPlaceholder(variable)}
                clickable
              />
            ))}
          </Stack>
        </Box>

        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
          <UnlayerEditor ref={editorRef} design={template?.design} />
        </Box>

        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="body1">{t('emailTemplates.preview')}</Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={handlePreview}
              loading={preview.isPending}
              disabled={!isEdit}
            >
              {t('emailTemplates.refreshPreview')}
            </Button>
          </Stack>
          {!isEdit && (
            <Typography variant="body2" color="text.secondary">
              {t('emailTemplates.previewAfterSave')}
            </Typography>
          )}
          {previewHtml !== null && (
            <iframe
              title={t('emailTemplates.preview')}
              srcDoc={previewHtml}
              sandbox=""
              style={{ width: '100%', height: 320, border: '1px solid #e0e0e0', borderRadius: 4 }}
            />
          )}
        </Box>
      </Stack>
    </Dialog>
  );
}
