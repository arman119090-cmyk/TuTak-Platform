import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminFetch, AdminApiError, currentAdmin } from '@/lib/api';
import { formatDateTime, relativeAge } from '@/lib/format';

interface ParkDetail {
  id: string;
  code: string;
  name: string;
  yandexParkId: string;
  currency: string;
  status: 'ACTIVE' | 'SUSPENDED';
  suspendedReason: string | null;
  createdAt: string;
  counts: { members: number; eligible: number; attached: number };
  credential: {
    clientId: string;
    apiKeyHint: string;
    lastVerifiedAt: string | null;
    lastError: string | null;
    updatedAt: string;
  } | null;
  imports: Array<{
    id: string;
    source: string;
    totalRows: number;
    created: number;
    updated: number;
    skipped: number;
    createdAt: string;
  }>;
}

interface MembershipRow {
  id: string;
  phone: string;
  externalProfileId: string;
  name: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  eligibility: 'ELIGIBLE' | 'INELIGIBLE' | 'PENDING_REVIEW';
  eligibilityReason: string | null;
  source: string;
  driverId: string | null;
  driverStatus: string | null;
  isActiveForDriver: boolean;
}

export const dynamic = 'force-dynamic';

/**
 * Parses the roster textarea: one driver per line, `phone, profileId[, first[, last]]`.
 * Commas, semicolons and tabs all separate; a header line is skipped.
 */
function parseRoster(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^phone/i.test(line))
    .map((line) => {
      const [phone = '', externalProfileId = '', firstName, lastName] = line
        .split(/[,;\t]/)
        .map((cell) => cell.trim());
      return {
        phone,
        externalProfileId,
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
      };
    });
}

