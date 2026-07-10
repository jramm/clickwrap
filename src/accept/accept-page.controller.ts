/**
 * Public endpoints of the hosted acceptance page. There is NO service token here — the link
 * token in the path IS the authentication (capability URL). Invalid/expired/revoked tokens all
 * render the SAME 404 page (GET) / LINK_NOT_FOUND (POST) — no information leak. Both endpoints
 * share a simple per-token in-memory rate limit (MVP, single-node).
 */
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOperation, ApiParam, ApiProduces, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator';
import { DomainError } from '../common/errors';
import { acceptanceLinkTokenHash } from '../domain/acceptance-links';
import { PLUGIN_DI_TOKENS, type AcceptancePageRenderer } from '../plugin-sdk';
import type { AcceptanceResponse } from '../consent/acceptance.service';
import { ZodBodyPipe } from '../consent/dto';
import { AcceptPageService } from './accept-page.service';
import { linkAcceptanceBodySchema, type LinkAcceptanceBody } from './dto';
import { LinkAcceptanceBodyModel, LinkAcceptanceResponseModel } from './openapi.models';
import { resolveAcceptPageLang } from './i18n';
import { SlidingWindowRateLimiter } from './rate-limiter';

export const ACCEPT_PAGE_RATE_LIMITER = Symbol('AcceptPageRateLimiter');

@ApiTags('Hosted acceptance page')
@Controller('accept')
export class AcceptPageController {
  constructor(
    private readonly pageService: AcceptPageService,
    @Inject(ACCEPT_PAGE_RATE_LIMITER) private readonly rateLimiter: SlidingWindowRateLimiter,
    @Inject(PLUGIN_DI_TOKENS.AcceptancePageRenderer) private readonly renderer: AcceptancePageRenderer,
  ) {}

  @Get(':token')
  @ApiOperation({
    summary: 'Hosted acceptance page (server-rendered HTML)',
    description:
      'Auth: the link token in the path is the capability — no service token, no headers. ' +
      'Rendering the page counts as provable access: per pending agreement of the link’s ' +
      'customer a NotificationEvent (channel LINK) is recorded and the deadline starts ' +
      '(atomic, first access wins, SUPERSEDED is never revived). Language: `?lang=de|en`, ' +
      'then Accept-Language, default en. Invalid/expired/revoked tokens all render the SAME ' +
      '404 page.',
  })
  @ApiParam({ name: 'token', description: 'Capability token from the minted acceptance-link URL.' })
  @ApiQuery({ name: 'lang', required: false, enum: ['en', 'de'] })
  @ApiProduces('text/html')
  @ApiResponse({ status: 200, description: 'Self-contained HTML page (inline CSS/JS, mobile-first).' })
  @ApiResponse({ status: 404, description: 'Uniform HTML 404 page — never reveals whether the token existed.' })
  @ApiResponse({ status: 429, description: 'Per-token rate limit exceeded (JSON `{ code: RATE_LIMITED }`).' })
  async page(
    @Param('token') token: string,
    @Res() res: Response,
    @Query('lang') lang?: string,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<void> {
    this.assertWithinRateLimit(token);
    const pageLang = resolveAcceptPageLang(lang, acceptLanguage);
    const view = await this.pageService.loadPage(token);
    if (!view) {
      res.status(404).type('text/html; charset=utf-8').send(this.renderer.renderNotFoundPage(pageLang));
      return;
    }
    res.status(200).type('text/html; charset=utf-8').send(this.renderer.renderAcceptPage(view, pageLang));
  }

  @Post(':token/acceptances')
  @ApiOperation({
    summary: 'Record consent from the hosted page (link token = auth, signer self-declared)',
    description:
      'Full acceptance flow with channel LINK: current-version check, role coverage, ' +
      'CONSENT_TEXT_MISMATCH cross-check against the server-side versioned consent text. The ' +
      'actor is `link:<linkId>` plus the SELF-DECLARED signer name/e-mail; the evidence note ' +
      'records the self-declaration. Optional Idempotency-Key header (the page sends a random ' +
      'key per attempt).',
  })
  @ApiParam({ name: 'token', description: 'Capability token from the minted acceptance-link URL.' })
  @ApiBody({ type: LinkAcceptanceBodyModel })
  @ApiCreatedResponse({ type: LinkAcceptanceResponseModel })
  @ApiErrorResponses({
    400: 'Body validation failed (strict schema).',
    404: 'LINK_NOT_FOUND (unknown/expired/revoked — uniform) · VERSION_NOT_FOUND',
    409: 'ALREADY_ACCEPTED',
    422: 'VERSION_NOT_CURRENT · ROLE_MISMATCH · CONSENT_TEXT_MISMATCH · INVALID_STATE',
    429: 'RATE_LIMITED (per-token, in-memory MVP limit).',
  })
  @HttpCode(201)
  async accept(
    @Param('token') token: string,
    @Body(new ZodBodyPipe(linkAcceptanceBodySchema)) body: LinkAcceptanceBody,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<AcceptanceResponse> {
    this.assertWithinRateLimit(token);
    return this.pageService.accept(token, {
      versionId: body.versionId,
      displayedConsentText: body.displayedConsentText,
      signerName: body.signerName,
      signerEmail: body.signerEmail,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      idempotencyKey: idempotencyKey?.trim() ? idempotencyKey : undefined,
    });
  }

  /** Keyed by token hash so raw capability tokens never linger in the limiter map. */
  private assertWithinRateLimit(token: string): void {
    if (!this.rateLimiter.allow(acceptanceLinkTokenHash(token))) {
      throw new DomainError('RATE_LIMITED', 'Too many requests for this acceptance link — retry in a minute');
    }
  }
}
