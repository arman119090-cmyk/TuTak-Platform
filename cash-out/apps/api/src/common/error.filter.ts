import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiErrorBody, isErrorCode } from '@cashout/contracts';
import { AppLogger } from './logging/logger.service';
import { requestContext } from './request-context';

/**
 * Turns anything thrown anywhere into the one error shape the clients know, and
 * makes sure an unexpected error never leaks its message to a driver's phone.
 * The message still reaches the logs in full, correlated by request id.
 */
@Catch()
@Injectable()
export class AppExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const requestId = requestContext.requestId();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const body = this.normalise(payload, status, requestId);

      if (status >= 500) {
        this.logger.fail('Request failed', exception, { path: request.url, status });
      } else {
        this.logger.warning('Request rejected', {
          path: request.url,
          status,
          code: body.code,
        });
      }

      response.status(status).json(body);
      return;
    }

    this.logger.fail('Unhandled exception', exception, { path: request.url });
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
      requestId,
    } satisfies ApiErrorBody);
  }

  private normalise(payload: unknown, status: number, requestId?: string): ApiErrorBody {
    if (payload && typeof payload === 'object') {
      const candidate = payload as Record<string, unknown>;
      if (isErrorCode(candidate.code)) {
        return {
          code: candidate.code,
          message: String(candidate.message ?? 'Request failed'),
          requestId,
          details: candidate.details as Record<string, unknown> | undefined,
        };
      }
    }
    return {
      code: status === 404 ? 'NOT_FOUND' : status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED',
      message: typeof payload === 'string' ? payload : 'Request failed',
      requestId,
    };
  }
}
