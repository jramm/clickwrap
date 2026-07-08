/**
 * Stable public document URLs — `${PUBLIC_BASE_URL}/documents/<type>/<audience>/latest.pdf`
 * always redirects to the CURRENTLY EFFECTIVE published PDF of that document. The path is
 * deterministic from the document's keys, so a rendered link (e.g. in an offer) stays valid
 * across every future publish. Shared by the public redirect endpoint
 * (src/compliance/public-documents.controller.ts) and the admin documents list
 * (`latestPdfUrl`, src/agreements/document.service.ts).
 */

/** Stable, deterministic path for the latest-PDF redirect of a (type, audience) document. */
export const latestPdfPath = (typeKey: string, audienceKey: string): string =>
  `/documents/${encodeURIComponent(typeKey)}/${encodeURIComponent(audienceKey)}/latest.pdf`;

/** Normalized PUBLIC_BASE_URL (trailing slashes stripped); undefined when unset/blank. */
export const publicBaseUrl = (): string | undefined => {
  const raw = (process.env.PUBLIC_BASE_URL ?? '').trim();
  return raw === '' ? undefined : raw.replace(/\/+$/, '');
};
