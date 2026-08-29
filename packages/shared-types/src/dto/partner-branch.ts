import { BranchFuelType, BranchStaffRole, PartnerBranchQrStatus } from '../enums/partner-branch';

/** What a branch QR scan resolves to — no amount, no commercial data. */
export interface PartnerBranchQrResolveResponseDto {
  partnerId: string;
  partnerBranchId: string;
  partnerDisplayName: string;
  branchName: string;
}

export interface PartnerBranchQrCodeDto {
  id: string;
  partnerId: string;
  partnerBranchId: string;
  token: string;
  status: PartnerBranchQrStatus;
  createdAt: string;
  revokedAt: string | null;
}

export interface PartnerBranchStaffAssignmentDto {
  id: string;
  partnerId: string;
  partnerBranchId: string;
  userId: string;
  role: BranchStaffRole;
  employeeDisplayCode: string;
  isActive: boolean;
  createdAt: string;
  deactivatedAt: string | null;
  user?: { id: string; firstName: string; lastName: string; phone: string };
  branch?: { id: string; name: string };
}

export interface AssignBranchStaffRequestDto {
  userId: string;
  role?: BranchStaffRole;
  employeeDisplayCode?: string;
}

export interface SetAllBranchesRequestDto {
  userId: string;
  allBranches: boolean;
}

export interface SetBranchFuelTypeRequestDto {
  fuelType: BranchFuelType;
}
