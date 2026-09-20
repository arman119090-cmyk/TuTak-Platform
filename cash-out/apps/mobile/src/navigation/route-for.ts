import type { DriverProfileDto } from '@cashout/contracts';

export type AppRoute =
  '/onboarding' | '/park/select' | '/park/not-found' | '/park/denied' | '/park/auto' | '/(tabs)';

type Resolution = Pick<DriverProfileDto, 'resolution' | 'membershipCount' | 'verificationStatus'>;

/**
 * Where the driver belongs, decided once, from what the server said.
 *
 * The server resolves the phone against every park's roster; the app only
 * routes on the answer. No screen may guess whether it is allowed to show.
 */
export function routeForProfile(
  status: 'loading' | 'signedOut' | 'signedIn',
  profile: Resolution | null,
): AppRoute | null {
  if (status === 'loading') return null;
  if (status === 'signedOut' || !profile) return '/onboarding';
  if (profile.verificationStatus === 'BLOCKED') return '/park/denied';
  switch (profile.resolution) {
    case 'CHOOSE':
      return '/park/select';
    case 'NONE':
      return profile.membershipCount === 0 ? '/park/not-found' : '/park/denied';
    case 'ACTIVE':
    default:
      return '/(tabs)';
  }
}

/**
 * Right after the code is accepted. One park is chosen for the driver, and
 * shown for a moment; anything else goes through the ordinary router.
 */
export function routeAfterSignIn(profile: Resolution | null): AppRoute {
  if (profile?.resolution === 'ACTIVE' && profile.membershipCount === 1) return '/park/auto';
  return routeForProfile('signedIn', profile) ?? '/onboarding';
}
