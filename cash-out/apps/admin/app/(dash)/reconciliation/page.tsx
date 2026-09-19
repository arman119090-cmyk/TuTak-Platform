import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { adminFetch, currentAdmin } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface Mismatch {
  id: string;
  kind: string;
  runKind: string;
  withdrawalId: string | null;
  expected: string | null;
  actual: string | null;
  detail: unknown;
  createdAt: string;
}

export const dynamic = 'force-dynamic';

/**
 * Reconciliation is the page that says whether the product is actually working.
 *
 * An empty list here means our books, the park's transactions and the bank's
 * records agree. A non-empty list is not a report — it is a queue.
 */
export default async function ReconciliationPage() {
  const [{ items }, admin] = await Promise.all([
    adminFetch<{ items: Mismatch[] }>('/v1/admin/reconciliation/mismatches'),
    currentAdmin(),
  ]);

  const canRun = admin.permissions.includes('reconciliation:run');

  async function run(formData: FormData): Promise<void> {
    'use server';
    await adminFetch(`/v1/admin/reconciliation/run?kind=${String(formData.get('kind'))}`, {
      method: 'POST',
    });
    revalidatePath('/reconciliation');
  }

  async function resolve(formData: FormData): Promise<void> {
    'use server';
    await adminFetch(`/v1/admin/reconciliation/mismatches/${String(formData.get('id'))}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ note: String(formData.get('note')) }),
    });
    revalidatePath('/reconciliation');
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Reconciliation</h1>
          <p className="muted" style={{ margin: 0 }}>
            Our ledger against itself, against the park’s transactions, and against the bank.
          </p>
        </div>
      </div>

      {canRun ? (
        <div className="toolbar">
          {(['LEDGER', 'YANDEX', 'PROVIDER'] as const).map((kind) => (
            <form key={kind} action={run}>
              <input type="hidden" name="kind" value={kind} />
              <button type="submit" className="secondary">
                Run {kind.toLowerCase()} check
              </button>
            </form>
          ))}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="card">
          <strong>Clean.</strong>
          <p className="muted" style={{ marginBottom: 0 }}>
            Every checked withdrawal matches its Yandex transaction and its bank transfer, and the
            ledger balances in every currency.
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Finding</th>
              <th>Withdrawal</th>
              <th>Expected</th>
              <th>Actual</th>
              <th>Found</th>
              <th>Close</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td>
                  <span className="chip danger">{row.kind}</span>
                  <div className="muted">{row.runKind}</div>
                </td>
                <td>
                  {row.withdrawalId ? (
                    <Link href={`/withdrawals/${row.withdrawalId}`}>open</Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="num">{row.expected ?? '—'}</td>
                <td className="num">{row.actual ?? '—'}</td>
                <td>{formatDateTime(row.createdAt)}</td>
                <td>
                  <form action={resolve}>
                    <input type="hidden" name="id" value={row.id} />
                    <input name="note" placeholder="What did you verify?" required minLength={5} />
                    <button type="submit" className="secondary" style={{ marginTop: 6 }}>
                      Close
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
