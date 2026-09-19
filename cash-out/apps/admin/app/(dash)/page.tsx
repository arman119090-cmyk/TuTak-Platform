import Link from 'next/link';
import type { DashboardMetricsDto } from '@cashout/contracts';
import { adminFetch } from '@/lib/api';
import { formatMoney, percentFromPpm, relativeAge } from '@/lib/format';
import { StateChip } from '@/components/StateChip';

interface StuckRow {
  id: string;
  reference: string;
  state: string;
  gross: string;
  currency: string;
  updatedAt: string;
}

export const dynamic = 'force-dynamic';

/**
 * The dashboard answers one question first: is anyone's money stuck right now?
 *
 * Volume and revenue are further down the page on purpose. A payout operation
 * that leads with its revenue chart is one that finds out about a stuck
 * withdrawal from the driver.
 */
export default async function DashboardPage() {
  const [metrics, stuck] = await Promise.all([
    adminFetch<DashboardMetricsDto>('/v1/admin/dashboard?window=24h'),
    adminFetch<{ items: StuckRow[] }>('/v1/admin/stuck').catch(() => ({ items: [] as StuckRow[] })),
  ]);

  const attention = metrics.manualReviewCount + metrics.stuckCount;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted" style={{ margin: 0 }}>
            Last 24 hours
          </p>
        </div>
      </div>

      {attention > 0 ? (
        <div className="banner">
          {metrics.stuckCount} withdrawal(s) holding a debit with no movement, and{' '}
          {metrics.manualReviewCount} waiting for a decision.{' '}
          <Link href="/withdrawals/attention">Open the queue →</Link>
        </div>
      ) : null}

      <section className="tiles">
        <Tile
          label="Stuck (debited, not paid)"
          value={String(metrics.stuckCount)}
          tone={metrics.stuckCount > 0 ? 'alarm' : undefined}
        />
        <Tile
          label="Awaiting a decision"
          value={String(metrics.manualReviewCount)}
          tone={metrics.manualReviewCount > 0 ? 'warn' : undefined}
        />
        <Tile label="In flight" value={String(metrics.inFlightCount)} />
        <Tile
          label="Suspense balance"
          value={formatMoney(metrics.suspenseBalance)}
          tone={metrics.suspenseBalance.minor !== '0' ? 'alarm' : undefined}
        />
      </section>

      <section className="tiles">
        <Tile label="Withdrawals" value={String(metrics.withdrawalsCount)} />
        <Tile label="Volume paid" value={formatMoney(metrics.withdrawalsVolume)} />
        <Tile label="Commission earned" value={formatMoney(metrics.platformRevenue)} />
        <Tile label="Success rate" value={percentFromPpm(metrics.successRatePpm)} />
      </section>

      <h2>Not moving</h2>
      {stuck.items.length === 0 ? (
        <div className="card muted">
          Nothing is stuck. Every withdrawal that has debited a driver is still progressing.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>State</th>
              <th className="num">Amount</th>
              <th>Last change</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {stuck.items.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/withdrawals/${row.id}`}>{row.reference}</Link>
                </td>
                <td>
                  <StateChip state={row.state} />
                </td>
                <td className="num">{formatMoney({ minor: row.gross, currency: row.currency })}</td>
                <td>{relativeAge(row.updatedAt)}</td>
                <td>
                  <Link href={`/withdrawals/${row.id}`}>Open →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'alarm' | 'warn' }) {
  return (
    <div className="card">
      <div className="tile-label">{label}</div>
      <div className={`tile-value${tone ? ` ${tone}` : ''}`}>{value}</div>
    </div>
  );
}
