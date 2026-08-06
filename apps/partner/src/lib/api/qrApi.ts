import type { IssueQrRequestDto, QrCodeDto } from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export const qrApi = {
  async issue(dto: IssueQrRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<QrCodeDto>>('/qr/issue', dto);
    return data.data;
  },
};
