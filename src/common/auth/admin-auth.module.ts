import { Module, type DynamicModule } from '@nestjs/common';
import { createSelectedAdminAuthStrategies } from './admin-auth.factory';
import { ADMIN_AUTH_STRATEGIES } from './admin-auth.tokens';
import { AuthMethodsController } from './auth-methods.controller';

/**
 * Global admin-auth wiring: binds ADMIN_AUTH_STRATEGIES (the ORDERED active strategy chain from
 * env ADMIN_AUTH via the plugin registry — unknown key = boot error listing the available
 * admin-auth plugins) and mounts the unauthenticated GET /admin/auth/methods discovery endpoint.
 * AdminGuard (used per-controller in admin/agreements) consumes the token from anywhere.
 */
@Module({})
export class AdminAuthModule {
  static forRoot(): DynamicModule {
    return {
      module: AdminAuthModule,
      global: true,
      controllers: [AuthMethodsController],
      providers: [{ provide: ADMIN_AUTH_STRATEGIES, useFactory: createSelectedAdminAuthStrategies }],
      exports: [ADMIN_AUTH_STRATEGIES],
    };
  }
}
