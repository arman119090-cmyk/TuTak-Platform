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

let lastSessionEpoch = useAuthStore.getState().sessionEpoch;
let lastHydrated = useAuthStore.getState().isHydrated;

useAuthStore.subscribe((state) => {
  const sessionChanged = state.sessionEpoch !== lastSessionEpoch;
  // Hydration is not a session change — the epoch deliberately does not move
  // for it — but it is the moment a restored session's user first exists, so
  // a cold start has to be handled too, and only once.
  const justHydrated = state.isHydrated && !lastHydrated;
  if (!sessionChanged && !justHydrated) return;

  lastSessionEpoch = state.sessionEpoch;
  lastHydrated = state.isHydrated;
  applySessionLocale(state.user?.locale);
});
