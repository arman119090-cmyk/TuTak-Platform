'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Select } from '@tutak/design/web';
import { canManageShift, getPrimaryPartnerId, useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';
import { apiErrorMessage, shiftApi } from '@/lib/api/partnerOrderApi';

/**
 * "Начать смену / Завершить смену" (spec §6, §75) — on every page of the
 * cabinet, because a cashier needs it before anything else. Several
 * employees can be on shift at one branch at once; yesterday's forgotten
 * shifts are closed by the server, never by this bar. During a partner's
 * one-off rollout window the bar warns rather than blocks; after it, every
 * cash-desk action is refused without a shift.
 *
 * Shown to whoever holds a permission whose actions need a shift — an
 * owner, a manager or a cashier alike — never decided by a "primary role".
 */
export function ShiftBar() {
  const { user } = useAuthStore();
  const allowed = canManageShift(user);
  const partnerId = allowed ? getPrimaryPartnerId(user) : null;
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: me } = useQuery({
    queryKey: ['my-shift', partnerId],
    queryFn: () => shiftApi.me(partnerId!),
    enabled: !!partnerId,
    refetchInterval: 60_000,
  });
  const { data: branches } = useQuery({
    queryKey: ['partner-branches', partnerId],
    queryFn: () => partnerApi.listBranches(partnerId!),
    enabled: !!partnerId,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['my-shift', partnerId] });
  const start = useMutation({
    mutationFn: () => shiftApi.start(branchId || branches?.[0]?.id || ''),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: (err) => setError(apiErrorMessage(err, 'Could not start the shift')),
  });
  const end = useMutation({ mutationFn: () => shiftApi.end(), onSuccess: () => void refresh() });

  if (!partnerId || !me) return null;
  const activeBranches = (branches ?? []).filter((b) => b.isActive);
  const branchName = (id: string) => activeBranches.find((b) => b.id === id)?.name ?? '';
  const required = me.shiftsRequiredNow;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      {me.shift ? (
        <>
          <Badge tone="available">On shift · {branchName(me.shift.branchId)}</Badge>
          <span className="text-[13px] text-muted">since {new Date(me.shift.startedAt).toLocaleTimeString()}</span>
          <Button size="sm" variant="secondary" loading={end.isPending} onClick={() => end.mutate()}>
            End shift
          </Button>
        </>
      ) : activeBranches.length === 0 ? (
        <span className="text-[13px] text-danger-text">
          Shifts are tied to a location. Create a location (for an online-only shop, for example “Online / office”) under Locations to start a shift.
        </span>
      ) : (
        <>
          <Badge tone={required ? 'danger' : 'pending'}>
            {required ? 'Start your shift to confirm payments' : 'Start your shift'}
          </Badge>
          {!required && me.shiftsRequiredFrom ? (
            <span className="text-[13px] text-muted">
              Shifts become mandatory on {new Date(me.shiftsRequiredFrom).toLocaleDateString()}
            </span>
          ) : null}
          {activeBranches.length > 1 ? (
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Choose location</option>
              {activeBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          ) : null}
          <Button
            size="sm"
            loading={start.isPending}
            disabled={activeBranches.length > 1 && !branchId}
            onClick={() => start.mutate()}
          >
            Start shift
          </Button>
        </>
      )}
      {error ? <span className="text-[13px] text-danger-text">{error}</span> : null}
    </div>
  );
}
