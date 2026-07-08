import { CanActivate, ExecutionContext, Inject, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AdminAuthError, type AdminAuthStrategy, type AdminIdentity } from '../../plugin-sdk';
import { createSelectedAdminAuthStrategies } from './admin-auth.factory';
import { ADMIN_AUTH_STRATEGIES } from './admin-auth.tokens';

type AdminRequest = Request & { adminActor?: AdminIdentity };

/**
 * Protects the /admin routes by delegating to the ORDERED list of active
 * {@link AdminAuthStrategy} instances (env ADMIN_AUTH via the plugin registry; built-ins:
 * google-sso, static-token, supertokens):
 *
 *  - the first strategy returning a non-null identity wins → `req.adminActor` is set;
 *  - a strategy throwing {@link AdminAuthError} aborts with that specific 401 message
 *    (e.g. verified Google user with a disallowed domain);
 *  - all strategies null → generic 401. A broken credential NEVER causes a 500.
 *
 * Strategies are injected by the global AdminAuthModule; unit tests pass them directly.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private defaultStrategies?: AdminAuthStrategy[];

  constructor(
    @Optional() @Inject(ADMIN_AUTH_STRATEGIES) private readonly injectedStrategies?: AdminAuthStrategy[],
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AdminRequest>();
    for (const strategy of this.strategies()) {
      let identity: AdminIdentity | null;
      try {
        identity = await strategy.authenticate(req);
      } catch (error) {
        throw new UnauthorizedException(error instanceof AdminAuthError ? error.message : undefined);
      }
      if (identity !== null) {
        req.adminActor = identity;
        return true;
      }
    }
    throw new UnauthorizedException();
  }

  private strategies(): AdminAuthStrategy[] {
    return this.injectedStrategies ?? (this.defaultStrategies ??= createSelectedAdminAuthStrategies());
  }
}
