/**
 * Reusable decorator for the uniform error contract: every error status renders as
 * `{ code, message }` (DomainErrorFilter) — 400 (Zod) and 401 (guards) use the Nest default body,
 * but are documented with the same shape for simplicity of client generation.
 */
import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from './error-response.dto';

/** `ApiErrorResponses({ 404: 'VERSION_NOT_FOUND', 422: 'INVALID_STATE · UNKNOWN_AUDIENCE' })` */
export const ApiErrorResponses = (byStatus: Record<number, string>): MethodDecorator & ClassDecorator =>
  applyDecorators(
    ...Object.entries(byStatus).map(([status, description]) =>
      ApiResponse({ status: Number(status), description, type: ErrorResponseDto }),
    ),
  );
