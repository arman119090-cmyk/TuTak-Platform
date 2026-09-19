import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requestContext } from './request-context';

const REQUEST_ID_HEADER = 'x-request-id';
/** A client-supplied id is echoed but never trusted as a unique key. */
const MAX_CLIENT_REQUEST_ID = 128;

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const supplied = request.header(REQUEST_ID_HEADER);
    const requestId =
      supplied && supplied.length <= MAX_CLIENT_REQUEST_ID ? supplied : randomUUID();
    response.setHeader(REQUEST_ID_HEADER, requestId);

    requestContext.run(
      {
        requestId,
        ip: request.ip,
        userAgent: request.header('user-agent'),
      },
      () => next(),
    );
  }
}
