import { Linking } from 'react-native';

/**
 * Where "Open FastCharge app" sends the customer — requirement 1 of
 * docs/FASTCHARGE_INTEGRATION_2026-08-25.md: "TuTak must NOT start or stop
 * FastCharge chargers... replace the control with a button/deep-link that
 * opens the FastCharge app instead".
 *
 * No real FastCharge app scheme/universal link exists in any documentation
 * available to this integration — see the completion report's "left out of
 * scope" section. This is a placeholder https URL chosen only so the button
 * has somewhere real to attempt to go and the flow is fully exercised (an
 * https URL falls through to a store/web listing even with no app installed,
 * unlike a custom scheme, which errors outright with nothing configured).
 * The one line to change once FastCharge hands over their real scheme or
 * universal link is `FASTCHARGE_APP_URL` below — nothing else in this file
 * or its caller needs to.
 */
export const FASTCHARGE_APP_URL = 'https://fastcharge.am/app';

/** Best-effort open; returns whether it succeeded so the caller can show its own error. */
export async function openFastChargeApp(): Promise<boolean> {
  try {
    await Linking.openURL(FASTCHARGE_APP_URL);
    return true;
  } catch {
    return false;
  }
}
