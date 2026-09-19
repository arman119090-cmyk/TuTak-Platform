import Link from 'next/link';
import { adminFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface DriverRow {
  id: string;
  phone: string;
  name: string | null;
  verificationStatus: string;
  parkId: string | null;
  yandexContractorProfileId: string | null;
  riskTier: string;
  withdrawalCount: number;
  createdAt: string;
}

export const dynamic = 'force-dynamic';

export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ limit: '50' });
  if (params.search) query.set('search', params.search);
  if (params.cursor) query.set('cursor', params.cursor);

  const page = await adminFetch<{ items: DriverRow[]; nextCursor: string | null }>(
    `/v1/admin/drivers?${query.toString()}`,
  );

  return (
    <>
      <div className="page-header">
        <h1>Drivers</h1>
      </div>

      <form className="toolbar" action="/drivers">
        <input
          name="search"
          defaultValue={params.search ?? ''}
          placeholder="Phone, name or contractor profile id"
          style={{ maxWidth: 420 }}
        />
        <button type="submit">Search</button>
      </form>

      {page.items.length === 0 ? (
        <div className="card muted">No drivers match.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Status</th>
              <th>Park</th>
              <th>Contractor profile</th>
              <th className="num">Withdrawals</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((driver) => (
              <tr key={driver.id}>
                <td>
                  <Link href={`/drivers/${driver.id}`}>{driver.name ?? driver.phone}</Link>
                  <div className="muted">{driver.phone}</div>
                </td>
                <td>
                  <span
                    className={`chip ${
                      driver.verificationStatus === 'VERIFIED'
                        ? 'ok'
                        : driver.verificationStatus === 'BLOCKED'
                          ? 'danger'
                          : 'neutral'
                    }`}
                  >
                    {driver.verificationStatus}
                  </span>
                  {driver.riskTier !== 'STANDARD' ? (
                    <div>
                      <span className="chip warn">{driver.riskTier}</span>
                    </div>
                  ) : null}
                </td>
                <td>{driver.parkId ?? '—'}</td>
                <td className="muted">{driver.yandexContractorProfileId ?? '—'}</td>
                <td className="num">{driver.withdrawalCount}</td>
                <td>{formatDateTime(driver.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {page.nextCursor ? (
        <p style={{ marginTop: 16 }}>
          <Link
            className="button"
            href={`/drivers?${new URLSearchParams({
              ...(params.search ? { search: params.search } : {}),
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
