import { render } from '@testing-library/react';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { Providers, registerSessionCacheReset } from '@tutak/design/web';
import type { AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import { useAuthStore } from './stores/authStore';

const userA: AuthenticatedUserDto = {
  id: 'admin-a',
  phone: '+37400000001',
  email: 'a@tutak.am',
  firstName: 'Anna',
  lastName: 'A',
  roles: [Role.ADMIN],
  partnerScopes: {},
  locale: 'hy',
  isPhoneVerified: true,
  avatar: null,
  showAvatarInReferralList: false,
  personalizedRecommendationsEnabled: false,
};

const userB: AuthenticatedUserDto = { ...userA, id: 'admin-b', firstName: 'Bagrat' };

const tokens = (who: string) => ({
  accessToken: `${who}-access`,
  refreshToken: `${who}-refresh`,
  accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
  refreshTokenExpiresAt: '2026-02-01T00:00:00.000Z',
});

/**
 * One React Query client lives for the lifetime of the tab, and none of the
 * dashboard's keys name the operator they belong to. On a workstation shared
 * between shifts, a cache that survives sign-out shows the next operator the
 * previous one's users, payouts and ledger — from cache, before any request
 * goes out, and inside `staleTime` without one going out at all.
 */
describe('admin session cache', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.setState({ user: null, accessToken: null, hasRestored: true, sessionEpoch: 0 });
  });

  /** Exactly what `Providers` registers, against a client this test can read. */
  const clientWiredLikeProviders = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const unregister = registerSessionCacheReset(() => client.clear());
    return { client, unregister };
  };

  const seed = (client: QueryClient) => {
    client.setQueryData(['users'], [{ id: 'user-1', phone: '+37400000009' }]);
    client.setQueryData(['payouts'], [{ id: 'payout-1', amount: 250_000 }]);
    client.setQueryData(['ledger'], { balance: 0 });
  };

  it('empties the cache when the operator signs out', () => {
    const { client, unregister } = clientWiredLikeProviders();
    try {
      useAuthStore.getState().setSession(userA, tokens('a'));
      seed(client);
      expect(client.getQueryCache().getAll()).toHaveLength(3);

      useAuthStore.getState().clear();

      expect(client.getQueryCache().getAll()).toEqual([]);
      expect(client.getQueryData(['users'])).toBeUndefined();
    } finally {
      unregister();
    }
  });

  it('leaves nothing of A for B, with or without a sign-out between them', () => {
    const { client, unregister } = clientWiredLikeProviders();
    try {
      useAuthStore.getState().setSession(userA, tokens('a'));
      seed(client);
      useAuthStore.getState().clear();
      useAuthStore.getState().setSession(userB, tokens('b'));
      expect(client.getQueryCache().getAll()).toEqual([]);

      // And again with no `clear()` in between — re-authenticating straight
      // into another account.
      seed(client);
      useAuthStore.getState().setSession(userA, tokens('a'));
      expect(client.getQueryCache().getAll()).toEqual([]);
    } finally {
      unregister();
    }
  });

  it('leaves the cache alone when only the access token is refreshed', () => {
    const { client, unregister } = clientWiredLikeProviders();
    try {
      useAuthStore.getState().setSession(userA, tokens('a'));
      seed(client);

      useAuthStore.getState().setTokens({ accessToken: 'a-access-2' });

      // Same operator, same session: clearing here would blank every open
      // screen every fifteen minutes.
      expect(client.getQueryData(['payouts'])).toEqual([{ id: 'payout-1', amount: 250_000 }]);
    } finally {
      unregister();
    }
  });

  it('Providers registers its own client for the reset', () => {
    let seen: QueryClient | null = null;
    function Probe() {
      seen = useQueryClient();
      return null;
    }
    render(
      <Providers>
        <Probe />
      </Providers>,
    );

    expect(seen).not.toBeNull();
    seen!.setQueryData(['users'], [{ id: 'user-1' }]);

    useAuthStore.getState().setSession(userA, tokens('a'));
    useAuthStore.getState().clear();

    expect(seen!.getQueryCache().getAll()).toEqual([]);
  });

  it('an unregistered cache is no longer touched', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const unregister = registerSessionCacheReset(() => client.clear());
    unregister();

    client.setQueryData(['users'], [{ id: 'user-1' }]);
    useAuthStore.getState().clear();

    expect(client.getQueryData(['users'])).toEqual([{ id: 'user-1' }]);
  });

  it('one failing reset does not stop the others', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const throwing = registerSessionCacheReset(() => {
      throw new Error('cache gone');
    });
    const working = registerSessionCacheReset(() => client.clear());
    try {
      client.setQueryData(['users'], [{ id: 'user-1' }]);

      expect(() => useAuthStore.getState().clear()).not.toThrow();
      expect(client.getQueryData(['users'])).toBeUndefined();
    } finally {
      throwing();
      working();
    }
  });

  /** Provider mount/unmount cycles must not leave stale resets behind. */
  it('does not accumulate resets across mounts', () => {
    const { unmount } = render(<Providers>{null}</Providers>);
    unmount();
    const { client, unregister } = clientWiredLikeProviders();
    try {
      client.setQueryData(['users'], [{ id: 'user-1' }]);
      expect(() => useAuthStore.getState().clear()).not.toThrow();
      expect(client.getQueryData(['users'])).toBeUndefined();
    } finally {
      unregister();
    }
  });
});
