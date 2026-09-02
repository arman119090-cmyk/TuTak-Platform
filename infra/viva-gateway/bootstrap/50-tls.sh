#!/usr/bin/env bash
# TLS in front of the gateway.
#
# The gateway binds to loopback and speaks plain HTTP; nginx terminates TLS
# and is the only thing on the public port. That split is deliberate: it keeps
# certificate renewal, TLS versions and ciphers out of the gateway process,
# and it means a mistake in the gateway cannot accidentally serve without TLS.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
: "${GATEWAY_FQDN:?set GATEWAY_FQDN, e.g. viva-gw.tutak.am — it must already resolve to this host}"
: "${LETSENCRYPT_EMAIL:?set LETSENCRYPT_EMAIL}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq install nginx certbot python3-certbot-nginx

cat > /etc/nginx/sites-available/viva-gateway <<CONF
server {
    listen 80;
    server_name ${GATEWAY_FQDN};
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl;
    http2 on;
    server_name ${GATEWAY_FQDN};

    # Only the paths the gateway implements reach it. nginx refusing an
    # unknown path is a second lock on top of the gateway's own allow-list.
    location = /health                     { proxy_pass http://127.0.0.1:8443; }
    location = /v1/token/get               { proxy_pass http://127.0.0.1:8443; }
    location = /v1/token/refresh           { proxy_pass http://127.0.0.1:8443; }
    location = /v1/transact/send/batch     { proxy_pass http://127.0.0.1:8443; }
    location = /v1/transact/show/progress  { proxy_pass http://127.0.0.1:8443; }
    location / { return 404; }

    client_max_body_size 64k;
    proxy_read_timeout 20s;
    proxy_set_header Host \$host;
    # The signed headers must survive untouched or every signature fails.
    proxy_pass_request_headers on;

    add_header Strict-Transport-Security "max-age=31536000" always;
}
CONF

ln -sf /etc/nginx/sites-available/viva-gateway /etc/nginx/sites-enabled/viva-gateway
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

certbot --nginx -d "${GATEWAY_FQDN}" --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL}" --redirect
systemctl enable --now certbot.timer

echo
echo "TLS is live on https://${GATEWAY_FQDN}"
echo "Set SMS_ENDPOINT=https://${GATEWAY_FQDN}/v1 in Railway (staging first)."
