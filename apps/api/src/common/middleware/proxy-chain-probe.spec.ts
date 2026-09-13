import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  MAX_PROBES_PER_PROCESS,
  PROBE_HEADER,
  describeProxyChain,
  proxyChainProbe,
  readProxyChain,
} from './proxy-chain-probe';

/** The marker the probe workflow sends: TEST-NET-3, never a real client. */
const MARKER = '203.0.113.7';
/** Stands in for the address the edge saw the caller arrive from. */
const CLIENT = '198.51.100.9';
/** Stands in for an inner proxy's own address. */
const INNER = '192.0.2.44';

describe('readProxyChain', () => {
  it('finds the marker counting from the right, not the left', () => {
    // Position from the right is the whole measurement: it is what Express's
    // numeric `trust proxy` counts, and counting from the left would give an
    // answer that changes with what the caller chose to send.
    const reading = readProxyChain({
      [PROBE_HEADER]: MARKER,
      'x-forwarded-for': `${MARKER}, ${CLIENT}, ${INNER}`,
    });
    expect(reading.forwardedEntries).toBe(3);
    expect(reading.markerFromRight).toBe(3);
  });

  it('reports the marker as missing when the edge replaced the header', () => {
    const reading = readProxyChain({
      [PROBE_HEADER]: MARKER,
      'x-forwarded-for': CLIENT,
    });
    expect(reading.markerDeclared).toBe(true);
    expect(reading.markerFromRight).toBe(0);
  });

  it('does not mistake a switch for an address', () => {
    // `X-TuTak-Proxy-Probe: 1` is what somebody types to turn the thing on.
    // Treating "1" as a chain entry would measure nothing while looking like
    // it had measured something.
    const reading = readProxyChain({ [PROBE_HEADER]: '1', 'x-forwarded-for': CLIENT });
    expect(reading.markerDeclared).toBe(false);
    expect(reading.markerFromRight).toBe(0);
  });

  it('locates X-Real-IP in the chain as a cross-check', () => {
    const reading = readProxyChain({
      [PROBE_HEADER]: MARKER,
      'x-forwarded-for': `${MARKER}, ${CLIENT}`,
      'x-real-ip': CLIENT,
    });
    expect(reading.realIpPresent).toBe(true);
    expect(reading.realIpFromRight).toBe(1);
  });

  it('treats a repeated header the way the chain that wrote it meant', () => {
    expect(
      readProxyChain({ 'x-forwarded-for': [MARKER, CLIENT], [PROBE_HEADER]: MARKER })
        .forwardedEntries,
    ).toBe(2);
  });

  it('ignores whitespace and empty entries rather than counting them as hops', () => {
    expect(readProxyChain({ 'x-forwarded-for': ` ${MARKER} , ,` }).forwardedEntries).toBe(1);
  });
});

describe('describeProxyChain', () => {
  const read = (headers: Record<string, unknown>) => describeProxyChain(readProxyChain(headers));

  it('names one hop when the edge appended exactly one entry', () => {
    const text = read({
      [PROBE_HEADER]: MARKER,
      'x-forwarded-for': `${MARKER}, ${CLIENT}`,
      'x-real-ip': CLIENT,
    });
    expect(text).toContain('CLIENT_IP_TRUSTED_HOPS=1');
    expect(text).toContain('X-Real-IP agrees');
  });

  it('names two hops when two were appended', () => {
    // The client's own address is the *first* appended entry, not the last:
    // each proxy appends its view of the hop before it. Getting this backwards
    // is the difference between a correct limit and a bypassable one.
    const text = read({
      [PROBE_HEADER]: MARKER,
      'x-forwarded-for': `${MARKER}, ${CLIENT}, ${INNER}`,
      'x-real-ip': CLIENT,
    });
    expect(text).toContain('CLIENT_IP_TRUSTED_HOPS=2');
    expect(text).toContain('X-Real-IP agrees');
  });

  it('refuses xff-depth outright when nothing was appended', () => {
    const text = read({ [PROBE_HEADER]: MARKER, 'x-forwarded-for': MARKER, 'x-real-ip': CLIENT });
    expect(text).toContain('do NOT set CLIENT_IP_STRATEGY=xff-depth');
  });

  it('trusts the whole chain when the edge replaced what the caller sent', () => {
    // Nothing the caller wrote survived, so no part of the header is
    // caller-controlled and the leftmost entry is the edge's view of them.
    const text = read({ [PROBE_HEADER]: MARKER, 'x-forwarded-for': CLIENT, 'x-real-ip': CLIENT });
    expect(text).toContain('CLIENT_IP_TRUSTED_HOPS=1');
    expect(text).toContain('replaces X-Forwarded-For');
  });

  it('refuses to pick a side when the two readings disagree', () => {
    const text = read({
      [PROBE_HEADER]: MARKER,
      'x-forwarded-for': `${MARKER}, ${CLIENT}, ${INNER}`,
      // X-Real-IP naming the innermost hop contradicts the arithmetic.
      'x-real-ip': INNER,
    });
    expect(text).toContain('disagree');
    expect(text).toContain('do not set anything');
  });

  it('asks for a marker when the probe did not name one', () => {
    const text = read({ [PROBE_HEADER]: '1', 'x-forwarded-for': `${MARKER}, ${CLIENT}` });
    expect(text).toContain('named no marker');
  });

  it('says to leave the strategy unset when nothing forwards the header', () => {
    const text = read({ [PROBE_HEADER]: MARKER });
    expect(text).toContain('Leave CLIENT_IP_STRATEGY unset');
  });

  it('never puts an address in the line', () => {
    const text = read({
      [PROBE_HEADER]: MARKER,
      'x-forwarded-for': `${MARKER}, ${CLIENT}`,
      'x-real-ip': CLIENT,
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

    proxyChainProbe(logger)(request({ 'x-forwarded-for': MARKER }), response, next);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('reports the chain when a request asks for it', () => {
    const logger = { warn: jest.fn() } as unknown as Logger;
    const next = jest.fn() as unknown as NextFunction;

    proxyChainProbe(logger)(
      request({
        [PROBE_HEADER]: MARKER,
        'x-forwarded-for': `${MARKER}, ${CLIENT}`,
        'x-real-ip': CLIENT,
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
      middleware(request({ [PROBE_HEADER]: MARKER }), response, next);
    }

    expect((logger.warn as jest.Mock).mock.calls).toHaveLength(MAX_PROBES_PER_PROCESS);
    expect((next as jest.Mock).mock.calls).toHaveLength(MAX_PROBES_PER_PROCESS + 10);
  });
});
