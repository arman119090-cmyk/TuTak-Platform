import type { AuthTokensDto, AuthenticatedUserDto } from '@tutak/shared-types';
import { Role } from '@tutak/shared-types';
import * as storage from '../storage/secureStorage';
import { useAuthStore } from './authStore';

jest.mock('../storage/secureStorage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  deleteItem: jest.fn(async () => undefined),
}));

const mockedStorage = storage as jest.Mocked<typeof storage>;

const userA: AuthenticatedUserDto = {
  id: 'user-a',
  phone: '+37400000001',
  email: null,
  firstName: 'Anna',
  lastName: 'A',
  roles: [Role.CUSTOMER],
  partnerScopes: {},
  locale: 'hy',
  isPhoneVerified: true,
  avatar: null,
  showAvatarInReferralList: false,
  personalizedRecommendationsEnabled: false,
};

const userB: AuthenticatedUserDto = { ...userA, id: 'user-b', firstName: 'Bagrat', locale: 'ru' };

const tokensFor = (who: string): AuthTokensDto => ({
  accessToken: `${who}-access`,
  refreshToken: `${who}-refresh`,
  accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
  refreshTokenExpiresAt: '2026-02-01T00:00:00.000Z',
});

/**
 * A storage adapter whose writes finish when this test says so.
 *
 * The default mock resolves immediately, which hides every ordering question:
 * a write that cannot be interrupted cannot be interleaved with a sign-out.
 * The real adapter is `expo-secure-store`, whose operations are asynchronous
 * and cross into native code, so the store must be correct for *any* ordering
 * rather than for the one a fast mock happens to produce.
 */
function deferredWrites() {
  const pending: (() => void)[] = [];
  const gate = () =>
    new Promise<undefined>((resolve) => {
      pending.push(() => resolve(undefined));
    });
  // The arrange step's own writes are not what these assertions are about.
  mockedStorage.setItem.mockClear();
  mockedStorage.deleteItem.mockClear();
  mockedStorage.setItem.mockImplementation(gate);
  mockedStorage.deleteItem.mockImplementation(gate);
  return {
    releaseAll: () => {
      while (pending.length) pending.shift()!();
    },
    count: () => pending.length,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('authStore — ordering across a session change', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedStorage.setItem.mockImplementation(async () => undefined);
    mockedStorage.deleteItem.mockImplementation(async () => undefined);
    useAuthStore.setState({
      user: null,
      accessToken: null,
      refreshToken: null,
      sessionEpoch: 0,
      isHydrated: true,
    });
  });

  /**
   * The compensating-write race.
   *
   * A refused token write used to repair storage by putting back whatever
   * memory held. That read is itself an observation that can go stale: if the
   * session it read is signed out while the repair is being written, the
   * repair puts a signed-out session's tokens back into the keystore — the
   * exact resurrection the guard exists to prevent, reintroduced by the guard.
   */
  it('4. a refused token write never puts a signed-out session’s tokens back', async () => {
    await useAuthStore.getState().setSession(userB, tokensFor('b'));
    const epochOfA = useAuthStore.getState().sessionEpoch - 1;

    const writes = deferredWrites();
    // A refresh belonging to the previous session answers now. Its epoch is
    // stale, so the write must be refused — and must not touch storage.
    const refused = useAuthStore.getState().setTokens(
      { accessToken: 'a-access-2', refreshToken: 'a-refresh-2' },
      epochOfA,
    );
    await settle();

    // Meanwhile B signs out.
    const signOut = useAuthStore.getState().clear();
    writes.releaseAll();
    await settle();
    writes.releaseAll();
    await Promise.all([refused, signOut]);
    await settle();
    writes.releaseAll();

    await expect(refused).resolves.toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();

    // Nothing may have written a token value after the sign-out began.
    const writtenTokens = mockedStorage.setItem.mock.calls.filter(([key]) =>
      key === 'tutak.accessToken' || key === 'tutak.refreshToken',
    );
    expect(writtenTokens).toEqual([]);
  });

  it('a token write refused for a stale session leaves the live session alone', async () => {
    await useAuthStore.getState().setSession(userB, tokensFor('b'));
    const stale = useAuthStore.getState().sessionEpoch - 1;

    await expect(
      useAuthStore.getState().setTokens({ accessToken: 'x', refreshToken: 'y' }, stale),
    ).resolves.toBe(false);

    expect(useAuthStore.getState().accessToken).toBe('b-access');
    expect(useAuthStore.getState().refreshToken).toBe('b-refresh');
  });

  /**
   * The captured-profile race.
   *
   * A profile edit sends the value and waits. The reply carries only the
   * changed field, so the caller merges it into the user object it captured
   * before the request. If the session changed in between, that object is the
   * previous person's profile — and merging it writes their name, phone and
   * avatar into a store whose tokens belong to somebody else.
   */
  it('3. a profile update that lands after a session change is refused', async () => {
    await useAuthStore.getState().setSession(userA, tokensFor('a'));
    const epochOfA = useAuthStore.getState().sessionEpoch;

    await useAuthStore.getState().clear();
    await useAuthStore.getState().setSession(userB, tokensFor('b'));

    // A's reply arrives now, carrying A's profile.
    const applied = useAuthStore.getState().patchUser({ locale: 'en' }, epochOfA);

    expect(applied).toBe(false);
    expect(useAuthStore.getState().user?.id).toBe('user-b');
    expect(useAuthStore.getState().user?.locale).toBe('ru');
  });

  it('a profile update within the same session is applied to the current user', async () => {
    await useAuthStore.getState().setSession(userA, tokensFor('a'));
    const epoch = useAuthStore.getState().sessionEpoch;

    const applied = useAuthStore.getState().patchUser({ locale: 'en' }, epoch);

    expect(applied).toBe(true);
    expect(useAuthStore.getState().user?.id).toBe('user-a');
    expect(useAuthStore.getState().user?.locale).toBe('en');
  });

  it('a profile update patches whatever the session currently holds, not a captured copy', async () => {
    await useAuthStore.getState().setSession(userA, tokensFor('a'));
    const epoch = useAuthStore.getState().sessionEpoch;
    // Something else in the same session updated the user first — an avatar
    // upload, say. The locale patch must not undo it.
    useAuthStore.getState().patchUser({ firstName: 'Renamed' }, epoch);

    useAuthStore.getState().patchUser({ locale: 'en' }, epoch);

    expect(useAuthStore.getState().user?.firstName).toBe('Renamed');
    expect(useAuthStore.getState().user?.locale).toBe('en');
  });

  it('a sign-out that starts during a sign-in’s storage write wins', async () => {
    const writes = deferredWrites();
    const signIn = useAuthStore.getState().setSession(userA, tokensFor('a'));
    await settle();

    const signOut = useAuthStore.getState().clear();
    writes.releaseAll();
    await settle();
    writes.releaseAll();
    await Promise.all([signIn, signOut]);
    await settle();
    writes.releaseAll();
    await settle();

    // The person asked to be signed out after asking to be signed in. The
    // later instruction is the one that must hold.
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
