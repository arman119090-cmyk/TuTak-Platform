import { existsSync, readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';

export const API = process.env.API_URL ?? 'http://localhost:4000/v1';
export const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3000';
export const PARTNER = process.env.PARTNER_URL ?? 'http://localhost:3001';
export const PASSWORD = process.env.DEMO_PASSWORD ?? 'TuTakDemo-2026!';

/**
 * One customer per spec, not one shared between them.
 *
 * Velocity limiting refuses a customer's ninth transaction in ten minutes.
 * That is the rule working, and a suite that put every payment through one
 * account hit it and reported five failures that were all the same hold.
 * These accounts exist only for this suite — see E2E_CUSTOMERS in the demo
 * seeder — so a run's traffic is spread and nothing accumulates behind it.
 */
export const PHONES = {
  admin: '+37400000000',
  partnerOwner: '+37477200001',
  /** QR loop. */
  customer: '+37477190001',
  /** First scanner in the double-redemption test. */
  scannerA: '+37477190002',
  /** Refunds, which capture two payments of their own. */
  refundCustomer: '+37477190003',
  /** Second scanner — the one holding a photograph of a spent code. */
  scannerB: '+37477190004',
  /** The dropped-response replay. */
  replayCustomer: '+37477190005',
} as const;

const STATE_DIR = 'tests/e2e/.auth';
export const ADMIN_STATE = `${STATE_DIR}/admin.json`;
export const PARTNER_STATE = `${STATE_DIR}/partner.json`;
export const TOKENS_FILE = `${STATE_DIR}/tokens.json`;

/** Unwraps the API's `{ data, timestamp }` envelope and fails loudly. */
async function json<T>(response: Response, what: string): Promise<T> {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${what} failed with ${response.status}: ${body}`);
  }
  return JSON.parse(body).data as T;
}

/**
 * One login per account per run.
 *
 * `/auth/login` is rate limited, correctly — brute-forcing an operator
 * password is exactly what that limit exists to stop. A suite that logged in
 * afresh in every test tripped it and then reported eight failures that were
 * all the same throttle. The tokens outlive the suite comfortably, so
 * caching them tests the same paths without arguing with a security control.
 */
const tokens = new Map<string, Promise<string>>();

/** Tokens the setup project already obtained through the login form. */
function fromSetup(phone: string): string | null {
  if (!existsSync(TOKENS_FILE)) return null;
  const saved = JSON.parse(readFileSync(TOKENS_FILE, 'utf8')) as Record<string, string>;
  return saved[phone] ?? null;
}

export function apiLogin(phone: string, deviceSuffix: string): Promise<string> {
  const cached = tokens.get(phone);
  if (cached) return cached;

  const reused = fromSetup(phone);
  if (reused) {
    const ready = Promise.resolve(reused);
    tokens.set(phone, ready);
    return ready;
  }

  const pending = (async () => {
    // Five logins a minute from one address, and this suite needs five. Two
    // runs started back to back therefore collide with the limit — not a
    // bug, just the rule applying to us as much as to anyone. Waiting the
    // window out is the correct response to a 429; the alternative is
    // loosening a control that exists to stop password guessing.
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password: PASSWORD, deviceId: `e2e-${deviceSuffix}` }),
      });
      if (response.status === 429 && attempt < 4) {
        await new Promise((r) => setTimeout(r, 20_000));
        continue;
      }
      const data = await json<{ tokens: { accessToken: string } }>(response, `login ${phone}`);
      return data.tokens.accessToken;
    }
  })();

  // Stored before awaiting, so two tests starting together share one request
  // rather than racing into two.
  tokens.set(phone, pending);
  pending.catch(() => tokens.delete(phone));
  return pending;
}

export async function api<T>(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return json<T>(response, `${init.method ?? 'GET'} ${path}`);
}

/**
 * Logs in through the real form rather than seeding a token into storage.
 *
 * The login page is itself part of what these tests cover, and a session
 * assembled by hand would not exercise the cookie the refresh flow depends
 * on.
 */
export async function login(page: Page, baseUrl: string, phone: string): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(phone);
  await inputs.nth(1).fill(PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).not.toHaveURL(/\/login$/, { timeout: 20_000 });
}

export interface LedgerAccount {
  id: string;
  type: string;
  partnerId: string | null;
  balance: string;
}

/**
 * The invariant every one of these tests ends on.
 *
 * Two separate claims: the accounts sum to zero (nothing was created or
 * destroyed by whatever the test just did), and each account's stored
 * balance still equals a replay of its own postings (the cache did not drift
 * from the record behind it). A flow can break either one without breaking
 * the other.
 */
export async function expectLedgerBalanced(token: string): Promise<void> {
  const accounts = await api<LedgerAccount[]>(token, '/admin/ledger/accounts');
  expect(accounts.length).toBeGreaterThan(0);

  const total = accounts.reduce((sum, a) => sum + Number(a.balance), 0);
  expect(Math.abs(total)).toBeLessThan(0.0001);

  for (const account of accounts) {
    const detail = await api<{ inSync: boolean; storedBalance: string; replayedBalance: string }>(
      token,
      `/admin/ledger/accounts/${account.id}/postings`,
    );
    expect(
      { account: account.type, inSync: detail.inSync },
      `${account.type} stored ${detail.storedBalance} vs replayed ${detail.replayedBalance}`,
    ).toEqual({ account: account.type, inSync: true });
  }
}

/** Drains the outbox by waiting for its cron, which runs every 10 seconds. */
export async function waitForSettlement(
  token: string,
  paymentId: string,
  timeoutMs = 45_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payment = await api<{ settledAt: string | null }>(token, `/payments/${paymentId}`);
    if (payment.settledAt) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Payment ${paymentId} was not settled within ${timeoutMs}ms`);
}

export const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
