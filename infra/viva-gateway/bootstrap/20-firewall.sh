#!/usr/bin/env bash
# The only ports this machine answers on.
#
# Nothing here opens a database, a cache or a generic proxy. The gateway port
# is the only inbound HTTPS, and it is the only thing Railway talks to.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

SSH_PORT="${SSH_PORT:-22}"
GATEWAY_PORT="${GATEWAY_PORT:-443}"

apt-get -y -qq install ufw

ufw --force reset
ufw default deny incoming
ufw default allow outgoing

# Ordered so SSH is allowed before anything can enable the firewall.
ufw allow "${SSH_PORT}/tcp"  comment 'SSH'
ufw allow 500/udp            comment 'IKE'
ufw allow 4500/udp           comment 'IPsec NAT-T'
ufw allow "${GATEWAY_PORT}/tcp" comment 'Viva gateway (Railway -> here)'

# ESP (protocol 50) is only needed when the tunnel is *not* encapsulated in
# UDP 4500. Contabo is behind NAT in most Hub Europe configurations, in which
# case NAT-T carries everything and opening ESP would be a rule with no
# traffic. Enable it only if Viva's side requires unencapsulated ESP.
if [ "${ALLOW_ESP:-false}" = "true" ]; then
  ufw allow proto esp comment 'ESP (unencapsulated)'
  echo "ESP allowed — make sure the topology actually needs it."
else
  echo "ESP NOT allowed. Set ALLOW_ESP=true only if Viva requires plain ESP."
fi

ufw --force enable
ufw status verbose
