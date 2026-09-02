# Placeholders in `viva.conf.template`

Nothing in this list may be guessed. Each is either supplied by Viva or read
off our own machine.

| Placeholder | Source | Status |
|---|---|---|
| `__CONTABO_PUBLIC_IP__` | `bootstrap/00-audit.sh` → "as-seen" | Ours, needs live check |
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

## The PSK

Never in this repository, never in a chat message, never in a shell history.
Exchange it out of band with Viva, then:

    install -m 600 /dev/null /etc/swanctl/conf.d/viva-secret.conf
    # paste the `secrets { ... }` block there, delete it from viva.conf
    swanctl --load-all
