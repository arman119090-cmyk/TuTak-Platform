import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';

import { ClientIpThrottlerGuard } from './client-ip-throttler.guard';

/**
 * The defect: `ThrottlerGuard` keys on `req.ip`, and behind a load balancer
 * with `TRUST_PROXY` unset that is the balancer for everyone. The limits in
 * `AuthController` were therefore global — eight requests a minute locked
 * every user out of `/auth/login`.
 *
 * So the assertion is not about a number of requests. It is that the guard
 * refuses to police an address that cannot tell callers apart, and starts
 * again the moment one can.
 */

const options = { throttlers: [{ ttl: 60_000, limit: 5 }] } as ThrottlerModuleOptions;
const storage = { increment: jest.fn() } as unknown as ThrottlerStorage;

function guardFor(strategy: 'socket' | 'xff-depth', trustedHops?: number) {
  const config = {
    get: () => ({ strategy, trustedHops }),
  } as never;
  return new ClientIpThrottlerGuard(options, storage, new Reflector(), config);
}

/** `shouldSkip` is protected; the test drives it as the framework does. */
function shouldSkip(guard: ClientIpThrottlerGuard): Promise<boolean> {
  const context = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ ip: '10.0.0.1' }), getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
  return (guard as unknown as { shouldSkip(c: ExecutionContext): Promise<boolean> }).shouldSkip(
    context,
  );
}

it('stands down when req.ip is the balancer, rather than sharing one bucket', async () => {
  await expect(shouldSkip(guardFor('socket'))).resolves.toBe(true);
});

it('polices normally once the address identifies a caller', async () => {
  await expect(shouldSkip(guardFor('xff-depth', 1))).resolves.toBe(false);
});

it('says so once, not on every request', async () => {
  const guard = guardFor('socket');
  const warn = jest
    .spyOn(
      (guard as unknown as { log: { warn: (m: string) => void } }).log,
      'warn',
    )
    .mockImplementation(() => undefined);

  await shouldSkip(guard);
  await shouldSkip(guard);
  await shouldSkip(guard);

  // A per-request warning would bury the log it is meant to stand out in.
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]?.[0]).toContain('CLIENT_IP_STRATEGY=xff-depth');
});
