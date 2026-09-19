import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';
import { AppError } from './app-error';

/**
 * Validates and *replaces* the incoming payload with the parsed result, so a
 * handler can never see a field the schema did not declare. Unknown keys are
 * stripped by zod's default object behaviour, which is what keeps a client from
 * smuggling `{ "state": "COMPLETED" }` into a body that a service later spreads.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AppError('VALIDATION_FAILED', 'Request payload failed validation', {
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }
      throw error;
    }
  }
}

export const zodBody = (schema: ZodSchema) => new ZodValidationPipe(schema);
