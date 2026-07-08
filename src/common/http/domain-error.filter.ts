import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Response } from 'express';
import { DomainError, HTTP_STATUS_BY_CODE } from '../errors';

/** Maps DomainError → typed error response { code, message } (project convention). */
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = HTTP_STATUS_BY_CODE[exception.code] ?? 500;
    res.status(status).json({ code: exception.code, message: exception.message });
  }
}
