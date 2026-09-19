# Cash Out

Instant payout of a Yandex Pro driver's fleet balance to their own bank card.

A driver opens the app, sees what they have earned, taps **Withdraw**, sees the
amount, both fees and the exact figure that will arrive, confirms, and gets the
money. Everything else in this repository exists to make that safe.

## What this is, honestly

This is a working foundation with a finished, tested money path and two
deliberately unfinished edges. Read [`docs/STATUS.md`](docs/STATUS.md) before
believing anything else: it lists exactly what runs, what is a mock, and what
cannot be built without a contract, a licence or a credential.

The short version:

- The ledger, the withdrawal state machine, quoting, fees, limits, risk, OTP
  auth, the admin panel and reconciliation are **implemented and tested**.
- Yandex Fleet has a **live HTTP adapter written from corroborated but
  unverified documentation** and a mock. It has never spoken to a real park.
- The payment provider has **a port and a mock, and no live adapter at all**,
  because no bank or PSP has been chosen. `PROVIDER_MODE=live` refuses to start.

## Layout

```
apps/
  api/      NestJS + Prisma + PostgreSQL — the whole money path
  mobile/   Expo (React Native) — the driver's app, hy/ru/en
  admin/    Next.js — the operations console
packages/
  money/          integer minor units on bigint, rounding, the fee engine
  contracts/      the withdrawal state machine, the chart of accounts, wire DTOs
  design-tokens/  colour roles, scales, WCAG contrast maths
  i18n/           Armenian, Russian and English, typed against English
docs/       architecture, the Yandex integration brief, security, operations
```

## Running it

Requires Node 22, pnpm 10 and PostgreSQL 16.

```bash
pnpm install

createdb cashout
cd apps/api
cp .env.example .env            # then fill in the keys, see below
pnpm prisma migrate deploy
ADMIN_BOOTSTRAP_EMAIL=you@example.com ADMIN_BOOTSTRAP_PASSWORD='a long password' pnpm seed
pnpm dev                        # :3000, against in-memory Yandex and PSP fakes
```

Generate the key material rather than using the placeholders:

```bash
for key in ENCRYPTION_KEY FINGERPRINT_KEY QUOTE_SIGNING_KEY; do
  echo "$key=$(openssl rand -hex 32)"
done
```

The admin panel:

```bash
cd apps/admin && API_BASE_URL=http://localhost:3000 pnpm dev   # :3001
```

The driver app:

```bash
cd apps/mobile && pnpm start
```

## Tests

```bash
pnpm test                                     # everything
pnpm --filter @cashout/api test:integration   # against a real PostgreSQL
```

The integration suite needs a database; it defaults to
`postgresql://cashout:cashout@127.0.0.1:5432/cashout_test` and truncates it
between tests. Point `TEST_DATABASE_URL` elsewhere if that is not what you want.

They run against a real PostgreSQL on purpose. Half of what stops a driver being
paid twice lives in the database — serialisable isolation, partial unique
indexes, deferred constraint triggers, advisory locks — and a fake would
exercise none of it.

## The one design decision to read

Cash Out sits between two systems it does not control: the driver's balance
inside the Yandex park, and a real bank transfer. Neither joins a transaction
with us, so one leg will eventually be applied while the other is not.

The whole design follows from choosing which leg we can take back. A settled
bank transfer is irreversible; a Yandex balance debit is a bookkeeping entry
that can always be compensated. So **the Yandex debit happens first**, and the
bank is only instructed once that debit is known to have been applied. Doing it
the other way round means a Yandex outage after a successful transfer is an
unrecoverable loss, one per affected withdrawal.

The argument in full, with the state machine it produces, is at the top of
[`packages/contracts/src/withdrawal-state.ts`](packages/contracts/src/withdrawal-state.ts).
