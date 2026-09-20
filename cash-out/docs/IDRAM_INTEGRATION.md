# iDram — what is built, what is a mock, and what iDram must provide

## The single most important fact

**No code in this repository has ever spoken to iDram.** There is no public
merchant-payout API documentation to build from, and no merchant contract. What
exists is the shape a live adapter must fill, a mock that behaves like a rail
with every answer a rail can give, and an application that treats the mock as a
mock: the admin tile reads `MOCK`, the app's notification screen and the
integrations page say so, and `PROVIDER_MODE=mock` refuses to start in
production.

## What is built

| Piece                                                   | Where                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| `IdramProviderPort` — verify a wallet, submit, probe    | `apps/api/src/modules/idram/idram.port.ts`                        |
| `IdramMockAdapter` (MOCK)                               | `apps/api/src/modules/idram/idram-mock.adapter.ts`                |
| Account linking, replacement, unlinking                 | `apps/api/src/modules/idram/idram.service.ts`, `idram.controller` |
| `PayoutMethod.kind = IDRAM`, `holderName`, `verifiedAt` | migration `20260920130000_idram_payout_method`                    |
| Mobile: link / replace / remove, payout destination     | `apps/mobile/app/idram/account.tsx`, `withdraw/idram.tsx`         |
| Tests against the mock                                  | `apps/api/test/integration/idram.spec.ts` (10)                    |

The port extends the generic `PaymentProviderPort` the withdrawal orchestrator
already drives, so an iDram payout goes through exactly the same nineteen-state
pipeline as any other: reserve in the park, submit to the rail, probe an
uncertain answer, settle or compensate. Nothing in the orchestrator knows the
word iDram.

### Endpoints

| Method | Path                | What                                                                |
| ------ | ------------------- | ------------------------------------------------------------------- |
| GET    | `/v1/idram/account` | The linked wallet, masked, or `null`                                |
| POST   | `/v1/idram/account` | Link (or replace) — verified with the rail first, stored encrypted  |
| DELETE | `/v1/idram/account` | Unlink; refused while a payout to it is in flight or a rule uses it |

The wallet identifier is stored encrypted (AES-256-GCM) and returned only as a
masked tail; the full identifier never appears in a response, a log or an audit
row.

### What the mock does

- Verifies any nine-digit wallet starting `094` or `098` except `…0000`, which
  it rejects — so "wallet unknown" has a test.
- Accepts, rejects (with a code), times out after submission, or returns
  "submitted, unknown" per test instruction, and settles on probe. Every one of
  those paths is covered by an orchestrator test.
- Records what it was asked to pay so tests can assert the instrument and the
  idempotency key.

## What is missing

Everything live. A live adapter needs, from iDram:

| What                                                               | Why                                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Merchant credentials and the base URL (`IDRAM_*` env variables)    | every call                                                                       |
| The wallet verification call (does this wallet exist, whose is it) | linking, and Driver ID-style holder checks                                       |
| The payout call, its idempotency semantics and its error codes     | submit without ever paying twice                                                 |
| The status call                                                    | resolving `PAYOUT_UNCERTAIN`                                                     |
| Webhook format and signature scheme, if any                        | `provider-webhook.controller.ts` verifies a raw-body HMAC and needs the real one |
| Limits: per payout, per wallet per day, fractional drams           | limit policies and the fee engine's payout increment                             |
| A sandbox                                                          | the adapter cannot be verified against production money                          |

`PROVIDER_MODE=live` throws at startup until such an adapter is registered in
`idram.module.ts`. That is deliberate: a process that pretends to pay is worse
than one that refuses to start.
