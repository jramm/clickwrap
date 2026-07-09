import type { Event } from '../api/hooks';

/**
 * "Document type · version" label for an event. `nameOf` resolves the document-type key to its
 * human-readable name (falls back to the key); pass it so legal staff see "Terms of Service"
 * rather than the raw "terms" slug. Returns '' when the event has no document/version (e.g. a
 * customer-created or config event), so callers can conditionally render it.
 */
export function documentLabel(event: Event, nameOf?: (key: string) => string): string {
  const typeLabel = event.documentType ? (nameOf?.(event.documentType) ?? event.documentType) : undefined;
  const parts = [typeLabel, event.versionLabel].filter((value): value is string => Boolean(value));
  return parts.join(' · ');
}
