import { isSupportedLocale } from '@tutak/i18n';
import { useAuthStore } from '../../data/stores/authStore';
import i18n from './i18n';

/**
 * Makes the interface language follow the account rather than the handset.
 *
 * `i18n.ts` starts the app in the device's language, which is the right guess
 * for someone who has not signed in yet. Once somebody has, the guess is
 * beaten by a fact: their profile carries a `locale` they chose, and it is
 * stored on the account precisely so it survives a new phone. Without this,
 * the language stayed wherever the previous person on this handset left it,
 * and a customer whose profile says `ru` opened the app in `hy` because that
 * is what the last person picked.
 *
 * Applied on a session change — sign-in, account switch, and the cold-start
 * restore — and never in between, so a language chosen from Settings during a
 * session is not overwritten under the person using it. That choice is
 * persisted to the account by `SettingsScreen`, which is what makes it the
 * value this reads on the next sign-in.
 *
 * Subscribed at module scope for the same reason the query cache is: it must
 * outlive any component the sign-out it watches for could unmount.
 */
export function applySessionLocale(locale: string | null | undefined): void {
  if (!locale || !isSupportedLocale(locale)) return;
  if (i18n.language === locale) return;
  void i18n.changeLanguage(locale);
}

let lastUserId: string | null = useAuthStore.getState().user?.id ?? null;

useAuthStore.subscribe((state) => {
  const userId = state.user?.id ?? null;
  if (userId === lastUserId) return;
  lastUserId = userId;
  // Keyed on *who* is signed in rather than on the session counter, for two
  // reasons. The counter moves the moment a sign-in claims the store, which is
  // before the user it signs in exists — reading the profile then would read
  // the previous one. And a language chosen from Settings changes the stored
  // profile without changing who it belongs to, so keying on identity leaves
  // that choice alone where a counter-based check would have to special-case
  // it. Covers sign-in, account switch and the cold-start restore alike.
  if (userId === null) return;
  applySessionLocale(state.user?.locale);
});
