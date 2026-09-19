import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { adminFetch, currentAdmin } from '@/lib/api';
import { formatDateTime, formatMinor } from '@/lib/format';
import { StateChip } from '@/components/StateChip';

interface WithdrawalDetail {
  withdrawal: {
    id: string;
    reference: string;
    state: string;
    currency: string;
    gross: string;
    platformFee: string;
    providerFee: string;
    net: string;
    parkId: string;
    yandexContractorProfileId: string;
    yandexTransactionId: string | null;
    yandexBalanceBefore: string | null;
    yandexBalanceAfter: string | null;
    providerTransactionId: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    manualReviewReason: string | null;
    riskScore: number | null;
    attempts: number;
    createdAt: string;
    updatedAt: string;
  };
  driver: { id: string; phone: string; name: string; verificationStatus: string };
  payoutMethod: { id: string; masked: string; status: string };
  timeline: Array<{
    from: string | null;
    to: string;
    at: string;
    actorType: string;
    note: string | null;
  }>;
  providerEvents: Array<{
    id: string;
    type: string;
    receivedAt: string;
    processedAt: string | null;
  }>;
  ledger: Array<{
    id: string;
    type: string;
    description: string;
    createdAt: string;
    postings: Array<{ account: string; direction: string; amount: string; currency: string }>;
  }>;
}

export const dynamic = 'force-dynamic';

/**
 * One withdrawal, with everything needed to decide what to do about it: the
 * amounts, both external references, the full state timeline, every webhook
 * the provider sent, and the actual ledger entries.
 *
 * The ledger is on this page rather than behind a link because an operator
 * resolving a stuck payout has to answer "what do our books say happened"
 * before they touch anything.
 */
