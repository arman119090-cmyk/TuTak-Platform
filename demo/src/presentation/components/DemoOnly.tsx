import React from 'react';
import Constants from 'expo-constants';
import { shouldUseMocks } from '../../data/api/mockGate';

/**
 * Renders its children only in the demonstration app.
 *
 * There is one thing a demonstration cannot do by running the real code: put
 * a QR code in front of the camera. `expo-camera` works in Expo Go, the
 * scanner opens, and then the walkthrough stops — there is nothing to scan,
 * because a merchant would have issued the code. Everything downstream of
 * that scan (the confirmation, the points, the receipt) becomes unreachable.
 *
 * So the demo gets an affordance that stands in for the merchant, and this
 * component is what keeps it there. It reads the same two-key gate the HTTP
 * transport reads — `useMocks` **and** `appEnv === 'demo'`, neither of which
 * `app.config.js` can produce — so a shortcut wrapped in this cannot appear
 * in a build anybody installs as TuTak.
 *
 * Rules for what belongs inside it:
 *
 *  - Only affordances that substitute for the physical world: a code to
 *    scan, a card to tap, a charger to plug in.
 *  - Never a shortcut past a check. Authentication, payment authorisation
 *    and idempotency run their real code in the demo; the mock transport
 *    answers them, and that answering is confined to `mockAdapter.ts`.
 *  - Nothing that changes what the production build renders. This returns
 *    `null` there, and the surrounding screen must read correctly without it.
 */
export function DemoOnly({ children }: { children: React.ReactNode }) {
  if (!shouldUseMocks(Constants.expoConfig?.extra)) return null;
  return <>{children}</>;
}

/** The same decision, for code that is not JSX. */
export function isDemoBuild(): boolean {
  return shouldUseMocks(Constants.expoConfig?.extra);
}
