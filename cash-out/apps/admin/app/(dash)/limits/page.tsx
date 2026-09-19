import { revalidatePath } from 'next/cache';
import { adminFetch, currentAdmin } from '@/lib/api';
import { formatDateTime, formatMinor } from '@/lib/format';

interface LimitRow {
  id: string;
  parkId: string | null;
  currency: string;
  minWithdrawalMinor: string;
  maxWithdrawalMinor: string;
  dailyAmountMinor: string;
  dailyCountMax: number;
  weeklyAmountMinor: string;
  monthlyAmountMinor: string;
  velocityWindowSeconds: number;
  velocityMaxCount: number;
  manualReviewAboveMinor: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
}

export const dynamic = 'force-dynamic';

export default async function LimitsPage() {
  const [{ items }, admin] = await Promise.all([
    adminFetch<{ items: LimitRow[] }>('/v1/admin/limits'),
    currentAdmin(),
  ]);

  const canWrite = admin.permissions.includes('limits:write');

  async function create(formData: FormData): Promise<void> {
    'use server';
    await adminFetch('/v1/admin/limits', {
      method: 'POST',
      body: JSON.stringify({
        parkId: String(formData.get('parkId') ?? '') || null,
        currency: String(formData.get('currency')),
        minWithdrawalMinor: String(formData.get('min')),
        maxWithdrawalMinor: String(formData.get('max')),
        dailyAmountMinor: String(formData.get('daily')),
        dailyCountMax: Number(formData.get('dailyCount')),
        weeklyAmountMinor: String(formData.get('weekly')),
        monthlyAmountMinor: String(formData.get('monthly')),
        velocityWindowSeconds: Number(formData.get('velocityWindow')),
        velocityMaxCount: Number(formData.get('velocityCount')),
        manualReviewAboveMinor: String(formData.get('reviewAbove') ?? '') || null,
        reason: String(formData.get('reason')),
      }),
    });
    revalidatePath('/limits');
  }

  return (
    <>
      <div className="page-header">
        <h1>Limits</h1>
      </div>

      <table>
        <thead>
          <tr>
            <th>Scope</th>
            <th className="num">Per withdrawal</th>
            <th className="num">Per day</th>
            <th className="num">Velocity</th>
            <th className="num">Review above</th>
            <th>In force</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id}>
              <td>
                {row.parkId ?? 'default'} · {row.currency}{' '}
                {row.active ? <span className="chip ok">active</span> : null}
              </td>
              <td className="num">
                {formatMinor(row.minWithdrawalMinor, row.currency)} —{' '}
                {formatMinor(row.maxWithdrawalMinor, row.currency)}
              </td>
              <td className="num">
                {formatMinor(row.dailyAmountMinor, row.currency)} / {row.dailyCountMax}×
              </td>
              <td className="num">
                {row.velocityMaxCount}× per {row.velocityWindowSeconds}s
              </td>
              <td className="num">
                {row.manualReviewAboveMinor
                  ? formatMinor(row.manualReviewAboveMinor, row.currency)
                  : '—'}
              </td>
              <td className="muted">
                {formatDateTime(row.effectiveFrom)} →{' '}
                {row.effectiveTo ? formatDateTime(row.effectiveTo) : 'now'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {canWrite ? (
        <section className="card" style={{ marginTop: 24 }}>
          <h2>New policy</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            All amounts in minor units. Usage counts every withdrawal that was, or could still be,
            paid — a failed one does not consume a driver’s limit, an in-flight one does.
          </p>
          <form action={create}>
            <div className="grid-2">
              <Field name="parkId" label="Park (blank = default)" />
              <div className="field">
                <label htmlFor="currency">Currency</label>
                <select id="currency" name="currency" defaultValue="AMD">
                  <option>AMD</option>
                  <option>RUB</option>
                  <option>USD</option>
                </select>
              </div>
              <Field name="min" label="Minimum" defaultValue="100000" />
              <Field name="max" label="Maximum" defaultValue="30000000" />
              <Field name="daily" label="Daily amount" defaultValue="50000000" />
              <Field name="dailyCount" label="Daily count" defaultValue="5" />
              <Field name="weekly" label="Weekly amount" defaultValue="150000000" />
              <Field name="monthly" label="Monthly amount" defaultValue="400000000" />
              <Field name="velocityWindow" label="Velocity window (s)" defaultValue="3600" />
              <Field name="velocityCount" label="Velocity count" defaultValue="3" />
              <Field name="reviewAbove" label="Manual review above (blank = never)" />
            </div>
            <div className="field">
              <label htmlFor="reason">Why</label>
              <textarea id="reason" name="reason" rows={2} minLength={5} required />
            </div>
            <button type="submit">Publish</button>
          </form>
        </section>
      ) : null}
    </>
  );
}

function Field({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} defaultValue={defaultValue} />
    </div>
  );
}
