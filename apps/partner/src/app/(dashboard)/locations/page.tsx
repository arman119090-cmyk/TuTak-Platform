'use client';

import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PartnerBranchState, type PartnerBranchDto } from '@tutak/shared-types';
import { Badge, Button, Field, Input, PageHeader, Surface, Table, Td, Th, Tr } from '@tutak/design/web';
import { getPrimaryPartnerId, isPartnerOwner, useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';
import { BranchFuelTools } from './BranchFuelTools';

/**
 * A partner's own physical locations — spec: partner self-service branches.
 * Branch operations (QR + staff) exist for every physical partner; only the
 * fuel-type selector is fuel-specific. A branch is referenced by purchase
 * history, so closing one deactivates it rather than deleting the row.
 */
/**
 * What each state means to the person reading it.
 *
 * Deliberately not "Active / Inactive". The owner's two reasons for shutting
 * a location need different words, because they imply different next steps:
 * one is coming back and one is not.
 */
const STATE_TONE: Record<PartnerBranchState, 'available' | 'pending' | 'neutral'> = {
  [PartnerBranchState.ACTIVE]: 'available',
  [PartnerBranchState.SUSPENDED]: 'pending',
  [PartnerBranchState.ARCHIVED]: 'neutral',
};

export default function LocationsPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const partnerId = getPrimaryPartnerId(user);
  const isOwner = isPartnerOwner(user, partnerId);

  const { data: branches, isLoading } = useQuery({
    queryKey: ['partner-branches', partnerId],
    queryFn: () => partnerApi.listBranches(partnerId!),
    enabled: !!partnerId && isOwner,
  });

  const { data: partner } = useQuery({
    queryKey: ['partner', partnerId],
    queryFn: () => partnerApi.get(partnerId!),
    enabled: !!partnerId && isOwner,
  });

  if (!isOwner) {
    return (
      <>
        <Header />
        <Surface>
          <p className="text-[13px] text-muted">{t('partnerPanel.branches.ownerOnly')}</p>
        </Surface>
      </>
    );
  }

  return (
    <>
      <Header />
      <BranchesCard
        partnerId={partnerId ?? ''}
        branches={branches ?? []}
        loading={isLoading}
        isFuelPartner={partner?.category === 'fuel'}
      />
    </>
  );
}

function Header() {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={t('partnerPanel.branches.title')}
      description={t('partnerPanel.branches.description')}
    />
  );
}

const EMPTY_FORM = { name: '', address: '', city: '', latitude: '', longitude: '' };
type BranchForm = typeof EMPTY_FORM;

