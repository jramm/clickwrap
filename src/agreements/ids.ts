import { randomUUID } from 'node:crypto';

/** Prefixed technical IDs (doc-…, v-…, cvs-…, a-…, audit-…) for new aggregates. */
export const newId = (prefix: string): string => `${prefix}-${randomUUID()}`;
