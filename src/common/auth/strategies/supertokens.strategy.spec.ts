import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey, type KeyLike } from 'jose';
import { AdminGuard } from '../admin.guard';
import { StaticTokenAdminAuthStrategy } from './static-token.strategy';
import { SupertokensAdminAuthStrategy } from './supertokens.strategy';

interface SignOptions {
  roles?: string[] | undefined;
  sub?: string;
  email?: string;
  expiresIn?: string;
  issuer?: string;
  useWrongKey?: boolean;
}

describe('SupertokensAdminAuthStrategy', () => {
  const env = { ...process.env };
  let keySource: JWTVerifyGetKey;
  let signKey: KeyLike;
  let wrongKey: KeyLike;

  const signToken = async (options: SignOptions = {}): Promise<string> => {
    const jwt = new SignJWT({
      ...(options.roles === undefined ? {} : { 'st-role': { v: options.roles, t: Date.now() } }),
      ...(options.email === undefined ? {} : { email: options.email }),
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'st-key-1' })
      .setSubject(options.sub ?? 'st-user-42')
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '5m');
    if (options.issuer !== undefined) jwt.setIssuer(options.issuer);
    return jwt.sign(options.useWrongKey ? wrongKey : signKey);
  };

  const authHeaders = (token: string): { headers: Record<string, string> } => ({
    headers: { authorization: `Bearer ${token}` },
  });

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    signKey = pair.privateKey;
    wrongKey = (await generateKeyPair('RS256')).privateKey;
    const jwk = await exportJWK(pair.publicKey);
    keySource = createLocalJWKSet({ keys: [{ ...jwk, kid: 'st-key-1', alg: 'RS256', use: 'sig' }] });
  });

  beforeEach(() => {
    delete process.env.ADMIN_SUPERTOKENS_ROLE;
    delete process.env.SUPERTOKENS_ISSUER;
    delete process.env.SUPERTOKENS_LOGIN_URL;
    delete process.env.ADMIN_API_TOKEN;
  });

  afterAll(() => {
    process.env = env;
  });

  const strategy = (): SupertokensAdminAuthStrategy => new SupertokensAdminAuthStrategy({ keySource });

  it('requires a jwksUrl or keySource at construction (boot error when SUPERTOKENS_JWKS_URL is missing)', () => {
    expect(() => new SupertokensAdminAuthStrategy({})).toThrow(/SUPERTOKENS_JWKS_URL|jwksUrl/);
  });

  it('valid token with the default role "admin" → identity from sub + email', async () => {
    const token = await signToken({ roles: ['admin'], email: 'ops@acme.example' });
    await expect(strategy().authenticate(authHeaders(token))).resolves.toEqual({
      userId: 'st-user-42',
      name: 'ops@acme.example',
    });
  });

  it('works without an email claim (name undefined)', async () => {
    const token = await signToken({ roles: ['admin'] });
    await expect(strategy().authenticate(authHeaders(token))).resolves.toEqual({
      userId: 'st-user-42',
      name: undefined,
    });
  });

  it('honors ADMIN_SUPERTOKENS_ROLE (configurable required role)', async () => {
    process.env.ADMIN_SUPERTOKENS_ROLE = 'clickwrap-admin';
    const withRole = await signToken({ roles: ['clickwrap-admin'] });
    const withoutRole = await signToken({ roles: ['admin'] });
    await expect(strategy().authenticate(authHeaders(withRole))).resolves.toMatchObject({ userId: 'st-user-42' });
    await expect(strategy().authenticate(authHeaders(withoutRole))).resolves.toBeNull();
  });

  it('wrong role → null (401 path)', async () => {
    const token = await signToken({ roles: ['viewer'] });
    await expect(strategy().authenticate(authHeaders(token))).resolves.toBeNull();
  });

  it('missing/empty st-role claim → null', async () => {
    await expect(strategy().authenticate(authHeaders(await signToken({ roles: undefined })))).resolves.toBeNull();
    await expect(strategy().authenticate(authHeaders(await signToken({ roles: [] })))).resolves.toBeNull();
  });

  it('expired token → null, never a 500', async () => {
    const token = await signToken({ roles: ['admin'], expiresIn: '-1m' });
    await expect(strategy().authenticate(authHeaders(token))).resolves.toBeNull();
  });

  it('wrong signature → null', async () => {
    const token = await signToken({ roles: ['admin'], useWrongKey: true });
    await expect(strategy().authenticate(authHeaders(token))).resolves.toBeNull();
  });

  it('checks the issuer only when SUPERTOKENS_ISSUER is set', async () => {
    const token = await signToken({ roles: ['admin'], issuer: 'https://st.acme.example/auth' });
    await expect(strategy().authenticate(authHeaders(token))).resolves.toMatchObject({ userId: 'st-user-42' });

    process.env.SUPERTOKENS_ISSUER = 'https://st.acme.example/auth';
    await expect(strategy().authenticate(authHeaders(token))).resolves.toMatchObject({ userId: 'st-user-42' });

    process.env.SUPERTOKENS_ISSUER = 'https://other.example/auth';
    await expect(strategy().authenticate(authHeaders(token))).resolves.toBeNull();
  });

  it('no bearer header → null', async () => {
    await expect(strategy().authenticate({ headers: {} })).resolves.toBeNull();
  });

  describe('describeLoginMethod', () => {
    it('is omitted (null) while SUPERTOKENS_LOGIN_URL is unset — verification still works', async () => {
      expect(strategy().describeLoginMethod()).toBeNull();
      const token = await signToken({ roles: ['admin'] });
      await expect(strategy().authenticate(authHeaders(token))).resolves.toMatchObject({ userId: 'st-user-42' });
    });

    it('advertises an oidc-redirect method when SUPERTOKENS_LOGIN_URL is set', () => {
      process.env.SUPERTOKENS_LOGIN_URL = 'https://st.acme.example/auth/login';
      expect(strategy().describeLoginMethod()).toEqual({
        key: 'supertokens',
        flow: 'oidc-redirect',
        label: 'SuperTokens',
        params: { authorizeUrl: 'https://st.acme.example/auth/login' },
      });
    });
  });

  describe('in the guard chain (ADMIN_AUTH=supertokens,static-token)', () => {
    const contextFor = (headers: Record<string, string>): ExecutionContext =>
      ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

    it('a SuperTokens session wins; the static token still works; garbage → 401', async () => {
      process.env.ADMIN_API_TOKEN = 'ci-token';
      const guard = new AdminGuard([strategy(), new StaticTokenAdminAuthStrategy()]);

      const token = await signToken({ roles: ['admin'] });
      await expect(guard.canActivate(contextFor({ authorization: `Bearer ${token}` }))).resolves.toBe(true);
      await expect(guard.canActivate(contextFor({ 'x-admin-token': 'ci-token' }))).resolves.toBe(true);
      await expect(guard.canActivate(contextFor({ authorization: 'Bearer garbage' }))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
