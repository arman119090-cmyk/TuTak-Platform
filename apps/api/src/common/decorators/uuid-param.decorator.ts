import { Param, ParseUUIDPipe } from '@nestjs/common';

/**
 * `@Param(name, ParseUUIDPipe)`, named for what it checks rather than how.
 *
 * Every primary key in this schema is `String @id @default(uuid())` except
 * one (`SweepRun.name`, a config/lookup table with no route parameter of its
 * own) — see `prisma/schema.prisma`. Because Prisma maps that `String` scalar
 * to a plain Postgres `text` column rather than the native `uuid` type, the
 * database enforces no shape on it at all: a value that merely fails to match
 * any row 404s as expected, but one containing a byte Postgres's `UTF8`
 * encoding itself rejects — a null byte, most reliably — reaches
 * `findUnique` and fails inside the query, which `AllExceptionsFilter`
 * catches as a generic, incident-logged `500`. That is safely contained (no
 * crash, no leaked internals) but wrong: a client sending a malformed id is
 * not the "unexpected server fault" a 500 claims it is, and every occurrence
 * pollutes incident/error monitoring with input that was never exceptional.
 *
 * `ParseUUIDPipe` rejects a malformed value before it ever reaches a
 * service or Prisma, with `BadRequestException`'s standard body — the exact
 * shape `ValidationPipe` already produces for a failed DTO field, so this is
 * not a new error shape, just the same one applied one layer earlier.
 *
 * Use this only where the parameter is actually a UUID primary/foreign key
 * lookup. A route keyed by something else — a name, a slug, a code — must
 * keep using a plain `@Param()`; wrapping it here would reject legitimate
 * values.
 */
export const UuidParam = (property: string) => Param(property, ParseUUIDPipe);
