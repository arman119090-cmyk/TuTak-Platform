import axios from 'axios';
import type { AuthResponseDto } from '@tutak/shared-types';
import { API_BASE_URL, httpClient, ApiEnvelope } from '../httpClient';

export const authApi = {
  async login(phone: string, password: string, deviceId: string) {
    const { data } = await httpClient.post<ApiEnvelope<AuthResponseDto>>('/auth/login', {
      phone,
      password,
      deviceId,
    });
    return data.data;
  },
  async logout(deviceId: string) {
    await httpClient.post('/auth/logout', { deviceId });
  },
};

/**
 * Accepts a staff invitation on behalf of a session that is not stored yet.
 *
 * Called from the sign-in screen, between the first sign-in (which proved the
 * phone, but carries no partner role) and the second (which picks the new
 * role up). The token is handed over explicitly and the shared client is
 * bypassed: that client adds whatever session is in the store — possibly a
 * previous person's on a shared till computer — and answers a 401 with a
 * refresh of that other session.
 */
export async function acceptInvitation(
  invitationToken: string,
  accessToken: string,
): Promise<{ partnerId: string; role: string; employeeCode: string; branchIds: string[] }> {
  const { data } = await axios.post<
    ApiEnvelope<{ partnerId: string; role: string; employeeCode: string; branchIds: string[] }>
  >(
    `${API_BASE_URL}/partner-invitations/accept`,
    { token: invitationToken },
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15_000 },
  );
  return data.data;
}
