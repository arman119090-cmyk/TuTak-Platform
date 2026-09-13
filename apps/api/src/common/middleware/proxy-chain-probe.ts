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
 * exact hole the whole mechanism exists to close. It says to measure the
 * count against the live deployment. It did not say how, and there was no
 * way — the answer is what the *application* sees, and nothing the
 * application serves reports it. So every deployment either left per-caller
 * rate limiting switched off or turned it on by guessing.
 *
 * ## How to measure
 *
 * Send one request carrying `X-TuTak-Proxy-Probe: 1` and an
 * `X-Forwarded-For` holding exactly one entry that is unmistakably not a
 * real client address — `203.0.113.7` (TEST-NET-3, reserved for
 * documentation) is a good choice. Then read this line out of the log:
 *
 *   * **2 entries, rightmost matches `X-Real-IP`** — the edge appended
 *     exactly one hop of its own. `CLIENT_IP_TRUSTED_HOPS=1`.
 *   * **3 entries** — two hops were appended. `CLIENT_IP_TRUSTED_HOPS=2`.
 *   * **1 entry** — nothing was appended: the header arrived exactly as it
 *     was sent, so it is written by the caller end to end and must never be
 *     trusted on this deployment at any depth.
 *   * **0 entries** — the edge does not use `X-Forwarded-For` at all.
 *
 * `.github/workflows/proxy-probe.yml` sends exactly that request, so the
 * measurement needs a browser tab and no shell.
 *
 * ## What it deliberately does not log
 *
 * No addresses — not the forwarded ones, not the socket peer. A client IP is
 * personal data and this line is meant to be safe to leave switched on
 * forever. The shape of the chain is the whole answer, and the shape is all
 * it prints.
 *
 * It also answers nothing to the caller: the response is untouched, so the
 * measurement is visible to whoever can read the deployment's logs and to
 * nobody else. And it writes at most `MAX_PROBES_PER_PROCESS` lines in the
 * life of a process, so a header anyone can send cannot become a way to
 * flood the log.
 */
export const PROBE_HEADER = 'x-tutak-proxy-probe';

/** Enough to measure twice and check, far too few to be a flood. */
export const MAX_PROBES_PER_PROCESS = 5;

export interface ProxyChainReading {
  /** Entries in `X-Forwarded-For` as this process received it. */
  forwardedEntries: number;
  /** Whether the edge supplied `X-Real-IP` at all. */
  realIpPresent: boolean;
  /**
   * Whether the rightmost `X-Forwarded-For` entry is the same address as
   * `X-Real-IP`. Together with a probe whose sent header is known not to be
   * the caller's own address, this is what distinguishes "the edge appended
   * its view of the client" from "the header came through untouched".
   */
  rightmostMatchesRealIp: boolean;
}

export function readProxyChain(headers: Record<string, unknown>): ProxyChainReading {
  const rawForwarded = headers['x-forwarded-for'];
  // Node lowercases header names and collapses repeats, except that a
  // repeated header arrives as an array — join it the way a proxy chain
  // would have written it in the first place.
  const forwarded = Array.isArray(rawForwarded)
    ? rawForwarded.join(',')
    : typeof rawForwarded === 'string'
      ? rawForwarded
      : '';

  const entries = forwarded
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const rawRealIp = headers['x-real-ip'];
  const realIp = (Array.isArray(rawRealIp) ? rawRealIp[0] : rawRealIp) ?? '';
  const realIpText = typeof realIp === 'string' ? realIp.trim() : '';

  return {
    forwardedEntries: entries.length,
    realIpPresent: realIpText.length > 0,
    rightmostMatchesRealIp:
      entries.length > 0 && realIpText.length > 0 && entries[entries.length - 1] === realIpText,
  };
}

/**
 * The sentence an operator actually needs, rather than three numbers they
 * have to interpret. Phrased as a conditional on purpose: the reading is
 * only meaningful for a request whose own `X-Forwarded-For` is known, and
 * this line is what reminds whoever reads it of that.
 */
export function describeProxyChain(reading: ProxyChainReading): string {
  const { forwardedEntries, realIpPresent, rightmostMatchesRealIp } = reading;
  const facts =
    `X-Forwarded-For entries: ${forwardedEntries}; ` +
    `X-Real-IP present: ${realIpPresent}; ` +
    `rightmost entry matches X-Real-IP: ${rightmostMatchesRealIp}.`;

  if (forwardedEntries === 0) {
    return (
      `${facts} Nothing forwards X-Forwarded-For to this process. ` +
      'Leave CLIENT_IP_STRATEGY unset — xff-depth has nothing to count.'
    );
  }

  const sentOne = forwardedEntries - 1;
  if (sentOne === 0) {
    return (
      `${facts} The header arrived with exactly the one entry that was sent, so nothing ` +
      'was appended to it. On this deployment X-Forwarded-For is written by the caller ' +
      'end to end: do NOT set CLIENT_IP_STRATEGY=xff-depth at any depth.'
    );
  }

  return (
    `${facts} ${sentOne} hop(s) were appended to the one entry that was sent. ` +
    `If that is what this probe sent, CLIENT_IP_TRUSTED_HOPS=${sentOne}.`
  );
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
