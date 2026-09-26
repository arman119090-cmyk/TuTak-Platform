#!/usr/bin/env bash
# Baseline hardening. Deliberately conservative about SSH.
#
# THE RULE THIS SCRIPT FOLLOWS: no existing way in is removed until a
# replacement has been proved to work. Password login is *not* disabled here,
# because this script cannot verify that a key works — see 11-ssh-keyonly.sh,
# which is separate for exactly that reason.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

echo "== security updates =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq upgrade

echo "== unattended security upgrades =="
apt-get -y -qq install unattended-upgrades
# Security only, and no automatic reboot: this box terminates an IPsec tunnel,
# and a reboot nobody scheduled is an outage Viva sees as the peer vanishing.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
cat > /etc/apt/apt.conf.d/51tutak-unattended <<'CONF'
Unattended-Upgrade::Automatic-Reboot "false";
CONF

echo "== SSH hardening (login methods left intact) =="
install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/10-tutak.conf <<'CONF'
# Root may log in with a key, never with a password. This is the setting that
# closes root password brute-forcing without closing the door we came in by:
# an operator with only a root password keeps working via 11-ssh-keyonly.sh's
# checked path, not by being locked out here.
PermitRootLogin prohibit-password
PubkeyAuthentication yes
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
CONF
sshd -t
systemctl reload ssh || systemctl reload sshd

echo "== fail2ban for SSH =="
apt-get -y -qq install fail2ban
systemctl enable --now fail2ban

echo
echo "Done. PasswordAuthentication is UNCHANGED on purpose."
echo "Next: put a key in /root/.ssh/authorized_keys, open a SECOND session to"
echo "prove it works, and only then run 11-ssh-keyonly.sh."
