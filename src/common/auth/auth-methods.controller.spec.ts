import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { AdminAuthStrategy } from '../../plugin-sdk/index.js';
import { ADMIN_AUTH_STRATEGIES } from './admin-auth.tokens.js';
import { AuthMethodsController } from './auth-methods.controller.js';
import { GoogleSsoAdminAuthStrategy } from './strategies/google-sso.strategy.js';
import { StaticTokenAdminAuthStrategy } from './strategies/static-token.strategy.js';
import { SupertokensAdminAuthStrategy } from './strategies/supertokens.strategy.js';

describe('GET /admin/auth/methods', () => {
  const env = { ...process.env };
  let app: INestApplication;

  const bootWith = async (strategies: AdminAuthStrategy[]): Promise<INestApplication> => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthMethodsController],
      providers: [{ provide: ADMIN_AUTH_STRATEGIES, useValue: strategies }],
    }).compile();
    const testApp = moduleRef.createNestApplication();
    await testApp.init();
    return testApp;
  };

  beforeEach(() => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.ADMIN_API_TOKEN;
    delete process.env.SUPERTOKENS_LOGIN_URL;
  });

  afterEach(async () => {
    await app.close();
    process.env = { ...env };
  });

  it('is UNauthenticated and returns the descriptors of the active strategies in ADMIN_AUTH order', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
    process.env.ADMIN_API_TOKEN = 'ci-token';
    app = await bootWith([new GoogleSsoAdminAuthStrategy(), new StaticTokenAdminAuthStrategy()]);

    const res = await request(app.getHttpServer()).get('/admin/auth/methods').expect(200);
    expect(res.body).toEqual({
      methods: [
        {
          key: 'google-sso',
          flow: 'google',
          label: 'Sign in with Google',
          params: { clientId: 'client-123.apps.googleusercontent.com' },
        },
        { key: 'static-token', flow: 'token', label: 'Admin API token', params: {} },
      ],
    });
  });

  it('omits methods a strategy does not advertise (unconfigured google / token; supertokens without login URL)', async () => {
    process.env.ADMIN_API_TOKEN = 'ci-token';
    app = await bootWith([
      new GoogleSsoAdminAuthStrategy(), // no GOOGLE_CLIENT_ID → omitted
      new SupertokensAdminAuthStrategy({ keySource: async () => Promise.reject(new Error('unused')) }),
      new StaticTokenAdminAuthStrategy(),
    ]);

    const res = await request(app.getHttpServer()).get('/admin/auth/methods').expect(200);
    expect(res.body.methods).toEqual([{ key: 'static-token', flow: 'token', label: 'Admin API token', params: {} }]);
  });

  it('advertises the supertokens oidc-redirect method when SUPERTOKENS_LOGIN_URL is set', async () => {
    process.env.SUPERTOKENS_LOGIN_URL = 'https://st.acme.example/auth/login';
    app = await bootWith([new SupertokensAdminAuthStrategy({ keySource: async () => Promise.reject(new Error('unused')) })]);

    const res = await request(app.getHttpServer()).get('/admin/auth/methods').expect(200);
    expect(res.body.methods).toEqual([
      {
        key: 'supertokens',
        flow: 'oidc-redirect',
        label: 'SuperTokens',
        params: { authorizeUrl: 'https://st.acme.example/auth/login' },
      },
    ]);
  });
});
