import { DynamicModule, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { RootRedirectController } from './root-redirect.controller.js';

/**
 * Optionally serves the admin-ui SPA from the backend process itself — the "combined" Docker image
 * (backend + SPA in one container). Enabled with SERVE_ADMIN_UI=true; off by default so the plain
 * backend image serves only the API.
 *
 * The SPA is served under `/ui` (built with base=/ui), leaving every backend route at the root
 * untouched — so there is no collision between the SPA's client routes (/customers, /documents, …)
 * and the backend controllers of the same name. A bare `/` redirects to `/ui` for convenience.
 */
@Module({})
export class AdminUiStaticModule {
  static forRootFromEnv(): DynamicModule {
    if (process.env.SERVE_ADMIN_UI !== 'true') {
      return { module: AdminUiStaticModule };
    }
    return {
      module: AdminUiStaticModule,
      imports: [
        ServeStaticModule.forRoot({
          // In the combined image the SPA build lives at /app/admin-ui-dist (overridable).
          rootPath: join(process.cwd(), process.env.ADMIN_UI_DIST ?? 'admin-ui-dist'),
          serveRoot: '/ui',
        }),
      ],
      controllers: [RootRedirectController],
    };
  }
}
