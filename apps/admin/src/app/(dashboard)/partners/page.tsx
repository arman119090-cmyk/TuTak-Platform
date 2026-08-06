'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { partnersApi } from '@/lib/api/partnersApi';

export default function PartnersPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['partners'], queryFn: partnersApi.list });
  const [form, setForm] = useState({
    legalName: '',
    displayName: '',
    taxId: '',
    category: '',
    bonusAccrualRateBps: 300,
    ownerUserId: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await partnersApi.create(form);
      queryClient.invalidateQueries({ queryKey: ['partners'] });
      setForm({ legalName: '', displayName: '', taxId: '', category: '', bonusAccrualRateBps: 300, ownerUserId: '' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await partnersApi.setActive(id, !isActive);
    queryClient.invalidateQueries({ queryKey: ['partners'] });
  };

  return (
    <div>
      <h1 className="text-2xl font-semibold">Partners</h1>

      <form onSubmit={handleCreate} className="mt-6 grid grid-cols-2 gap-4 rounded-2xl border border-black/5 bg-white p-6 shadow-sm">
        <Field label="Legal name" value={form.legalName} onChange={(v) => setForm({ ...form, legalName: v })} />
        <Field label="Display name" value={form.displayName} onChange={(v) => setForm({ ...form, displayName: v })} />
        <Field label="Tax ID" value={form.taxId} onChange={(v) => setForm({ ...form, taxId: v })} />
        <Field label="Category" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
        <Field label="Owner user ID" value={form.ownerUserId} onChange={(v) => setForm({ ...form, ownerUserId: v })} />
        <Field
          label="Bonus rate (bps)"
          value={String(form.bonusAccrualRateBps)}
          onChange={(v) => setForm({ ...form, bonusAccrualRateBps: Number(v) || 0 })}
        />
        <div className="col-span-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-brand-green px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create partner'}
          </button>
        </div>
      </form>

      <div className="mt-8 overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Bonus rate</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {data?.map((p) => (
              <tr key={p.id} className="border-t border-neutral-100">
                <td className="px-4 py-3">{p.displayName}</td>
                <td className="px-4 py-3">{p.category}</td>
                <td className="px-4 py-3">{(p.bonusAccrualRateBps / 100).toFixed(2)}%</td>
                <td className="px-4 py-3">{p.isActive ? 'Active' : 'Inactive'}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => handleToggle(p.id, p.isActive)}
                    className="rounded-md border border-neutral-200 px-2 py-1 text-xs hover:bg-neutral-50"
                  >
                    {p.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-600">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 outline-none focus:border-brand-green"
        required
      />
    </div>
  );
}
