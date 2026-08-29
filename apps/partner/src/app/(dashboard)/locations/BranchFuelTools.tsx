'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BranchFuelType, BranchStaffRole } from '@tutak/shared-types';
import { Badge, Button, Field, Input, Select } from '@tutak/design/web';
import { partnerApi } from '@/lib/api/partnerApi';

const FUEL_LABELS: Record<BranchFuelType, string> = {
  [BranchFuelType.PETROL]: 'Petrol',
  [BranchFuelType.METHANE_CNG]: 'Methane (CNG)',
  [BranchFuelType.PROPANE_LPG]: 'Propane (LPG)',
};

/**
 * Fuel-station branches task: everything specific to a `fuel`-category
 * branch that the plain branch form above does not cover — which product it
 * sells, its own scan-to-pay QR, and who is assigned to work there.
 * Rendered inline per branch, collapsed behind "Manage" so a partner with
 * many branches (or none of them fuel) is not shown an empty panel per row.
 */
export function BranchFuelTools({ partnerId, branchId }: { partnerId: string; branchId: string }) {
  const queryClient = useQueryClient();
  const invalidateBranches = () =>
    queryClient.invalidateQueries({ queryKey: ['partner-branches', partnerId] });

  const { data: qr, isLoading: qrLoading } = useQuery({
    queryKey: ['branch-qr', partnerId, branchId],
    queryFn: () => partnerApi.getBranchQr(partnerId, branchId),
  });
  const invalidateQr = () => queryClient.invalidateQueries({ queryKey: ['branch-qr', partnerId, branchId] });

  const { data: staff, isLoading: staffLoading } = useQuery({
    queryKey: ['branch-staff', partnerId, branchId],
    queryFn: () => partnerApi.listBranchStaff(partnerId, branchId),
  });
  const invalidateStaff = () =>
    queryClient.invalidateQueries({ queryKey: ['branch-staff', partnerId, branchId] });

  const setFuelType = useMutation({
    mutationFn: (fuelType: BranchFuelType) => partnerApi.setBranchFuelType(partnerId, branchId, fuelType),
    onSuccess: () => void invalidateBranches(),
  });

  const issueQr = useMutation({
    mutationFn: () => partnerApi.issueBranchQr(partnerId, branchId),
    onSuccess: () => void invalidateQr(),
  });
  const rotateQr = useMutation({
    mutationFn: () => partnerApi.rotateBranchQr(partnerId, branchId),
    onSuccess: () => void invalidateQr(),
  });
  const revokeQr = useMutation({
    mutationFn: () => partnerApi.revokeBranchQr(partnerId, branchId),
    onSuccess: () => void invalidateQr(),
  });

  const [assignForm, setAssignForm] = useState({ userId: '', role: BranchStaffRole.STAFF, code: '' });
  const assign = useMutation({
    mutationFn: () =>
      partnerApi.assignBranchStaff(partnerId, branchId, {
        userId: assignForm.userId.trim(),
        role: assignForm.role,
        employeeDisplayCode: assignForm.code.trim() || undefined,
      }),
    onSuccess: () => {
      setAssignForm({ userId: '', role: BranchStaffRole.STAFF, code: '' });
      void invalidateStaff();
    },
  });

  const deactivate = useMutation({
    mutationFn: (assignmentId: string) => partnerApi.deactivateBranchStaff(partnerId, branchId, assignmentId),
    onSuccess: () => void invalidateStaff(),
  });

  return (
    <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-line p-4 lg:grid-cols-3">
      <div>
        <div className="text-[13px] font-semibold text-ink">Fuel type</div>
        <p className="mt-1 text-[12px] text-faint">
          What this specific location sells. Never guessed from your account&apos;s general gas/petrol
          settings — see Profile.
        </p>
        <Select
          className="mt-2"
          disabled={setFuelType.isPending}
          onChange={(e) => setFuelType.mutate(e.target.value as BranchFuelType)}
        >
          <option value="">Not classified yet</option>
          {Object.values(BranchFuelType).map((ft) => (
            <option key={ft} value={ft}>
              {FUEL_LABELS[ft]}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <div className="text-[13px] font-semibold text-ink">Scan-to-pay QR</div>
        <p className="mt-1 text-[12px] text-faint">
          A customer scans this to open a purchase at this branch specifically — never a general
          code for the whole chain.
        </p>
        {qrLoading ? (
          <p className="mt-2 text-[12px] text-faint">Loading…</p>
        ) : qr ? (
          <div className="mt-2">
            <code className="block break-all rounded bg-canvas p-2 text-[11px] text-muted">
              TUTAK-BRANCH:{qr.token}
            </code>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="secondary" loading={rotateQr.isPending} onClick={() => rotateQr.mutate()}>
                Rotate
              </Button>
              <Button size="sm" variant="destructive" loading={revokeQr.isPending} onClick={() => revokeQr.mutate()}>
                Revoke
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" className="mt-2" loading={issueQr.isPending} onClick={() => issueQr.mutate()}>
            Issue QR code
          </Button>
        )}
      </div>

      <div>
        <div className="text-[13px] font-semibold text-ink">Branch staff</div>
        <p className="mt-1 text-[12px] text-faint">
          Only staff assigned here can see or confirm this branch&apos;s purchases. Assigning requires the
          person to already have a staff role for your account — ask an administrator to add them first,
          then enter their user ID here.
        </p>
        {staffLoading ? (
          <p className="mt-2 text-[12px] text-faint">Loading…</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {(staff ?? []).length === 0 ? (
              <li className="text-[12px] text-faint">Nobody assigned yet.</li>
            ) : (
              (staff ?? []).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-muted">
                    {a.user ? `${a.user.firstName} ${a.user.lastName}` : a.userId} · {a.employeeDisplayCode}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{a.role.toLowerCase()}</Badge>
                    <Button size="sm" variant="tertiary" loading={deactivate.isPending} onClick={() => deactivate.mutate(a.id)}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))
            )}
          </ul>
        )}

        <div className="mt-3 space-y-2">
          <Field label="User ID">
            <Input
              value={assignForm.userId}
              onChange={(e) => setAssignForm((f) => ({ ...f, userId: e.target.value }))}
              placeholder="uuid"
            />
          </Field>
          <Select
            value={assignForm.role}
            onChange={(e) => setAssignForm((f) => ({ ...f, role: e.target.value as BranchStaffRole }))}
          >
            <option value={BranchStaffRole.STAFF}>Staff</option>
            <option value={BranchStaffRole.MANAGER}>Manager</option>
          </Select>
          <Button
            size="sm"
            disabled={!assignForm.userId.trim()}
            loading={assign.isPending}
            onClick={() => assign.mutate()}
          >
            Assign to this branch
          </Button>
          {assign.isError ? (
            <p className="text-[12px] text-danger-text">
              Could not assign — make sure this user already has a staff role for your account.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
