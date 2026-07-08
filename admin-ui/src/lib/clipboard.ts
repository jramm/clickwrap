/**
 * Clipboard helper: navigator.clipboard first (requires a secure context), window.prompt as the
 * manual fallback so the value is never lost. Returns true when the text was copied
 * programmatically, false when the user has to copy it from the prompt.
 */
export async function copyTextToClipboard(text: string, manualPromptMessage: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // e.g. permission denied / insecure context — fall through to the manual prompt.
    }
  }
  window.prompt(manualPromptMessage, text);
  return false;
}
