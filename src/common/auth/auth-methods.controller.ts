import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { AdminAuthStrategy, LoginMethodDescriptor } from '../../plugin-sdk/index.js';
import { ADMIN_AUTH_STRATEGIES } from './admin-auth.tokens.js';

/** OpenAPI documentation model of one login method (runtime shape: SDK LoginMethodDescriptor). */
export class LoginMethodModel {
  @ApiProperty({ example: 'google-sso', description: 'Plugin key of the admin-auth strategy.' })
  key!: string;

  @ApiProperty({
    enum: ['google', 'token', 'oidc-redirect'],
    description:
      "How the login page obtains a credential: 'google' = Google Identity Services with params.clientId " +
      "(send the ID token as Authorization: Bearer); 'token' = static token prompt (send as x-admin-token); " +
      "'oidc-redirect' = redirect to params.authorizeUrl, the returned access token is sent as Authorization: Bearer.",
  })
  flow!: 'google' | 'token' | 'oidc-redirect';

  @ApiProperty({ example: 'Sign in with Google' })
  label!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      "Flow parameters — google: { clientId }, token: {}, oidc-redirect: { authorizeUrl, clientId? }. " +
      'The Google clientId comes from the BACKEND env (GOOGLE_CLIENT_ID) — the admin UI takes it ' +
      'from here at runtime.',
    example: { clientId: '1234-abc.apps.googleusercontent.com' },
  })
  params!: Record<string, unknown>;
}

export class AuthMethodsResponseModel {
  @ApiProperty({ type: [LoginMethodModel], description: 'Advertised methods, in ADMIN_AUTH order.' })
  methods!: LoginMethodModel[];
}

/**
 * GET /admin/auth/methods — UNauthenticated discovery endpoint: which login methods the admin UI
 * should render, for the ACTIVE admin-auth strategies (env ADMIN_AUTH, ordered). Strategies that
 * are active but not advertisable (e.g. google-sso without GOOGLE_CLIENT_ID, supertokens without
 * SUPERTOKENS_LOGIN_URL) are omitted — they may still verify credentials.
 */
@ApiTags('auth')
@Controller('admin/auth')
export class AuthMethodsController {
  constructor(@Inject(ADMIN_AUTH_STRATEGIES) private readonly strategies: AdminAuthStrategy[]) {}

  @Get('methods')
  @ApiOperation({
    summary: 'Login-method discovery for the admin UI (unauthenticated)',
    description:
      'Returns the login methods of the ACTIVE admin-auth strategies (env ADMIN_AUTH, ordered). ' +
      'Deliberately unauthenticated: the login page needs it before any credential exists.',
  })
  @ApiOkResponse({ type: AuthMethodsResponseModel })
  methods(): { methods: LoginMethodDescriptor[] } {
    return {
      methods: this.strategies
        .map((strategy) => strategy.describeLoginMethod())
        .filter((method): method is LoginMethodDescriptor => method !== null),
    };
  }
}
