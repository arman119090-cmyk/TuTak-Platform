import type { PaginatedResultDto, Role } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export interface AdminUserDto {
  id: string;
  phone: string;
  email: string | null;
  firstName: string;
  lastName: string;
  isActive: boolean;
  createdAt: string;
  roles: { role: { name: string }; partnerId: string | null }[];
  wallet: { availableBonus: string } | null;
}

export interface SystemOverviewDto {
  userCount: number;
  partnerCount: number;
  transactionCount: number;
  totalAvailableBonus: string;
  totalPendingBonus: string;
  totalReservedBonus: string;
}

export const adminApi = {
  async listUsers(cursor?: string) {
    const { data } = await httpClient.get<ApiEnvelope<PaginatedResultDto<AdminUserDto>>>(
      '/admin/users',
      { params: { cursor } },
    );
    return data.data;
  },

  async assignRole(userId: string, role: Role, partnerId?: string) {
    const { data } = await httpClient.post('/admin/users/roles', { userId, role, partnerId });
    return data.data;
  },

  async setUserActive(id: string, isActive: boolean) {
    const { data } = await httpClient.patch(`/admin/users/${id}/active`, { isActive });
    return data.data;
  },

  async overview() {
    const { data } = await httpClient.get<ApiEnvelope<SystemOverviewDto>>('/admin/overview');
    return data.data;
  },
};
