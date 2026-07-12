import { Controller, Get, Redirect } from '@nestjs/common';

/**
 * Convenience redirect for the "combined" deployment (backend + admin UI in one origin): a browser
 * hitting the bare root `/` is sent to the admin UI at `/ui`, so users don't need to know the path.
 * Only registered when SERVE_ADMIN_UI=true (see AdminUiStaticModule); the backend otherwise has no
 * root route. Not part of either OpenAPI surface (not in the build-documents include list).
 */
@Controller()
export class RootRedirectController {
  @Get()
  @Redirect('/ui', 302)
  root(): void {}
}
