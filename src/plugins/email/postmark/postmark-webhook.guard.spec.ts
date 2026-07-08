import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PostmarkWebhookGuard } from './postmark-webhook.guard';

const contextWithToken = (token: string | undefined): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: token === undefined ? {} : { token } }),
    }),
  }) as unknown as ExecutionContext;

describe('PostmarkWebhookGuard', () => {
  const originalToken = process.env.POSTMARK_WEBHOOK_TOKEN;

  beforeEach(() => {
    process.env.POSTMARK_WEBHOOK_TOKEN = 'secret-webhook-token';
  });

  afterAll(() => {
    process.env.POSTMARK_WEBHOOK_TOKEN = originalToken;
  });

  it('lets the correct token header through', () => {
    const guard = new PostmarkWebhookGuard();
    expect(guard.canActivate(contextWithToken('secret-webhook-token'))).toBe(true);
  });

  it('throws ForbiddenException (403) on a wrong token header — never 401/500', () => {
    const guard = new PostmarkWebhookGuard();
    expect(() => guard.canActivate(contextWithToken('wrong-token'))).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException on a missing token header', () => {
    const guard = new PostmarkWebhookGuard();
    expect(() => guard.canActivate(contextWithToken(undefined))).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when POSTMARK_WEBHOOK_TOKEN is not configured', () => {
    process.env.POSTMARK_WEBHOOK_TOKEN = '';
    const guard = new PostmarkWebhookGuard();
    expect(() => guard.canActivate(contextWithToken('secret-webhook-token'))).toThrow(ForbiddenException);
  });
});
