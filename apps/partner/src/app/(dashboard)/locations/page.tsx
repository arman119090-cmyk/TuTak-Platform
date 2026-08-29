'use client';

import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PartnerBranchDto } from '@tutak/shared-types';
import { Badge, Button, Field, Input, PageHeader, Surface, Table, Td, Th, Tr } from '@tutak/design/web';
import { getPrimaryPartnerId, isPartnerOwner, useAuthStore } from '@/lib/stores/authStore';
import { partnerApi } from '@/lib/api/partnerApi';
import { BranchFuelTools } from './BranchFuelTools';

/**
 * A partner's own physical locations — spec: partner self-service branches
 * (Arman, 2026-08-26: "1" — the partner adds their own, the platform does
 * not do it on their behalf). A chain can have as many as it actually has;
 * nothing here caps it below the API's own generous sanity ceiling.
 *
 * Individual create/edit/deactivate, unlike `/profile`'s offerings list:
 * a branch is referenced by real purchase history, so closing one
 * deactivates it rather than deleting the row — see `PartnerBranchDto.isActive`.
 *
 * OWNER-only, same tier as `/profile` and `/branding`.
 */
export default function LocationsPage() {
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
          <p className="text-[13px] text-muted">
            Only the partner owner can manage your locations. Ask your owner account to add or edit
            them.
          </p>
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
  return (
    <PageHeader
      title="Locations"
      description="Every address customers can walk into and earn or spend points at. Add as many as you actually have — a closed location can be deactivated without losing its history."
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
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Field label="Name">
        <Input
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Downtown"
          maxLength={120}
        />
      </Field>
      <Field label="Address">
        <Input
          value={form.address}
          onChange={(e) => onChange({ address: e.target.value })}
          placeholder="1 Republic Square"
          maxLength={300}
        />
      </Field>
      <Field label="City">
        <Input
          value={form.city}
          onChange={(e) => onChange({ city: e.target.value })}
          placeholder="Yerevan"
          maxLength={100}
        />
      </Field>
      <Field label="Latitude">
        <Input
          value={form.latitude}
          onChange={(e) => onChange({ latitude: e.target.value })}
          inputMode="decimal"
          placeholder="40.1772"
        />
      </Field>
      <Field label="Longitude">
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

  const toggleActive = useMutation({
    mutationFn: ({ branchId, isActive }: { branchId: string; isActive: boolean }) =>
      partnerApi.setBranchActive(partnerId, branchId, isActive),
    onSuccess: () => void invalidate(),
  });

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
        <div className="text-[15px] font-semibold text-ink">Your locations</div>
        {!adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)} disabled={loading}>
            Add location
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
              Save
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              onClick={() => {
                setAdding(false);
                setNewForm(EMPTY_FORM);
              }}
            >
              Cancel
            </Button>
            {create.isError ? (
              <span className="text-[13px] text-danger-text">Could not save. Please try again.</span>
            ) : null}
          </div>
        </div>
      )}

      {branches.length === 0 && !adding ? (
        <p className="mt-4 text-[13px] text-faint">No locations yet. Add your first one above.</p>
      ) : branches.length > 0 ? (
        <div className="mt-4">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Address</Th>
                <Th>City</Th>
                <Th>Status</Th>
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
                          Save
                        </Button>
                        <Button size="sm" variant="tertiary" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                        {update.isError ? (
                          <span className="text-[13px] text-danger-text">
                            Could not save. Please try again.
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
                        <Badge tone={branch.isActive ? 'available' : 'neutral'}>
                          {branch.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </Td>
                      <Td align="right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="tertiary" onClick={() => startEdit(branch)}>
                            Edit
                          </Button>
                          {isFuelPartner ? (
                            <Button
                              size="sm"
                              variant="tertiary"
                              onClick={() => setManagingId(managingId === branch.id ? null : branch.id)}
                            >
                              {managingId === branch.id ? 'Close' : 'Manage'}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="tertiary"
                            loading={
                              toggleActive.isPending && toggleActive.variables?.branchId === branch.id
                            }
                            onClick={() =>
                              toggleActive.mutate({ branchId: branch.id, isActive: !branch.isActive })
                            }
                          >
                            {branch.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                    {isFuelPartner && managingId === branch.id ? (
                      <Tr key={`${branch.id}-manage`}>
                        <Td colSpan={5}>
                          <BranchFuelTools partnerId={partnerId} branchId={branch.id} />
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
