'use client';

import { useEffect, useState } from 'react';

/**
 * A key that identifies what the operator meant to do, not which HTTP attempt
 * carried it.
 *
 * ## Why this exists
 *
 * `financeApi` used to mint a key inside each request function, with a
 * comment arguing that a fresh key per attempt was deliberate: a retry the
 * operator starts is a new refund rather than a replay of the last one.
 *
 * That reads well and it is wrong, because it assumes the operator can tell
 * the two apart. They cannot. `httpClient` gives up after fifteen seconds,
 * and a refund that commits on the server after sixteen — a cold instance, a
 * slow ledger transaction, a proxy that drops the connection — comes back as
 * "timeout of 15000ms exceeded". The money moved. The screen says it failed.
 * The operator presses the button again, a new key goes out, and the customer
 * is refunded twice.
 *
 * The server has been proof against a *repeated* key since the crash tests
 * (`AUDIT_FINANCIAL_2026-08.md`, F-9 and F-10). None of that protection can
 * engage if the client never sends the same key twice.
 *
 * The mobile app already learned this — `ScanQrScreen` mints one key when the
 * QR code is scanned and holds it across retries, with a comment naming the
 * double charge that taught it. The same shape was still live here, on the
 * screens that issue full refunds and send money to a partner's bank.
 *
 * ## What resets it
 *
 * Only a change in what the operation would *do*. Amount, partner, payment:
 * different values are a different intention and deserve a different key, or
 * the server would answer a 50 request with the result of the 100 one that
 * came before it. A field that does not affect the money — the note attached
 * to a refund — is deliberately not in the list, so an operator who reworded
 * their reason after a timeout does not thereby authorise a second refund.
 */
export function useIdempotencyKey(identity: unknown[]): string {
  const [key, setKey] = useState(newIdempotencyKey);
  const fingerprint = JSON.stringify(identity);

  useEffect(() => {
    setKey(newIdempotencyKey());
  }, [fingerprint]);

  return key;
}

function newIdempotencyKey(): string {
  return `adm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
