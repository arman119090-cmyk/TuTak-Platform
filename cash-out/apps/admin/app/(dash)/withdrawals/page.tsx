import Link from 'next/link';
import { adminFetch } from '@/lib/api';
import { formatDateTime, formatMinor } from '@/lib/format';
import { StateChip } from '@/components/StateChip';

export interface AdminWithdrawalRow {
  id: string;
  reference: string;
  state: string;
  currency: string;
  gross: string;
  net: string;
  platformFee: string;
  providerFee: string;
  driverId: string;
  driverPhone: string;
  driverName: string | null;
  parkId: string;
  payoutMethod: string;
  failureCode: string | null;
  manualReviewReason: string | null;
  riskScore: number | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export const dynamic = 'force-dynamic';

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; driverId?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ limit: '50' });
  if (params.state) query.set('state', params.state);
  if (params.driverId) query.set('driverId', params.driverId);
  if (params.cursor) query.set('cursor', params.cursor);

  const page = await adminFetch<{ items: AdminWithdrawalRow[]; nextCursor: string | null }>(
    `/v1/admin/withdrawals?${query.toString()}`,
  );

  return (
    <>
      <div className="page-header">
        <h1>Withdrawals</h1>
      </div>

      <WithdrawalTable rows={page.items} />

      {page.nextCursor ? (
        <p style={{ marginTop: 16 }}>
          <Link
            className="button"
            href={`/withdrawals?${new URLSearchParams({
              ...(params.state ? { state: params.state } : {}),
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

export function WithdrawalTable({ rows }: { rows: AdminWithdrawalRow[] }) {
  if (rows.length === 0) {
    return <div className="card muted">Nothing here.</div>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Reference</th>
          <th>Driver</th>
          <th>State</th>
          <th className="num">Gross</th>
          <th className="num">Net</th>
          <th>Requested</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <Link href={`/withdrawals/${row.id}`}>{row.reference}</Link>
              <div className="muted">{row.payoutMethod}</div>
            </td>
            <td>
              <Link href={`/drivers/${row.driverId}`}>{row.driverName ?? row.driverPhone}</Link>
              <div className="muted">{row.parkId}</div>
            </td>
            <td>
              <StateChip state={row.state} />
              {row.riskScore !== null && row.riskScore > 0 ? (
                <div className="muted">risk {row.riskScore}</div>
              ) : null}
            </td>
            <td className="num">{formatMinor(row.gross, row.currency)}</td>
            <td className="num">{formatMinor(row.net, row.currency)}</td>
            <td>{formatDateTime(row.createdAt)}</td>
            <td className="muted">{row.manualReviewReason ?? row.failureCode ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
