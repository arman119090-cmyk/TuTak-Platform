import express from 'express';
import type { Server } from 'http';
import {
  clientIpIsPerCaller,
  expressTrustProxySetting,
  resolveClientIpConfig,
} from './client-ip';

describe('resolveClientIpConfig', () => {
  it('defaults to the socket address, which no header can change', () => {
    expect(resolveClientIpConfig({})).toEqual({ strategy: 'socket', trustedHops: 0 });
  });

  it('rejects an unknown strategy rather than falling back to one', () => {
    expect(() => resolveClientIpConfig({ CLIENT_IP_STRATEGY: 'cf-connecting-ip' })).toThrow(
      /CLIENT_IP_STRATEGY must be one of/,
    );
  });

  it('refuses xff-depth without a hop count', () => {
    // A defaulted hop count is a bypassable rate limit, not a degraded one.
    expect(() => resolveClientIpConfig({ CLIENT_IP_STRATEGY: 'xff-depth' })).toThrow(
      /CLIENT_IP_TRUSTED_HOPS must be a positive integer/,
    );
  });

  it.each(['0', '-1', '1.5', 'two', ''])('refuses hop count %p', (hops) => {
    expect(() =>
      resolveClientIpConfig({ CLIENT_IP_STRATEGY: 'xff-depth', CLIENT_IP_TRUSTED_HOPS: hops }),
    ).toThrow(/CLIENT_IP_TRUSTED_HOPS/);
  });

  it('accepts a measured hop count', () => {
    expect(
      resolveClientIpConfig({ CLIENT_IP_STRATEGY: 'xff-depth', CLIENT_IP_TRUSTED_HOPS: '2' }),
    ).toEqual({ strategy: 'xff-depth', trustedHops: 2 });
  });

  it('only claims a per-caller address under xff-depth', () => {
    expect(clientIpIsPerCaller({ strategy: 'socket', trustedHops: 0 })).toBe(false);
    expect(clientIpIsPerCaller({ strategy: 'xff-depth', trustedHops: 1 })).toBe(true);
  });

  it('hands Express a hop count only for xff-depth', () => {
    expect(expressTrustProxySetting({ strategy: 'socket', trustedHops: 0 })).toBeUndefined();
    expect(expressTrustProxySetting({ strategy: 'xff-depth', trustedHops: 3 })).toBe(3);
  });
});

/**
 * The behaviour that actually matters, asserted against Express itself
 * rather than against our belief about Express.
 *
 * Render appends its hop to whatever `X-Forwarded-For` the client sent, so
 * the header arriving at the app is `<spoofed…>, <infrastructure…>`. These
 * cases fix what `req.ip` must be in each shape.
 */
describe('req.ip under a proxy chain that only appends', () => {
  const servers: Server[] = [];

  afterAll(async () => {
    await Promise.all(
      servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
    );
  });

  /** A real listening Express app, so this asserts Express, not our belief about it. */
  const whoami = async (
    trustProxy: number | undefined,
    headers: Record<string, string> = {},
  ): Promise<string> => {
    const app = express();
    if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
    app.get('/whoami', (req, res) => {
      res.json({ ip: req.ip });
    });

    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    servers.push(server);

    const { port } = server.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/whoami`, { headers });
    const body = (await response.json()) as { ip: string };
    return body.ip;
  };

  it('ignores the header entirely under the socket strategy', async () => {
    expect(await whoami(undefined, { 'X-Forwarded-For': '9.9.9.9' })).not.toBe('9.9.9.9');
  });

  it('takes the entry the trusted proxy appended, not the one the client wrote', async () => {
    // The real shape on Render: the client prepended `9.9.9.9` itself, and
    // the load balancer appended the address it actually saw. Express counts
    // the socket as trusted hop 1, so one trusted hop lands on the rightmost
    // forwarded entry — the one written by infrastructure.
    expect(await whoami(1, { 'X-Forwarded-For': '9.9.9.9, 203.0.113.7' })).toBe('203.0.113.7');
  });

  it('cannot be pushed off by extra spoofed entries on the left', async () => {
    // However many addresses the client stuffs in front, the position
    // counted from the right is unchanged — which is the entire reason for
    // counting from that end rather than taking the leftmost value.
    expect(
      await whoami(1, { 'X-Forwarded-For': '1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.7' }),
    ).toBe('203.0.113.7');
  });

  it('selects the spoofed value when the hop count is too high — why it is never guessed', async () => {
    // Documents the failure this configuration must avoid: two trusted hops
    // declared where only one exists hands the attacker exactly what they
    // wrote. The protection is measuring the count, not the code.
    expect(await whoami(2, { 'X-Forwarded-For': '9.9.9.9, 203.0.113.7' })).toBe('9.9.9.9');
    // Each extra hop walks one position further left, deeper into ground the
    // attacker wrote: at 3 the selected address is the leftmost value they
    // supplied.
    expect(
      await whoami(3, { 'X-Forwarded-For': '7.7.7.7, 8.8.8.8, 203.0.113.7' }),
    ).toBe('7.7.7.7');
  });

  it('falls back to the socket address when the header is absent', async () => {
    expect(await whoami(1)).toContain('127.0.0.1');
  });
});
