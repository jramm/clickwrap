import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';
import { GoogleIdTokenClaims, GoogleTokenVerifier } from './google-token.verifier.js';
import { GoogleSsoAdminAuthStrategy } from './strategies/google-sso.strategy.js';
import { StaticTokenAdminAuthStrategy } from './strategies/static-token.strategy.js';

interface FakeReq {
  headers: Record<string, string | undefined>;
  adminActor?: { userId: string; name?: string };
}

const contextFor = (headers: Record<string, string | undefined>): { ctx: ExecutionContext; req: FakeReq } => {
  const req: FakeReq = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
};

/** Fake verifier — real Google calls must NEVER happen in tests. */
class FakeVerifier implements GoogleTokenVerifier {
  constructor(private readonly outcome: GoogleIdTokenClaims | Error) {}
  verify(idToken: string): Promise<GoogleIdTokenClaims> {
    expect(idToken).toBeTruthy();
    if (this.outcome instanceof Error) return Promise.reject(this.outcome);
    return Promise.resolve(this.outcome);
  }
}

const claims = (over: Partial<GoogleIdTokenClaims> = {}): GoogleIdTokenClaims => ({
  email: 'admin@acme.example',
  emailVerified: true,
  name: 'Ada Admin',
  ...over,
});

/** The default chain (ADMIN_AUTH=google-sso,static-token) with an injected fake verifier. */
const guardWith = (verifier?: GoogleTokenVerifier): AdminGuard =>
  new AdminGuard([new GoogleSsoAdminAuthStrategy(verifier), new StaticTokenAdminAuthStrategy()]);

describe('AdminGuard', () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.ADMIN_ALLOWED_DOMAIN;
    delete process.env.ADMIN_ALLOWED_EMAILS;
    delete process.env.ADMIN_API_TOKEN;
  });

  afterAll(() => {
    process.env = env;
  });

  describe('Google SSO (Authorization: Bearer <idToken>)', () => {
    beforeEach(() => {
      process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
      process.env.ADMIN_ALLOWED_DOMAIN = 'acme.example';
    });

    it('valid token with an allowed domain → true + adminActor = e-mail/name', async () => {
      const guard = guardWith(new FakeVerifier(claims()));
      const { ctx, req } = contextFor({ authorization: 'Bearer good-token' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.adminActor).toEqual({ userId: 'admin@acme.example', name: 'Ada Admin' });
    });

    it('ADMIN_ALLOWED_DOMAIN unset → Google path fails closed with a clear 401 message', async () => {
      delete process.env.ADMIN_ALLOWED_DOMAIN;
      const guard = guardWith(new FakeVerifier(claims()));
      const { ctx } = contextFor({ authorization: 'Bearer good-token' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(guard.canActivate(ctx)).rejects.toThrow(/ADMIN_ALLOWED_DOMAIN/);
    });

    it('wrong domain → 401', async () => {
      const guard = guardWith(new FakeVerifier(claims({ email: 'eve@evil.example' })));
      const { ctx } = contextFor({ authorization: 'Bearer good-token' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('email_verified=false → 401', async () => {
      const guard = guardWith(new FakeVerifier(claims({ emailVerified: false })));
      const { ctx } = contextFor({ authorization: 'Bearer good-token' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('allowlist set and e-mail NOT on it → 401', async () => {
      process.env.ADMIN_ALLOWED_EMAILS = 'boss@acme.example, legal@acme.example';
      const guard = guardWith(new FakeVerifier(claims({ email: 'admin@acme.example' })));
      const { ctx } = contextFor({ authorization: 'Bearer good-token' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('allowlist set and e-mail on it → true', async () => {
      process.env.ADMIN_ALLOWED_EMAILS = 'admin@acme.example, legal@acme.example';
      const guard = guardWith(new FakeVerifier(claims({ email: 'admin@acme.example' })));
      const { ctx, req } = contextFor({ authorization: 'Bearer good-token' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.adminActor?.userId).toBe('admin@acme.example');
    });

    it('verifier throws (broken/expired token) → 401, never 500', async () => {
      const guard = guardWith(new FakeVerifier(new Error('Token used too late')));
      const { ctx } = contextFor({ authorization: 'Bearer broken' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('e-mail comparison is case-insensitive', async () => {
      const guard = guardWith(new FakeVerifier(claims({ email: 'Admin@Acme.EXAMPLE' })));
      const { ctx, req } = contextFor({ authorization: 'Bearer good-token' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.adminActor?.userId).toBe('admin@acme.example');
    });

    it('no GOOGLE_CLIENT_ID → bearer path disabled → 401 (even if the verifier would succeed)', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      const guard = guardWith(new FakeVerifier(claims()));
      const { ctx } = contextFor({ authorization: 'Bearer good-token' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('static fallback (x-admin-token, dev/CI)', () => {
    it('correct x-admin-token → true + adminActor from x-admin-user', async () => {
      process.env.ADMIN_API_TOKEN = 'secret-admin-token';
      const guard = new AdminGuard([new StaticTokenAdminAuthStrategy()]);
      const { ctx, req } = contextFor({ 'x-admin-token': 'secret-admin-token', 'x-admin-user': 'ops-1' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.adminActor).toEqual({ userId: 'ops-1' });
    });

    it('wrong x-admin-token → 401', async () => {
      process.env.ADMIN_API_TOKEN = 'secret-admin-token';
      const guard = new AdminGuard([new StaticTokenAdminAuthStrategy()]);
      const { ctx } = contextFor({ 'x-admin-token': 'wrong' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('ADMIN_API_TOKEN unset → fallback disabled → 401', async () => {
      const guard = new AdminGuard([new StaticTokenAdminAuthStrategy()]);
      const { ctx } = contextFor({ 'x-admin-token': 'anything' });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('fallback keeps working without GOOGLE_CLIENT_ID (google strategy passes on the request)', async () => {
      process.env.ADMIN_API_TOKEN = 'secret-admin-token';
      const guard = guardWith(new FakeVerifier(claims()));
      const { ctx, req } = contextFor({ 'x-admin-token': 'secret-admin-token' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.adminActor?.userId).toBe('admin');
    });
  });

  describe('strategy chain semantics', () => {
    it('the FIRST strategy returning an identity wins (order = ADMIN_AUTH order)', async () => {
      const first = { authenticate: jest.fn().mockResolvedValue({ userId: 'from-first' }), describeLoginMethod: () => null };
      const second = { authenticate: jest.fn().mockResolvedValue({ userId: 'from-second' }), describeLoginMethod: () => null };
      const guard = new AdminGuard([first, second]);
      const { ctx, req } = contextFor({});
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.adminActor).toEqual({ userId: 'from-first' });
      expect(second.authenticate).not.toHaveBeenCalled();
    });

    it('an unexpected strategy error is mapped to a generic 401, never a 500', async () => {
      const broken = { authenticate: jest.fn().mockRejectedValue(new TypeError('boom')), describeLoginMethod: () => null };
      const guard = new AdminGuard([broken]);
      const { ctx } = contextFor({});
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  it('neither x-admin-token nor bearer → 401', async () => {
    const guard = guardWith();
    const { ctx } = contextFor({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
