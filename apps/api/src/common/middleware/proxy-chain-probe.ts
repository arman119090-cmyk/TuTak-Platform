import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Measures how many hops the deployment's own infrastructure adds to
 * `X-Forwarded-For`, so `CLIENT_IP_TRUSTED_HOPS` can be a measurement rather
 * than a guess.
 *
 * ## Why this exists
 *
 * `config/client-ip.ts` refuses to default that number, and it is right to:
 * one too high and `req.ip` becomes a value the caller wrote, which is the
 * exact hole the mechanism exists to close. It says to measure the count
 * against the live deployment. It did not say how, and there was no way —
 * the answer is what the *application* sees, and nothing the application
 * serves reports it. So the deployment either left per-caller rate limiting
 * switched off or turned it on by guessing.
 *
 * ## The measurement
 *
 * Send one request whose `X-Forwarded-For` holds a single entry that cannot
 * be a real address — `203.0.113.7` (TEST-NET-3, reserved by RFC 5737 for
 * documentation) — and name that same value in `X-TuTak-Proxy-Probe`. The
 * process then knows exactly which entry the caller wrote, and everything to
 * the right of it was appended by infrastructure.
 *
 * A proxy chain appends left to right: the first proxy appends its view of
 * whoever connected to it (the client), the second appends its view of the
 * first, and so on. So with the marker at position `s` counting from the
 * right, the client's real address is the entry at position `s - 1`, and
 * that is exactly what Express's numeric `trust proxy` counts — verified
 * against Express itself in `client-ip.spec.ts`.
 *
 *   * `s == 1` — nothing was appended. The header arrived exactly as it was
 *     sent, so on this deployment it is caller-written end to end and must
 *     never be trusted at any depth.
 *   * `s > 1` — `CLIENT_IP_TRUSTED_HOPS = s - 1`.
 *   * the marker is absent from the chain — the edge stripped what the
 *     caller sent and wrote the header itself, so every entry is
 *     infrastructure-written and the client is the leftmost:
 *     `CLIENT_IP_TRUSTED_HOPS = <number of entries>`.
 *
 * `X-Real-IP` is read as a cross-check: Railway documents it as the client's
 * remote address, so where it appears in the chain should agree with the
 * arithmetic above. Disagreement is reported rather than resolved — a
 * measurement that quietly picks one of two contradictory answers is worse
 * than one that says it is contradictory.
 *
 * ## What it deliberately does not log
 *
 * No addresses — not the forwarded ones, not `X-Real-IP`, not the socket
 * peer. A client IP is personal data and this line is meant to be safe to
 * leave switched on forever. Positions and counts are the whole answer.
 *
 * It also answers nothing to the caller: the response is untouched, so the
 * reading reaches whoever can read the deployment's logs and nobody else.
 * And it writes at most `MAX_PROBES_PER_PROCESS` lines in the life of a
 * process, so a header anyone can send cannot become a way to flood a log.
 */
export const PROBE_HEADER = 'x-tutak-proxy-probe';

/** Enough to measure twice and check, far too few to be a flood. */
export const MAX_PROBES_PER_PROCESS = 5;

export interface ProxyChainReading {
  /** Entries in `X-Forwarded-For` as this process received it. */
  forwardedEntries: number;
  /**
   * Where the caller's own marker entry ended up, counting from the right
   * and starting at 1. Zero when the marker never arrived — either because
   * the probe named no marker, or because the edge replaced the header.
   */
  markerFromRight: number;
  /** Whether the probe named a marker at all. */
  markerDeclared: boolean;
  /**
   * Where `X-Real-IP` appears in the chain, counting from the right and
   * starting at 1. Zero when the header is absent or its value is not in the
   * chain.
   */
  realIpFromRight: number;
  /** Whether the edge supplied `X-Real-IP` at all. */
  realIpPresent: boolean;
}

function headerText(value: unknown): string {
  if (Array.isArray(value)) return value.join(',');
  return typeof value === 'string' ? value : '';
}

/** 1-based position counting from the right; 0 when absent. */
function positionFromRight(entries: readonly string[], needle: string): number {
  if (!needle) return 0;
  const index = entries.lastIndexOf(needle);
  return index === -1 ? 0 : entries.length - index;
}

