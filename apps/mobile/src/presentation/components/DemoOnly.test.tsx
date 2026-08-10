import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import Constants from 'expo-constants';
import { DemoOnly, isDemoBuild } from './DemoOnly';

// `expo-constants` exposes `expoConfig` as a non-configurable getter, so the
// module is mocked rather than the property redefined.
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: {} } }));

/**
 * The demonstration is allowed one kind of shortcut: standing in for the
 * physical world, where a preview has no merchant to hold up a QR code. It is
 * allowed no shortcut past a check.
 *
 * This proves the first half is switched off everywhere except the
 * demonstration app. The second half is enforced by there being nothing of
 * that kind to test: authentication, payment authorisation and idempotency
 * run their real code in the demo, and the only thing that answers
 * differently is the HTTP transport.
 */
describe('DemoOnly', () => {
  const setExtra = (extra: Record<string, unknown> | null) => {
    (Constants as { expoConfig: unknown }).expoConfig =
      extra === null ? null : { extra };
  };

  afterEach(() => setExtra({}));

  it('renders in the demonstration app', () => {
    setExtra({ useMocks: true, appEnv: 'demo' });

    render(
      <DemoOnly>
        <Text>simulate a scan</Text>
      </DemoOnly>,
    );

    expect(screen.getByText('simulate a scan')).toBeTruthy();
  });

  it.each([
    ['a production build', { appEnv: 'production', useMocks: false }],
    ['a preview build', { appEnv: 'preview', useMocks: false }],
    ['a development build against a real API', { appEnv: 'development', useMocks: false }],
    ['a build where only useMocks was set', { appEnv: 'production', useMocks: true }],
    ['a build where only the name was set', { appEnv: 'demo' }],
    ['a build with no config at all', null],
  ])('renders nothing in %s', (_case, extra) => {
    setExtra(extra as Record<string, unknown> | null);

    render(
      <DemoOnly>
        <Text>simulate a scan</Text>
      </DemoOnly>,
    );

    expect(screen.queryByText('simulate a scan')).toBeNull();
  });

  it('agrees with the transport about which build this is', () => {
    // One decision, read from two places. If these ever disagree, a screen
    // could offer a shortcut while the app talks to a real API.
    setExtra({ useMocks: true, appEnv: 'demo' });
    expect(isDemoBuild()).toBe(true);

    setExtra({ useMocks: true, appEnv: 'production' });
    expect(isDemoBuild()).toBe(false);
  });
});