function isValidForm(form: BranchForm): boolean {
  const lat = Number(form.latitude);
  const lng = Number(form.longitude);
  return (
    form.name.trim().length > 0 &&
    form.address.trim().length > 0 &&
    form.city.trim().length > 0 &&
    form.latitude.trim().length > 0 &&
    form.longitude.trim().length > 0 &&
    Number.isFinite(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    Number.isFinite(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

function toBranchInput(form: BranchForm) {
  return {
    name: form.name.trim(),
    address: form.address.trim(),
    city: form.city.trim(),
    latitude: Number(form.latitude),
    longitude: Number(form.longitude),
  };
}

function BranchForm({
  form,
  onChange,
}: {
  form: BranchForm;
  onChange: (patch: Partial<BranchForm>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Field label={t('partnerPanel.branches.name')}>
        <Input
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={t('partnerPanel.branches.namePlaceholder')}
          maxLength={120}
        />
      </Field>
      <Field label={t('partnerPanel.branches.address')}>
        <Input
          value={form.address}
          onChange={(e) => onChange({ address: e.target.value })}
          placeholder={t('partnerPanel.branches.addressPlaceholder')}
          maxLength={300}
        />
      </Field>
      <Field label={t('partnerPanel.branches.city')}>
        <Input
          value={form.city}
          onChange={(e) => onChange({ city: e.target.value })}
          placeholder={t('partnerPanel.branches.cityPlaceholder')}
          maxLength={100}
        />
      </Field>
      <Field label={t('partnerPanel.branches.latitude')}>
        <Input
          value={form.latitude}
          onChange={(e) => onChange({ latitude: e.target.value })}
          inputMode="decimal"
          placeholder="40.1772"
        />
      </Field>
      <Field label={t('partnerPanel.branches.longitude')}>
        <Input
          value={form.longitude}
          onChange={(e) => onChange({ longitude: e.target.value })}
          inputMode="decimal"
          placeholder="44.5126"
        />
      </Field>
    </div>
  );
}

function BranchesCard({
  partnerId,
  branches,
  loading,
  isFuelPartner,
}: {
  partnerId: string;
  branches: PartnerBranchDto[];
  loading: boolean;
  isFuelPartner: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['partner-branches', partnerId] });

  const [adding, setAdding] = useState(false);
  const [newForm, setNewForm] = useState<BranchForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<BranchForm>(EMPTY_FORM);
  const [managingId, setManagingId] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => partnerApi.createBranch(partnerId, toBranchInput(newForm)),
    onSuccess: () => {
      setAdding(false);
      setNewForm(EMPTY_FORM);
      void invalidate();
    },
  });

  const update = useMutation({
    mutationFn: (branchId: string) => partnerApi.updateBranch(partnerId, branchId, toBranchInput(editForm)),
    onSuccess: () => {
      setEditingId(null);
      void invalidate();
    },
  });

  const setState = useMutation({
    mutationFn: ({ branchId, state }: { branchId: string; state: PartnerBranchState }) =>
      partnerApi.setBranchState(partnerId, branchId, state),
    onSuccess: () => void invalidate(),
  });

  /** One state change at a time, and only the row being changed shows it. */
  const busyOn = (branchId: string) =>
    setState.isPending && setState.variables?.branchId === branchId;

  const startEdit = (branch: PartnerBranchDto) => {
    setEditingId(branch.id);
    setEditForm({
      name: branch.name,
      address: branch.address,
      city: branch.city,
      latitude: String(branch.latitude),
      longitude: String(branch.longitude),
    });
  };

  return (
    <Surface>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="text-[15px] font-semibold text-ink">
          {t('partnerPanel.branches.yourBranches')}
        </div>
        {!adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={loading}>
            {t('partnerPanel.branches.add')}
          </Button>
        )}
      </div>

      {adding && (
        <div className="mt-4 rounded-lg border border-line p-4">
          <BranchForm form={newForm} onChange={(patch) => setNewForm((f) => ({ ...f, ...patch }))} />
          <div className="mt-3 flex items-center gap-3">
            <Button
              size="sm"
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={!isValidForm(newForm)}
            >
              {t('partnerPanel.branches.save')}
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              onClick={() => {
                setAdding(false);
                setNewForm(EMPTY_FORM);
              }}
            >
              {t('partnerPanel.branches.cancel')}
            </Button>
            {create.isError ? (
              <span className="text-[13px] text-danger-text">
                {t('partnerPanel.branches.saveFailed')}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {branches.length === 0 && !adding ? (
        <p className="mt-4 text-[13px] text-faint">{t('partnerPanel.branches.empty')}</p>
      ) : branches.length > 0 ? (
        <div className="mt-4">
          <Table>
            <thead>
              <tr>
                <Th>{t('partnerPanel.branches.name')}</Th>
                <Th>{t('partnerPanel.branches.address')}</Th>
                <Th>{t('partnerPanel.branches.city')}</Th>
                <Th>{t('partnerPanel.branches.statusColumn')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) =>
                editingId === branch.id ? (
                  <Tr key={branch.id}>
                    <Td colSpan={5}>
                      <BranchForm
                        form={editForm}
                        onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))}
                      />
                      <div className="mt-3 flex items-center gap-3">
                        <Button
                          size="sm"
                          onClick={() => update.mutate(branch.id)}
                          loading={update.isPending}
                          disabled={!isValidForm(editForm)}
                        >
                          {t('partnerPanel.branches.save')}
                        </Button>
                        <Button size="sm" variant="tertiary" onClick={() => setEditingId(null)}>
                          {t('partnerPanel.branches.cancel')}
                        </Button>
                        {update.isError ? (
                          <span className="text-[13px] text-danger-text">
                            {t('partnerPanel.branches.saveFailed')}
                          </span>
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                ) : (
                  <Fragment key={branch.id}>
                    <Tr>
                      <Td>{branch.name}</Td>
                      <Td>{branch.address}</Td>
                      <Td>{branch.city}</Td>
                      <Td>
                        <Badge tone={STATE_TONE[branch.state]}>
                          {t(`partnerPanel.branches.state${branch.state}`)}
                        </Badge>
                        {/* The reassurance that belongs next to a closure, not
                            in a help page: the question an owner actually has
                            when shutting a shop is what happens to the sales
                            already made there. */}
                        {branch.state !== PartnerBranchState.ACTIVE ? (
                          <span className="block text-[12px] text-faint">
                            {t(`partnerPanel.branches.note${branch.state}`)}
                          </span>
                        ) : null}
                      </Td>
                      <Td align="right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="tertiary" onClick={() => startEdit(branch)}>
                            {t('partnerPanel.branches.edit')}
                          </Button>
                          <Button
                            size="sm"
                            variant="tertiary"
                            onClick={() => setManagingId(managingId === branch.id ? null : branch.id)}
                          >
                            {managingId === branch.id
                              ? t('partnerPanel.branches.close')
                              : t('partnerPanel.branches.manage')}
                          </Button>
                          {branch.state === PartnerBranchState.ACTIVE ? (
                            <Button
                              size="sm"
                              variant="tertiary"
                              loading={busyOn(branch.id)}
                              onClick={() =>
                                setState.mutate({
                                  branchId: branch.id,
                                  state: PartnerBranchState.SUSPENDED,
                                })
                              }
                            >
                              {t('partnerPanel.branches.closeForNow')}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="tertiary"
                              loading={busyOn(branch.id)}
                              onClick={() =>
                                setState.mutate({
                                  branchId: branch.id,
                                  state: PartnerBranchState.ACTIVE,
                                })
                              }
                            >
                              {t('partnerPanel.branches.reopen')}
                            </Button>
                          )}
                          {branch.state === PartnerBranchState.ARCHIVED ? null : (
                            <Button
                              size="sm"
                              variant="tertiary"
                              loading={busyOn(branch.id)}
                              onClick={() =>
                                setState.mutate({
                                  branchId: branch.id,
                                  state: PartnerBranchState.ARCHIVED,
                                })
                              }
                            >
                              {t('partnerPanel.branches.closeForGood')}
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                    {managingId === branch.id ? (
                      <Tr key={`${branch.id}-manage`}>
                        <Td colSpan={5}>
                          <BranchFuelTools
                            partnerId={partnerId}
                            branchId={branch.id}
                            isFuelPartner={isFuelPartner}
                          />
                        </Td>
                      </Tr>
                    ) : null}
                  </Fragment>
                ),
              )}
            </tbody>
          </Table>
        </div>
      ) : null}
    </Surface>
  );
}
