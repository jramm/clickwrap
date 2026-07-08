import { timingSafeEqual } from 'node:crypto';
import type { AdminAuthRequest, AdminAuthStrategy, AdminIdentity, LoginMethodDescriptor } from '../../../plugin-sdk';

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/**
 * Built-in `static-token` admin-auth strategy: `x-admin-token` compared in constant time against
 * ADMIN_API_TOKEN (dev/CI fallback — see README); optional `x-admin-user` names the actor.
 * Unset ADMIN_API_TOKEN disables the strategy (always null).
 */
export class StaticTokenAdminAuthStrategy implements AdminAuthStrategy {
  async authenticate(req: AdminAuthRequest): Promise<AdminIdentity | null> {
    const expected = process.env.ADMIN_API_TOKEN ?? '';
    const token = String(req.headers['x-admin-token'] ?? '');
    if (!expected || !token || !safeEqual(token, expected)) return null;
    return { userId: String(req.headers['x-admin-user'] ?? 'admin') };
  }

  /** Advertised only while the token fallback is actually enabled. */
  describeLoginMethod(): LoginMethodDescriptor | null {
    if (!(process.env.ADMIN_API_TOKEN ?? '')) return null;
    return { key: 'static-token', flow: 'token', label: 'Admin API token', params: {} };
  }
}
