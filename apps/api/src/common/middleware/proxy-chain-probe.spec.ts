import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  MAX_PROBES_PER_PROCESS,
  PROBE_HEADER,
  describeProxyChain,
  proxyChainProbe,
  readProxyChain,
} from './proxy-chain-probe';

describe('readProxyChain', () => {
  it('counts the entries a proxy chain wrote, not the header occurrences', () => {
    expect(
      readProxyChain({ 'x-forwarded-for': '203.0.113.7, 198.51.100.9' }).forwardedEntries,
    ).toBe(2);
  });

  it('treats a repeated header the way the chain that wrote it meant', () => {
    // Node hands a repeated header back as an array; two separate proxies
    // each adding their own line is the same chain as one comma-joined one.
    expect(
      readProxyChain({ 'x-forwarded-for': ['203.0.113.7', '198.51.100.9'] }).forwardedEntries,
    ).toBe(2);
  });

  it('ignores whitespace and empty entries rather than counting them as hops', () => {
    expect(readProxyChain({ 'x-forwarded-for': ' 203.0.113.7 , ,' }).forwardedEntries).toBe(1);
  });

  it('reports no entries when nothing forwards the header', () => {
    const reading = readProxyChain({});
    expect(reading.forwardedEntries).toBe(0);
    expect(reading.realIpPresent).toBe(false);
    expect(reading.rightmostMatchesRealIp).toBe(false);
  });

  it('matches the rightmost entry against X-Real-IP, never the leftmost', () => {
    // The leftmost is the value the caller wrote. A reading that matched on
    // it would report "the edge appended its view of the client" for a
    // request where the edge appended nothing at all.
    const reading = readProxyChain({
      'x-forwarded-for': '203.0.113.7, 198.51.100.9',
      'x-real-ip': '198.51.100.9',
    });
    expect(reading.rightmostMatchesRealIp).toBe(true);

    const spoofedLeft = readProxyChain({
      'x-forwarded-for': '198.51.100.9, 203.0.113.7',
      'x-real-ip': '198.51.100.9',
    });
    expect(spoofedLeft.rightmostMatchesRealIp).toBe(false);
  });
});

describe('describeProxyChain', () => {
  it('refuses xff-depth outright when the header arrived untouched', () => {
    const text = describeProxyChain({
      forwardedEntries: 1,
      realIpPresent: true,
      rightmostMatchesRealIp: false,
    });
    expect(text).toContain('do NOT set CLIENT_IP_STRATEGY=xff-depth');
  });

  it('names the hop count when the edge appended one hop', () => {
    const text = describeProxyChain({
      forwardedEntries: 2,
      realIpPresent: true,
      rightmostMatchesRealIp: true,
    });
    expect(text).toContain('CLIENT_IP_TRUSTED_HOPS=1');
  });

  it('names the hop count when the edge appended two', () => {
    const text = describeProxyChain({
      forwardedEntries: 3,
      realIpPresent: true,
      rightmostMatchesRealIp: true,
    });
    expect(text).toContain('CLIENT_IP_TRUSTED_HOPS=2');
  });

  it('says to leave the strategy unset when nothing forwards the header', () => {
    const text = describeProxyChain({
      forwardedEntries: 0,
      realIpPresent: false,
      rightmostMatchesRealIp: false,
    });
    expect(text).toContain('Leave CLIENT_IP_STRATEGY unset');
  });

  it('never puts an address in the line', () => {
    const text = describeProxyChain({
      forwardedEntries: 2,
      realIpPresent: true,
      rightmostMatchesRealIp: true,
    });
    expect(text).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe('proxyChainProbe', () => {
  const request = (headers: Record<string, unknown>) => ({ headers }) as unknown as Request;
  const response = {} as Response;

  it('says nothing about a request that did not ask', () => {
    const logger = { warn: jest.fn() } as unknown as Logger;
    const next = jest.fn() as unknown as NextFunction;

    proxyChainProbe(logger)(request({ 'x-forwarded-for': '203.0.113.7' }), response, next);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('reports the chain when a request asks for it', () => {
    const logger = { warn: jest.fn() } as unknown as Logger;
    const next = jest.fn() as unknown as NextFunction;

    proxyChainProbe(logger)(
      request({
        [PROBE_HEADER]: '1',
        'x-forwarded-for': '203.0.113.7, 198.51.100.9',
        'x-real-ip': '198.51.100.9',
      }),
      response,
      next,
    );

    expect((logger.warn as jest.Mock).mock.calls[0][0]).toContain('CLIENT_IP_TRUSTED_HOPS=1');
    expect(next).toHaveBeenCalled();
  });

  it('cannot be used to flood the log', () => {
    // The header is one anybody can send. Without a ceiling, a loop over a
    // public endpoint would write a log line per request forever.
    const logger = { warn: jest.fn() } as unknown as Logger;
    const next = jest.fn() as unknown as NextFunction;
    const middleware = proxyChainProbe(logger);

    for (let i = 0; i < MAX_PROBES_PER_PROCESS + 10; i += 1) {
      middleware(request({ [PROBE_HEADER]: '1' }), response, next);
    }

    expect((logger.warn as jest.Mock).mock.calls).toHaveLength(MAX_PROBES_PER_PROCESS);
    expect((next as jest.Mock).mock.calls).toHaveLength(MAX_PROBES_PER_PROCESS + 10);
  });
});
