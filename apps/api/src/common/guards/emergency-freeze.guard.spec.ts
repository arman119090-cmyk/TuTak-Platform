import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { EmergencyFreezeGuard, isAllowedWhileFrozen } from './emergency-freeze.guard';

/**
 * A freeze that lets a write through is not a freeze; a freeze that blocks
 * the login or the health check takes the platform out of the operator's
 * hands at the moment they need it. Both edges are pinned.
 */
describe('EmergencyFreezeGuard', () => {
  const guardWith = (freeze: boolean) =>
    new EmergencyFreezeGuard({
      get: () => ({ freeze }),
    } as unknown as ConfigService<AppConfig, true>);

  const contextFor = (method: string, path: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ method, path, url: path }) }),
    }) as unknown as ExecutionContext;

  it('does nothing while the freeze is off', () => {
    const guard = guardWith(false);
    expect(guard.canActivate(contextFor('POST', '/v1/purchase-intents'))).toBe(true);
    expect(guard.canActivate(contextFor('DELETE', '/v1/users/me'))).toBe(true);
  });

  it('refuses every state-changing request with 503 PLATFORM_FROZEN while on', () => {
    const guard = guardWith(true);
    for (const [method, path] of [
      ['POST', '/v1/purchase-intents'],
      ['POST', '/v1/partner-settlements/abc/paid'],
      ['PATCH', '/v1/users/me'],
      ['DELETE', '/v1/users/me'],
      ['POST', '/v1/psp/callback'],
      ['POST', '/v1/customer-balance/topup/webhook'],
      ['POST', '/v1/authority'], // looks like auth, is not
    ] as const) {
      let thrown: unknown;
      try {
        guard.canActivate(contextFor(method, path));
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ServiceUnavailableException);
      expect((thrown as ServiceUnavailableException).getResponse()).toMatchObject({
        error: 'PLATFORM_FROZEN',
      });
    }
  });

  it('keeps reads, health, auth and metrics open while on', () => {
    const guard = guardWith(true);
    for (const [method, path] of [
      ['GET', '/v1/wallet/me'],
      ['HEAD', '/v1/partners'],
      ['GET', '/health/ready'],
      ['POST', '/v1/auth/login'],
      ['POST', '/v1/auth/refresh?x=1'],
      ['POST', '/v1/auth/logout'],
      ['POST', '/auth/login'],
      ['GET', '/v1/metrics'],
    ] as const) {
      expect(guard.canActivate(contextFor(method, path))).toBe(true);
    }
  });

  it('decides on the method and the path alone', () => {
    expect(isAllowedWhileFrozen('get', '/anything')).toBe(true);
    expect(isAllowedWhileFrozen('POST', '/v1/auth/login')).toBe(true);
    expect(isAllowedWhileFrozen('POST', '/v2/auth/login')).toBe(true);
    expect(isAllowedWhileFrozen('POST', '/v1/authz/login')).toBe(false);
    expect(isAllowedWhileFrozen('POST', '/v1/qr-payments/redeem')).toBe(false);
  });
});
