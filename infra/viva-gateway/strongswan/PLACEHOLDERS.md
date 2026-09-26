# Placeholders in `viva.conf.template`

**Two left.** Everything else is CONFIRMED from the signed Viva application
form ("VPN Site2Site details (IPSEC tunnel)", 03/09/2026).

| Placeholder | Source | Status |
|---|---|---|
| `__CONTABO_LOCAL_ADDRS__` | `bootstrap/00-audit.sh` — see "Bind address vs identity" | needs the live audit |
| `__PSK__` | Viva, out of band | NEEDS VIVA |

## Confirmed by the form — do not change without agreeing both sides

| | Viva site | Our site |
|---|---|---|
| Company | Viva Armenia | SaNHay LLC |
| Tunnel Source (peer) | `217.76.0.20` | `217.76.49.94` |
| Encryption Domain | `217.76.1.50` | `217.76.49.94` |

| Parameter | Value | In swanctl |
|---|---|---|
| Authentication | Symmetric PSK | `auth = psk` |
| Encryption Scheme | IKE v2 | `version = 2` |
| Mode | Main Mode | (IKEv2 has no aggressive mode) |
| Diffie-Hellman | Group 14 | `modp2048` |
| Phase 1 Encryption | AES_256 | `aes256` |
| Phase 1 Hashing / Integrity | SHA-256 | `sha256` |
| PRF | SHA-256 | `prfsha256` |
| IKE SA lifetime | 86400 s | `rekey_time 82800s` + `over_time 3600s` |
| SA Negotiation | ESP | `esp_proposals` |
| Phase 2 Encryption | AES_256 | `aes256` |
| Data Integrity | SHA-256 | `sha256` |
| PFS | enabled | a DH group in `esp_proposals` |
| PFS type | Group 14 | `modp2048` |
| IPSEC SA lifetime | 3600 s | `life_time 3600s`, `rekey_time 3240s` |

Resulting proposals:

```
proposals     = aes256-sha256-prfsha256-modp2048
esp_proposals = aes256-sha256-modp2048
```

## Bind address vs identity

The form states our **identity** (`217.76.49.94`). It does not state what
strongSwan should **bind a socket to**, and those are different questions.

* `local.id` = `217.76.49.94` — who we claim to be. Already filled in.
* `local_addrs` = `__CONTABO_LOCAL_ADDRS__` — a socket bind. Must be an
  address this VPS actually holds.

Run `bootstrap/00-audit.sh`, which prints both:

```
on-interface: ...
as-seen:      ...
```

* `as-seen` appears in `on-interface` — the public IP is on the interface.
  Put `217.76.49.94` in `local_addrs`.
* it does not — the VPS is behind NAT. Put the interface address or `%any`,
  and the tunnel runs over NAT-T (UDP 4500). The public address stays the
  identity; strongSwan cannot bind to an address the machine does not hold.

## The one assumption left in the file

The form gives Viva's peer **address** and no separate peer **ID**. The
config assumes they identify by that same IP, which is the normal case for a
peer reached by address. If authentication fails with a PSK both sides agree
on, that line is the first suspect — ask `syseng@viva.am`.

## The PSK

Never in this repository, never in a chat message, never in a shell history.
Exchange it out of band, then:

    install -m 600 /dev/null /etc/swanctl/conf.d/viva-secret.conf
    # move the `secrets { ... }` block there, delete it from viva.conf
    swanctl --load-all

The `id-1` / `id-2` in that block must stay `217.76.49.94` and `217.76.0.20`
— the identities, not the bind addresses.
