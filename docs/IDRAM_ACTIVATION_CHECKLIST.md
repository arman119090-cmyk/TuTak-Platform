# Idram: what must be true before `TUTAK_PSP_ENABLED=true` in production

Status: **not activated.** `TUTAK_PSP_ENABLED=false`, `PSP_REFUNDS_ENABLED=false`.
Nothing in this list has been done, because most of it cannot be done by us —
it is answers we need from Idram.

The integration is written against the documentation supplied and has never
run against the real provider. Every item below is a thing that, if wrong,
costs a customer real money.

---

## 1. Questions only Idram can answer

Each of these is currently a declared *absence* in the adapter
(`capabilities` in `idram.adapter.ts`), not a gap in the code. Turning a
capability on is a one-line change — **after** the answer is in writing.

| Question | Why it matters | Current assumption |
|---|---|---|
| Is there a refund/reversal API? | `PSP_REFUNDS_ENABLED` stays off until there is. A refund button built on an endpoint nobody confirmed is a button that lies to a customer about their money. | `refund: false` |
| Is there a status query? | Without it, the only way to resolve a timed-out payment is two people reading the portal. With it, the platform could ask. | `statusQuery: false` |
| Is there a void/cancel? | Would let an abandoned bill be closed rather than aged out. | `void: false` |
| Is there a settlement feed? | Today an operator keys remittances in by hand from the statement. | `settlementFeed: false` |
| Is the fee reported per transaction? | Fees are recorded as **unknown**, not zero. A platform that books unknown fees at zero overstates what it can pay out by exactly the fees. | `feeStatement: false` |

## 2. Timeout and retry semantics — §9

The thresholds are configurable per provider (`PSP_STALE_AFTER_MS`,
`PSP_ESCALATE_EVERY_MS`, `PSP_TIMEOUT_POLICY`). The defaults — 30 minutes and
1 hour — are **operational defaults chosen by us, not a contractual fact**.

Before activation, confirm with Idram:

- [ ] How long after a bill is opened may a payment still arrive?
- [ ] How many times, and over what window, does Idram retry a callback it
      did not get `OK` for?
- [ ] Does Idram ever send a callback for a bill it has already confirmed?
- [ ] Is `EDP_TRANS_ID` unique and stable across retries? The inbox's
      duplicate defence is keyed on it.

Then set the per-provider policy to match, rather than leaving our guess in
place. Note what does **not** change whatever the answers are: no timeout
ever becomes `MONEY_DID_NOT_MOVE` on its own. Time escalates; only an
authoritative provider result or a confirmed two-person reconciliation
releases a payment.

## 3. Endpoints and credentials

- [ ] `IDRAM_FORM_ACTION` points at the **sandbox** for testing and is
      changed deliberately for production. Since 19.09.2026 it has **no
      default**: with `TUTAK_PSP_ENABLED=true` the boot validation requires
      an explicit `https://` value, alongside `ALERT_WEBHOOK_URL`.
- [ ] The point-by-point provider confirmation — checksum, `EDP_TRANS_ID`,
      pre-check, callback retries, status query, refunds, expirations — is
      in `docs/IDRAM_PROVIDER_CONFIRMATION.md`, with the letter to send and
      the sandbox activation plan.
- [ ] `IDRAM_MERCHANT_ID` / `IDRAM_SECRET_KEY` set from the real merchant
      account. The secret is never logged and never written to a durable row —
      `EDP_CHECKSUM` is a digest, and the inbox keeps the digest, not the key.
- [ ] The callback URL registered with Idram is
      `POST /v1/psp/idram/callback`, reachable from Idram's network, over TLS.
- [ ] Confirm whether Idram sends the pre-check to the same URL. The adapter
      distinguishes them by `EDP_PRECHECK=YES` in the body because that is
      what the documentation establishes; a separate endpoint would be a
      one-place change.

## 4. A sandbox run that proves the circuit

Not a unit test — a real payment through Idram's sandbox, end to end:

- [ ] merchant approval → bill opened → form posted → pre-check answered
      `OK` → payment made → callback verified → purchase CONFIRMED →
      `PARTNER_PAYABLE` credited.
- [ ] A pre-check for a bill that may **not** be paid answers `NO` and
      nothing is posted.
- [ ] A callback delivered twice produces one economic effect.
- [ ] A callback with a tampered amount is rejected and recorded.
- [ ] The customer's app shows `SUCCEEDED` only after the backend says so —
      never because the browser landed on the success URL.

## 5. Operational readiness

- [ ] Somebody owns the `Payments` screen in the admin panel daily. An
      unresolved payment is a customer whose money is somewhere nobody can
      account for, and it does not resolve itself.
- [ ] The alert channel is live: `psp.attempt-unresolved` and
      `psp.callback-dead-letter` both page a human.
- [ ] Two people with `PSP_RECONCILE` exist, and they are different people.
      The two-person release is not satisfiable by one.
- [ ] Two people for `CONTRIBUTION_RULE_PROPOSE` / `..._APPROVE` likewise.
- [ ] A remittance process exists: who reads Idram's statement, and how
      often they record it as an acquirer settlement. Until that is recorded,
      captured money is not spendable and `safeToPay` will say so.

## 6. Database rollout

- [ ] `apps/api/scripts/migration-rehearsal.sh` run against a copy of
      production, not only a fresh database.
- [ ] `SELECT * FROM tutak_preflight_one_live_purchase()` returns no rows
      immediately before the deploy. If it does not, follow the rollout in
      `20260915150000_one_live_purchase_per_customer_partner`'s header —
      drain, wait out the purchase timeout, let the sweep run, re-check.
      **Do not close live purchases from a migration.**

---

## What is deliberately not on this list

Turning `TUTAK_PSP_ENABLED` on for a single partner as a trial. The flag is
platform-wide, and a per-partner rollout is a real feature nobody has asked
for yet — worth saying out loud so that its absence is a decision rather than
a discovery on the night.
