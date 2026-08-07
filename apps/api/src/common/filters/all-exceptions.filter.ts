import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { requestContext } from '../observability/request-context';

interface HttpExceptionBody {
  message?: string | string[];
  error?: string;
}

/**
 * Turns anything thrown anywhere into a response.
 *
 * The rule that matters: nothing the client sees may come from an error the
 * application did not deliberately raise. Returning `exception.message` for
 * any Error handed back Prisma's own text — which embeds the failing query and
 * its arguments, the database host for an initialization failure, and the
 * table and constraint names for a CHECK violation — to anyone who could
 * provoke one (docs/AUDIT_2026-08-B.md §H4).
 *
 * Detail now goes to the log with a correlation id; the client gets the id and
 * a generic message, so a support conversation can still find the incident.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      // Deliberately raised by the application: its message is written for
      // the caller and is safe to return.
      status = exception.getStatus();
      const body = exception.getResponse();
      message =
        typeof body === 'string' ? body : ((body as HttpExceptionBody).message ?? exception.message);
      code =
        typeof body === 'object'
          ? ((body as HttpExceptionBody).error ?? exception.name)
          : exception.name;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'A record with these unique fields already exists';
        code = 'UNIQUE_CONSTRAINT_VIOLATION';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'Record not found';
        code = 'NOT_FOUND';
      } else {
        // The Prisma error code is a stable, non-revealing identifier; the
        // message that accompanies it is not, so it stays in the log.
        status = HttpStatus.BAD_REQUEST;
        message = 'Database request error';
        code = 'DATABASE_ERROR';
      }
    }

    // Anything else — including PrismaClientValidationError,
    // PrismaClientInitializationError and CHECK-constraint violations, which
    // arrive as PrismaClientUnknownRequestError — keeps the generic 500.

    // Prefer the request's own correlation id: it is already on every log
    // line this request produced and is echoed in the `x-request-id` header,
    // so one identifier ties the client's report, the response body and the
    // whole log trail together. A freshly minted id would only ever appear
    // on this one line.
    const incidentId = requestContext.get()?.requestId ?? randomUUID();
    if (status >= 500) {
      this.logger.error(
        `[${incidentId}] ${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      code,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
      // Present only where the body is deliberately uninformative, so support
      // has something to correlate against the log.
      ...(status >= 500 ? { incidentId } : {}),
    });
  }
}
