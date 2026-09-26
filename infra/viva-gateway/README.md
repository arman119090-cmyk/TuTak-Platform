# TuTak → Contabo → Viva Business Hub

Recovery runbook and design notes. **No secrets in this file, ever.**

Rebuilds the Viva gateway on a blank Ubuntu 24.04 VPS from nothing.

---

## Architecture

```
  TuTak API (Railway)                Contabo VPS               Viva
  ───────────────────                ───────────                ────
  VivaSmsProvider                    nginx :443  (TLS)
    │  HTTPS + HMAC                    │
    │  X-TuTak-Timestamp               │ 127.0.0.1:8443
    │  X-TuTak-Nonce         ────────► viva-gateway.mjs
    │  X-TuTak-Signature               │  · 4 paths only
    │                                  │  · fixed upstream
    │                                  │  · fail-closed on tunnel
    │                                  ▼
    │                              strongSwan  ══ IPsec/IKEv2 ══► Viva
    │                                                              businesshubapi.viva.am
```

Railway keeps everything it has: API, Postgres, Redis, Admin, Partner, mobile
builds. The VPS does one thing — terminate the IPsec tunnel and forward four
HTTP requests across it. Nothing else moves.

### Why a gateway rather than IPsec on Railway

Railway runs application containers; it gives no control over kernel IPsec
policy, no persistent network namespace and no static outbound address. A
site-to-site tunnel needs all three. The VPS supplies them, and gives Viva the
single fixed peer address their form asks for.

### Why HMAC rather than an IP allow-list or a bearer token

Railway Hobby has no stable outbound IP, so an allow-list would have to be
wide enough to be worthless. That leaves the request proving its own
authenticity.

A bearer token would do that, but proves only possession, forever: anything
that ever sees one — a log line, a crash dump, a mis-set header — can send SMS
on our Viva account until someone notices. The HMAC signs the timestamp, a
nonce, the method, the path and a hash of the body, so:

* the secret never travels;
* a captured request cannot be replayed (nonce + 300s window);
* a signature for `show/progress` cannot be lifted onto `send/batch`;
* a signature cannot be moved onto a different recipient or code.

mTLS would be stronger still and is the obvious upgrade if Railway ever makes
client certificates convenient. It was not chosen now because managing a
client key through Railway environment variables, and rotating it, is more
moving parts than the threat warrants — and `fetch` needs a custom agent for
it, which is a change on the login path.

---

## Order of operations

Each step is safe to re-run.

```bash
# 0. Look before touching. Keep the output.
sudo bash bootstrap/00-audit.sh | tee /root/audit-$(date +%F).txt

# 1. Updates, unattended security upgrades, SSH hardening, fail2ban.
#    Does NOT disable password login.
sudo bash bootstrap/10-harden.sh

# 2. Install your key, open a SECOND session and prove it works, then:
sudo bash bootstrap/11-ssh-keyonly.sh

# 3. Firewall: SSH, UDP 500, UDP 4500, 443. Nothing else.
sudo bash bootstrap/20-firewall.sh

# 4. strongSwan + the template. Starts no tunnel.
sudo bash bootstrap/30-strongswan.sh

# 5. The gateway. Generate the secret first and keep it:
#    openssl rand -hex 32
sudo VIVA_GATEWAY_SECRET=<secret> bash bootstrap/40-gateway.sh

# 6. TLS. The FQDN must already resolve to this host.
sudo GATEWAY_FQDN=viva-gw.tutak.am LETSENCRYPT_EMAIL=<email> bash bootstrap/50-tls.sh

# 7. Verify, reboot, verify again — the second run is the real test.
sudo bash bootstrap/99-verify.sh
sudo reboot
sudo bash bootstrap/99-verify.sh
```

The tunnel is deliberately absent from that list. It cannot be built until
Viva supplies the values in `strongswan/PLACEHOLDERS.md`.

---

## Fail-closed

`VIVA_GATEWAY_REQUIRE_TUNNEL=true` (the default) means the gateway returns
`503 tunnel_down` rather than reaching Viva over the ordinary internet when
the tunnel is not up.

This matters because the failure it prevents is invisible from Railway: a
request that leaves the box the wrong way looks exactly like one that
worked. `viva-tunnel-health.timer` writes `up|down <unixtime>` every 30s and
the gateway treats a file older than 120s as down — so if the timer stops,
the gateway closes on its own instead of trusting a stale "up".

During the pre-VPN phase this is the one setting to turn off, deliberately and
on staging only.

---

## What is logged, and what is not

Logged: request id, endpoint, HTTP method and status, duration, a safe error
code, Viva's transaction id, tunnel state.

**Never logged, on either side:** OTP codes, full phone numbers, the IPsec
PSK, Viva's `client_secret` or password, access or refresh tokens, the gateway
secret, the `Authorization` header, or any request or response body.

The gateway logs a fixed path from a four-item list, so the endpoint field
cannot carry anything. `safeProviderErrorCode` on the API side admits only
`[A-Za-z0-9_.-]{1,64}` from a field named like a code, so a sentence never
qualifies even when it arrives in `code`.

---

## Rotation

**Gateway secret** — generate a new one, set it in Railway *and* in
`/etc/viva-gateway/gateway.env`, restart the gateway. There is a brief window
where in-flight requests fail with 401; do it outside peak hours. Staging and
production must have different secrets and different FQDNs.

**IPsec PSK** — coordinate with Viva; it is changed on both sides at once.
Lives only in `/etc/swanctl/conf.d/viva-secret.conf`, mode 0600.

---

## Recovery from nothing

1. New Ubuntu 24.04 VPS. Note its public IPv4 — **if it differs from the old
   one, Viva must update their peer configuration**, so plan for it.
2. Clone this repository, run steps 0–7 above.
3. Restore `/etc/swanctl/conf.d/viva.conf` and `viva-secret.conf` from the
   password manager (they are not in git).
4. `swanctl --load-all && swanctl --initiate --child viva`
5. `bootstrap/99-verify.sh`
6. Point `SMS_ENDPOINT` at the new FQDN in Railway.

---

## The Viva VPN form

`docs/VIVA_VPN_FORM_RU.md` holds the filled table, what is confirmed and what
still needs Viva. **Do not submit it without the owner.**
