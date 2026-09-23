export enum BranchFuelType {
  PETROL = 'PETROL',
  METHANE_CNG = 'METHANE_CNG',
  PROPANE_LPG = 'PROPANE_LPG',
}

export enum BranchStaffRole {
  STAFF = 'STAFF',
  MANAGER = 'MANAGER',
}

export enum PartnerBranchQrStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

/**
 * Where a branch stands in its life.
 *
 * `isActive` on the same object answers the one question the rest of the
 * product asks — may a purchase be taken here right now — and keeps
 * answering it. This says *why*, and the two reasons a branch is shut need
 * different screens: a location closed for refurbishment comes back, one
 * that is gone does not.
 */
export enum PartnerBranchState {
  /** Open. Purchases may be taken here. */
  ACTIVE = 'ACTIVE',
  /** Shut for now. No new purchases; returns, disputes and history continue. */
  SUSPENDED = 'SUSPENDED',
  /** Closed for good. As suspended, and out of the ordinary branch list. */
  ARCHIVED = 'ARCHIVED',
}
