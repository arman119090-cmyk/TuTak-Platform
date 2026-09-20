import Link from 'next/link';
import { adminFetch } from '@/lib/api';
import { formatDateTime, formatMoney, relativeAge } from '@/lib/format';

interface RuleRow {
  id: string;
  enabled: boolean;
  paused: boolean;
  pausedReason: string | null;
  cadence: string;
  threshold: { minor: string; currency: string };
  maxPayout: { minor: string; currency: string } | null;
  runHour: number | null;
  runWeekday: number | null;
  timezone: string;
  park: { id: string; name: string };
  destination: { maskedIdentifier: string; displayName: string | null; status: string };
  nextCheckAt: string | null;
  lastRunAt: string | null;
  lastWithdrawalId: string | null;
  lastFailureCode: string | null;
  consecutiveFailures: number;
  driverId: string;
  driverPhone: string | null;
  driverName: string | null;
}

export const dynamic = 'force-dynamic';

/**
 * Automatic payout rules, read-only.
 *
 * The rule is the driver's; operators see it to answer "why did money move at
 * 09:00" and "why did it stop". Stopping is the driver's, or the system's
 * after three failures — an operator who needs a rule off blocks the driver,
 * which is audited, rather than editing a rule they do not own.
 */
export default async function AutoPayoutPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ limit: '50' });
  if (params.status && params.status !== 'all') query.set('status', params.status);
  if (params.cursor) query.set('cursor', params.cursor);

  const page = await adminFetch<{ items: RuleRow[]; nextCursor: string | null }>(
    `/v1/admin/auto-payout/rules?${query.toString()}`,
  );

  return (
    <>
      <div className="page-header">
        <h1>Automatic payouts</h1>
      </div>

      <form className="toolbar" action="/auto-payout">
        <select name="status" defaultValue={params.status ?? 'all'}>
          <option value="all">All rules</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="disabled">Disabled</option>
        </select>
        <button type="submit">Show</button>
      </form>

      {page.items.length === 0 ? (
        <div className="card muted">No rules match.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Park</th>
              <th>Rule</th>
              <th>Destination</th>
              <th>State</th>
              <th>Next check</th>
              <th>Last run</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((rule) => (
              <tr key={rule.id}>
                <td>
                  <Link href={`/drivers/${rule.driverId}`}>
                    {rule.driverName ?? rule.driverPhone ?? rule.driverId}
                  </Link>
                  <div className="muted">{rule.driverPhone}</div>
                </td>
                <td>
                  <Link href={`/parks/${rule.park.id}`}>{rule.park.name}</Link>
                </td>
                <td>
                  {rule.cadence.replace(/_/g, ' ').toLowerCase()} · from{' '}
                  {formatMoney(rule.threshold)}
                  {rule.maxPayout ? ` · up to ${formatMoney(rule.maxPayout)}` : ''}
                  <div className="muted">
                    {rule.runHour !== null ? `${String(rule.runHour).padStart(2, '0')}:00 ` : ''}
                    {rule.timezone}
                  </div>
                </td>
                <td>
                  {rule.destination.displayName ?? 'iDram'} {rule.destination.maskedIdentifier}
                  {rule.destination.status !== 'ACTIVE' ? (
                    <div>
                      <span className="chip danger">{rule.destination.status}</span>
                    </div>
                  ) : null}
                </td>
                <td>
                  <span
                    className={`chip ${!rule.enabled ? 'neutral' : rule.paused ? 'danger' : 'ok'}`}
                  >
                    {!rule.enabled ? 'disabled' : rule.paused ? 'paused' : 'active'}
                  </span>
                  {rule.paused && rule.pausedReason ? (
                    <div className="muted">{rule.pausedReason}</div>
                  ) : null}
                  {rule.consecutiveFailures > 0 ? (
                    <div className="muted">
                      {rule.consecutiveFailures} failure(s): {rule.lastFailureCode}
                    </div>
                  ) : null}
                </td>
                <td>{rule.nextCheckAt ? formatDateTime(rule.nextCheckAt) : '—'}</td>
                <td>
                  {relativeAge(rule.lastRunAt)}
                  {rule.lastWithdrawalId ? (
                    <div>
                      <Link href={`/withdrawals/${rule.lastWithdrawalId}`}>last payout</Link>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {page.nextCursor ? (
        <p style={{ marginTop: 16 }}>
          <Link
            className="button"
            href={`/auto-payout?${new URLSearchParams({
              ...(params.status ? { status: params.status } : {}),
              cursor: page.nextCursor,
            }).toString()}`}
          >
            Next page →
          </Link>
        </p>
      ) : null}
    </>
  );
}
