#!/usr/bin/env bash
# Installs the Viva gateway as a systemd service.
#
# Expects VIVA_GATEWAY_SECRET in the environment; it is written to a 0600 file
# and never echoed. Generate it with `openssl rand -hex 32` and put the same
# value in Railway as SMS_VIVA_GATEWAY_SECRET.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
: "${VIVA_GATEWAY_SECRET:?set VIVA_GATEWAY_SECRET (openssl rand -hex 32)}"

if [ "${#VIVA_GATEWAY_SECRET}" -lt 32 ]; then
  echo "REFUSING: the gateway secret is under 32 characters." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq install nodejs

id -u viva-gw >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin viva-gw

here="$(cd "$(dirname "$0")/.." && pwd)"
install -d -m 755 /opt/viva-gateway
install -m 644 "$here/gateway/viva-gateway.mjs" /opt/viva-gateway/
install -m 755 "$here/gateway/tunnel-health.sh" /opt/viva-gateway/

install -d -m 750 -o root -g viva-gw /etc/viva-gateway
umask 077
cat > /etc/viva-gateway/gateway.env <<CONF
VIVA_GATEWAY_PORT=8443
VIVA_GATEWAY_BIND=127.0.0.1
VIVA_GATEWAY_SECRET=${VIVA_GATEWAY_SECRET}
VIVA_GATEWAY_REQUIRE_TUNNEL=true
VIVA_GATEWAY_MAX_BODY_BYTES=65536
VIVA_GATEWAY_RATE_LIMIT_PER_MINUTE=60
CONF
chmod 640 /etc/viva-gateway/gateway.env
chown root:viva-gw /etc/viva-gateway/gateway.env

install -m 644 "$here/systemd/viva-gateway.service"       /etc/systemd/system/
install -m 644 "$here/systemd/viva-tunnel-health.service" /etc/systemd/system/
install -m 644 "$here/systemd/viva-tunnel-health.timer"   /etc/systemd/system/

systemctl daemon-reload
systemctl enable --now viva-tunnel-health.timer
systemctl enable --now viva-gateway.service

echo
echo "Gateway listening on 127.0.0.1:8443."
echo "It binds to loopback on purpose: TLS terminates in the reverse proxy"
echo "(50-tls.sh), so the gateway itself is never exposed without a certificate."
systemctl --no-pager --lines=5 status viva-gateway.service || true
