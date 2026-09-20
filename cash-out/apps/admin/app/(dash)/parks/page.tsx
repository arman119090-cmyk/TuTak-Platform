import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { adminFetch, currentAdmin } from '@/lib/api';
import { formatDateTime, relativeAge } from '@/lib/format';

interface ParkRow {
  id: string;
  code: string;
  name: string;
  yandexParkId: string;
  currency: string;
  status: 'ACTIVE' | 'SUSPENDED';
  suspendedReason: string | null;
  memberCount: number;
  credential: { clientId: string; apiKeyHint: string; lastVerifiedAt: string | null } | null;
  createdAt: string;
}

export const dynamic = 'force-dynamic';

/**
 * Taxi parks.
 *
 * Every park Cash Out serves, with whether it has its own Fleet API key and
 * when that key last answered. A park with no credential falls back to the
 * process-wide key, which is fine for one park and wrong for the second —
 * so the column is there to be looked at.
 */
export default async function ParksPage() {
  const [{ items }, admin] = await Promise.all([
    adminFetch<{ items: ParkRow[] }>('/v1/admin/parks'),
    currentAdmin(),
  ]);
  const canWrite = admin.permissions.includes('parks:write');

  async function create(formData: FormData): Promise<void> {
    'use server';
    await adminFetch('/v1/admin/parks', {
      method: 'POST',
      body: JSON.stringify({
        code: String(formData.get('code')).trim().toLowerCase(),
        name: String(formData.get('name')).trim(),
        yandexParkId: String(formData.get('yandexParkId')).trim(),
        currency: String(formData.get('currency') || 'AMD'),
      }),
    });
    revalidatePath('/parks');
  }

  return (
    <>
      <div className="page-header">
        <h1>Taxi parks</h1>
      </div>

      {items.length === 0 ? (
        <div className="card muted">No parks yet. Add the first one below.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Park</th>
              <th>Yandex park id</th>
              <th>Status</th>
              <th className="num">Roster</th>
              <th>Fleet API key</th>
              <th>Added</th>
            </tr>
          </thead>
          <tbody>
            {items.map((park) => (
              <tr key={park.id}>
                <td>
                  <Link href={`/parks/${park.id}`}>{park.name}</Link>
                  <div className="muted">{park.code}</div>
                </td>
                <td className="muted">{park.yandexParkId}</td>
                <td>
                  <span className={`chip ${park.status === 'ACTIVE' ? 'ok' : 'danger'}`}>
                    {park.status}
                  </span>
                </td>
                <td className="num">{park.memberCount}</td>
                <td>
                  {park.credential ? (
                    <>
                      …{park.credential.apiKeyHint}
                      <div className="muted">
                        verified {relativeAge(park.credential.lastVerifiedAt)}
                      </div>
                    </>
                  ) : (
                    <span className="chip warn">process default</span>
                  )}
                </td>
                <td>{formatDateTime(park.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canWrite ? (
        <section className="card" style={{ marginTop: 24 }}>
          <h2>Add a park</h2>
          <form action={create} className="grid-2">
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" required minLength={2} maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="code">Code (lowercase, dashes)</label>
              <input id="code" name="code" required pattern="[a-z0-9][a-z0-9-]*" />
            </div>
            <div className="field">
              <label htmlFor="yandexParkId">Yandex park id</label>
              <input id="yandexParkId" name="yandexParkId" required minLength={4} />
            </div>
            <div className="field">
              <label htmlFor="currency">Currency</label>
              <select id="currency" name="currency" defaultValue="AMD">
                <option>AMD</option>
                <option>RUB</option>
                <option>USD</option>
                <option>EUR</option>
                <option>GEL</option>
                <option>KZT</option>
              </select>
            </div>
            <div>
              <button type="submit">Add park</button>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}
