import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { adminFetch, currentAdmin } from '@/lib/api';
import { formatDateTime, formatMinor, formatMoney } from '@/lib/format';
import { StateChip } from '@/components/StateChip';

interface DriverDetail {
  driver: {
    id: string;
    phone: string;
    name: string | null;
    locale: string;
    verificationStatus: string;
    parkId: string | null;
    parkName: string | null;
    yandexContractorProfileId: string | null;
    currency: string;
    riskTier: string;
    blockReason: string | null;
    verifiedAt: string | null;
    createdAt: string;
  };
  outstandingPayable: { minor: string; currency: string };
  memberships: Array<{
    id: string;
    parkId: string;
    parkName: string;
    parkStatus: string;
    externalProfileId: string;
    status: string;
    eligibility: string;
    eligibilityReason: string | null;
    isActive: boolean;
  }>;
  parkSwitches: Array<{
    id: string;
    fromParkId: string | null;
    toParkId: string;
    actorType: string;
    at: string;
  }>;
  payoutMethods: Array<{
    id: string;
    kind: string;
    status: string;
    masked: string;
    displayName: string | null;
    isDefault: boolean;
    createdAt: string;
    disabledAt: string | null;
  }>;
  withdrawals: Array<{
    id: string;
    reference: string;
    state: string;
    currency: string;
    gross: string;
    net: string;
    createdAt: string;
  }>;
}

export const dynamic = 'force-dynamic';

