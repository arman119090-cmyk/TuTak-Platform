import { useEffect, useRef } from 'react';
import { useAuthStore } from '../data/stores/authStore';
import { registerPushToken } from '../data/push/registerPushToken';

/**
 * Registers this device for notifications once a session exists.
 *
 * Deliberately here rather than inside the auth store. A store holds state;
 * making it reach out to a notification service on write drags the network
 * layer into it — and the resulting import cycle (store → api → httpClient →
 * store) is what made the first attempt need a dynamic import, which broke
 * the test runner.
 *
 * Runs once per signed-in session, not on every render: the permission
 * prompt should follow a sign-in, and re-registering the same token on every
 * navigation is a request that achieves nothing.
 */
export function usePushRegistration(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || registeredFor.current === userId) return;
    registeredFor.current = userId;
    // Not awaited, and it never rejects — nothing in the app should wait on
    // a notification service.
    void registerPushToken();
  }, [userId]);
}
