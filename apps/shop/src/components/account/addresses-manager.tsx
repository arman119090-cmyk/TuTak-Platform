'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Plus, Trash2 } from 'lucide-react';
import { REGIONS } from '@/config/site';
import type { Dictionary, Locale } from '@/lib/i18n';
import { Button, Checkbox, EmptyState, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/ui/modal';
import { useStore } from '@/components/providers/store-provider';

export type AddressView = {
  id: string;
  label: string;
  region: string;
  city: string;
  street: string;
  building: string;
  apartment: string | null;
  floor: number | null;
  hasLift: boolean;
  isDefault: boolean;
};

export const AddressesManager = ({
  addresses,
  locale,
  dict,
}: {
  addresses: AddressView[];
  locale: Locale;
  dict: Dictionary;
}) => {
  const router = useRouter();
  const { toast } = useStore();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    label: '',
    region: 'yerevan',
    city: '',
    street: '',
    building: '',
    apartment: '',
    floor: '',
    hasLift: true,
    isDefault: false,
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const response = await fetch('/api/account/addresses', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...form, floor: form.floor ? Number(form.floor) : null }),
    });
    setSaving(false);
    if (response.ok) {
      setOpen(false);
      toast(dict.common.saved);
      router.refresh();
    } else {
      toast(dict.forms.errorText, 'error');
    }
  };

  const remove = async (id: string) => {
    const response = await fetch(`/api/account/addresses?id=${id}`, { method: 'DELETE' });
    if (response.ok) {
      toast(dict.common.saved, 'info');
      router.refresh();
    }
  };

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus width={16} height={16} />
          {dict.account.addAddress}
        </Button>
      </div>

      {addresses.length === 0 ? (
        <EmptyState
          icon={<MapPin width={40} height={40} strokeWidth={1.4} />}
          title={dict.account.noAddresses}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="rounded-[var(--radius-md)] border border-line bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[15px] font-medium">
                    {address.label}
                    {address.isDefault ? (
                      <span className="ml-2 rounded-full bg-success-soft px-2 py-0.5 text-[11px] text-success">
                        {dict.account.defaultAddress}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-[13px] text-muted">
                    {[
                      REGIONS.find((region) => region.key === address.region)?.names[locale],
                      address.city,
                      address.street,
                      address.building,
                      address.apartment ? `${dict.checkout.apartment} ${address.apartment}` : null,
                      address.floor ? `${dict.checkout.floor} ${address.floor}` : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(address.id)}
                  aria-label={dict.common.delete}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-sale"
                >
                  <Trash2 width={16} height={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <Modal title={dict.account.addAddress} onClose={() => setOpen(false)}>
          <form onSubmit={submit} className="space-y-4">
            <Field label={dict.account.addressLabel} required>
              <Input
                required
                value={form.label}
                onChange={(event) => setForm({ ...form, label: event.target.value })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={dict.checkout.region} required>
                <Select
                  value={form.region}
                  onChange={(event) => setForm({ ...form, region: event.target.value })}
                >
                  {REGIONS.map((region) => (
                    <option key={region.key} value={region.key}>
                      {region.names[locale]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={dict.checkout.city} required>
                <Input
                  required
                  value={form.city}
                  onChange={(event) => setForm({ ...form, city: event.target.value })}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
              <Field label={dict.checkout.street} required>
                <Input
                  required
                  value={form.street}
                  onChange={(event) => setForm({ ...form, street: event.target.value })}
                />
              </Field>
              <Field label={dict.checkout.building} required>
                <Input
                  required
                  value={form.building}
                  onChange={(event) => setForm({ ...form, building: event.target.value })}
                />
              </Field>
              <Field label={dict.checkout.apartment}>
                <Input
                  value={form.apartment}
                  onChange={(event) => setForm({ ...form, apartment: event.target.value })}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={dict.checkout.floor}>
                <Input
                  inputMode="numeric"
                  value={form.floor}
                  onChange={(event) =>
                    setForm({ ...form, floor: event.target.value.replace(/\D/g, '') })
                  }
                />
              </Field>
              <div className="flex items-end pb-1">
                <Checkbox
                  label={dict.checkout.hasLift}
                  checked={form.hasLift}
                  onChange={(event) => setForm({ ...form, hasLift: event.target.checked })}
                />
              </div>
            </div>
            <Checkbox
              label={dict.account.defaultAddress}
              checked={form.isDefault}
              onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
            />
            <Button type="submit" className="w-full" disabled={saving}>
              {dict.common.save}
            </Button>
          </form>
        </Modal>
      ) : null}
    </div>
  );
};
