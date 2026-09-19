import { adminFetch } from '@/lib/api';
import { WithdrawalTable, type AdminWithdrawalRow } from '../page';

export const dynamic = 'force-dynamic';

/**
 * The work queue: everything an operator is expected to act on, in one list.
 *
 * Failed payouts, uncertain outcomes and manual reviews are deliberately not
 * separate screens. They are one queue because they are one job — find the
 * withdrawals where automation stopped, and finish them.
 */
export default async function AttentionPage() {
  const page = await adminFetch<{ items: AdminWithdrawalRow[]; nextCursor: string | null }>(
    '/v1/admin/withdrawals?limit=100&needsAttention=true',
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Needs attention</h1>
          <p className="muted" style={{ margin: 0 }}>
            Withdrawals where automation stopped: a failed or returned payout, an outcome we could
            not determine, or a decision that needs a person.
          </p>
        </div>
      </div>

      <WithdrawalTable rows={page.items} />
    </>
  );
}
