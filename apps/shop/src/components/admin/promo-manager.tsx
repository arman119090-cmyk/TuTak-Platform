'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { Button, Checkbox, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/ui/modal';
import { Panel, Table } from './ui';

export type PromoView = {
  id: string;
  code: string;
  discountType: 'PERCENT' | 'FIXED';
  value: number;
  minSubtotalMinor: number | null;
  maxDiscountMinor: number | null;
  freeDelivery: boolean;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  description: string;
  endsAt: string | null;
};

export const PromoManager = ({ promos }: { promos: PromoView[] }) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: '',
    discountType: 'PERCENT' as 'PERCENT' | 'FIXED',
    value: '10',
    minSubtotalMinor: '',
    maxDiscountMinor: '',
    freeDelivery: false,
    usageLimit: '',
    description: '',
  });

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const response = await fetch('/api/admin/promos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: form.code,
        discountType: form.discountType,
        value: Number(form.value),
        minSubtotalMinor: form.minSubtotalMinor ? Number(form.minSubtotalMinor) : null,
        maxDiscountMinor: form.maxDiscountMinor ? Number(form.maxDiscountMinor) : null,
        freeDelivery: form.freeDelivery,
        usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
        description: form.description,
        isActive: true,
      }),
    });
    if (response.ok) {
      setOpen(false);
      router.refresh();
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setError(data.error === 'duplicate_code' ? 'Такой промокод уже есть' : 'Проверьте поля');
  };

  const toggle = async (promo: PromoView) => {
    await fetch(`/api/admin/promos/${promo.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isActive: !promo.isActive }),
    });
    router.refresh();
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus width={16} height={16} /> Создать промокод
        </Button>
      </div>

      <Panel>
        <Table head={['Код', 'Скидка', 'Условия', 'Использован', 'Действует до', 'Статус']}>
          {promos.map((promo) => (
            <tr key={promo.id}>
              <td className="px-4 py-2.5">
                <code className="rounded bg-surface-2 px-1.5 py-0.5">{promo.code}</code>
                <span className="block text-[12px] text-muted">{promo.description}</span>
              </td>
              <td className="px-4 py-2.5">
                {promo.discountType === 'PERCENT' ? `${promo.value}%` : formatMoney(promo.value)}
                {promo.freeDelivery ? <span className="block text-[12px] text-success">+ доставка бесплатно</span> : null}
              </td>
              <td className="px-4 py-2.5 text-muted">
                {promo.minSubtotalMinor ? `от ${formatMoney(promo.minSubtotalMinor)}` : '—'}
                {promo.maxDiscountMinor ? ` · макс. ${formatMoney(promo.maxDiscountMinor)}` : ''}
              </td>
              <td className="px-4 py-2.5 tabular-nums">
                {promo.usedCount}
                {promo.usageLimit ? ` / ${promo.usageLimit}` : ''}
              </td>
              <td className="px-4 py-2.5 text-muted">
                {promo.endsAt ? formatDate(promo.endsAt, 'ru') : '—'}
              </td>
              <td className="px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => toggle(promo)}
                  className={promo.isActive ? 'text-success' : 'text-muted'}
                >
                  {promo.isActive ? 'Активен' : 'Отключён'}
                </button>
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      {open ? (
        <Modal title="Новый промокод" onClose={() => setOpen(false)}>
          <form onSubmit={create} className="space-y-4">
            <Field label="Код" required>
              <Input
                required
                value={form.code}
                onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Тип скидки">
                <Select
                  value={form.discountType}
                  onChange={(event) =>
                    setForm({ ...form, discountType: event.target.value as 'PERCENT' | 'FIXED' })
                  }
                >
                  <option value="PERCENT">Процент</option>
                  <option value="FIXED">Фиксированная сумма, ֏</option>
                </Select>
              </Field>
              <Field label="Значение" required>
                <Input
                  required
                  inputMode="numeric"
                  value={form.value}
                  onChange={(event) => setForm({ ...form, value: event.target.value.replace(/\D/g, '') })}
                />
              </Field>
              <Field label="Минимальная сумма, ֏">
                <Input
                  inputMode="numeric"
                  value={form.minSubtotalMinor}
                  onChange={(event) => setForm({ ...form, minSubtotalMinor: event.target.value.replace(/\D/g, '') })}
                />
              </Field>
              <Field label="Максимальная скидка, ֏">
                <Input
                  inputMode="numeric"
                  value={form.maxDiscountMinor}
                  onChange={(event) => setForm({ ...form, maxDiscountMinor: event.target.value.replace(/\D/g, '') })}
                />
              </Field>
              <Field label="Лимит использований">
                <Input
                  inputMode="numeric"
                  value={form.usageLimit}
                  onChange={(event) => setForm({ ...form, usageLimit: event.target.value.replace(/\D/g, '') })}
                />
              </Field>
            </div>
            <Checkbox
              label="Бесплатная доставка"
              checked={form.freeDelivery}
              onChange={(event) => setForm({ ...form, freeDelivery: event.target.checked })}
            />
            <Field label="Описание">
              <Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
            </Field>
            {error ? <p className="text-[13px] text-sale">{error}</p> : null}
            <Button type="submit" className="w-full">
              Создать
            </Button>
          </form>
        </Modal>
      ) : null}
    </>
  );
};
