/**
 * Thin wrapper around the Unlayer drag-and-drop editor (react-email-editor). Exposes a small
 * imperative handle so the dialog can export the design JSON + HTML on save and load an existing
 * design on open. Our template placeholders are registered as Unlayer merge tags so authors insert
 * them from the editor UI.
 *
 * TRADE-OFF: the Unlayer editor iframe loads from Unlayer's CDN — the template EDITOR therefore
 * needs internet access and a third-party (free-tier) service. Sending/rendering does NOT: the
 * exported HTML is self-contained (see README / docs/INTEGRATION.md).
 */
import { forwardRef, useImperativeHandle, useRef } from 'react';
import EmailEditor, { type EditorRef } from 'react-email-editor';
import { PLACEHOLDER_VARIABLES } from '../lib/placeholders';

export interface UnlayerHandle {
  /** Exports the current design JSON (serialised) + HTML. */
  export(): Promise<{ design: string; html: string }>;
}

export interface UnlayerEditorProps {
  /** Serialised Unlayer design JSON to load initially (edit mode). */
  design?: string;
}

/** Unlayer merge-tags map for our placeholders: `{{name}}` inserted via the editor UI. */
const mergeTags = Object.fromEntries(
  PLACEHOLDER_VARIABLES.map((name) => [name, { name, value: `{{${name}}}` }]),
);

export const UnlayerEditor = forwardRef<UnlayerHandle, UnlayerEditorProps>(function UnlayerEditor(
  { design },
  ref,
) {
  const editorRef = useRef<EditorRef>(null);

  useImperativeHandle(ref, () => ({
    export: () =>
      new Promise((resolve) => {
        const unlayer = editorRef.current?.editor;
        if (!unlayer) {
          resolve({ design: design ?? '', html: '' });
          return;
        }
        unlayer.exportHtml((data: { design: unknown; html: string }) =>
          resolve({ design: JSON.stringify(data.design), html: data.html }),
        );
      }),
  }));

  const onReady = () => {
    const unlayer = editorRef.current?.editor;
    if (!unlayer) return;
    if (design) {
      try {
        unlayer.loadDesign(JSON.parse(design));
      } catch {
        // Ignore an unparsable design — the editor stays on a blank canvas.
      }
    }
  };

  return (
    <EmailEditor
      ref={editorRef}
      onReady={onReady}
      minHeight={480}
      options={{ mergeTags }}
    />
  );
});
