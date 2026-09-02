#!/usr/bin/env bash
# Turns off SSH password authentication — the last step, and only once a key
# has been proved to work.
#
# Separate from 10-harden.sh because this is the one change that can lock you
# out of the machine. It refuses to run unless a key is actually installed,
# and it tells you to keep your current session open while you test.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

keys=$(grep -c '^ssh-\|^ecdsa-\|^sk-' /root/.ssh/authorized_keys 2>/dev/null || echo 0)
if [ "$keys" -eq 0 ]; then
  echo "REFUSING: /root/.ssh/authorized_keys has no key." >&2
  echo "Disabling passwords now would lock you out permanently." >&2
  exit 1
fi
echo "Found $keys authorised key(s)."

cat >> /etc/ssh/sshd_config.d/10-tutak.conf <<'CONF'
PasswordAuthentication no
KbdInteractiveAuthentication no
CONF
sshd -t
systemctl reload ssh || systemctl reload sshd

echo
echo "Password authentication is now OFF."
echo "KEEP THIS SESSION OPEN. Open a new one with your key before closing it."
echo "If the new session fails: PasswordAuthentication yes, then reload ssh."
