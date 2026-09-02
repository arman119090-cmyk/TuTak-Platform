#!/usr/bin/env bash
# Read-only audit of the VPS. Changes nothing; safe to run at any time.
#
# Run first, keep the output. Everything the hardening steps assume about this
# machine is stated here, so a surprise shows up before anything is changed
# rather than after.
set -uo pipefail

section() { printf '\n== %s ==\n' "$1"; }

section "identity"
hostnamectl 2>/dev/null | sed 's/^/  /'
printf '  kernel: %s\n' "$(uname -r)"

section "public IPv4 as the host sees it"
# The value that goes on the Viva form as Tunnel Source. Two independent
# sources: what is on the interface, and what the internet sees. They differ
# on a NATed VPS, and Viva needs the second.
printf '  on-interface: %s\n' "$(ip -4 -o addr show scope global | awk '{print $2" "$4}' | paste -sd', ')"
printf '  as-seen:      %s\n' "$(curl -4 --max-time 10 -fsS https://api.ipify.org 2>/dev/null || echo '(could not determine)')"

section "interfaces"; ip -brief addr | sed 's/^/  /'
section "routes";     ip route | sed 's/^/  /'
section "DNS";        resolvectl status 2>/dev/null | grep -E 'DNS Server|Current DNS' | sed 's/^/  /'

section "listening sockets"
ss -tulpnH 2>/dev/null | awk '{print "  "$1" "$5" "$7}'

section "firewall"
if command -v ufw >/dev/null; then ufw status verbose 2>/dev/null | sed 's/^/  /'; else echo "  ufw not installed"; fi
nft list ruleset 2>/dev/null | head -40 | sed 's/^/  /' || echo "  (no nftables ruleset)"

section "SSH configuration in force"
sshd -T 2>/dev/null | grep -Ei '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|permitemptypasswords|x11forwarding|maxauthtries)' | sed 's/^/  /'

section "authorised keys present"
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [ -f "$f" ] && printf '  %s: %s key(s)\n' "$f" "$(grep -c '^ssh-\|^ecdsa-\|^sk-' "$f" 2>/dev/null || echo 0)"
done

section "pending security updates"
apt-get -s upgrade 2>/dev/null | grep -c '^Inst.*security' | sed 's/^/  security updates pending: /'

section "failed units"
systemctl --failed --no-legend 2>/dev/null | sed 's/^/  /' || true

section "strongSwan"
command -v swanctl >/dev/null && swanctl --version 2>/dev/null | sed 's/^/  /' || echo "  not installed"

section "reboot required"
[ -f /var/run/reboot-required ] && echo "  YES" || echo "  no"
