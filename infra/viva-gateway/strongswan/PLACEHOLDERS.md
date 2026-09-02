# Placeholders in `viva.conf.template`

Nothing in this list may be guessed. Each is either supplied by Viva or read
off our own machine by a live audit.

| Placeholder | Source | Status |
|---|---|---|
| `__CONTABO_LOCAL_ADDRS__` | `bootstrap/00-audit.sh` — see "Bind address vs identity" below | Ours, needs live check |
| `__LOCAL_IKE_ID__` | `bootstrap/00-audit.sh` → "as-seen", **form of the ID** confirmed by Viva | Ours + NEEDS VIVA |
| `__VIVA_PEER__` | Viva | NEEDS VIVA |
| `__VIVA_PEER_ID__` | Viva (usually = peer IP) | NEEDS VIVA |
| `__LOCAL_ENCRYPTION_DOMAIN__` | Viva tells us what they expect | NEEDS VIVA |
| `__VIVA_ENCRYPTION_DOMAIN__` | Viva | NEEDS VIVA |
| `__IKE_ENC__` | Viva | NEEDS VIVA |
| `__IKE_INTEG__` | Viva | NEEDS VIVA |
| `__IKE_PRF__` | Viva | NEEDS VIVA |
| `__IKE_DH__` | Viva | NEEDS VIVA |
| `__ESP_ENC__` | Viva | NEEDS VIVA |
| `__ESP_INTEG__` | Viva | NEEDS VIVA |
| `__PFS_GROUP__` | Viva | NEEDS VIVA |
| `__PSK__` | Viva, out of band | NEEDS VIVA |

Already fixed by the Viva form and **not** placeholders: IKEv2, Main Mode,
symmetric PSK, IKE lifetime 86400s, ESP, PFS enabled, IPsec lifetime 3600s.

## Bind address vs identity

`__CONTABO_LOCAL_ADDRS__` and `__LOCAL_IKE_ID__` are two different things and
must not be filled in with the same value reflexively.

* `__CONTABO_LOCAL_ADDRS__` is what strongSwan **binds a socket to**. It has to
  be an address that actually exists on an interface of this VPS.
* `__LOCAL_IKE_ID__` is **who we claim to be** to Viva, and what goes on the
  Viva form as Tunnel Source. Normally our public IPv4.

Run `bootstrap/00-audit.sh`, which prints both:

```
on-interface: ...
as-seen:      ...
```

* If `as-seen` appears in `on-interface` — the public IP is on the interface.
  Both placeholders get that address.
* If it does not — the VPS is behind NAT. `__CONTABO_LOCAL_ADDRS__` gets the
  interface address (or `%any`), `__LOCAL_IKE_ID__` still gets the `as-seen`
  public address, and the tunnel runs over NAT-T (UDP 4500). Putting the
  public NAT address in `local_addrs` makes the socket unbindable.

Confirm with Viva that they expect an **IP** as our IKE ID and not an FQDN or
e-mail-style identity before writing `__LOCAL_IKE_ID__`.

## Lifetimes

`rekey_time` / `over_time` / `life_time` in the template are already derived
from Viva's 86400s (IKE) and 3600s (IPsec) and should not be "rounded up":

* IKE hard lifetime = `rekey_time` + `over_time` = 82800 + 3600 = **86400s**.
* CHILD hard lifetime = `life_time` = **3600s**, with `rekey_time` 3240s below it.

## The PSK

Never in this repository, never in a chat message, never in a shell history.
Exchange it out of band with Viva, then:

    install -m 600 /dev/null /etc/swanctl/conf.d/viva-secret.conf
    # paste the `secrets { ... }` block there, delete it from viva.conf
    swanctl --load-all

The `id-1` / `id-2` in that block must be the same identities as `local.id` /
`remote.id` in the connection, i.e. `__LOCAL_IKE_ID__` and `__VIVA_PEER_ID__`.