export default async function DriverDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, admin] = await Promise.all([
    adminFetch<DriverDetail>(`/v1/admin/drivers/${id}`),
    currentAdmin(),
  ]);

  const driver = detail.driver;
  const canWrite = admin.permissions.includes('drivers:write');
  const canAdjust = admin.permissions.includes('ledger:adjust');
  const blocked = driver.verificationStatus === 'BLOCKED';
  const parkNames = new Map(detail.memberships.map((row) => [row.parkId, row.parkName]));

  async function setBlocked(formData: FormData): Promise<void> {
    'use server';
    await adminFetch(`/v1/admin/drivers/${id}/block`, {
      method: 'POST',
      body: JSON.stringify({
        blocked: formData.get('blocked') === 'true',
        reason: String(formData.get('reason')),
      }),
    });
    revalidatePath(`/drivers/${id}`);
  }

  async function adjust(formData: FormData): Promise<void> {
    'use server';
    await adminFetch(`/v1/admin/drivers/${id}/adjust`, {
      method: 'POST',
      body: JSON.stringify({
        direction: formData.get('direction') === 'DEBIT' ? 'DEBIT' : 'CREDIT',
        amount: { minor: String(formData.get('minor')), currency: driver.currency },
        reason: String(formData.get('reason')),
      }),
    });
    revalidatePath(`/drivers/${id}`);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{driver.name ?? driver.phone}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {driver.phone} · joined {formatDateTime(driver.createdAt)}
          </p>
        </div>
        <Link href="/drivers">← All drivers</Link>
      </div>

      {blocked ? (
        <div className="error">
          Withdrawals are blocked: {driver.blockReason ?? 'no reason recorded'}
        </div>
      ) : null}

      <div className="grid-2">
        <section className="card">
          <h2>Profile</h2>
          <dl className="kv">
            <dt>Verification</dt>
            <dd>
              <span
                className={`chip ${blocked ? 'danger' : driver.verificationStatus === 'VERIFIED' ? 'ok' : 'neutral'}`}
              >
                {driver.verificationStatus}
              </span>
            </dd>
            <dt>Active park</dt>
            <dd>
              {driver.parkId ? (
                <Link href={`/parks/${driver.parkId}`}>{driver.parkName ?? driver.parkId}</Link>
              ) : (
                '—'
              )}
            </dd>
            <dt>Contractor profile</dt>
            <dd>{driver.yandexContractorProfileId ?? '—'}</dd>
            <dt>Currency</dt>
            <dd>{driver.currency}</dd>
            <dt>Language</dt>
            <dd>{driver.locale}</dd>
            <dt>Risk tier</dt>
            <dd>{driver.riskTier}</dd>
            <dt>Verified</dt>
            <dd>{formatDateTime(driver.verifiedAt)}</dd>
            <dt>Owed by Cash Out</dt>
            <dd>
              <strong>{formatMoney(detail.outstandingPayable)}</strong>
            </dd>
          </dl>
        </section>

        <section className="card">
          <h2>Payout methods</h2>
          {detail.payoutMethods.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Status</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {detail.payoutMethods.map((method) => (
                  <tr key={method.id}>
                    <td>
                      {method.displayName ?? method.kind} {method.masked}
                      {method.isDefault ? ' · default' : ''}
                    </td>
                    <td>
                      <span className={`chip ${method.status === 'ACTIVE' ? 'ok' : 'neutral'}`}>
                        {method.status}
                      </span>
                    </td>
                    <td>{formatDateTime(method.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <h2 style={{ marginTop: 24 }}>Taxi parks</h2>
      {detail.memberships.length === 0 ? (
        <div className="card muted">This phone is in no park’s roster.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Park</th>
              <th>Profile id</th>
              <th>Status</th>
              <th>Eligibility</th>
              <th>In the app</th>
            </tr>
          </thead>
          <tbody>
            {detail.memberships.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/parks/${row.parkId}`}>{row.parkName}</Link>
                  {row.parkStatus !== 'ACTIVE' ? (
                    <div>
                      <span className="chip danger">{row.parkStatus}</span>
                    </div>
                  ) : null}
                </td>
                <td className="muted">{row.externalProfileId}</td>
                <td>
                  <span className={`chip ${row.status === 'ACTIVE' ? 'ok' : 'neutral'}`}>
                    {row.status}
                  </span>
                </td>
                <td>
                  <span
                    className={`chip ${
                      row.eligibility === 'ELIGIBLE'
                        ? 'ok'
                        : row.eligibility === 'PENDING_REVIEW'
                          ? 'warn'
                          : 'danger'
                    }`}
                  >
                    {row.eligibility.replace(/_/g, ' ')}
                  </span>
                  {row.eligibilityReason ? (
                    <div className="muted">{row.eligibilityReason}</div>
                  ) : null}
                </td>
                <td>{row.isActive ? <span className="chip info">active park</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detail.parkSwitches.length > 0 ? (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Park switches</h2>
          <ul className="timeline">
            {detail.parkSwitches.map((row) => (
              <li key={row.id}>
                {formatDateTime(row.at)} ·{' '}
                {row.fromParkId ? (parkNames.get(row.fromParkId) ?? row.fromParkId) : 'none'} →{' '}
                {parkNames.get(row.toParkId) ?? row.toParkId}{' '}
                <span className="chip neutral">{row.actorType}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h2 style={{ marginTop: 24 }}>Withdrawals</h2>
      {detail.withdrawals.length === 0 ? (
        <div className="card muted">This driver has not withdrawn anything.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>State</th>
              <th className="num">Gross</th>
              <th className="num">Net</th>
              <th>Requested</th>
            </tr>
          </thead>
          <tbody>
            {detail.withdrawals.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/withdrawals/${row.id}`}>{row.reference}</Link>
                </td>
                <td>
                  <StateChip state={row.state} />
                </td>
                <td className="num">{formatMinor(row.gross, row.currency)}</td>
                <td className="num">{formatMinor(row.net, row.currency)}</td>
                <td>{formatDateTime(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canAdjust ? (
        <section className="card" style={{ marginTop: 24 }}>
          <h2>Adjust what Cash Out owes</h2>
          <p className="muted">
            A balanced ledger entry against SUSPENSE, shown to the driver as an adjustment in their
            history. It never touches the park balance inside Yandex. Amount in minor units of{' '}
            {driver.currency} (100 = 1.00).
          </p>
          <form action={adjust} className="toolbar" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="direction">Direction</label>
              <select id="direction" name="direction" defaultValue="CREDIT">
                <option value="CREDIT">Credit (owe more)</option>
                <option value="DEBIT">Debit (owe less)</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="minor">Amount (minor units)</label>
              <input id="minor" name="minor" inputMode="numeric" pattern="[0-9]+" required />
            </div>
            <div className="field" style={{ margin: 0, flex: 1 }}>
              <label htmlFor="adjustReason">Reason</label>
              <input id="adjustReason" name="reason" required minLength={5} maxLength={500} />
            </div>
            <button type="submit">Post adjustment</button>
          </form>
        </section>
      ) : null}

      {canWrite ? (
        <section className="card" style={{ marginTop: 24 }}>
          <h2>{blocked ? 'Unblock' : 'Block'} withdrawals</h2>
          <form action={setBlocked}>
            <input type="hidden" name="blocked" value={blocked ? 'false' : 'true'} />
            <div className="field">
              <label htmlFor="reason">Reason</label>
              <textarea id="reason" name="reason" rows={2} minLength={5} required />
            </div>
            <button type="submit" className={blocked ? 'secondary' : 'danger'}>
              {blocked ? 'Allow withdrawals again' : 'Block withdrawals'}
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
