import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requestContext } from './request-context';

/** Header used to carry a correlation id in and back out again. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Opens a correlation scope for every request.
 *
 * An inbound `x-request-id` is honoured rather than replaced, so a trace that
 * started at an ingress or in a calling service survives the hop into this
 * one. The id is echoed on the response, which is what lets a client attach
 * it to a bug report and a support conversation find the exact request.
 *
 * Bounded and stripped of anything but the characters an id needs: this value
 * reaches log output, and an unvalidated header is how a caller injects
 * newlines into logs to forge entries.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
    const requestId = sanitize(candidate) ?? randomUUID();

    res.setHeader(REQUEST_ID_HEADER, requestId);

    /*
     * The path only — never the query string.
     *
     * `originalUrl` carries `?lat=40.18&lng=44.51` on the partner map's
     * "near me" request, and everything in this context ends up in every log
     * line the request writes. A person's position is not something a log
     * should hold as a side effect of debugging, and the privacy policy says
     * coordinates are not kept on the server. The path is enough to know
     * which route was running.
     */
    requestContext.run(
      { requestId, method: req.method, path: withoutQuery(req.originalUrl ?? req.url) },
      () => next(),
    );
  }
}

function sanitize(value: string | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 128);
  return cleaned.length > 0 ? cleaned : null;
}

function withoutQuery(url: string): string {
  const cut = url.indexOf('?');
  return cut === -1 ? url : url.slice(0, cut);
}
