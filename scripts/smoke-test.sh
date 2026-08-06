#!/usr/bin/env bash
# End-to-end smoke test for the TuTak API.
#
# Exercises the real money-moving paths against a running API + database:
# auth (register/login/refresh), partner onboarding, QR issue + redeem with a
# bonus discount, bonus accrual/ledger, referral qualification, and the
# admin/analytics read models.
#
# Usage: API_URL=http://127.0.0.1:4000/v1 ./scripts/smoke-test.sh
set -euo pipefail

API="${API_URL:-http://127.0.0.1:4000/v1}"
ADMIN_PHONE="${ADMIN_PHONE:-+37400000000}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-ChangeMe123!}"

PASS=0
FAIL=0
RUN_ID="$(date +%s)"

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
info()  { printf '\033[0;36m▸ %s\033[0m\n' "$1"; }

check() {
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    green "  ✓ $label ($actual)"
    PASS=$((PASS + 1))
  else
    red "  ✗ $label — expected '$expected', got '$actual'"
    FAIL=$((FAIL + 1))
  fi
}

jqr() { node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const j=JSON.parse(s);const v=$1;console.log(v===undefined||v===null?'':v);}catch(e){console.log('');}
});"; }

# ── Auth ────────────────────────────────────────────────────────────────
info "Auth: admin login"
ADMIN_RES=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$ADMIN_PHONE\",\"password\":\"$ADMIN_PASSWORD\",\"deviceId\":\"smoke-admin\"}")
ADMIN_TOKEN=$(echo "$ADMIN_RES" | jqr "j.data.tokens.accessToken")
ADMIN_ID=$(echo "$ADMIN_RES" | jqr "j.data.user.id")
check "admin authenticated" "$([[ -n "$ADMIN_TOKEN" ]] && echo yes || echo no)" "yes"
check "admin has SUPER_ADMIN" "$(echo "$ADMIN_RES" | jqr "j.data.user.roles.includes('SUPER_ADMIN')")" "true"
check "passwordHash not leaked" "$(echo "$ADMIN_RES" | jqr "j.data.user.passwordHash!==undefined")" "false"

info "Auth: customer registration"
CUST_PHONE="+3749${RUN_ID: -7}"
CUST_RES=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$CUST_PHONE\",\"password\":\"Passw0rd!23\",\"firstName\":\"Ani\",\"lastName\":\"Petrosyan\",\"locale\":\"hy\",\"deviceId\":\"smoke-cust\"}")
CUST_TOKEN=$(echo "$CUST_RES" | jqr "j.data.tokens.accessToken")
CUST_REFRESH=$(echo "$CUST_RES" | jqr "j.data.tokens.refreshToken")
CUST_ID=$(echo "$CUST_RES" | jqr "j.data.user.id")
check "customer registered" "$([[ -n "$CUST_TOKEN" ]] && echo yes || echo no)" "yes"
check "customer role is CUSTOMER" "$(echo "$CUST_RES" | jqr "j.data.user.roles[0]")" "CUSTOMER"

info "Auth: refresh token rotation"
REFRESH_RES=$(curl -s -X POST "$API/auth/refresh" -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$CUST_REFRESH\",\"deviceId\":\"smoke-cust\"}")
NEW_REFRESH=$(echo "$REFRESH_RES" | jqr "j.data.tokens.refreshToken")
check "new token pair issued" "$([[ -n "$NEW_REFRESH" ]] && echo yes || echo no)" "yes"
check "refresh token rotated" "$([[ "$NEW_REFRESH" != "$CUST_REFRESH" ]] && echo yes || echo no)" "yes"
REUSE_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/refresh" \
  -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$CUST_REFRESH\",\"deviceId\":\"smoke-cust\"}")
check "old refresh token revoked" "$REUSE_CODE" "401"

info "Auth: unauthenticated request rejected"
check "no-token request is 401" \
  "$(curl -s -o /dev/null -w '%{http_code}' "$API/wallet/me")" "401"

# ── Wallet ──────────────────────────────────────────────────────────────
info "Wallet: initial balance"
WALLET=$(curl -s "$API/wallet/me" -H "Authorization: Bearer $CUST_TOKEN")
check "wallet auto-created" "$(echo "$WALLET" | jqr "j.data.availableBonus")" "0"

info "Wallet: admin credits 5000 points"
ADJ_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/wallet/admin/adjust" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"userId\":\"$CUST_ID\",\"amount\":\"5000\",\"direction\":\"CREDIT\",\"reason\":\"smoke test grant\"}")
check "manual adjustment accepted" "$ADJ_CODE" "201"
WALLET=$(curl -s "$API/wallet/me" -H "Authorization: Bearer $CUST_TOKEN")
check "available balance is 5000" "$(echo "$WALLET" | jqr "Number(j.data.availableBonus)")" "5000"

