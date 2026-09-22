import { BranchStaffRole, PartnerBranchQrStatus } from '../enums/partner-branch';

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

/**
 * One posting on an employee card.
 *
 * `deactivatedAt` is carried rather than inferred from `isActive`: a card
 * that says "no longer here" without saying since when answers a different
 * question than the one somebody reading last quarter's receipt is asking.
 */
export interface PartnerEmployeeCardAssignmentDto {
  branchId: string;
  branchName: string;
  branchAddress: string;
  role: string;
  isActive: boolean;
  assignedAt: string;
  deactivatedAt: string | null;
}

/**
 * Who a permanent employee code belongs to.
 *
 * A statement line and a confirmed purchase name `EMP-007` and nothing else,
 * on purpose: a platform user id means nothing to the partner reading it,
 * and a name on every row is more personal data on more screens than the row
 * needs. This is what the panel fetches when somebody clicks the code.
 *
 * Deliberately narrow. No phone, no email, no user id — a partner checking
 * who confirmed a sale needs a name and a place, not a way to reach that
 * person through the platform's records. `assignments` holds only the
 * postings the caller is entitled to see and may be empty; a code the caller
 * may not resolve is a 404, indistinguishable from one that does not exist.
 */
export interface PartnerEmployeeCardDto {
  code: string;
  firstName: string;
  lastName: string;
  assignments: PartnerEmployeeCardAssignmentDto[];
  /** Partner-scoped roles, including an all-branch grant that has no posting. */
  roles: { role: string; allBranches: boolean }[];
}
