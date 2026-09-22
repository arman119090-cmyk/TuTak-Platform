import { PurchaseConfirmationSource } from '@prisma/client';
import type { PurchaseConfirmationDto as SharedPurchaseConfirmationDto } from '@tutak/shared-types';
import { PurchaseConfirmationSource as SharedPurchaseConfirmationSource } from '@tutak/shared-types';
import type { PurchaseConfirmationView } from './purchase-intents.service';

/**
 * The confirmation union the API returns and the one the clients read must
 * be the same shape.
 *
 * They are written twice because `apps/api` cannot import
 * `@tutak/shared-types` in its build — `rootDir` is `apps/api/src` and the
 * cross-workspace import fails with TS6059, the same constraint
 * `media.contracts.spec.ts` and `password-rules-parity.spec.ts` live under.
 * This spec compiles with the workspace root as its `rootDir` and can see
 * both trees, so the compiler does the checking: the mutual assignments
 * below stop building the moment a field is added, removed or retyped on one
 * side only.
 *
 * The runtime assertion covers what the types cannot — that both sides still
 * agree with the Prisma enum. A fourth confirmation source added to the
 * database and to only one of these two would otherwise reach a partner's
 * screen as an unhandled case.
 */
/**
 * The same union with its `source` widened from an enum member to the string
 * it is.
 *
 * Both sides spell the source as a TypeScript enum — Prisma's on one, the
 * shared package's on the other — and string enums are nominal: `'STAFF'`,
 * `PurchaseConfirmationSource.STAFF` and its shared twin are three different
 * types to the compiler although they are one value at runtime, which is
 * what crosses the wire. Widening both to the string leaves every other
 * field checked exactly as before, so a renamed, added, removed or retyped
 * field still fails the build; only the enum's identity is set aside, and
 * the assertion at the end of this file is what keeps the two enums honest.
 */
type WithPlainSource<T> = T extends object
  ? { [K in keyof T]: T[K] extends string ? `${T[K]}` : T[K] }
  : never;

describe('the confirmation union stays in step with @tutak/shared-types', () => {
  it('a staff confirmation is the same object on both sides', () => {
    const local: PurchaseConfirmationView = {
      source: PurchaseConfirmationSource.STAFF,
      employeeCode: 'EMP-007',
      assignmentId: 'assignment-1',
      role: 'STAFF',
    };
    const shared: WithPlainSource<SharedPurchaseConfirmationDto> = local;
    const back: WithPlainSource<PurchaseConfirmationView> = shared;
    expect(back).toEqual(local);
  });

  it('an integration confirmation is the same object on both sides', () => {
    const local: PurchaseConfirmationView = {
      source: PurchaseConfirmationSource.PARTNER_INTEGRATION,
      apiKeyId: 'key-1',
    };
    const shared: WithPlainSource<SharedPurchaseConfirmationDto> = local;
    const back: WithPlainSource<PurchaseConfirmationView> = shared;
    expect(back).toEqual(local);
  });

  it('a provider confirmation is the same object on both sides', () => {
    const local: PurchaseConfirmationView = {
      source: PurchaseConfirmationSource.PROVIDER_CALLBACK,
    };
    const shared: WithPlainSource<SharedPurchaseConfirmationDto> = local;
    const back: WithPlainSource<PurchaseConfirmationView> = shared;
    expect(back).toEqual(local);
  });

  it('both sides know exactly the sources the database has', () => {
    expect(Object.values(SharedPurchaseConfirmationSource).sort()).toEqual(
      Object.values(PurchaseConfirmationSource).sort(),
    );
  });
});
