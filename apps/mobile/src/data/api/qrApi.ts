import type { IssueQrRequestDto, QrCodeDto, RedeemQrRequestDto, RedeemQrResponseDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from './httpClient';

export const qrApi = {
  async issue(dto: IssueQrRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<QrCodeDto>>('/qr/issue', dto);
    return data.data;
  },

  async redeem(dto: RedeemQrRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<RedeemQrResponseDto>>('/qr/redeem', dto);
    return data.data;
  },
};
