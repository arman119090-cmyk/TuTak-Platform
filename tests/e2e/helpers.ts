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
  /**
   * The second administrator.
   *
   * Payouts are under a two-person rule: whoever requested one cannot
   * confirm it. Without a second account the suite cannot exercise the happy
   * path at all — which is a good sign that the control is real, and the
   * reason this account exists in the demo seeder.
   */
  approver: '+37400000001',
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

/** A login that the API refused, carrying the status the caller must branch on. */
export class LoginFailed extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LoginFailed';
  }
}

/**
 * Logs in through the real form rather than seeding a token into storage, and
 * returns the access token that login produced.
 *
 * The login page is itself part of what these tests cover, and a session
 * assembled by hand would not exercise the cookie the refresh flow depends on.
 *
 * The token is read from the login response rather than out of the browser's
 * storage. It used to be lifted from `localStorage` via `storageState`, which
 * worked only for as long as the dashboards persisted it there — and they
 * deliberately stopped: the access token now lives in memory alone and the
 * refresh token in an httpOnly cookie, precisely so that page script cannot
 * read either. A test that went looking for it in storage was asserting the
 * old, weaker model. `storageState` is still what carries the session to the
 * other specs; it carries the cookie, which is where the session actually is.
 *
 * On failure this throws with what someone reading CI needs and nothing more:
 * the response status, the message the form showed, and the page's URL. Never
 * the password, the cookie or the token. The screenshot and trace Playwright
 * attaches on failure are configured in playwright.config.ts.
 */
export async function login(page: Page, baseUrl: string, phone: string): Promise<string> {
  await page.goto(`${baseUrl}/login`);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill(phone);
  await inputs.nth(1).fill(PASSWORD);

  // Armed before the click: the response can arrive before the next statement
  // runs, and waiting for it afterwards would race.
  const pending = page.waitForResponse(
    (r) => r.url().endsWith('/auth/login') && r.request().method() === 'POST',
    { timeout: 20_000 },
  );

  // Whether the request left the browser at all is its own failure mode — a
  // Content-Security-Policy that forbids the API blocks it before the network
  // sees it, and the form then shows the same "cannot reach the API" as a
  // genuinely absent server. Recorded here so the two can be told apart.
  const blocked: string[] = [];
  const noteBlocked = (message: string) => {
    if (/Content Security Policy|Refused to connect/i.test(message)) blocked.push(message);
  };
  page.on('console', (m) => noteBlocked(m.text()));
  page.on('requestfailed', (r) => {
    if (r.url().includes('/auth/login')) noteBlocked(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`);
  });

  await page.click('button[type="submit"]');

  let response;
  try {
    response = await pending;
  } catch {
    throw new LoginFailed(
      0,
      [
        `No response to POST /auth/login from ${baseUrl} within 20s.`,
        blocked.length
          ? `The browser refused to send it: ${blocked.join(' | ')}`
          : 'The request never reached the API.',
        `form said: ${await visibleError(page)}`,
        `url: ${page.url()}`,
      ].join('\n'),
    );
  }

  if (!response.ok()) {
    throw new LoginFailed(
      response.status(),
      [
        `POST /auth/login returned ${response.status()} for ${baseUrl}.`,
        `form said: ${await visibleError(page)}`,
        `url: ${page.url()}`,
      ].join('\n'),
    );
  }

  const body = (await response.json()) as { data?: { tokens?: { accessToken?: string } } };
  const accessToken = body.data?.tokens?.accessToken;
  if (!accessToken) {
    throw new LoginFailed(response.status(), 'The login response carried no access token.');
  }

  // The API accepted the credentials; the dashboard still has to act on that.
  // Kept as a separate assertion so a client-side rejection — a role the app
  // does not admit, a session guard that bounces back — reads as itself rather
  // than as a login failure.
  await expect(page, `signed in but never left ${baseUrl}/login`).not.toHaveURL(/\/login$/, {
    timeout: 20_000,
  });

  return accessToken;
}

/** Whatever the form is telling the operator, or a note that it says nothing. */
async function visibleError(page: Page): Promise<string> {
  const text = await page
    .locator('form')
    .innerText()
    .catch(() => '');
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(phone|password|sign in)$/i.test(l));
  return lines.length ? lines.join(' / ') : '<no message>';
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
