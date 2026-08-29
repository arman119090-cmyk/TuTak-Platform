'use client';

import { Fragment, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Surface,
  Table,
  Td,
  Th,
  Tr,
} from '@tutak/design/web';
import { partnersApi } from '@/lib/api/partnersApi';
import { PartnerBranchAudit } from './PartnerBranchAudit';

const EMPTY = {
  legalName: '',
  displayName: '',
  taxId: '',
  category: '',
  bonusAccrualRateBps: 300,
  ownerUserId: '',
  sellsGas: false,
  sellsPetrol: false,
};

export default function PartnersPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['partners'], queryFn: partnersApi.list });
  const [form, setForm] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Which partner's Activate/Deactivate request is in flight, so a second
  // click can't fire a second toggle racing to invert the same field twice.
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await partnersApi.create(form);
      queryClient.invalidateQueries({ queryKey: ['partners'] });
      setForm(EMPTY);
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const partners = data ?? [];

  return (
    <>
      <PageHeader
        title="Partners"
        description="Businesses accepting TuTak payments."
        actions={
          <Button onClick={() => setOpen((v) => !v)} variant={open ? 'tertiary' : 'primary'}>
            {open ? 'Cancel' : 'Add partner'}
          </Button>
        }
      />

      {open ? (
        <Surface className="mb-5">
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Legal name">
              <Input
                required
                value={form.legalName}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
              />
            </Field>
            <Field label="Display name">
              <Input
                required
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </Field>
            <Field label="Tax ID">
              <Input
                required
                value={form.taxId}
                onChange={(e) => setForm({ ...form, taxId: e.target.value })}
              />
            </Field>
            <Field label="Category">
              <Input
                required
                placeholder="cafe, retail, fuel…"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </Field>
            {form.category.trim().toLowerCase() === 'fuel' ? (
              <Field label="Sells" hint="Propane and methane count as one bucket: &quot;gas&quot;.">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={form.sellsGas}
                      onChange={(e) => setForm({ ...form, sellsGas: e.target.checked })}
                    />
                    Gas
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={form.sellsPetrol}
                      onChange={(e) => setForm({ ...form, sellsPetrol: e.target.checked })}
                    />
                    Petrol
                  </label>
                </div>
              </Field>
            ) : null}
            <Field label="Owner user ID">
              <Input
                required
                value={form.ownerUserId}
                onChange={(e) => setForm({ ...form, ownerUserId: e.target.value })}
              />
            </Field>
            <Field
              label="Bonus accrual rate"
              hint={`${(form.bonusAccrualRateBps / 100).toFixed(2)}% of every payment`}
            >
              <Input
                required
                inputMode="numeric"
                value={String(form.bonusAccrualRateBps)}
                onChange={(e) =>
                  setForm({ ...form, bonusAccrualRateBps: Number(e.target.value) || 0 })
                }
              />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" loading={submitting}>
                Create partner
              </Button>
            </div>
          </form>
        </Surface>
      ) : null}

      {partners.length === 0 ? (
        <EmptyState
          title="No partners yet"
          message="Add your first partner business to start accepting TuTak payments."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Business</Th>
              <Th>Category</Th>
              <Th align="right">Bonus rate</Th>
              <Th>Status</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => (
              <Fragment key={p.id}>
                <Tr>
                  <Td>
                    <div className="font-medium text-ink">{p.displayName}</div>
                    <div className="text-[12px] text-faint">{p.legalName}</div>
                  </Td>
                  <Td className="text-muted">{p.category}</Td>
                  <Td align="right" className="tabular">
                    {(p.bonusAccrualRateBps / 100).toFixed(2)}%
                  </Td>
                  <Td>
                    <Badge tone={p.isActive ? 'available' : 'neutral'}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="tertiary"
                        onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                      >
                        {expandedId === p.id ? 'Hide branches' : 'Branches'}
                      </Button>
                      <Button
                        size="sm"
                        variant={p.isActive ? 'destructive' : 'secondary'}
                        disabled={togglingId === p.id}
                        onClick={async () => {
                          setTogglingId(p.id);
                          try {
                            await partnersApi.setActive(p.id, !p.isActive);
                            queryClient.invalidateQueries({ queryKey: ['partners'] });
                          } finally {
                            setTogglingId(null);
                          }
                        }}
                      >
                        {togglingId === p.id
                          ? p.isActive
                            ? 'Deactivating…'
                            : 'Activating…'
                          : p.isActive
                            ? 'Deactivate'
                            : 'Activate'}
                      </Button>
                    </div>
                  </Td>
                </Tr>
                {expandedId === p.id ? (
                  <Tr>
                    <Td colSpan={5}>
                      <PartnerBranchAudit partnerId={p.id} />
                    </Td>
                  </Tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
