'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@tutak/design/web';
import { partnersApi } from '@/lib/api/partnersApi';

/**
 * Fuel-station branches task: the admin's full-hierarchy, read-only view —
 * every branch a partner has, who is assigned to each, and whether it has a
 * live scan-to-pay QR. Platform admins already bypass every branch-scope
 * check on the read endpoints this calls (`isPlatformAdmin`), so this is
 * pure oversight: no issue/rotate/revoke/assign actions live here — those
 * stay the partner owner's own call, made in their own portal.
 */
export function PartnerBranchAudit({ partnerId }: { partnerId: string }) {
  const { data: branches, isLoading: branchesLoading } = useQuery({
    queryKey: ['admin-partner-branches', partnerId],
    queryFn: () => partnersApi.listBranches(partnerId),
  });
  const { data: staff, isLoading: staffLoading } = useQuery({
    queryKey: ['admin-partner-staff', partnerId],
    queryFn: () => partnersApi.listStaff(partnerId),
  });

  if (branchesLoading || staffLoading) {
    return <p className="p-4 text-[12px] text-faint">Loading branches…</p>;
  }

  if (!branches || branches.length === 0) {
    return <p className="p-4 text-[12px] text-faint">This partner has no branches.</p>;
  }

  return (
    <div className="space-y-3 p-4">
      {branches.map((branch) => {
        const branchStaff = (staff ?? []).filter((s) => s.partnerBranchId === branch.id);
        return <BranchRow key={branch.id} partnerId={partnerId} branch={branch} staff={branchStaff} />;
      })}
    </div>
  );
}

function BranchRow({
  partnerId,
  branch,
  staff,
}: {
  partnerId: string;
  branch: { id: string; name: string; city: string; isActive: boolean; fuelType?: string | null };
  staff: Array<{ id: string; employeeDisplayCode: string; role: string; isActive: boolean }>;
}) {
  const { data: qr } = useQuery({
    queryKey: ['admin-branch-qr', partnerId, branch.id],
    queryFn: () => partnersApi.getBranchQr(partnerId, branch.id),
  });

  const activeStaff = staff.filter((s) => s.isActive);

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-[13px] font-medium text-ink">{branch.name}</span>
          <span className="ml-2 text-[12px] text-faint">{branch.city}</span>
        </div>
        <div className="flex items-center gap-2">
          {branch.fuelType ? <Badge tone="neutral">{branch.fuelType.toLowerCase()}</Badge> : null}
          <Badge tone={branch.isActive ? 'available' : 'neutral'}>
            {branch.isActive ? 'Open' : 'Closed'}
          </Badge>
          <Badge tone={qr ? 'available' : 'neutral'}>{qr ? 'QR active' : 'No QR'}</Badge>
        </div>
      </div>
      <div className="mt-2 text-[12px] text-muted">
        {activeStaff.length === 0
          ? 'No active staff assigned.'
          : activeStaff.map((s) => `${s.employeeDisplayCode} (${s.role.toLowerCase()})`).join(', ')}
      </div>
    </div>
  );
}
