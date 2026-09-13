import type {
  CreatePartnerRequestDto,
  PartnerBranchDto,
  PartnerBranchQrCodeDto,
  PartnerBranchStaffAssignmentDto,
  PartnerDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export const partnersApi = {
  async list() {
    const { data } = await httpClient.get<ApiEnvelope<PartnerDto[]>>('/partners');
    return data.data;
  },
  async create(dto: CreatePartnerRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerDto>>('/partners', dto);
    return data.data;
  },
  /**
   * Admits an application. The rate the applicant proposed is what the
   * partner trades on — approval is a yes to their offer, not a place to
   * type a different number.
   */
  async approve(id: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerDto>>(`/partners/${id}/approve`, {});
    return data.data;
  },

  /** Turns an application down. The reason is required and is recorded. */
  async reject(id: string, reason: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerDto>>(`/partners/${id}/reject`, {
      reason,
    });
    return data.data;
  },

  async setActive(id: string, isActive: boolean) {
    const { data } = await httpClient.patch<ApiEnvelope<PartnerDto>>(`/partners/${id}/active`, {
      isActive,
    });
    return data.data;
  },

  /** Fuel-station branches task: the full hierarchy view admin oversight needs. */
  async listBranches(id: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerBranchDto[]>>(`/partners/${id}/branches`);
    return data.data;
  },

  /** Every branch-staff assignment for this partner — the staff audit trail. */
  async listStaff(id: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerBranchStaffAssignmentDto[]>>(
      `/partners/${id}/staff`,
    );
    return data.data;
  },

  /** A branch's current active QR, or null — the QR audit trail. */
  async getBranchQr(id: string, branchId: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerBranchQrCodeDto | null>>(
      `/partners/${id}/branches/${branchId}/qr`,
    );
    return data.data;
  },
};
