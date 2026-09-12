import { Prisma } from '@prisma/client';
import { isConfirmationCodeCollision } from './purchase-intents.service';

/**
 * The four-digit till code is allocated by drawing one and letting the
 * database reject a draw that is already held. That only works if the
 * allocator can recognise *its own* unique violation — and the first
 * version could not.
 *
 * `meta.target` is not one shape. Prisma reports a unique violation either
 * as the model's field names (`['partnerId', 'confirmationCode']`, camel
 * case, an array) or as the database's index name
 * (`purchase_intents_active_partner_confirmation_code_key`, snake case, a
 * string), depending on what the driver could resolve. The first version
 * matched the index name only, so when Prisma reported field names a real
 * collision escaped the retry loop and failed the customer's purchase with
 * a 500.
 *
 * It surfaced in CI as a one-in-thirteen failure of the 40-way concurrent
 * allocation test — the kind of defect that passes locally almost every
 * time. These cases are what stop it coming back: both spellings must be
 * recognised, and nothing else may be.
 */
describe('isConfirmationCodeCollision', () => {
  const p2002 = (target: unknown) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target },
    });

  it('recognises the violation reported as the model field names', () => {
    expect(isConfirmationCodeCollision(p2002(['partnerId', 'confirmationCode']))).toBe(true);
  });

  it('recognises the violation reported as the database index name', () => {
    expect(
      isConfirmationCodeCollision(p2002('purchase_intents_active_partner_confirmation_code_key')),
    ).toBe(true);
  });

  it('does not swallow a different unique violation on the same table', () => {
    // Retrying this one would loop over an error a new code cannot fix, and
    // would hide a real conflict behind a 503.
    expect(isConfirmationCodeCollision(p2002(['confirmationIdempotencyKey']))).toBe(false);
  });

  it('does not swallow a non-unique Prisma error, or a plain one', () => {
    const notFound = new Prisma.PrismaClientKnownRequestError('Not found', {
      code: 'P2025',
      clientVersion: 'test',
      meta: { target: ['confirmationCode'] },
    });
    expect(isConfirmationCodeCollision(notFound)).toBe(false);
    expect(isConfirmationCodeCollision(new Error('confirmationCode'))).toBe(false);
    expect(isConfirmationCodeCollision(undefined)).toBe(false);
  });

  it('tolerates a violation that carries no target at all', () => {
    expect(isConfirmationCodeCollision(p2002(undefined))).toBe(false);
  });
});
