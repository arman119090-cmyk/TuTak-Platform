'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
import { localDay } from '@/lib/dates';
import { normalizeArmenianPhone } from '@tutak/shared-types';


const STATUS_TONE: Record<PartnerStaffInvitationStatusDto, 'pending' | 'available' | 'neutral'> = {
  [PartnerStaffInvitationStatusDto.PENDING]: 'pending',
  [PartnerStaffInvitationStatusDto.ACCEPTED]: 'available',
  [PartnerStaffInvitationStatusDto.REVOKED]: 'neutral',
  [PartnerStaffInvitationStatusDto.EXPIRED]: 'neutral',
};

/**
 * The server's own refusal, when it sent one.
 *
 * Kept in the server's words rather than translated: a refusal like "that
 * phone already works here" is specific to what happened, and a generic
 * translated fallback would lose it. Only the "no message at all" case has
 * a translated sentence, because there is nothing else to say.
 */
const messageOf = (error: unknown, t: TFunction): string => {
  const data = (error as AxiosError<{ message?: string }> | undefined)?.response?.data;
  return data?.message ?? t('partnerPanel.invitations.genericError');
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('+374');
  const [role, setRole] = useState('PARTNER_STAFF');
  const [branchId, setBranchId] = useState('');
  const normalizedPhone = normalizeArmenianPhone(phone);

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
        phone: normalizedPhone ?? phone.trim(),
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
  const canInvite = normalizedPhone !== null;

  return (
    <Surface>
      <h3 className="text-[15px] font-semibold text-ink">
        {t('partnerPanel.invitations.title')}
      </h3>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label={t('partnerPanel.invitations.phone')}>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+37491234567"
            autoComplete="off"
          />
        </Field>
        <Field label={t('partnerPanel.invitations.role')}>
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="PARTNER_STAFF">{t('partnerPanel.invitations.roleStaff')}</option>
            <option value="PARTNER_MANAGER">{t('partnerPanel.invitations.roleManager')}</option>
          </Select>
        </Field>
        <Field label={t('partnerPanel.invitations.branch')}>
          <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">{t('partnerPanel.invitations.noBranch')}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button onClick={() => invite.mutate()} loading={invite.isPending} disabled={!canInvite}>
          {t('partnerPanel.invitations.send')}
        </Button>
      </div>

      {/* Only once something beyond the prefix has been typed: a form that
          opens already scolding is noise, but a disabled button with no
          reason given left owners guessing. */}
      {!canInvite && phone.replace(/\D/g, '').length > 3 ? (
        <p className="mt-2 text-[12px] text-danger-text">
          {t('partnerPanel.invitations.phoneInvalid')}
        </p>
      ) : null}
      <p className="mt-3 text-[12px] text-muted">{t('partnerPanel.invitations.secretNote')}</p>
      {invite.isError ? (
        <p role="alert" className="mt-2 text-[13px] text-danger-text">
          {messageOf(invite.error, t)}
        </p>
      ) : null}

      <div className="mt-5">
        {state === 'loading' ? (
          <LoadingNotice label={t('partnerPanel.invitations.loading')} />
        ) : null}
        {state === 'error' ? (
          <LoadError
            title={t('partnerPanel.invitations.loadError')}
            onRetry={() => void query.refetch()}
            busy={query.isFetching}
          />
        ) : null}
        {state === 'stale' ? (
          <StaleNotice
            asOf={query.dataUpdatedAt}
            what={t('partnerPanel.invitations.staleWhat')}
            onRetry={() => void query.refetch()}
            busy={query.isFetching}
          />
        ) : null}

        {state !== 'loading' && state !== 'error' ? (
          invitations.length === 0 ? (
            <p className="text-[13px] text-faint">{t('partnerPanel.invitations.empty')}</p>
          ) : (
            <Table>
              <thead>
                <Tr>
                  <Th>{t('partnerPanel.invitations.phone')}</Th>
                  <Th>{t('partnerPanel.invitations.role')}</Th>
                  <Th>{t('partnerPanel.invitations.sent')}</Th>
                  <Th>{t('partnerPanel.invitations.statusColumn')}</Th>
                  <Th align="right">{t('partnerPanel.invitations.action')}</Th>
                </Tr>
              </thead>
              <tbody>
                {invitations.map((invitation) => (
                  <Tr key={invitation.id}>
                    <Td className="tabular">{invitation.phone}</Td>
                    <Td className="text-muted">
                      {t(
                        invitation.role === 'PARTNER_MANAGER'
                          ? 'partnerPanel.invitations.roleManager'
                          : 'partnerPanel.invitations.roleStaff',
                      )}
                    </Td>
                    <Td className="tabular text-muted">{localDay(invitation.createdAt)}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[invitation.status]}>
                        {t(`partnerPanel.invitations.status${invitation.status}`)}
                      </Badge>
                      {invitation.status === PartnerStaffInvitationStatusDto.PENDING ? (
                        <span className="block text-[12px] text-faint">
                          {t('partnerPanel.invitations.until', {
                            date: localDay(invitation.expiresAt),
                          })}
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
                            {t('partnerPanel.invitations.sendAgain')}
                          </Button>
                          <Button
                            size="sm"
                            variant="tertiary"
                            loading={revoke.isPending && revoke.variables === invitation.id}
                            onClick={() => revoke.mutate(invitation.id)}
                          >
                            {t('partnerPanel.invitations.cancel')}
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

      <p className="mt-4 text-[12px] text-muted">{t('partnerPanel.invitations.resendNote')}</p>
    </Surface>
  );
}
