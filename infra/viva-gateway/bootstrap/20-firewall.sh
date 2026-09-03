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

# IKE and NAT-T are open to Viva's peer only, not to the internet.
#
# The address is CONFIRMED by the signed application form ("Tunnel Source
# (peer)", Viva site), which is what makes this narrowing possible at all —
# a rule can only name a peer once the peer is known. Every IKE daemon
# exposed to the whole internet spends its life answering scans and
# half-open negotiations from strangers; this one answers exactly one host.
VIVA_PEER="${VIVA_PEER:-217.76.0.20}"
ufw allow from "$VIVA_PEER" to any port 500  proto udp comment 'IKE (Viva)'
ufw allow from "$VIVA_PEER" to any port 4500 proto udp comment 'IPsec NAT-T (Viva)'

ufw allow "${GATEWAY_PORT}/tcp" comment 'Viva gateway (Railway -> here)'

# ESP (protocol 50) is only needed when the tunnel is *not* encapsulated in
# UDP 4500. Contabo is behind NAT in most Hub Europe configurations, in which
# case NAT-T carries everything and opening ESP would be a rule with no
# traffic. Enable it only if Viva's side requires unencapsulated ESP.
if [ "${ALLOW_ESP:-false}" = "true" ]; then
  ufw allow from "$VIVA_PEER" proto esp comment 'ESP (Viva, unencapsulated)'
  echo "ESP allowed — make sure the topology actually needs it."
else
  echo "ESP NOT allowed. Set ALLOW_ESP=true only if Viva requires plain ESP."
fi

ufw --force enable
ufw status verbose