export default async function ParkDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string; search?: string; cursor?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const membersQuery = new URLSearchParams({ limit: '50' });
  if (query.search) membersQuery.set('search', query.search);
  if (query.cursor) membersQuery.set('cursor', query.cursor);

  const [park, members, admin] = await Promise.all([
    adminFetch<ParkDetail>(`/v1/admin/parks/${id}`),
    adminFetch<{ items: MembershipRow[]; nextCursor: string | null }>(
      `/v1/admin/parks/${id}/memberships?${membersQuery.toString()}`,
    ),
    currentAdmin(),
  ]);
  const canWrite = admin.permissions.includes('parks:write');
  const suspended = park.status === 'SUSPENDED';

  const back = (notice: string, error = false) =>
    redirect(`/parks/${id}?${error ? 'error' : 'notice'}=${encodeURIComponent(notice)}`);

  async function setStatus(formData: FormData): Promise<void> {
    'use server';
    const nextSuspended = formData.get('suspend') === 'true';
    await adminFetch(`/v1/admin/parks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: nextSuspended ? 'SUSPENDED' : 'ACTIVE',
        suspendedReason: nextSuspended ? String(formData.get('reason')) : null,
      }),
    });
    revalidatePath(`/parks/${id}`);
  }

  async function setCredential(formData: FormData): Promise<void> {
    'use server';
    await adminFetch(`/v1/admin/parks/${id}/credential`, {
      method: 'POST',
      body: JSON.stringify({
        clientId: String(formData.get('clientId')).trim(),
        apiKey: String(formData.get('apiKey')).trim(),
      }),
    });
    back('Credential stored. Verify it to see whether the Fleet API answers.');
  }

  async function verifyCredential(): Promise<void> {
    'use server';
    const result = await adminFetch<{ ok: boolean; error: string | null }>(
      `/v1/admin/parks/${id}/credential/verify`,
      { method: 'POST' },
    );
    back(
      result.ok
        ? 'The Fleet API answered with this park’s key.'
        : `Verification failed: ${result.error}`,
      !result.ok,
    );
  }

  async function importRoster(formData: FormData): Promise<void> {
    'use server';
    const rows = parseRoster(String(formData.get('roster') ?? ''));
    if (rows.length === 0) back('Nothing to import: paste one driver per line.', true);
    let result: {
      total: number;
      created: number;
      updated: number;
      skipped: number;
      errors: Array<{ row: number; error: string }>;
    };
    try {
      result = await adminFetch(`/v1/admin/parks/${id}/roster/import`, {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });
    } catch (caught) {
      back(caught instanceof AdminApiError ? caught.message : 'Import failed', true);
      return;
    }
    back(
      `Imported ${result.total} rows: ${result.created} new, ${result.updated} updated, ${result.skipped} skipped` +
        (result.errors.length ? `, ${result.errors.length} with errors` : ''),
    );
  }

  async function syncRoster(): Promise<void> {
    'use server';
    let result: { total: number; created: number; updated: number; skipped: number };
    try {
      result = await adminFetch(`/v1/admin/parks/${id}/roster/sync`, { method: 'POST' });
    } catch (caught) {
      back(caught instanceof AdminApiError ? caught.message : 'Sync failed', true);
      return;
    }
    back(
      `Synced from the Fleet API: ${result.total} profiles, ${result.created} new, ${result.updated} updated.`,
    );
  }

  async function updateMembership(formData: FormData): Promise<void> {
    'use server';
    const membershipId = String(formData.get('membershipId'));
    const status = String(formData.get('status') || '');
    const eligibility = String(formData.get('eligibility') || '');
    await adminFetch(`/v1/admin/memberships/${membershipId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...(status ? { status } : {}),
        ...(eligibility ? { eligibility } : {}),
        reason: String(formData.get('reason')),
      }),
    });
    revalidatePath(`/parks/${id}`);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{park.name}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {park.code} · Yandex park {park.yandexParkId} · {park.currency} · added{' '}
            {formatDateTime(park.createdAt)}
          </p>
        </div>
        <Link href="/parks">← All parks</Link>
      </div>

      {query.notice ? <div className="banner">{query.notice}</div> : null}
      {query.error ? <div className="error">{query.error}</div> : null}
      {suspended ? (
        <div className="error">
          Park suspended: {park.suspendedReason ?? 'no reason recorded'}. Its drivers cannot
          withdraw.
        </div>
      ) : null}

      <div className="tiles">
        <div className="card">
          <div className="tile-label">Roster</div>
          <div className="tile-value">{park.counts.members}</div>
        </div>
        <div className="card">
          <div className="tile-label">Eligible</div>
          <div className="tile-value">{park.counts.eligible}</div>
        </div>
        <div className="card">
          <div className="tile-label">Signed in to the app</div>
          <div className="tile-value">{park.counts.attached}</div>
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Fleet API credential</h2>
          {park.credential ? (
            <dl className="kv">
              <dt>Client id</dt>
              <dd>{park.credential.clientId}</dd>
              <dt>API key</dt>
              <dd>…{park.credential.apiKeyHint} (never shown in full)</dd>
              <dt>Last verified</dt>
              <dd>{relativeAge(park.credential.lastVerifiedAt)}</dd>
              <dt>Last error</dt>
              <dd>{park.credential.lastError ?? '—'}</dd>
              <dt>Updated</dt>
              <dd>{formatDateTime(park.credential.updatedAt)}</dd>
            </dl>
          ) : (
            <p className="muted">
              No credential of its own: this park uses the process-wide Fleet API key. Set one
              before a second park goes live.
            </p>
          )}
          {canWrite ? (
            <>
              {park.credential ? (
                <form action={verifyCredential} style={{ marginBottom: 12 }}>
                  <button type="submit" className="secondary">
                    Verify against the Fleet API
                  </button>
                </form>
              ) : null}
              <form action={setCredential}>
                <div className="field">
                  <label htmlFor="clientId">Client id</label>
                  <input id="clientId" name="clientId" required minLength={2} />
                </div>
                <div className="field">
                  <label htmlFor="apiKey">API key</label>
                  <input id="apiKey" name="apiKey" type="password" required minLength={8} />
                </div>
                <button type="submit">{park.credential ? 'Replace key' : 'Store key'}</button>
              </form>
            </>
          ) : null}
        </section>

        <section className="card">
          <h2>Status</h2>
          <p>
            <span className={`chip ${suspended ? 'danger' : 'ok'}`}>{park.status}</span>
          </p>
          {canWrite ? (
            <form action={setStatus}>
              <input type="hidden" name="suspend" value={suspended ? 'false' : 'true'} />
              {suspended ? null : (
                <div className="field">
                  <label htmlFor="reason">Reason</label>
                  <textarea id="reason" name="reason" rows={2} minLength={3} required />
                </div>
              )}
              <button type="submit" className={suspended ? 'secondary' : 'danger'}>
                {suspended ? 'Reactivate park' : 'Suspend park'}
              </button>
            </form>
          ) : null}
        </section>
      </div>

      {canWrite ? (
        <div className="grid-2" style={{ marginTop: 24 }}>
          <section className="card">
            <h2>Import roster</h2>
            <p className="muted">
              One driver per line: <code>phone, Yandex profile id, first name, last name</code>.
              Existing rows are updated by phone; nobody is removed by an import.
            </p>
            <form action={importRoster}>
              <div className="field">
                <textarea
                  name="roster"
                  rows={8}
                  placeholder={'+37491000001, 8f2c…, Ara, Sargsyan\n+37491000002, 9a1d…'}
                  required
                />
              </div>
              <button type="submit">Import</button>
            </form>
          </section>
          <section className="card">
            <h2>Sync from the Fleet API</h2>
            <p className="muted">
              Reads the park’s contractor profiles with its credential and folds them into the
              roster. Requires a working key. Against the mock Fleet API this imports the mock’s
              profiles.
            </p>
            <form action={syncRoster}>
              <button type="submit" className="secondary">
                Sync now
              </button>
            </form>
            {park.imports.length > 0 ? (
              <table style={{ marginTop: 16 }}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Source</th>
                    <th className="num">Rows</th>
                    <th className="num">New</th>
                    <th className="num">Updated</th>
                    <th className="num">Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {park.imports.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDateTime(row.createdAt)}</td>
                      <td>{row.source}</td>
                      <td className="num">{row.totalRows}</td>
                      <td className="num">{row.created}</td>
                      <td className="num">{row.updated}</td>
                      <td className="num">{row.skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </section>
        </div>
      ) : null}

      <h2 style={{ marginTop: 24 }}>Roster</h2>
      <form className="toolbar" action={`/parks/${id}`}>
        <input
          name="search"
          defaultValue={query.search ?? ''}
          placeholder="Phone, name or profile id"
          style={{ maxWidth: 420 }}
        />
        <button type="submit">Search</button>
      </form>

      {members.items.length === 0 ? (
        <div className="card muted">Nobody in the roster matches.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Driver</th>
              <th>Profile id</th>
              <th>Status</th>
              <th>Eligibility</th>
              <th>Source</th>
              <th>App</th>
              {canWrite ? <th>Change</th> : null}
            </tr>
          </thead>
          <tbody>
            {members.items.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.driverId ? (
                    <Link href={`/drivers/${row.driverId}`}>{row.name ?? row.phone}</Link>
                  ) : (
                    (row.name ?? row.phone)
                  )}
                  <div className="muted">{row.phone}</div>
                </td>
                <td className="muted">{row.externalProfileId}</td>
                <td>
                  <span
                    className={`chip ${
                      row.status === 'ACTIVE'
                        ? 'ok'
                        : row.status === 'SUSPENDED'
                          ? 'warn'
                          : 'neutral'
                    }`}
                  >
                    {row.status}
                  </span>
                </td>
                <td>
                  <span
                    className={`chip ${
                      row.eligibility === 'ELIGIBLE'
                        ? 'ok'
                        : row.eligibility === 'PENDING_REVIEW'
                          ? 'warn'
                          : 'danger'
                    }`}
                  >
                    {row.eligibility.replace(/_/g, ' ')}
                  </span>
                  {row.eligibilityReason ? (
                    <div className="muted">{row.eligibilityReason}</div>
                  ) : null}
                </td>
                <td className="muted">{row.source}</td>
                <td>
                  {row.driverId ? (
                    <span className={`chip ${row.isActiveForDriver ? 'info' : 'neutral'}`}>
                      {row.isActiveForDriver ? 'active park' : 'signed in'}
                    </span>
                  ) : (
                    <span className="muted">not yet</span>
                  )}
                </td>
                {canWrite ? (
                  <td>
                    <form action={updateMembership} className="toolbar" style={{ margin: 0 }}>
                      <input type="hidden" name="membershipId" value={row.id} />
                      <select name="eligibility" defaultValue="">
                        <option value="">eligibility…</option>
                        <option value="ELIGIBLE">ELIGIBLE</option>
                        <option value="INELIGIBLE">INELIGIBLE</option>
                        <option value="PENDING_REVIEW">PENDING REVIEW</option>
                      </select>
                      <select name="status" defaultValue="">
                        <option value="">status…</option>
                        <option value="ACTIVE">ACTIVE</option>
                        <option value="SUSPENDED">SUSPENDED</option>
                        <option value="REMOVED">REMOVED</option>
                      </select>
                      <input name="reason" placeholder="reason" required minLength={3} />
                      <button type="submit" className="secondary">
                        Apply
                      </button>
                    </form>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {members.nextCursor ? (
        <p style={{ marginTop: 16 }}>
          <Link
            className="button"
            href={`/parks/${id}?${new URLSearchParams({
              ...(query.search ? { search: query.search } : {}),
              cursor: members.nextCursor,
            }).toString()}`}
          >
            Next page →
          </Link>
        </p>
      ) : null}
    </>
  );
}
