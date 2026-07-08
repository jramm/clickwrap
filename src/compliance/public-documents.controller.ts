/**
 * Public per-document PDF endpoint — NO auth, NO token: the URL is meant to be rendered into
 * static places (e.g. offers) as `${PUBLIC_BASE_URL}/documents/<type>/<audience>/latest.pdf`.
 * Each request 302-redirects to a FRESH presigned URL of the currently effective published
 * version, so presigned expiry is irrelevant and the endpoint stays storage-plugin-agnostic.
 * Side-effect-free: a GET never writes notifications, states or evidence.
 */
import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PublicDocumentsService } from './public-documents.service';

@ApiTags('Public documents')
@Controller('documents')
export class PublicDocumentsController {
  constructor(private readonly publicDocumentsService: PublicDocumentsService) {}

  @Get(':typeKey/:audienceKey/latest.pdf')
  @ApiOperation({
    summary: 'Stable public link to the latest effective PDF of a document (302 redirect)',
    description:
      'Unauthenticated. The URL is DETERMINISTIC from the document keys ' +
      '(`/documents/<type>/<audience>/latest.pdf`), so it stays valid across every future ' +
      'publish — render it into offers/templates once. Each request redirects (302) to a fresh, ' +
      'time-limited presigned URL of the CURRENTLY EFFECTIVE published version ' +
      '(newest PUBLISHED with validFrom <= now — never an upcoming, not-yet-effective one: an ' +
      'offer must reference what is in force at signing time). Signature on the offer = implicit ' +
      'acceptance; record it later via `acceptedVersions` on customer creation. ' +
      'Side-effect-free: no notification/state/evidence writes.',
  })
  @ApiParam({ name: 'typeKey', description: 'Document type key, e.g. `terms`.' })
  @ApiParam({ name: 'audienceKey', description: 'Audience key, e.g. `customer`.' })
  @ApiResponse({ status: 302, description: 'Redirect to a fresh presigned PDF URL (time-limited).' })
  @ApiResponse({
    status: 404,
    description:
      'Uniform for unknown type/audience/document, no published version, or an only-upcoming ' +
      'version — never reveals which case it was.',
  })
  async latestPdf(
    @Param('typeKey') typeKey: string,
    @Param('audienceKey') audienceKey: string,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.publicDocumentsService.resolveLatestPdfUrl(typeKey, audienceKey);
    if (!url) {
      // Uniform 404 within the `{ code, message }` error contract — same body for every miss.
      res.status(404).json({ code: 'VERSION_NOT_FOUND', message: 'No published document at this address' });
      return;
    }
    res.redirect(302, url);
  }
}
