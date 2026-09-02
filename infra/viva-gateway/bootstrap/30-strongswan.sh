#!/usr/bin/env bash
# Installs strongSwan and lays down the template. Starts no tunnel.
#
# The tunnel is NOT initiated here, because the config is a template with
# placeholders in it. A tunnel built on guessed crypto is worse than no
# tunnel: it either fails in a way that wastes a support round trip with
# Viva, or it comes up against something that is not Viva.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq install strongswan strongswan-swanctl charon-systemd

install -d -m 700 /etc/swanctl/conf.d
if [ ! -f /etc/swanctl/conf.d/viva.conf ]; then
  install -m 600 "$(dirname "$0")/../strongswan/viva.conf.template" \
    /etc/swanctl/conf.d/viva.conf.template
  echo "Template placed at /etc/swanctl/conf.d/viva.conf.template"
  echo "Fill in every __PLACEHOLDER__, rename to viva.conf, then: swanctl --load-all"
fi

systemctl enable strongswan || systemctl enable strongswan-starter || true

echo
echo "strongSwan installed. NO tunnel configured — see strongswan/PLACEHOLDERS.md."
swanctl --version || true