export function readProxyChain(headers: Record<string, unknown>): ProxyChainReading {
  // Node lowercases header names and collapses repeats, except that a
  // repeated header arrives as an array — join it the way a proxy chain
  // would have written it in the first place.
  const entries = headerText(headers['x-forwarded-for'])
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const marker = headerText(headers[PROBE_HEADER]).trim();
  // A marker has to look like an address to be one. `1`, `true` and `yes` are
  // what a person types to turn something on, and treating one of those as a
  // chain entry would silently measure nothing.
  const markerDeclared = marker.includes('.') || marker.includes(':');

  const realIp = headerText(headers['x-real-ip']).trim();

  return {
    forwardedEntries: entries.length,
    markerDeclared,
    markerFromRight: markerDeclared ? positionFromRight(entries, marker) : 0,
    realIpPresent: realIp.length > 0,
    realIpFromRight: positionFromRight(entries, realIp),
  };
}

/**
 * The sentence an operator actually needs, rather than five numbers they
 * have to interpret.
 */
export function describeProxyChain(reading: ProxyChainReading): string {
  const { forwardedEntries, markerDeclared, markerFromRight, realIpPresent, realIpFromRight } =
    reading;

  const facts =
    `X-Forwarded-For entries: ${forwardedEntries}; ` +
    `probe marker position from right: ${markerFromRight}; ` +
    `X-Real-IP present: ${realIpPresent}; ` +
    `X-Real-IP position from right: ${realIpFromRight}.`;

  if (forwardedEntries === 0) {
    return (
      `${facts} Nothing forwards X-Forwarded-For to this process. Leave CLIENT_IP_STRATEGY ` +
      'unset — xff-depth has nothing to count.'
    );
  }

  if (!markerDeclared) {
    return (
      `${facts} This probe named no marker, so nothing here distinguishes what the caller ` +
      'wrote from what the edge appended. Send X-TuTak-Proxy-Probe with the same single ' +
      'address used in X-Forwarded-For (203.0.113.7 is a good one) and read this line again.'
    );
  }

  if (markerFromRight === 0) {
    // The edge threw away what the caller sent. Everything present was
    // written by infrastructure, so the leftmost entry is its view of the
    // client and no part of the chain is caller-controlled.
    const advice = `CLIENT_IP_TRUSTED_HOPS=${forwardedEntries}`;
    const crossCheck =
      realIpFromRight > 0 && realIpFromRight !== forwardedEntries
        ? ` But X-Real-IP sits at position ${realIpFromRight}, not ${forwardedEntries}, so the ` +
          'two readings disagree — do not set anything until that is understood.'
        : '';
    return (
      `${facts} The marker did not survive: this edge replaces X-Forwarded-For rather than ` +
      `appending to it, so every entry is infrastructure-written. ${advice}.${crossCheck}`
    );
  }

  if (markerFromRight === 1) {
    return (
      `${facts} The marker is the rightmost entry, so nothing was appended to it. On this ` +
      'deployment X-Forwarded-For is written by the caller end to end: do NOT set ' +
      'CLIENT_IP_STRATEGY=xff-depth at any depth.'
    );
  }

  const hops = markerFromRight - 1;
  const crossCheck =
    realIpPresent && realIpFromRight !== hops
      ? ` X-Real-IP is at position ${realIpFromRight} rather than ${hops}, so the two readings ` +
        'disagree — do not set anything until that is understood.'
      : ' X-Real-IP agrees.';
  return `${facts} ${hops} hop(s) were appended. CLIENT_IP_TRUSTED_HOPS=${hops}.${crossCheck}`;
}

export function proxyChainProbe(logger: Logger = new Logger('ProxyChain')) {
  let probesLogged = 0;

  return function proxyChainProbeMiddleware(req: Request, _res: Response, next: NextFunction) {
    if (req.headers[PROBE_HEADER] === undefined) return next();
    if (probesLogged >= MAX_PROBES_PER_PROCESS) return next();

    probesLogged += 1;
    logger.warn(describeProxyChain(readProxyChain(req.headers as Record<string, unknown>)));
    return next();
  };
}