info "RBAC: customer cannot perform admin adjustment"
check "customer adjust is 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/wallet/admin/adjust" \
     -H "Authorization: Bearer $CUST_TOKEN" -H 'Content-Type: application/json' \
     -d "{\"userId\":\"$CUST_ID\",\"amount\":\"1\",\"direction\":\"CREDIT\",\"reason\":\"nope\"}")" "403"

# ── Partner + QR payment ────────────────────────────────────────────────
info "Partner: create (5% bonus accrual)"
PARTNER_RES=$(curl -s -X POST "$API/partners" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"legalName\":\"Smoke LLC $RUN_ID\",\"displayName\":\"Smoke Cafe\",\"taxId\":\"TAX$RUN_ID\",\"category\":\"cafe\",\"bonusAccrualRateBps\":500,\"ownerUserId\":\"$ADMIN_ID\"}")
PARTNER_ID=$(echo "$PARTNER_RES" | jqr "j.data.id")
check "partner created" "$([[ -n "$PARTNER_ID" ]] && echo yes || echo no)" "yes"

info "QR: partner issues a 10000 AMD invoice"
QR_RES=$(curl -s -X POST "$API/qr/issue" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"DYNAMIC_INVOICE\",\"partnerId\":\"$PARTNER_ID\",\"amount\":\"10000\",\"expiresInSeconds\":900}")
QR_TOKEN=$(echo "$QR_RES" | jqr "j.data.token")
check "QR issued" "$([[ -n "$QR_TOKEN" ]] && echo yes || echo no)" "yes"

info "QR: customer redeems, applying 2000 bonus points"
IDEM="smoke-$RUN_ID"
REDEEM=$(curl -s -X POST "$API/qr/redeem" -H "Authorization: Bearer $CUST_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$QR_TOKEN\",\"bonusAmountToApply\":\"2000\",\"idempotencyKey\":\"$IDEM\"}")
TX_ID=$(echo "$REDEEM" | jqr "j.data.transactionId")
check "payment completed" "$([[ -n "$TX_ID" ]] && echo yes || echo no)" "yes"
check "charged 10000" "$(echo "$REDEEM" | jqr "Number(j.data.amountCharged)")" "10000"
check "bonus applied 2000" "$(echo "$REDEEM" | jqr "Number(j.data.bonusApplied)")" "2000"
# 5% of the 8000 paid in cash (10000 - 2000 bonus discount) = 400
check "bonus earned 400 (5% of paid portion)" "$(echo "$REDEEM" | jqr "Number(j.data.bonusEarned)")" "400"

info "QR: idempotency — replaying the same key"
REPLAY=$(curl -s -X POST "$API/qr/redeem" -H "Authorization: Bearer $CUST_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$QR_TOKEN\",\"bonusAmountToApply\":\"2000\",\"idempotencyKey\":\"$IDEM\"}")
check "replay returns same transaction" "$(echo "$REPLAY" | jqr "j.data.transactionId")" "$TX_ID"

info "QR: single-use code cannot be redeemed twice"
SECOND=$(curl -s -X POST "$API/qr/redeem" -H "Authorization: Bearer $CUST_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$QR_TOKEN\",\"idempotencyKey\":\"smoke-$RUN_ID-b\"}")
check "second redemption rejected" "$(echo "$SECOND" | jqr "j.statusCode")" "400"

info "Wallet: balances after payment"
WALLET=$(curl -s "$API/wallet/me" -H "Authorization: Bearer $CUST_TOKEN")
# 5000 - 2000 spent = 3000 available; the 400 earned sits PENDING (cooling-off)
check "available now 3000" "$(echo "$WALLET" | jqr "Number(j.data.availableBonus)")" "3000"
check "pending now 400" "$(echo "$WALLET" | jqr "Number(j.data.pendingBonus)")" "400"
check "reserved back to 0" "$(echo "$WALLET" | jqr "Number(j.data.reservedBonus)")" "0"
check "lifetime spent 2000" "$(echo "$WALLET" | jqr "Number(j.data.lifetimeSpent)")" "2000"

info "Wallet: ledger recorded the movements"
LEDGER=$(curl -s "$API/wallet/me/ledger" -H "Authorization: Bearer $CUST_TOKEN")
check "ledger has entries" "$(echo "$LEDGER" | jqr "j.data.items.length>0")" "true"

