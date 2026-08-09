/**
 * The health probe is not under the version prefix.
 *
 * `/health` is served version-neutral so an orchestrator's fixed path does
 * not break when the API version moves. The mobile client's base URL ends in
 * `/v1`, so asking axios for `/health` produced `/v1/health` — a 404 — and
 * the demo-mode check silently answered "not a demonstration" for a
 * deployment that was one.
 *
 * Nothing about that failure is visible: the request is wrapped in a
 * try/catch that treats any error as "no demo", which is right for an
 * unreachable server and wrong for an address that was never correct.
 */
function healthUrlFor(base: string): string {
  return base.replace(/\/v\d+\/?$/, '') + '/health';
}

describe('the health URL', () => {
  it('drops the version segment the API base carries', () => {
    expect(healthUrlFor('https://api.example.com/v1')).toBe('https://api.example.com/health');
  });

  it('drops it with a trailing slash too', () => {
    expect(healthUrlFor('https://api.example.com/v1/')).toBe('https://api.example.com/health');
  });

  it('handles a future version without being edited', () => {
    expect(healthUrlFor('https://api.example.com/v2')).toBe('https://api.example.com/health');
  });

  it('leaves a base that carries no version alone', () => {
    expect(healthUrlFor('https://api.example.com')).toBe('https://api.example.com/health');
  });

  it('does not mistake a host or path that merely contains a v-number', () => {
    // `v1` inside a path segment is not the version suffix.
    expect(healthUrlFor('https://v1.example.com/api')).toBe('https://v1.example.com/api/health');
  });

  it('works for the local development address', () => {
    expect(healthUrlFor('http://localhost:4000/v1')).toBe('http://localhost:4000/health');
  });
});
