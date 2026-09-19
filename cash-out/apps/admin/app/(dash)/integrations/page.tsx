import { adminFetch } from '@/lib/api';
import { formatDateTime, relativeAge } from '@/lib/format';

interface IntegrationRow {
  integration: string;
  mode: 'mock' | 'live';
  status: string;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  okCount: number;
  errorCount: number;
}

export const dynamic = 'force-dynamic';

/**
 * Integration health.
 *
 * A tile reads MOCK, not OK, whenever the process is running against a fake.
 * A green mock is worse than no tile at all: it is an operator being told the
 * bank is up when there is no bank.
 */
export default async function IntegrationsPage() {
  const { items } = await adminFetch<{ items: IntegrationRow[] }>('/v1/admin/integrations');
  const anyMock = items.some((item) => item.mode === 'mock');

  return (
    <>
      <div className="page-header">
        <h1>Integrations</h1>
      </div>

      {anyMock ? (
        <div className="banner">
          This deployment is running against mock integrations. No Yandex balance is changed and no
          real money moves.
        </div>
      ) : null}

      <div className="tiles">
        {items.map((item) => (
          <div className="card" key={item.integration}>
            <div className="tile-label">{item.integration}</div>
            <div
              className={`tile-value${
                item.mode === 'mock' ? ' warn' : item.status === 'OK' ? '' : ' alarm'
              }`}
            >
              {item.mode === 'mock' ? 'MOCK' : item.status}
            </div>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Last success</dt>
              <dd>{relativeAge(item.lastOkAt)}</dd>
              <dt>Last failure</dt>
              <dd>{relativeAge(item.lastErrorAt)}</dd>
              <dt>Successes</dt>
              <dd>{item.okCount}</dd>
              <dt>Failures</dt>
              <dd>{item.errorCount}</dd>
            </dl>
            {item.lastError ? (
              <p className="muted" style={{ marginBottom: 0 }}>
                {item.lastError} ({formatDateTime(item.lastErrorAt)})
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <section className="card">
        <h2>What these mean</h2>
        <dl className="kv">
          <dt>yandex-fleet</dt>
          <dd>
            Reads the driver’s park balance and posts the debit that funds a payout. It does not
            move money to a bank.
          </dd>
          <dt>payment-provider</dt>
          <dd>
            The licensed bank or PSP that actually transfers the net amount to the driver’s account.
          </dd>
        </dl>
      </section>
    </>
  );
}
