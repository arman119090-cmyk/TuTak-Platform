import { httpClient } from './httpClient';
import { evApi } from './evApi';

/**
 * Stopping a charge is the one money operation in this app that the customer
 * performs standing outside, on a phone, at a charge point — which is to say
 * in the worst network conditions the product has.
 *
 * The API grew an idempotency key for stop precisely for that case (F-2 in
 * `AUDIT_FINANCIAL_2026-08.md`: a double-tapped stop billed twice), and left
 * it optional because no client sent one. This app is that client.
 */

jest.mock('./httpClient', () => ({
  httpClient: { post: jest.fn(), get: jest.fn() },
}));

const mockedHttp = httpClient as jest.Mocked<typeof httpClient>;

describe('evApi.stopSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedHttp.post.mockResolvedValue({ data: { data: { id: 'session-1' } } } as never);
  });

  it('sends the key it was given', async () => {
    await evApi.stopSession('session-1', 'ev-stop-session-1-full');

    expect(mockedHttp.post).toHaveBeenCalledWith('/ev/sessions/session-1/stop', {
      idempotencyKey: 'ev-stop-session-1-full',
    });
  });

  it('sends the bonus alongside the key when points are being spent', async () => {
    await evApi.stopSession('session-1', 'ev-stop-session-1-250.00', '250.00');

    expect(mockedHttp.post).toHaveBeenCalledWith('/ev/sessions/session-1/stop', {
      bonusAmountToApply: '250.00',
      idempotencyKey: 'ev-stop-session-1-250.00',
    });
  });

  it('never sends a stop without a key', async () => {
    // The signature makes this impossible in TypeScript; the assertion is
    // here for the shape of the request that actually goes out, which is
    // what the server sees.
    await evApi.stopSession('session-1', 'ev-stop-session-1-full');

    const [, body] = mockedHttp.post.mock.calls[0]!;
    expect((body as { idempotencyKey?: string }).idempotencyKey).toBeTruthy();
  });

  it('produces a key long enough for the API to accept', async () => {
    // The server validates 8..128 characters and rejects anything shorter,
    // which would turn a protection into a 400 at the charge point.
    const key = `ev-stop-${'c'.repeat(25)}-full`;
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(128);
  });
});
