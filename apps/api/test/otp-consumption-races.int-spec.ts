import { AuthOtpPurpose, PrismaClient } from '@prisma/client';
import { AuthOtpService } from '../src/modules/auth/auth-otp.service';
import { sha256Hex } from '../src/common/utils/crypto';
import { TestHarness, createTestHarness, truncateAll } from './setup/harness';

/**
 * What happens when two people — or one attacker with a script — hit the
 * verify step at the same instant.
 *
 * `otp-code-consumption.spec.ts` decides the single-threaded questions against
 * a modelled row. It cannot answer these: whether N simultaneous wrong guesses
 * cost N attempts or one, whether two requests carrying the same right code
 * can both succeed, and what state a challenge is left in when a process dies
 * mid-sequence. Those are properties of PostgreSQL's concurrency, and a stub
 * that answered them would be answering about itself.
 *
 * The shape under test is deliberately not one transaction. Counting an
 * attempt and burning the challenge are separate writes, and consuming a
 * correct code is a third — so each test below names which interleaving it is
 * standing in for, rather than assuming the separation is harmless.
 */
describe('OTP consumption under concurrency (integration)', () => {
  let harness: TestHarness;
  let prisma: PrismaClient;
  let otp: AuthOtpService;

  const PHONE = '+37455010203';
  const CODE = '424242';
  const WRONG = '000000';
  /** `MAX_ATTEMPTS` in `auth-otp.service.ts`. */
  const MAX_ATTEMPTS = 5;

  beforeAll(async () => {
    harness = await createTestHarness();
    prisma = harness.prisma;
    otp = harness.app.get(AuthOtpService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const challenge = (
    overrides: Partial<{ attempts: number; expiresAt: Date; consumedAt: Date }> = {},
  ) =>
    prisma.authOtpToken.create({
      data: {
        phone: PHONE,
        purpose: AuthOtpPurpose.LOGIN,
        codeHash: sha256Hex(CODE),
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 5 * 60_000),
        attempts: overrides.attempts ?? 0,
        ...(overrides.consumedAt ? { consumedAt: overrides.consumedAt } : {}),
      },
    });

  const verify = (code: string) =>
    otp.consumeCode(PHONE, AuthOtpPurpose.LOGIN, code).then(
      () => 'accepted' as const,
      () => 'refused' as const,
    );

  const rowFor = (id: string) => prisma.authOtpToken.findUniqueOrThrow({ where: { id } });

  it('charges every one of five simultaneous wrong guesses', async () => {
    // The reason the count is `{ increment: 1 }` and not `attempts + 1`. Read
    // then write, and all five read 0 and all five write 1: five guesses cost
    // one attempt, and the ceiling is walked past by firing in parallel
    // instead of in sequence.
    const token = await challenge();

    const outcomes = await Promise.all(Array.from({ length: 5 }, () => verify(WRONG)));

    expect(outcomes).toEqual(Array(5).fill('refused'));
    expect((await rowFor(token.id)).attempts).toBe(5);
  });

  it('burns the challenge when parallel guesses cross the limit together', async () => {
    // Three attempts already spent, three more arriving at once. Whichever
    // write lands on the fifth must burn it, and the two after it must not
    // undo or duplicate that.
    const token = await challenge({ attempts: 3 });

    await Promise.all(Array.from({ length: 3 }, () => verify(WRONG)));

    const after = await rowFor(token.id);
    expect(after.attempts).toBeGreaterThanOrEqual(MAX_ATTEMPTS);
    expect(after.consumedAt).toBeInstanceOf(Date);
  });

  it('lets only one of two requests carrying the same right code through', async () => {
    // Both read a live challenge; the conditional write decides. If both were
    // accepted, one code would authenticate two sessions — or create two
    // accounts on the registration path.
    const token = await challenge();

    const outcomes = await Promise.all([verify(CODE), verify(CODE)]);

    expect(outcomes.filter((o) => o === 'accepted')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'refused')).toHaveLength(1);
    expect((await rowFor(token.id)).consumedAt).toBeInstanceOf(Date);
  });

  it('refuses the right code racing the wrong guess that exhausts the limit', async () => {
    // The interleaving worth naming: the last allowed wrong guess burns the
    // challenge at the same moment the real owner submits the real code.
    // Either order is defensible, but exactly one outcome is not — both
    // succeeding. The challenge must end spent either way.
    const token = await challenge({ attempts: MAX_ATTEMPTS - 1 });

    const [right, wrong] = await Promise.all([verify(CODE), verify(WRONG)]);

    expect(wrong).toBe('refused');
    expect(['accepted', 'refused']).toContain(right);
    expect((await rowFor(token.id)).consumedAt).toBeInstanceOf(Date);
  });

  it('refuses a code the moment it has been used once', async () => {
    const token = await challenge();

    await expect(verify(CODE)).resolves.toBe('accepted');
    await expect(verify(CODE)).resolves.toBe('refused');
    // And a wrong guess afterwards finds nothing to count against.
    await expect(verify(WRONG)).resolves.toBe('refused');
    expect((await rowFor(token.id)).attempts).toBe(0);
  });

  it('refuses a code that expires between being issued and being used', async () => {
    const token = await challenge({ expiresAt: new Date(Date.now() + 40) });

    await new Promise((resolve) => setTimeout(resolve, 80));

    await expect(verify(CODE)).resolves.toBe('refused');
    // Never spent, because it was never eligible: `findFirst` filters on
    // `expiresAt > now`, so an expired challenge is invisible rather than
    // consumed. It leaves the table by expiry, not by use.
    const after = await rowFor(token.id);
    expect(after.consumedAt).toBeNull();
    expect(after.attempts).toBe(0);
  });

  it('refuses an exhausted challenge even when the burn write never landed', async () => {
    /*
     * The failure mode the separation admits, stated rather than assumed.
     *
     * The count and the burn are two statements. A process that stops between
     * them leaves a challenge at the limit and still unconsumed — and the
     * next request would find it live.
     *
     * When this test was first written it asserted that the per-number
     * attempt budget made the window harmless. It does not: that budget is
     * fifteen an hour against the challenge's five, so the row went on taking
     * guesses and the count reached six. The per-challenge limit was being
     * held up by one write, and a lost write raised it threefold.
     *
     * So the limit is read as well as written — `findFirst` now requires
     * `attempts < MAX_ATTEMPTS` — and an exhausted challenge is invisible
     * whether or not the burn landed. This test is what found that, and what
     * holds it.
     */
    const token = await prisma.authOtpToken.create({
      data: {
        phone: PHONE,
        purpose: AuthOtpPurpose.LOGIN,
        codeHash: sha256Hex(CODE),
        expiresAt: new Date(Date.now() + 5 * 60_000),
        // Exactly the state a crash between the two writes leaves behind.
        attempts: MAX_ATTEMPTS,
        consumedAt: null,
      },
    });

    await expect(verify(WRONG)).resolves.toBe('refused');
    await expect(verify(CODE)).resolves.toBe('refused');

    // Untouched: the challenge was never selected, so neither guess counted
    // against it. Before the read enforced the limit this reached six.
    expect((await rowFor(token.id)).attempts).toBe(MAX_ATTEMPTS);
  });
});
