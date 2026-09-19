import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { createCustomer } from './setup/fixtures';
import { HttpTestHarness, createHttpTestHarness, truncateAll } from './setup/harness';

const CURRENT = 'rotation-current-secret-long-enough-for-the-validator-32';
const PREVIOUS = 'rotation-previous-secret-long-enough-for-the-validator-32';
const STRANGER = 'a-secret-this-platform-has-never-signed-anything-with-32';

/**
 * Rotating the JWT access secret without signing everybody out.
 *
 * ## Why this exists
 *
 * Changing `JWT_ACCESS_SECRET` on its own invalidates every access token in
 * flight at once: every signed-in customer is thrown out in the middle of
 * whatever they were doing, including mid-purchase. That cost is exactly why
 * a leaked secret sits unrotated for days — and an unrotated leaked secret is
 * the danger the rotation was for. The overlap window makes rotation cheap
 * enough to actually perform.
 *
 * ## What is asserted
 *
 * Both halves, because either one alone is a different bug. Accepting the
 * retiring key proves the window works; refusing a stranger's key proves the
 * window is a window and not a hole.
 */
describe('JWT access secret rotation (integration)', () => {
  let harness: HttpTestHarness;
  let prisma: PrismaClient;
  let jwt: JwtService;

  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_ACCESS_SECRET_PREVIOUS'] as const) {
      saved[key] = process.env[key];
    }
    // Set before the harness builds: `configuration()` reads `process.env`
    // when `ConfigModule.forRoot` loads it, which is at module construction.
    process.env.JWT_ACCESS_SECRET = CURRENT;
    process.env.JWT_ACCESS_SECRET_PREVIOUS = PREVIOUS;

    harness = await createHttpTestHarness({ authGuards: true });
    prisma = harness.prisma;
    jwt = harness.app.get(JwtService);
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await harness.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  const meWith = async (token: string) =>
    fetch(`${harness.baseUrl}/v1/users/me`, {
      headers: { authorization: `Bearer ${token}` },
    });

  async function tokenFor(secret: string) {
    const { user } = await createCustomer(prisma);
    return jwt.signAsync(
      { sub: user.id, phone: user.phone, deviceId: 'device-rotation' },
      { secret, expiresIn: '15m' },
    );
  }

  it('accepts a token minted under the live secret', async () => {
    expect((await meWith(await tokenFor(CURRENT))).status).toBe(200);
  });

  /**
   * The point of the whole change. This customer signed in before the
   * rotation and is halfway through something; their token has to keep
   * working until it expires on its own.
   */
  it('still accepts a token minted under the secret being retired', async () => {
    expect((await meWith(await tokenFor(PREVIOUS))).status).toBe(200);
  });

  it('refuses a token signed with a secret this platform never used', async () => {
    expect((await meWith(await tokenFor(STRANGER))).status).toBe(401);
  });

  it('refuses a token that is not a token at all', async () => {
    expect((await meWith('not-a-jwt')).status).toBe(401);
  });

  /**
   * An expired token is expired under either key. Worth asserting because
   * the trial verification in `JwtStrategy` swallows the failure of the live
   * key and hands back the retiring one — a version of that which also
   * swallowed expiry would turn the rotation window into an unlimited
   * session extension.
   */
  it('refuses an expired token even though the retiring key would verify its signature', async () => {
    const { user } = await createCustomer(prisma);
    const expired = await jwt.signAsync(
      { sub: user.id, phone: user.phone, deviceId: 'device-rotation' },
      { secret: PREVIOUS, expiresIn: '-1s' },
    );
    expect((await meWith(expired)).status).toBe(401);
  });
});
