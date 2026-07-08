import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { CustomerContext } from './actor';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * MVP seam for the service-to-service auth of the calling tools / downstream services:
 * the calling backend authenticates its own users and forwards the verified context via
 * a signed channel (x-service-token) + context headers. customerId/actor therefore always
 * come from the auth context — NEVER from the body. Future work: mTLS/JWT.
 */
@Injectable()
export class ServiceGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { customerContext?: CustomerContext }>();
    const token = String(req.headers['x-service-token'] ?? '');
    const expected = process.env.SERVICE_API_TOKEN ?? '';
    if (!expected || !safeEqual(token, expected)) throw new UnauthorizedException();

    const customerId = String(req.headers['x-customer-id'] ?? '');
    if (!customerId) throw new UnauthorizedException('missing customer context');
    req.customerContext = {
      customerId,
      actor: {
        userId: String(req.headers['x-actor-user-id'] ?? ''),
        name: req.headers['x-actor-name'] ? String(req.headers['x-actor-name']) : undefined,
        email: req.headers['x-actor-email'] ? String(req.headers['x-actor-email']) : undefined,
        portalRole: req.headers['x-actor-role'] ? String(req.headers['x-actor-role']) : undefined,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
    return true;
  }
}
