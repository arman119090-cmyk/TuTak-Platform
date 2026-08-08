import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { notificationsApi } from '../api/notificationsApi';
import { getDeviceId } from '../stores/authStore';

/**
 * Asks for permission, gets this device's push token, and tells the server.
 *
 * Called after a session exists, not at launch. A permission prompt on first
 * open, before the customer has seen anything, is the reliable way to be
 * refused — and a refusal on iOS is close to permanent, since the system
 * dialog never appears again.
 *
 * Returns quietly on every path that cannot produce a token: a simulator has
 * no push service, a refused prompt is an answer to respect rather than
 * retry, and a build without an EAS project id has nothing to register
 * against. None of those are errors the customer should be shown — they were
 * about to look at their wallet, not at a notification setting.
 */
export async function registerPushToken(): Promise<'registered' | 'skipped' | 'denied'> {
  // Simulators and emulators have no notification service to register with.
  if (!Device.isDevice) return 'skipped';

  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      // Only ask if the system will actually show a dialog. Asking again
      // after a denial silently returns the denial and wastes a round trip.
      if (!existing.canAskAgain) return 'denied';
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return 'denied';

    // Required on Android 8+, or notifications arrive with no sound and no
    // heads-up display.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'TuTak',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants.easConfig as { projectId?: string } | undefined)?.projectId;
    if (!projectId) return 'skipped';

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    await notificationsApi.registerPushToken({
      // The same device id the session was opened with, so the server
      // updates that device rather than accumulating a second row for the
      // same phone.
      deviceId: getDeviceId(),
      platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
      pushToken: token,
      deviceName: Device.deviceName ?? undefined,
    });

    return 'registered';
  } catch {
    // Never surfaced. Failing to register for notifications must not stop
    // someone using the app.
    return 'skipped';
  }
}