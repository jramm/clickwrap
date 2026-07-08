import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { Actor } from './actor';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Service-to-service auth WITHOUT a customer context — for integration routes that operate before
 * a customer exists (e.g. POST /customers onboarding). Validates only the shared `x-service-token`
 * (like {@link ServiceGuard}) and never weakens the customer-scoped routes: those keep using
 * ServiceGuard, which additionally requires `x-customer-id`.
 *
 * The actor is read from the optional `x-actor-*` headers when the integrator forwards a user;
 * otherwise a generic `service` actor is recorded for the audit/evidence trail.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { serviceActor?: Actor }>();
    const token = String(req.headers['x-service-token'] ?? '');
    const expected = process.env.SERVICE_API_TOKEN ?? '';
    if (!expected || !safeEqual(token, expected)) throw new UnauthorizedException();

    const userId = req.headers['x-actor-user-id'] ? String(req.headers['x-actor-user-id']) : 'service';
    req.serviceActor = {
      userId,
      name: req.headers['x-actor-name'] ? String(req.headers['x-actor-name']) : undefined,
      email: req.headers['x-actor-email'] ? String(req.headers['x-actor-email']) : undefined,
      portalRole: req.headers['x-actor-role'] ? String(req.headers['x-actor-role']) : undefined,
    };
    return true;
  }
}
