import { Controller, ForbiddenException, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { LocalFileStorage } from './local-file-storage';

/** Content-Disposition value: keep it printable ASCII, no quotes/control chars. */
const sanitizeFileName = (fileName: string): string =>
  fileName.replace(/["\\]/g, "_").replace(/[^\x20-\x7e]/g, "_");

/**
 * GET /files/:storageKey?expires=<unix>&sig=<hmac> — download endpoint of the `local` file-storage
 * plugin, mounted ONLY while FILE_STORAGE=local (same gating as the Postmark webhook).
 *
 * Auth is the URL itself: HMAC-SHA256 over `<storageKey>:<expires>` (FILE_STORAGE_LOCAL_SECRET).
 * Expired/tampered/traversal requests → 403; valid signature over a missing file → 404. Streams
 * the blob inline as application/pdf under its original fileName.
 *
 * Excluded from the OpenAPI specs: URLs are minted by the backend and opaque to integrators.
 */
@ApiExcludeController()
@Controller('files')
export class LocalFilesController {
  constructor(private readonly storage: LocalFileStorage) {}

  @Get(':storageKey')
  async serve(
    @Param('storageKey') storageKey: string,
    @Query('expires') expires: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.storage.verifyPresignedRequest(storageKey, Number(expires), String(sig ?? ''))) {
      throw new ForbiddenException('Invalid or expired file link');
    }
    const file = await this.storage.open(storageKey);
    if (!file) {
      throw new NotFoundException();
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeFileName(file.fileName)}"`);
    file.stream.pipe(res);
  }
}
