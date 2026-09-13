import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The eye on a password box.
 *
 * Extracted from `OtpRegisterScreen`, which had the only one in the app. The
 * other five password fields — sign in, reset, change, and the one that
 * confirms deleting an account — had none, so everywhere except registration
 * a person typed blind.
 *
 * That is worse on a phone than it sounds. A mistyped character is invisible,
 * autocorrect and the number/letter keyboard switch both interfere, and the
 * only feedback is a refusal that reads as "you got your password wrong". The
 * account this matters most for is the administrator's, whose password is
 * generated, unmemorised and read off another screen.
 *
 * Always starts hidden and is never remembered: nothing here is stored, and a
 * revealed field goes back to dots the moment the screen is left.
 *
 * The label says what pressing it does, not what is on screen — a person using
 * a screen reader gains nothing from being told about pixels.
 */
export function usePasswordReveal() {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);

  return {
    /** Pass to `TextField`'s `secureTextEntry` — inverted, because it asks whether to hide. */
    secureTextEntry: !revealed,
    revealToggle: {
      revealed,
      onToggle: () => setRevealed((on) => !on),
      label: revealed ? t('auth.hidePassword') : t('auth.showPassword'),
    },
  };
}