export default async function WithdrawalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [detail, admin] = await Promise.all([
    adminFetch<WithdrawalDetail>(`/v1/admin/withdrawals/${id}`),
    currentAdmin(),
  ]);

  const w = detail.withdrawal;
  const canResolve = admin.permissions.includes('withdrawals:resolve');
  const underReview = w.state === 'MANUAL_REVIEW' || w.state === 'RISK_REVIEW';

  async function resolve(formData: FormData): Promise<void> {
    'use server';
    await adminFetch(`/v1/admin/withdrawals/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({
        resolution: String(formData.get('resolution')),
        reason: String(formData.get('reason')),
        evidenceReference: String(formData.get('evidenceReference') ?? '') || undefined,
      }),
    });
    revalidatePath(`/withdrawals/${id}`);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{w.reference}</h1>
          <p className="muted" style={{ margin: 0 }}>
            <StateChip state={w.state} /> · requested {formatDateTime(w.createdAt)}
          </p>
        </div>
        <Link href="/withdrawals">← All withdrawals</Link>
      </div>

      {w.manualReviewReason ? <div className="banner">{w.manualReviewReason}</div> : null}
      {w.failureCode ? (
        <div className="error">
          {w.failureCode}
          {w.failureMessage ? ` — ${w.failureMessage}` : ''}
        </div>
      ) : null}

      <div className="grid-2">
        <section className="card">
          <h2>Amounts</h2>
          <dl className="kv">
            <dt>Gross (debited)</dt>
            <dd>{formatMinor(w.gross, w.currency)}</dd>
            <dt>Cash Out fee</dt>
            <dd>{formatMinor(w.platformFee, w.currency)}</dd>
            <dt>Provider fee</dt>
            <dd>{formatMinor(w.providerFee, w.currency)}</dd>
            <dt>Net (paid)</dt>
            <dd>
              <strong>{formatMinor(w.net, w.currency)}</strong>
            </dd>
          </dl>
        </section>

        <section className="card">
          <h2>Counterparties</h2>
          <dl className="kv">
            <dt>Driver</dt>
            <dd>
              <Link href={`/drivers/${detail.driver.id}`}>
                {detail.driver.name || detail.driver.phone}
              </Link>
            </dd>
            <dt>Park</dt>
            <dd>{w.parkId}</dd>
            <dt>Contractor profile</dt>
            <dd>{w.yandexContractorProfileId}</dd>
            <dt>Yandex transaction</dt>
            <dd>{w.yandexTransactionId ?? '—'}</dd>
            <dt>Balance before</dt>
            <dd>{w.yandexBalanceBefore ? formatMinor(w.yandexBalanceBefore, w.currency) : '—'}</dd>
            <dt>Payout method</dt>
            <dd>
              {detail.payoutMethod.masked} ({detail.payoutMethod.status})
            </dd>
            <dt>Provider transaction</dt>
            <dd>{w.providerTransactionId ?? '—'}</dd>
            <dt>Attempts</dt>
            <dd>{w.attempts}</dd>
            <dt>Risk score</dt>
            <dd>{w.riskScore ?? '—'}</dd>
          </dl>
        </section>
      </div>

      <h2 style={{ marginTop: 24 }}>Timeline</h2>
      <ul className="timeline card">
        {detail.timeline.map((entry) => (
          <li key={`${entry.to}-${entry.at}`}>
            <span>
              <StateChip state={entry.to} />{' '}
              <span className="muted">
                {entry.from ? `from ${entry.from}` : 'created'} · {entry.actorType}
                {entry.note ? ` · ${entry.note}` : ''}
              </span>
            </span>
            <span className="muted">{formatDateTime(entry.at)}</span>
          </li>
        ))}
      </ul>

      <h2 style={{ marginTop: 24 }}>Ledger</h2>
      {detail.ledger.length === 0 ? (
        <div className="card muted">No journal entries yet — nothing has been booked.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Entry</th>
              <th>Account</th>
              <th>Direction</th>
              <th className="num">Amount</th>
              <th>Posted</th>
            </tr>
          </thead>
          <tbody>
            {detail.ledger.flatMap((entry) =>
              entry.postings.map((posting, index) => (
                <tr key={`${entry.id}-${index}`}>
                  <td>{index === 0 ? entry.type : ''}</td>
                  <td>{posting.account}</td>
                  <td>
                    <span className={`chip ${posting.direction === 'DEBIT' ? 'info' : 'neutral'}`}>
                      {posting.direction}
                    </span>
                  </td>
                  <td className="num">{formatMinor(posting.amount, posting.currency)}</td>
                  <td>{index === 0 ? formatDateTime(entry.createdAt) : ''}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}

      {detail.providerEvents.length > 0 ? (
        <>
          <h2 style={{ marginTop: 24 }}>Provider events</h2>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Received</th>
                <th>Processed</th>
              </tr>
            </thead>
            <tbody>
              {detail.providerEvents.map((event) => (
                <tr key={event.id}>
                  <td>{event.type}</td>
                  <td>{formatDateTime(event.receivedAt)}</td>
                  <td>{formatDateTime(event.processedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {canResolve && underReview ? (
        <section className="card" style={{ marginTop: 24 }}>
          <h2>Resolve</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Every decision is written to the audit log with your name and your reason. Marking a
            payout completed asserts that the money really reached the driver, so it requires the
            provider’s transaction id as evidence.
          </p>
          <form action={resolve}>
            <div className="field">
              <label htmlFor="resolution">Decision</label>
              <select id="resolution" name="resolution" defaultValue="COMPENSATE">
                <option value="COMPENSATE">Return the money to the driver’s balance</option>
                <option value="RETRY_PAYOUT">Instruct the provider again</option>
                <option value="MARK_COMPLETED">The money did arrive — mark completed</option>
                <option value="MARK_FAILED">Nothing moved — mark failed</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="reason">Reason (at least 10 characters)</label>
              <textarea id="reason" name="reason" rows={3} minLength={10} required />
            </div>
            <div className="field">
              <label htmlFor="evidenceReference">Evidence (provider transaction id)</label>
              <input id="evidenceReference" name="evidenceReference" />
            </div>
            <button type="submit">Apply decision</button>
          </form>
        </section>
      ) : null}
    </>
  );
}