info "Bonus: cannot spend more than available"
OVER_QR=$(curl -s -X POST "$API/qr/issue" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"DYNAMIC_INVOICE\",\"partnerId\":\"$PARTNER_ID\",\"amount\":\"99999\"}")
OVER_TOKEN=$(echo "$OVER_QR" | jqr "j.data.token")
OVER=$(curl -s -X POST "$API/qr/redeem" -H "Authorization: Bearer $CUST_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$OVER_TOKEN\",\"bonusAmountToApply\":\"99999\",\"idempotencyKey\":\"smoke-$RUN_ID-over\"}")
check "overspend rejected" "$(echo "$OVER" | jqr "j.statusCode")" "400"
WALLET=$(curl -s "$API/wallet/me" -H "Authorization: Bearer $CUST_TOKEN")
check "balance unchanged after failed spend" "$(echo "$WALLET" | jqr "Number(j.data.availableBonus)")" "3000"
check "no points stuck reserved" "$(echo "$WALLET" | jqr "Number(j.data.reservedBonus)")" "0"

# ── Transactions / referral / analytics ─────────────────────────────────
info "Transactions: customer history"
TXS=$(curl -s "$API/transactions/me" -H "Authorization: Bearer $CUST_TOKEN")
check "history contains the payment" "$(echo "$TXS" | jqr "j.data.items.some(t=>t.id==='$TX_ID')")" "true"

info "Referral: code issued at registration"
REF=$(curl -s "$API/referral/me/code" -H "Authorization: Bearer $CUST_TOKEN")
REF_CODE=$(echo "$REF" | jqr "j.data.code")
check "referral code exists" "$([[ -n "$REF_CODE" ]] && echo yes || echo no)" "yes"

info "Referral: referred signup qualifies referrer on first payment"
REFEREE_PHONE="+3748${RUN_ID: -7}"
REFEREE_RES=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$REFEREE_PHONE\",\"password\":\"Passw0rd!23\",\"firstName\":\"Davit\",\"lastName\":\"Hakobyan\",\"locale\":\"hy\",\"deviceId\":\"smoke-ref\",\"referralCode\":\"$REF_CODE\"}")
REFEREE_TOKEN=$(echo "$REFEREE_RES" | jqr "j.data.tokens.accessToken")
REF_QR=$(curl -s -X POST "$API/qr/issue" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"DYNAMIC_INVOICE\",\"partnerId\":\"$PARTNER_ID\",\"amount\":\"3000\"}")
REF_QR_TOKEN=$(echo "$REF_QR" | jqr "j.data.token")
curl -s -X POST "$API/qr/redeem" -H "Authorization: Bearer $REFEREE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$REF_QR_TOKEN\",\"idempotencyKey\":\"smoke-$RUN_ID-ref\"}" > /dev/null
sleep 1
INVITES=$(curl -s "$API/referral/me/invites" -H "Authorization: Bearer $CUST_TOKEN")
check "referral invite rewarded" "$(echo "$INVITES" | jqr "j.data[0]&&j.data[0].status")" "REWARDED"

info "Partner: scoped transaction list"
PTX=$(curl -s "$API/partners/$PARTNER_ID/transactions" -H "Authorization: Bearer $ADMIN_TOKEN")
check "partner sees its transactions" "$(echo "$PTX" | jqr "j.data.items.length>0")" "true"

info "Authorization: customer cannot issue QR for a partner"
check "unauthorized QR issue is 403" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/qr/issue" \
     -H "Authorization: Bearer $CUST_TOKEN" -H 'Content-Type: application/json' \
     -d "{\"type\":\"DYNAMIC_INVOICE\",\"partnerId\":\"$PARTNER_ID\",\"amount\":\"100\"}")" "403"

info "Admin: overview, analytics, audit log"
check "admin overview reachable" \
  "$(curl -s "$API/admin/overview" -H "Authorization: Bearer $ADMIN_TOKEN" | jqr "j.data.userCount>0")" "true"
check "platform analytics reachable" \
  "$(curl -s "$API/analytics/platform" -H "Authorization: Bearer $ADMIN_TOKEN" | jqr "j.data.transactionsByType.length>0")" "true"
check "audit log recorded actions" \
  "$(curl -s "$API/admin/audit-logs" -H "Authorization: Bearer $ADMIN_TOKEN" | jqr "j.data.items.length>0")" "true"

info "Notifications: generated by domain events"
check "customer has notifications" \
  "$(curl -s "$API/notifications/me" -H "Authorization: Bearer $CUST_TOKEN" | jqr "j.data.items.length>0")" "true"

info "Validation: malformed payload rejected"
check "bad phone format is 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/auth/register" \
     -H 'Content-Type: application/json' \
     -d '{"phone":"12345","password":"short","firstName":"X","lastName":"Y","deviceId":"d"}')" "400"

# ── Summary ─────────────────────────────────────────────────────────────
echo
echo "──────────────────────────────────────────"
if [[ $FAIL -eq 0 ]]; then
  green "All $PASS checks passed."
else
  red "$FAIL check(s) failed, $PASS passed."
  exit 1
fi
