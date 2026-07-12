import { DynamicModule, Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { resolve } from 'node:path';

/**
 * Optionally serves a directory of static client assets at `/accept-assets`, for an
 * `acceptance-page` plugin that renders with its own JS/CSS bundle instead of a self-contained page.
 *
 * The renderer contract is intentionally pure HTML (no plugin-contributed routes), so an org
 * renderer that ships a client bundle needs the host to serve those assets. Rather than inline the
 * (potentially large) bundle into every page — losing browser caching — point `ACCEPT_ASSETS_DIR`
 * at the plugin's built asset directory; the renderer then references e.g.
 * `<script src="/accept-assets/app.js">`. Off by default (unset) so the default self-contained page
 * needs nothing. Generic and plugin-agnostic — parallel to how SERVE_ADMIN_UI serves the SPA.
 */
@Module({})
export class AcceptAssetsModule {
  /** Public URL prefix the assets are served under; renderers reference paths beneath it. */
  static readonly serveRoot = '/accept-assets';

  static forRootFromEnv(): DynamicModule {
    const dir = process.env.ACCEPT_ASSETS_DIR;
    if (!dir) {
      return { module: AcceptAssetsModule };
    }
    return {
      module: AcceptAssetsModule,
      imports: [
        ServeStaticModule.forRoot({
          rootPath: resolve(dir),
          serveRoot: AcceptAssetsModule.serveRoot,
        }),
      ],
    };
  }
}
