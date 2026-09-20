# Security

What is implemented, what it defends against, and what is still open.

## Identity

**Drivers** sign in with a phone number and a one-time code. The code is
generated from a CSPRNG, never logged, never returned by an API, and stored only
as a scrypt hash — a fast hash over six digits is worthless, since an attacker
with the table enumerates all 10⁶ codes instantly.

Three independent limits guard the endpoint, because an unthrottled OTP endpoint
is both an account-takeover surface and a way to spend someone's SMS budget
overnight: per phone per hour, per IP per hour, and a cooldown between sends. A
challenge is bound to the device that requested it, capped at five attempts, and
consumed on first success.

**Access tokens** are short-lived JWTs. **Refresh tokens** are 256 bits from a
CSPRNG, stored only as a hash, and rotated on every use. Presenting a rotated
token revokes the entire family — that is what makes theft detectable rather
than merely survivable. Revoking a session takes effect immediately, not when
the JWT happens to expire, because "sign out on my lost phone" has to mean
something.

**Operators** sign in with a password (scrypt) plus TOTP. Two-factor is
mandatory for every role that can act; a money role with no second factor
enrolled cannot sign in at all. The failure message is identical for an unknown
email, a wrong password and a wrong code, and an unknown account still pays the
cost of a hash, so the response neither says nor times out differently.
Five failures lock the account for fifteen minutes.

## Authorisation

Driver endpoints are protected by a globally registered guard: a new controller
is protected unless someone marks it `@Public()`, because forgetting to add a
guard is far more common than forgetting to remove one.

Admin endpoints are fail-closed: an endpoint without a `@RequirePermission` is
refused rather than allowed. Roles map to a fixed permission set in
`@cashout/contracts`, checked on every request; there is no implicit "admins can
do anything". The panel hides links the operator lacks, but that is a courtesy —
the server enforces it regardless.

## Key rotation and rate limiting

Column encryption uses a key ring: the active key writes, any retired key in
`ENCRYPTION_PREVIOUS_KEYS` still reads, and a re-encryption job walks every
encrypted column in batches — idempotent, resumable, dry-run first, audited,
never logging plaintext. Rate limits live in Redis in production (atomic
increment with TTL, shared by every instance) and fail closed during a Redis
outage. Both procedures are in `OPERATIONS.md`.

## Data

- **At rest**: provider tokens and TOTP secrets are AES-256-GCM encrypted with a
  key id stored beside the ciphertext, so keys can be rotated. Authenticated
  encryption, so tampering fails loudly instead of decrypting to noise.
- **Card data never reaches Cash Out.** The app collects it inside the payment
  provider's own SDK; only a single-use token is sent to the API. The database
  holds a provider reference, a masked tail and a peppered fingerprint, none of
  which can be turned back into an instrument. Cash Out is therefore out of PCI
  scope for cardholder data — a claim a QSA must still confirm against the
  provider that is eventually chosen.
- **Fingerprints** are HMAC with a dedicated pepper, not a bare hash: a bare
  SHA-256 of a card token would let anyone with the table confirm a guess.
- **Logs** have a redaction list covering authorisation headers, OTP codes,
  passwords, tokens and account identifiers. Logging any of them once puts it in
  a log aggregator forever.
- On the phone, tokens live in the platform keystore (Keychain /
  EncryptedSharedPreferences), never in AsyncStorage.

## Money-specific controls

- **Signed quotes.** The fee a driver is shown is HMAC-signed; the confirm call
  must present the signature unchanged, so a modified client cannot invent its
  own fee, and a quote edited in the database is rejected.
- **Idempotency** on the client's own key, bound to a hash of the request. The
  same key with different contents is an error, not a silently wrong answer.
- **One live withdrawal per driver**, at the database level.
- **Amount, daily, weekly, monthly and velocity limits**, counting every
  withdrawal that was or could still be paid.
- **Risk scoring** with explicit, explainable signals — a shared payout
  instrument, a brand-new account, a card added minutes ago, repeated recent
  failures, several devices in a day. Above a threshold the withdrawal goes to a
  human instead of to the bank, and the reasons are recorded verbatim so support
  can answer "why".
- **Manual review decisions** demand a written reason; marking a payout complete
  additionally demands the provider's transaction id as evidence.

## Webhooks

Signature over the raw body (which is why the route uses a raw-body parser),
plus a freshness window — a replayed delivery carries a perfectly valid
signature, so the timestamp is the only thing standing between an old capture
and a repeated state change. Deliveries are deduplicated on
`(provider, externalId)`, and an event that does not apply in the withdrawal's
current state is recorded and ignored rather than forced through.

A bad signature returns 403, not 400: it is not a malformed message from the
provider, it is a message from someone we cannot identify.

## Confirming a payout: PIN and biometrics

Every payout — and the consent for an automatic rule — consumes a single-use
**authorization** issued by `POST /v1/security/authorize`. The authorization is
bound to the driver, the device, the purpose and (for a withdrawal) the quote
it will confirm; it lives for a few minutes; and it is spent inside the same
transaction that creates the withdrawal, so a replay cannot create a second
one. The withdrawal records which method authorized it.

**PIN.** Six digits, refused if trivially sequential or repeated, stored as a
scrypt hash, never logged. Five wrong attempts lock the PIN for a period that
grows with each further lockout; the lock is server-side, so a reinstalled app
does not reset it. Changing the PIN requires the current one and queues a
security notification.

**Biometrics**, honestly described. Cash Out stores no biometric data. At
enrolment — which requires the PIN — the server issues a random device secret
and stores only its hash against that device; the app places the secret in the
platform keystore with `requireAuthentication`, so the OS demands Face ID,
Touch ID or the Android biometric prompt before releasing it. Authorizing
means reading that secret and sending it; the server verifies the hash and
that the device is the enrolled one. The server never trusts a bare "the face
matched" from the client.

Limitation, stated plainly: this proves possession of a device-bound secret
released after an OS biometric check. It is not a hardware-attested signature
over a server challenge, which would need a native key-pair module the current
Expo stack does not ship. Until then, a rooted device that can read the
keystore can authorize without a face. This is listed below as not done.

## Park credentials

Each taxi park's Fleet API key is written once through the admin panel, stored
AES-256-GCM encrypted with a key id, and never returned by any endpoint — the
panel shows the last four characters and when the key last answered. Balance
reads, debits and roster syncs for a park use that park's key; only when a park
has none does the process-wide key apply, and the panel says so.

## Not done yet

- **Biometric authorization is not hardware-attested** (see above).

- **No WAF, no bot protection** in front of the OTP endpoint beyond the
  application's own limits.
- **No penetration test** has been performed.
- **No formal threat model document**, though the controls above were chosen
  against the obvious ones: a stolen phone, a modified client, a compromised
  operator account, a replayed webhook, a mule ring sharing one card.
- **Admin session tokens are opaque and server-checked**, but there is no
  device binding for operators as there is for drivers.
