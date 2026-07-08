import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * Auth for POST /webhooks/postmark: compare the `token` header in constant time against
 * POSTMARK_WEBHOOK_TOKEN. Invalid → 403 — that stops Postmark retries; any other non-2xx code (401,
 * 500) would be redelivered, hence exclusively ForbiddenException.
 */
@Injectable()
export class PostmarkWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = Buffer.from(String(request.headers['token'] ?? ''));
    const expected = Buffer.from(process.env.POSTMARK_WEBHOOK_TOKEN ?? '');
    const isValid = expected.length > 0 && provided.length === expected.length && timingSafeEqual(provided, expected);
    if (!isValid) {
      throw new ForbiddenException();
    }
    return true;
  }
}
