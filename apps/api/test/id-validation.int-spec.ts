import { PrismaClient } from '@prisma/client';
import { createEvConnector, createPartner } from './setup/fixtures';
import { createHttpTestHarness, HttpTestHarness, truncateAll } from './setup/harness';

/**
 * Regression suite for docs/PENTEST_2026-08-23.md §B.2 (deferred there,
 * fixed here) — recorded in full in docs/ID_VALIDATION_2026-08-23.md.
 *
 * No `:id`-shaped route parameter in this API was ever validated as a UUID
 * before reaching Prisma. `Partner`/`EvStation`/every other primary key in
 * `prisma/schema.prisma` is `String @id @default(uuid())`, which Postgres
 * stores as plain `text` — so a value that merely does not match a row
 * 404s harmlessly, but one containing a byte the database's `UTF8` encoding
 * itself rejects (a null byte, most reliably) reached `findUnique` and
 * failed inside the query, which `AllExceptionsFilter` turned into a
 * generic, incident-logged `500` for what was actually an ordinary
 * malformed request.
 *
 * These four routes are picked to span independent modules (media,
 * partners, ev-charging, admin/reconciliation) and independent id-parameter
 * names (`assetId`, `id`, `partnerId`) — not to re-test every one of the
 * ~30 parameters this fix actually touches, which
 * `docs/ID_VALIDATION_2026-08-23.md` lists individually alongside the live
 * `curl` proof that drove every one of them, before and after, against the
 * real running server.
 *
 * This is the one file in the suite that boots a real listening HTTP
 * server — see `createHttpTestHarness`'s own docblock in
 * `test/setup/harness.ts` for why: `ParseUUIDPipe` is Nest's
 * request-argument pipeline itself, which (like `ThrottlerGuard`, per
 * `media-system.int-spec.ts`) does not run when a controller method is
 * simply called as a plain TypeScript function, the way every other suite
 * here exercises the app.
 */
describe('Route-parameter UUID validation (integration)', () => {
  let harness: HttpTestHarness;
  let prisma: PrismaClient;

  beforeAll(async () => {
    harness = await createHttpTestHarness();
    prisma = harness.prisma;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const get = (path: string) => fetch(`${harness.baseUrl}${path}`);

  const malformedShapes = {
    'a non-UUID string': 'not-a-uuid',
    'a null byte': 'null%00',
    'a very long garbage string': 'a'.repeat(3000),
  };

  describe.each([
    ['GET', '/v1/media/brand/%ID%/display', 'media (assetId)'],
    ['GET', '/v1/partners/%ID%', 'partners (id)'],
    ['GET', '/v1/ev/stations/%ID%', 'ev-charging (id)'],
    ['POST', '/v1/admin/partners/%ID%/payout-block/clear', 'reconciliation (partnerId)'],
  ])('%s %s — %s', (method, template) => {
    for (const [label, shape] of Object.entries(malformedShapes)) {
      it(`rejects ${label} with a clean 400, not a 500`, async () => {
        const path = template.replace('%ID%', shape);
        const res = await fetch(`${harness.baseUrl}${path}`, { method });

        expect(res.status).toBe(400);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body).toMatchObject({
          statusCode: 400,
          code: 'Bad Request',
        });
        expect(typeof body.message).toBe('string');
        expect(String(body.message)).toMatch(/uuid/i);
        // The whole point: no incident id, because this was never an
        // "unexpected server fault" in the first place.
        expect(body.incidentId).toBeUndefined();
      });
    }
  });

  it('produces the exact same body shape a normal DTO validation failure already produces', async () => {
    // A field-level `class-validator` failure, via the global `ValidationPipe`
    // every other route already relies on — `CreateReservationDto.connectorId`
    // is itself `@IsUUID()`, the body-level sibling of the fix under test.
    const dtoFailure = await fetch(`${harness.baseUrl}/v1/ev/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(dtoFailure.status).toBe(400);
    const dtoBody = (await dtoFailure.json()) as Record<string, unknown>;

    const paramFailure = await get('/v1/ev/stations/not-a-uuid');
    expect(paramFailure.status).toBe(400);
    const paramBody = (await paramFailure.json()) as Record<string, unknown>;

    expect(Object.keys(paramBody).sort()).toEqual(Object.keys(dtoBody).sort());
    expect(paramBody.statusCode).toBe(dtoBody.statusCode);
    expect(paramBody.code).toBe(dtoBody.code);
  });

  it('a well-formed but non-existent id is a 404, not a 400 — shape and existence stay separate checks', async () => {
    const res = await get('/v1/ev/stations/11111111-1111-4111-8111-111111111111');
    expect(res.status).toBe(404);
  });

  it('a real, existing UUID still resolves normally — the fix does not touch legitimate lookups', async () => {
    const partner = await createPartner(prisma);
    const connector = await createEvConnector(prisma, { partnerId: partner.id });

    const res = await get(`/v1/ev/stations/${connector.stationId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(connector.stationId);
  });

  // No controller anywhere in `apps/api/src/modules` takes a route
  // parameter for `SweepRun` (`name String @id`, the one non-UUID primary
  // key in the schema) — it is read only by the sweep processor and the
  // metrics service, never off a request path. There is therefore no live
  // route to positively prove "a non-UUID id still works" against; the
  // negative claim — that `UuidParam` was applied only where the schema
  // backs it — is what `docs/ID_VALIDATION_2026-08-23.md` records instead,
  // control by control.
});
