import { useCallback } from 'react';
import { isErrorCode } from '@cashout/contracts';
import { ApiError } from '../api/client';
import { useI18n } from '../i18n/i18n';

/**
 * Turns anything thrown by the API into a sentence in the driver's language.
 *
 * Server messages are for engineers; they are English, and they sometimes name
 * internals. The driver sees a translated string chosen by the stable error
 * code, and an unrecognised code falls back to a generic apology rather than
 * leaking whatever the server said.
 */
export function useErrorMessage() {
  const { t } = useI18n();

  return useCallback(
    (error: unknown): string => {
      if (error instanceof ApiError) {
        if (error.isNetwork) return t('errors.network');
        if (isErrorCode(error.code)) {
          return t(`errors.${error.code}` as never);
        }
      }
      return t('common.error');
    },
    [t],
  );
}
