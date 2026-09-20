import { routeAfterSignIn, routeForProfile } from '../src/navigation/route-for';

const base = { verificationStatus: 'VERIFIED' as const };

describe('routing on the server’s park resolution', () => {
  it('waits while the session loads and sends a signed-out phone to onboarding', () => {
    expect(routeForProfile('loading', null)).toBeNull();
    expect(routeForProfile('signedOut', null)).toBe('/onboarding');
    expect(routeForProfile('signedIn', null)).toBe('/onboarding');
  });

  it('one park: straight to the app', () => {
    expect(routeForProfile('signedIn', { ...base, resolution: 'ACTIVE', membershipCount: 1 })).toBe(
      '/(tabs)',
    );
  });

  it('several parks and none active: the driver chooses', () => {
    expect(routeForProfile('signedIn', { ...base, resolution: 'CHOOSE', membershipCount: 3 })).toBe(
      '/park/select',
    );
  });

  it('no park at all: "your number is not registered"', () => {
    expect(routeForProfile('signedIn', { ...base, resolution: 'NONE', membershipCount: 0 })).toBe(
      '/park/not-found',
    );
  });

  it('in a roster but not eligible: access denied, not "not found"', () => {
    expect(routeForProfile('signedIn', { ...base, resolution: 'NONE', membershipCount: 2 })).toBe(
      '/park/denied',
    );
  });

  it('a blocked driver is denied whatever the roster says', () => {
    expect(
      routeForProfile('signedIn', {
        verificationStatus: 'BLOCKED',
        resolution: 'ACTIVE',
        membershipCount: 1,
      }),
    ).toBe('/park/denied');
  });
});

describe('right after sign-in', () => {
  it('shows the automatic choice when there is exactly one park', () => {
    expect(routeAfterSignIn({ ...base, resolution: 'ACTIVE', membershipCount: 1 })).toBe(
      '/park/auto',
    );
  });

  it('otherwise routes as the splash would', () => {
    expect(routeAfterSignIn({ ...base, resolution: 'CHOOSE', membershipCount: 2 })).toBe(
      '/park/select',
    );
    expect(routeAfterSignIn({ ...base, resolution: 'ACTIVE', membershipCount: 2 })).toBe('/(tabs)');
    expect(routeAfterSignIn(null)).toBe('/onboarding');
  });
});
