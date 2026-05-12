#!/usr/bin/env bash
# ============================================================
#  AMINA Telegram webhook watchdog
# ============================================================
#  Runs every 15 min via cron. One job: make sure the Telegram
#  bot's registered webhook URL still points at our public
#  named-tunnel endpoint AND carries the right secret token.
#
#  If Telegram has dropped the URL (rare) or the secret_token
#  mismatch is detected, we re-register with the correct values.
#
#  Secret source of truth: /root/amina/.telegram_webhook_secret
#  (mode 600). The same value is baked into the gateway-lb
#  nginx.conf so nginx rejects POSTs missing/mismatching the
#  X-Telegram-Bot-Api-Secret-Token header with 403 — defence in
#  depth so impostors can't reach multichannel-access even
#  through the CF WAF skip we had to add.
#
#  Log: /var/log/amina-telegram-watchdog.log (logrotated weekly
#  via the existing /etc/logrotate.d/amina rule).
# ============================================================
set -u

LOG=/var/log/amina-telegram-watchdog.log
EXPECTED_URL="https://api.amina-design.com/telegram/webhook"
SECRET_FILE=/root/amina/.telegram_webhook_secret

ts() { date -Iseconds; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# 1. Read the bot token from the multichannel-access container env
#    (avoids storing it in two places).
TOKEN=$(docker exec multichannel-access printenv TELEGRAM_BOT_TOKEN 2>/dev/null)
if [[ -z "$TOKEN" ]]; then
    log "FAIL: could not read TELEGRAM_BOT_TOKEN from multichannel-access (container down?)"
    exit 1
fi

# 2. Read the webhook secret from the host-only file.
if [[ ! -r "$SECRET_FILE" ]]; then
    log "FAIL: secret file $SECRET_FILE not readable"
    exit 1
fi
SECRET=$(cat "$SECRET_FILE" | tr -d '\n\r')
if [[ ${#SECRET} -lt 16 ]]; then
    log "FAIL: secret too short (${#SECRET} chars)"
    exit 1
fi

# 3. Ask Telegram what URL it currently has registered.
info=$(curl -s --max-time 10 "https://api.telegram.org/bot${TOKEN}/getWebhookInfo")
ok=$(echo "$info" | grep -oE '"ok":[a-z]+' | head -1 | cut -d: -f2)
current_url=$(echo "$info" | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('result', {}).get('url', ''))
except Exception:
    print('')
" 2>/dev/null)

if [[ "$ok" != "true" ]]; then
    log "FAIL: getWebhookInfo failed — response: ${info:0:200}"
    exit 2
fi

# We can't read whether the secret_token is correctly set from
# getWebhookInfo (Telegram doesn't echo it back), but we CAN compare
# the URL. If the URL drifted we'll re-register with the right
# secret in one shot.
if [[ "$current_url" == "$EXPECTED_URL" ]]; then
    log "OK: webhook=$current_url (secret enforced)"
    exit 0
fi

# 4. URL drifted — re-register with URL + secret_token.
log "MISMATCH: have=$current_url want=$EXPECTED_URL — re-registering with secret_token"
set_resp=$(curl -s --max-time 15 -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
    -d "url=${EXPECTED_URL}" \
    -d "secret_token=${SECRET}" \
    -d 'allowed_updates=["message","callback_query"]' \
    -d 'drop_pending_updates=false')
set_ok=$(echo "$set_resp" | grep -oE '"ok":[a-z]+' | head -1 | cut -d: -f2)

if [[ "$set_ok" == "true" ]]; then
    log "RECOVER: webhook re-registered → $EXPECTED_URL (secret_token applied)"
    exit 0
else
    log "FAIL: setWebhook rejected — response: ${set_resp:0:300}"
    exit 3
fi
