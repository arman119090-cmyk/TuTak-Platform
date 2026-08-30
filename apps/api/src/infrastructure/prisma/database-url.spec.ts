import { applyPoolSettings } from './database-url';

const BASE = 'postgresql://user:pw@db.example.com:5432/tutak';

describe('applyPoolSettings', () => {
  it('changes nothing when the deployment has said nothing', () => {
    expect(applyPoolSettings(BASE, {})).toBe(BASE);
  });

  it('sets the pool size the deployment asked for', () => {
    const url = new URL(applyPoolSettings(BASE, { DATABASE_CONNECTION_LIMIT: '5' }));
    expect(url.searchParams.get('connection_limit')).toBe('5');
  });

  it('sets the checkout timeout independently', () => {
    const url = new URL(applyPoolSettings(BASE, { DATABASE_POOL_TIMEOUT: '20' }));
    expect(url.searchParams.get('pool_timeout')).toBe('20');
    expect(url.searchParams.has('connection_limit')).toBe(false);
  });

  /**
   * Two places disagreeing about pool size is worse than either being wrong:
   * whoever wrote it into the URL has already made this decision.
   */
  it('never overrides a value already in the connection string', () => {
    const explicit = `${BASE}?connection_limit=3`;
    const result = applyPoolSettings(explicit, { DATABASE_CONNECTION_LIMIT: '25' });
    expect(new URL(result).searchParams.get('connection_limit')).toBe('3');
  });

  it('preserves the rest of the connection string', () => {
    const withParams = `${BASE}?schema=public&sslmode=require`;
    const url = new URL(applyPoolSettings(withParams, { DATABASE_CONNECTION_LIMIT: '7' }));
    expect(url.searchParams.get('schema')).toBe('public');
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(url.searchParams.get('connection_limit')).toBe('7');
  });

  it.each(['0', '-1', '2.5', 'many', ''])('ignores %s rather than acting on it', (value) => {
    expect(applyPoolSettings(BASE, { DATABASE_CONNECTION_LIMIT: value })).toBe(BASE);
  });

  /**
   * A malformed connection string is Prisma's error to report, in its own
   * words. Throwing here would replace it with a message about pool sizing.
   */
  it('hands back an unparseable URL untouched', () => {
    expect(applyPoolSettings('not a url', { DATABASE_CONNECTION_LIMIT: '5' })).toBe('not a url');
  });
});
