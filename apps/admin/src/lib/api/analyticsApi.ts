import { httpClient, ApiEnvelope } from '../httpClient';

export interface PlatformOverviewDto {
  transactionsByType: { type: string; count: number; totalAmount: string }[];
  transactionsByStatus: { status: string; count: number }[];
  bonusTotals: { lifetimeEarned: string; lifetimeSpent: string; currentlyAvailable: string };
}

export const analyticsApi = {
  async platform() {
    const { data } = await httpClient.get<ApiEnvelope<PlatformOverviewDto>>('/analytics/platform');
    return data.data;
  },
};
