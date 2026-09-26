#!/usr/bin/env bash
# Installs strongSwan and lays down the Viva tunnel, all but the PSK.
#
# Every crypto parameter is CONFIRMED by the signed application form, so this
# no longer hands over a template full of blanks. It installs a working
# configuration, decides the one value the form cannot state, and stops at
# the one value that must never travel through a repository.
#
# The tunnel is NOT initiated here. It cannot be: without the PSK there is
# nothing to authenticate with, and starting it would only fill the log with
# failed negotiations against a peer that is expecting a key.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$HERE/../strongswan/viva.conf.template"
CONF=/etc/swanctl/conf.d/viva.conf
SECRET=/etc/swanctl/conf.d/viva-secret.conf

# Our identity, as promised to Viva on the form. Not a bind address.
CONFIRMED_IDENTITY="217.76.49.94"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq install strongswan strongswan-swanctl charon-systemd

install -d -m 700 /etc/swanctl/conf.d

# ── The one value the form cannot answer ────────────────────────────────
#
# `local_addrs` is a socket bind, so it must name an address this machine
# actually holds. On a VPS with its public IP on the interface that is the
# public IP; behind NAT it cannot be, and `%any` is correct instead, with
# NAT-T carrying the tunnel. Decided from the machine rather than assumed,
# and overridable for the case where an operator knows better.
if [ -n "${LOCAL_ADDRS:-}" ]; then
  BIND="$LOCAL_ADDRS"
  echo "local_addrs = $BIND (from LOCAL_ADDRS)"
else
  ON_IFACE="$(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1)"
  AS_SEEN="$(curl -4 --max-time 10 -fsS https://api.ipify.org 2>/dev/null || echo '')"
  if [ -z "$AS_SEEN" ]; then
    echo "Could not determine the public address. Re-run with LOCAL_ADDRS set." >&2
    exit 1
  fi
  if printf '%s\n' "$ON_IFACE" | grep -qx "$AS_SEEN"; then
    BIND="$AS_SEEN"
    echo "Public IP is on the interface: local_addrs = $BIND"
  else
    BIND="%any"
    echo "Behind NAT ($AS_SEEN is on no interface): local_addrs = %any, NAT-T will carry it"
  fi
  if [ "$AS_SEEN" != "$CONFIRMED_IDENTITY" ]; then
    echo >&2
    echo "!! This machine is $AS_SEEN, but the Viva form promises $CONFIRMED_IDENTITY." >&2
    echo "!! Viva will refuse a tunnel from a different address." >&2
    echo "!! Refusing to install a configuration that cannot work." >&2
    exit 1
  fi
fi

# ── The connection, without its secret ──────────────────────────────────
#
# The `secrets` block is stripped out and written to its own 0600 file. Two
# reasons, and the second is the one that matters: a single file invites
# someone to paste the PSK into the same document they later copy somewhere
# to ask a question about it.
if [ -f "$CONF" ]; then
  echo "$CONF exists — leaving it alone. Remove it first to regenerate."
else
  awk '/^secrets \{/{skip=1} !skip{print} /^\}/{if(skip) skip=0}' "$TEMPLATE" \
    | sed "s|__CONTABO_LOCAL_ADDRS__|$BIND|" > "$CONF"
  chmod 600 "$CONF"
  echo "Wrote $CONF"
fi

if [ ! -f "$SECRET" ]; then
  install -m 600 /dev/null "$SECRET"
  cat > "$SECRET" <<'SECRET_EOF'
# The pre-shared key, and nothing else. Mode 0600, root only.
#
# The two ids are IKE *identities* and must match local.id / remote.id in
# viva.conf — strongSwan selects the PSK by identity, so a mismatch here
# fails authentication even when the key itself is right.
#
# Replace PUT_THE_PSK_HERE with the key Viva issued, then:
#   swanctl --load-all
#   swanctl --initiate --child viva
secrets {
    ike-viva {
        id-1   = 217.76.49.94
        id-2   = 217.76.0.20
        secret = "PUT_THE_PSK_HERE"
    }
}
SECRET_EOF
  echo "Wrote $SECRET — put the PSK in it."
fi

systemctl enable strongswan || systemctl enable strongswan-starter || true

echo
if grep -q PUT_THE_PSK_HERE "$SECRET" 2>/dev/null; then
  echo "strongSwan installed and configured. ONE thing left:"
  echo "  1. Put the PSK in $SECRET"
  echo "  2. swanctl --load-all"
  echo "  3. swanctl --initiate --child viva"
  echo "  4. swanctl --list-sas      # expect: ESTABLISHED, INSTALLED"
else
  echo "strongSwan installed and configured, PSK present. To bring it up:"
  echo "  swanctl --load-all && swanctl --initiate --child viva"
fi
swanctl --version || true
