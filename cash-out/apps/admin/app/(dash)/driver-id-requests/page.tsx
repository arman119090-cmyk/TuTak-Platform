import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { adminFetch, currentAdmin } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface RequestRow {
  id: string;
  park: { id: string; name: string };
  previousDriverId: string;
  requestedDriverId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  source: 'DRIVER' | 'ADMIN';
  requestedAt: string;
  verifiedAt: string | null;
  decidedAt: string | null;
  verificationNote: string | null;
  driverId: string;
  phone: string;
  driverName: string | null;
}

export const dynamic = 'force-dynamic';

const NOTE: Record<string, string> = {
  profile_found: 'The Fleet API knows this profile in this park',
  profile_not_found: 'The Fleet API has no such profile in this park',
  phone_mismatch: 'The profile belongs to a different phone number',
  fleet_unavailable: 'The Fleet API did not answer; not verified',
};

/**
 * Driver ID change requests.
 *
 * A driver asks to be linked to a different Yandex profile; the automatic
 * check says what the Fleet API found; an operator decides. Approval swaps the
 * profile on the roster row and invalidates the balance — it is refused while
 * a payout is in flight, so the money and the identity never move together.
 */
export default async function DriverIdRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const status = params.status ?? 'PENDING';
  const query = new URLSearchParams({ limit: '50' });
  if (status !== 'ALL') query.set('status', status);
  if (params.cursor) query.set('cursor', params.cursor);

  const [page, admin] = await Promise.all([
    adminFetch<{ items: RequestRow[]; nextCursor: string | null }>(
      `/v1/admin/driver-id-requests?${query.toString()}`,
    ),
    currentAdmin(),
  ]);
  const canWrite = admin.permissions.includes('drivers:write');

  async function decide(formData: FormData): Promise<void> {
    'use server';
    const id = String(formData.get('id'));
    const decision = formData.get('decision') === 'approve' ? 'approve' : 'reject';
    await adminFetch(`/v1/admin/driver-id-requests/${id}/${decision}`, {
      method: 'POST',
      body: JSON.stringify({ reason: String(formData.get('reason')) }),
    });
    revalidatePath('/driver-id-requests');
  }

  return (
    <>
      <div className="page-header">
        <h1>Driver ID requests</h1>
      </div>

      <form className="toolbar" action="/driver-id-requests">
        <select name="status" defaultValue={status}>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="ALL">All</option>
        </select>
        <button type="submit">Show</button>
      </form>

      {page.items.length === 0 ? (
        <div className="card muted">No requests in this state.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Park</th>
              <th>From → to</th>
              <th>Automatic check</th>
              <th>Status</th>
              <th>Requested</th>
              {canWrite ? <th>Decision</th> : null}
            </tr>
          </thead>
          <tbody>
            {page.items.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`/drivers/${row.driverId}`}>{row.driverName ?? row.phone}</Link>
                  <div className="muted">{row.phone}</div>
                </td>
                <td>
                  <Link href={`/parks/${row.park.id}`}>{row.park.name}</Link>
                </td>
                <td>
                  <code>{row.previousDriverId}</code> → <code>{row.requestedDriverId}</code>
                </td>
                <td>
                  {row.verificationNote ? (
                    <span
                      className={`chip ${
                        row.verificationNote === 'profile_found'
                          ? 'ok'
                          : row.verificationNote === 'fleet_unavailable'
                            ? 'warn'
                            : 'danger'
                      }`}
                    >
                      {NOTE[row.verificationNote] ?? row.verificationNote}
                    </span>
                  ) : (
                    <span className="muted">not checked</span>
                  )}
                </td>
                <td>
                  <span
                    className={`chip ${
                      row.status === 'APPROVED'
                        ? 'ok'
                        : row.status === 'PENDING'
                          ? 'warn'
                          : 'neutral'
                    }`}
                  >
                    {row.status}
                  </span>
                  {row.decidedAt ? (
                    <div className="muted">{formatDateTime(row.decidedAt)}</div>
                  ) : null}
                </td>
                <td>{formatDateTime(row.requestedAt)}</td>
                {canWrite ? (
                  <td>
                    {row.status === 'PENDING' ? (
                      <form action={decide} className="toolbar" style={{ margin: 0 }}>
                        <input type="hidden" name="id" value={row.id} />
                        <input name="reason" placeholder="reason" required minLength={3} />
                        <button type="submit" name="decision" value="approve">
                          Approve
                        </button>
                        <button type="submit" name="decision" value="reject" className="danger">
                          Reject
                        </button>
                      </form>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {page.nextCursor ? (
        <p style={{ marginTop: 16 }}>
          <Link
            className="button"
            href={`/driver-id-requests?${new URLSearchParams({ status, cursor: page.nextCursor }).toString()}`}
          >
            Next page →
          </Link>
        </p>
      ) : null}
    </>
  );
}
