'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PartnerStaffInvitationStatusDto,
  type PartnerBranchDto,
  type PartnerStaffInvitationDto,
} from '@tutak/shared-types';
import { Badge, Button, Field, Input, Select, Surface, Table, Td, Th, Tr } from '@tutak/design/web';
import type { AxiosError } from 'axios';
import { partnerApi } from '@/lib/api/partnerApi';
import { dataStateOf } from '@/lib/queryState';
import { LoadError, LoadingNotice, StaleNotice } from '@/lib/components/DataStatus';

const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

const STATUS_LABEL: Record<PartnerStaffInvitationStatusDto, string> = {
  [PartnerStaffInvitationStatusDto.PENDING]: 'Waiting',
  [PartnerStaffInvitationStatusDto.ACCEPTED]: 'Accepted',
  [PartnerStaffInvitationStatusDto.REVOKED]: 'Cancelled',
  [PartnerStaffInvitationStatusDto.EXPIRED]: 'Expired',
};

const STATUS_TONE: Record<PartnerStaffInvitationStatusDto, 'pending' | 'available' | 'neutral'> = {
  [PartnerStaffInvitationStatusDto.PENDING]: 'pending',
  [PartnerStaffInvitationStatusDto.ACCEPTED]: 'available',
  [PartnerStaffInvitationStatusDto.REVOKED]: 'neutral',
  [PartnerStaffInvitationStatusDto.EXPIRED]: 'neutral',
};

const messageOf = (error: unknown): string => {
  const data = (error as AxiosError<{ message?: string }> | undefined)?.response?.data;
  return data?.message ?? 'Could not do that. Please try again.';
};

/**
 * Inviting people to work here, and calling an invitation back.
 *
 * The screen never shows a token and never can: it goes to the invited
 * phone and is stored only as a hash, so an owner reading this page cannot
 * accept on somebody's behalf. That is deliberate, and the note under the
 * form says so — an owner who expects to see a code and does not needs to
 * know why rather than assume something failed.
 */
export function InvitationsCard({
  partnerId,
  branches,
}: {
  partnerId: string;
  branches: PartnerBranchDto[];
}) {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('+374');
  const [role, setRole] = useState('PARTNER_STAFF');
  const [branchId, setBranchId] = useState('');

  const query = useQuery({
    queryKey: ['partner-invitations', partnerId],
    queryFn: () => partnerApi.listInvitations(partnerId),
    enabled: Boolean(partnerId),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['partner-invitations', partnerId] });

  const invite = useMutation({
    mutationFn: () =>
      partnerApi.invite(partnerId, {
        phone: phone.trim(),
        role,
        branchIds: branchId ? [branchId] : [],
      }),
    onSuccess: () => {
      setPhone('+374');
      setBranchId('');
      void invalidate();
    },
  });

  const revoke = useMutation({
    mutationFn: (invitationId: string) => partnerApi.revokeInvitation(partnerId, invitationId),
    onSuccess: () => void invalidate(),
  });

  const resend = useMutation({
    mutationFn: (invitationId: string) => partnerApi.resendInvitation(partnerId, invitationId),
    onSuccess: () => void invalidate(),
  });

  const state = dataStateOf(query);
  const invitations: PartnerStaffInvitationDto[] = query.data ?? [];
  const canInvite = /^\+374\d{8}$/.test(phone.trim());

  return (
    <Surface>
      <h3 className="text-[15px] font-semibold text-ink">Invitations</h3>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Phone">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+37491234567"
            autoComplete="off"
          />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="PARTNER_STAFF">Cashier</option>
            <option value="PARTNER_MANAGER">Manager</option>
          </Select>
        </Field>
        <Field label="Branch">
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">No branch yet</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={() => invite.mutate()} loading={invite.isPending} disabled={!canInvite}>
          Send invitation
        </Button>
      </div>

      <p className="mt-3 text-[12px] text-muted">
        The code goes to that phone by SMS and is never shown here — not even to you. That is what
        makes accepting it proof that the person holds the number. If they did not get it, cancel
        the invitation and send a new one.
      </p>
      {invite.isError ? (
        <p role="alert" className="mt-2 text-[13px] text-danger-text">
          {messageOf(invite.error)}
        </p>
      ) : null}

      <div className="mt-5">
        {state === 'loading' ? <LoadingNotice label="Loading invitations…" /> : null}
        {state === 'error' ? (
          <LoadError
            title="Could not load invitations."
            onRetry={() => void query.refetch()}
            busy={query.isFetching}
          />
        ) : null}
        {state === 'stale' ? (
          <StaleNotice
            asOf={query.dataUpdatedAt}
            what="this invitation list"
            onRetry={() => void query.refetch()}
            busy={query.isFetching}
          />
        ) : null}

        {state !== 'loading' && state !== 'error' ? (
          invitations.length === 0 ? (
            <p className="text-[13px] text-faint">No invitations yet.</p>
          ) : (
            <Table>
              <thead>
                <Tr>
                  <Th>Phone</Th>
                  <Th>Role</Th>
                  <Th>Sent</Th>
                  <Th>Status</Th>
                  <Th align="right">Action</Th>
                </Tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <Tr key={invitation.id}>
                    <Td className="tabular">{invitation.phone}</Td>
                    <Td className="text-muted">
                      {invitation.role === 'PARTNER_MANAGER' ? 'Manager' : 'Cashier'}
                    </Td>
                    <Td className="tabular text-muted">{day(invitation.createdAt)}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[invitation.status]}>
                        {STATUS_LABEL[invitation.status]}
                      </Badge>
                      {invitation.status === PartnerStaffInvitationStatusDto.PENDING ? (
                        <span className="block text-[12px] text-faint">
                          until {day(invitation.expiresAt)}
                        </span>
                      ) : null}
                    </Td>
                    <Td align="right">
                      {invitation.status === PartnerStaffInvitationStatusDto.PENDING ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="tertiary"
                            loading={resend.isPending && resend.variables === invitation.id}
                            onClick={() => resend.mutate(invitation.id)}
                          >
                            Send again
                          </Button>
                          <Button
                            size="sm"
                            variant="tertiary"
                            loading={revoke.isPending && revoke.variables === invitation.id}
                            onClick={() => revoke.mutate(invitation.id)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <span className="text-[12px] text-faint">—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}
      </div>

      <p className="mt-4 text-[12px] text-muted">
        Sending again cancels the old code and issues a new one, so a link that went to the wrong
        number stops working. Cancelling an invitation does not remove access somebody already
        has — that comes off the staff list.
      </p>
    </Surface>
  );
}
