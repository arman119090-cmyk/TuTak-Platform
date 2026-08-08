import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Envelope<T> {
  data: T;
  timestamp: string;
}

/**
 * Paths that must return exactly what the handler produced.
 *
 * The envelope is right for the JSON API every client consumes, and wrong for
 * anything speaking a format someone else's parser defines. `/metrics` serves
 * the Prometheus text exposition format: wrapped in `{ data, timestamp }` and
 * JSON-escaped, it is a valid HTTP 200 that no scraper can read — which is
 * exactly the sort of failure that looks fine in a browser and produces empty
 * dashboards.
 */
const UNWRAPPED = ['/metrics'];

/** Wraps every successful response in a consistent `{ data, timestamp }` envelope. */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Envelope<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Envelope<T> | T> {
    const request = context.switchToHttp().getRequest<{ url?: string }>();
    const path = (request.url ?? '').split('?')[0]!;

    if (UNWRAPPED.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      return next.handle() as Observable<T>;
    }

    return next.handle().pipe(
      map((data) => ({
        data,
        timestamp: new Date().toISOString(),
      })),
    ) as Observable<Envelope<T>>;
  }
}
