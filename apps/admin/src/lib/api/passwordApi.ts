import { httpClient } from '../httpClient';

export const passwordApi = {
  /**
   * The one endpoint an account under forced rotation may still call — see
   * `@AllowsPendingPasswordChange` on the API. The current password is
   * required so that a stolen access token alone cannot lock an
   * administrator out of their own account.
   */
  async change(currentPassword: string, newPassword: string) {
    await httpClient.post('/auth/change-password', { currentPassword, newPassword });
  },
};
