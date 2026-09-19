import Link from 'next/link';
import { adminFetch } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface AuditRow {
  id: string;
  at: string;
  actorType: string;
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId: string | null;
  reason: string | null;
  requestId: string | null;
}

export const dynamic = 'force-dynamic';

/**
 * The audit log is append-only at the database level: the table rejects UPDATE
 * and DELETE with a trigger. What is shown here is what happened.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ subjectId?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ limit: '100' });
  if (params.subjectId) query.set('subjectId', params.subjectId);
  if (params.cursor) query.set('cursor', params.cursor);

  const page = await adminFetch<{ items: AuditRow[]; nextCursor: string | null }>(
    `/v1/admin/audit?${query.toString()}`,
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Audit log</h1>
          <p className="muted" style={{ margin: 0 }}>
            Append-only. Who did what, to what, when, and why.
          </p>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Subject</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {page.items.map((row) => (
            <tr key={row.id}>
              <td>{formatDateTime(row.at)}</td>
              <td>
                <span className="chip neutral">{row.actorType}</span>
                <div className="muted">{row.actorId ?? '—'}</div>
              </td>
              <td>{row.action}</td>
              <td>
                {row.subjectType === 'withdrawal' && row.subjectId ? (
                  <Link href={`/withdrawals/${row.subjectId}`}>{row.subjectType}</Link>
                ) : row.subjectType === 'driver' && row.subjectId ? (
                  <Link href={`/drivers/${row.subjectId}`}>{row.subjectType}</Link>
                ) : (
                  row.subjectType
                )}
                <div className="muted">{row.subjectId ?? '—'}</div>
              </td>
              <td className="muted">{row.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {page.nextCursor ? (
        <p style={{ marginTop: 16 }}>
          <Link className="button" href={`/audit?cursor=${page.nextCursor}`}>
            Next page →
          </Link>
        </p>
      ) : null}
    </>
  );
}
