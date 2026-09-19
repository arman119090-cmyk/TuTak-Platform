import { revalidatePath } from 'next/cache';
import { adminFetch, currentAdmin } from '@/lib/api';
import { formatDateTime, formatMinor } from '@/lib/format';

interface FeeRow {
  id: string;
  parkId: string | null;
  currency: string;
  platformRate: string;
  platformFixedMinor: string;
  providerRate: string;
  providerFixedMinor: string;
  payoutIncrementMinor: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
}

export const dynamic = 'force-dynamic';

/**
 * Pricing.
 *
 * A change never edits the row in force: it closes it and opens a new one, so
 * "what was this driver charged in March" stays answerable forever. The list
 * therefore grows and is meant to.
 */
export default async function FeesPage() {
  const [{ items }, admin] = await Promise.all([
    adminFetch<{ items: FeeRow[] }>('/v1/admin/fees'),
    currentAdmin(),
  ]);

  const canWrite = admin.permissions.includes('fees:write');

  async function create(formData: FormData): Promise<void> {
    'use server';
    await adminFetch('/v1/admin/fees', {
      method: 'POST',
      body: JSON.stringify({
        parkId: String(formData.get('parkId') ?? '') || null,
        currency: String(formData.get('currency')),
        platformRateNumerator: String(formData.get('platformBps')),
        platformRateDenominator: '10000',
        platformFixedMinor: String(formData.get('platformFixed')),
        providerRateNumerator: String(formData.get('providerBps')),
        providerRateDenominator: '10000',
        providerFixedMinor: String(formData.get('providerFixed')),
        payoutIncrementMinor: String(formData.get('increment') || '1'),
        reason: String(formData.get('reason')),
      }),
    });
    revalidatePath('/fees');
  }

  return (
    <>
      <div className="page-header">
        <h1>Fees</h1>
      </div>

      <table>
        <thead>
          <tr>
            <th>Scope</th>
            <th>Cash Out</th>
            <th>Provider</th>
            <th className="num">Payout increment</th>
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
              <td>
                {row.platformRate} + {formatMinor(row.platformFixedMinor, row.currency)}
              </td>
              <td>
                {row.providerRate} + {formatMinor(row.providerFixedMinor, row.currency)}
              </td>
              <td className="num">{row.payoutIncrementMinor}</td>
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
          <h2>New schedule</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Rates are in basis points (200 = 2.00%). Fixed parts and the payout increment are in
            minor units (100 = 1 AMD). Publishing closes the schedule currently in force for the
            same scope; withdrawals already quoted keep the price they were quoted.
          </p>
          <form action={create}>
            <div className="grid-2">
              <div className="field">
                <label htmlFor="parkId">Park (blank = default)</label>
                <input id="parkId" name="parkId" />
              </div>
              <div className="field">
                <label htmlFor="currency">Currency</label>
                <select id="currency" name="currency" defaultValue="AMD">
                  <option>AMD</option>
                  <option>RUB</option>
                  <option>USD</option>
                  <option>EUR</option>
                  <option>GEL</option>
                  <option>KZT</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="platformBps">Cash Out rate (bps)</label>
                <input id="platformBps" name="platformBps" defaultValue="200" required />
              </div>
              <div className="field">
                <label htmlFor="platformFixed">Cash Out fixed (minor)</label>
                <input id="platformFixed" name="platformFixed" defaultValue="5000" required />
              </div>
              <div className="field">
                <label htmlFor="providerBps">Provider rate (bps)</label>
                <input id="providerBps" name="providerBps" defaultValue="60" required />
              </div>
              <div className="field">
                <label htmlFor="providerFixed">Provider fixed (minor)</label>
                <input id="providerFixed" name="providerFixed" defaultValue="1000" required />
              </div>
              <div className="field">
                <label htmlFor="increment">Payout increment (minor)</label>
                <input id="increment" name="increment" defaultValue="1" required />
              </div>
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
