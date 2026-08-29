import type {
  AssignBranchStaffRequestDto,
  BranchFuelType,
  PartnerAnalyticsDto,
  PartnerBranchDto,
  PartnerBranchQrCodeDto,
  PartnerBranchStaffAssignmentDto,
  PartnerDto,
  PartnerOfferingDto,
  SetAllBranchesRequestDto,
  TransactionDto,
  PaginatedResultDto,
} from '@tutak/shared-types';
import { httpClient, ApiEnvelope } from '../httpClient';

export const partnerApi = {
  async get(id: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerDto>>(`/partners/${id}`);
    return data.data;
  },

  /**
   * The public profile's "about" text — confirmed with Arman 2026-08-23. No
   * review step on the API side, unlike `mediaApi.submit`: this takes effect
   * for every customer the instant it saves.
   */
  async updateAbout(id: string, about: string | null) {
    const { data } = await httpClient.patch<ApiEnvelope<PartnerDto>>(`/partners/${id}/about`, {
      about,
    });
    return data.data;
  },

  /**
   * What a `fuel`-category station actually sells (Arman, 2026-08-26) — see
   * `PartnerDto.sellsGas`/`sellsPetrol`. Same immediacy as `updateAbout`:
   * no review step, live on the customer's map the instant it saves.
   */
  async updateFuelTypes(id: string, fuelTypes: { sellsGas?: boolean; sellsPetrol?: boolean }) {
    const { data } = await httpClient.patch<ApiEnvelope<PartnerDto>>(
      `/partners/${id}/fuel-types`,
      fuelTypes,
    );
    return data.data;
  },

  /**
   * Replaces the whole offerings list in one call — see
   * `ReplacePartnerOfferingsDto` on the API for why this is a bulk replace
   * rather than per-row add/update/delete. The array's order is what the
   * customer sees; reordering is "submit it again in the new order".
   */
  async replaceOfferings(
    id: string,
    offerings: Array<{ name: string; description?: string | null; price: string }>,
  ) {
    const { data } = await httpClient.put<ApiEnvelope<PartnerOfferingDto[]>>(
      `/partners/${id}/offerings`,
      { offerings },
    );
    return data.data;
  },

  /** A partner's own locations — spec: partner self-service branches (Arman, 2026-08-26). */
  async listBranches(id: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerBranchDto[]>>(
      `/partners/${id}/branches`,
    );
    return data.data;
  },

  async createBranch(
    id: string,
    branch: { name: string; address: string; city: string; latitude: number; longitude: number },
  ) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerBranchDto>>(
      `/partners/${id}/branches`,
      branch,
    );
    return data.data;
  },

  async updateBranch(
    id: string,
    branchId: string,
    branch: Partial<{ name: string; address: string; city: string; latitude: number; longitude: number }>,
  ) {
    const { data } = await httpClient.patch<ApiEnvelope<PartnerBranchDto>>(
      `/partners/${id}/branches/${branchId}`,
      branch,
    );
    return data.data;
  },

  /** Deactivates/reactivates rather than deleting — see `PartnerBranchDto.isActive`. */
  async setBranchActive(id: string, branchId: string, isActive: boolean) {
    const { data } = await httpClient.patch<ApiEnvelope<PartnerBranchDto>>(
      `/partners/${id}/branches/${branchId}/active`,
      { isActive },
    );
    return data.data;
  },

  /** Fuel-station branches task: classifies one branch's actual product — never guessed. */
  async setBranchFuelType(id: string, branchId: string, fuelType: BranchFuelType) {
    const { data } = await httpClient.patch<ApiEnvelope<PartnerBranchDto>>(
      `/partners/${id}/branches/${branchId}/fuel-type`,
      { fuelType },
    );
    return data.data;
  },

  async listBranchStaff(id: string, branchId: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerBranchStaffAssignmentDto[]>>(
      `/partners/${id}/branches/${branchId}/staff`,
    );
    return data.data;
  },

  async assignBranchStaff(id: string, branchId: string, dto: AssignBranchStaffRequestDto) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerBranchStaffAssignmentDto>>(
      `/partners/${id}/branches/${branchId}/staff`,
      dto,
    );
    return data.data;
  },

  async deactivateBranchStaff(id: string, branchId: string, assignmentId: string) {
    const { data } = await httpClient.patch<ApiEnvelope<PartnerBranchStaffAssignmentDto>>(
      `/partners/${id}/branches/${branchId}/staff/${assignmentId}/deactivate`,
      {},
    );
    return data.data;
  },

  async listStaff(id: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerBranchStaffAssignmentDto[]>>(
      `/partners/${id}/staff`,
    );
    return data.data;
  },

  /** Owner granting/revoking a trusted manager's all-branch reach. */
  async setAllBranches(id: string, dto: SetAllBranchesRequestDto) {
    const { data } = await httpClient.patch(`/partners/${id}/staff/all-branches`, dto);
    return data.data;
  },

  async getBranchQr(id: string, branchId: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerBranchQrCodeDto | null>>(
      `/partners/${id}/branches/${branchId}/qr`,
    );
    return data.data;
  },

  async issueBranchQr(id: string, branchId: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerBranchQrCodeDto>>(
      `/partners/${id}/branches/${branchId}/qr`,
    );
    return data.data;
  },

  async rotateBranchQr(id: string, branchId: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerBranchQrCodeDto>>(
      `/partners/${id}/branches/${branchId}/qr/rotate`,
    );
    return data.data;
  },

  async revokeBranchQr(id: string, branchId: string) {
    const { data } = await httpClient.post<ApiEnvelope<PartnerBranchQrCodeDto>>(
      `/partners/${id}/branches/${branchId}/qr/revoke`,
    );
    return data.data;
  },

  async transactions(id: string, cursor?: string) {
    const { data } = await httpClient.get<ApiEnvelope<PaginatedResultDto<TransactionDto>>>(
      `/partners/${id}/transactions`,
      { params: { cursor } },
    );
    return data.data;
  },

  async analytics(id: string, from?: string, to?: string) {
    const { data } = await httpClient.get<ApiEnvelope<PartnerAnalyticsDto>>(`/analytics/partners/${id}`, {
      params: { from, to },
    });
    return data.data;
  },
};
