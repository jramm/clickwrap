import type { AdminAuthRequest } from '../../../plugin-sdk/index.js';

/** Extracts the `Authorization: Bearer <token>` credential, if present. */
export const extractBearer = (req: AdminAuthRequest): string | undefined => {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : undefined;
};
