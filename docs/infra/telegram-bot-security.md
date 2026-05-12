# Telegram Bot — Security & Operations

**Status:** Production
**Last reviewed:** 2026-05-12
**Owners:** Platform team

This document describes how AMINA Care's Telegram bot is wired end-to-end, what protects it from abuse, and how to operate it.

---

## 1. Architecture at a glance

```
  ┌────────────────┐                ┌──────────────┐
  │ Telegram User  │  /hi           │  Telegram    │
  │  in Telegram   │ ──────────────►│  Bot API     │
  └────────────────┘                │  (telegram   │
                                    │  servers)    │
                                    └──────┬───────┘
                                           │ POST https://api.amina-design.com/telegram/webhook
                                           │ Header: X-Telegram-Bot-Api-Secret-Token: <SECRET>
                                           │
                                           ▼
                          ┌────────────────────────────────┐
                          │ Cloudflare Edge                │
                          │ • WAF Skip rule: bypass        │
                          │   bot-protection for           │
                          │   URI path = /telegram/webhook │
                          └─────────────────┬──────────────┘
                                            │ (no challenge served to Telegram)
                                            ▼
                          ┌────────────────────────────────┐
                          │ cloudflared (named tunnel,     │
                          │ JWT-token authenticated)       │
                          └─────────────────┬──────────────┘
                                            │ direct to:
                                            ▼
                          ┌────────────────────────────────┐
                          │ amina-gateway-lb  (nginx)      │
                          │ • location = /telegram/webhook │
                          │ • REJECTS 403 unless           │
                          │   X-Telegram-Bot-Api-          │
                          │   Secret-Token header EXACTLY  │
                          │   matches the host secret      │
                          │ • All other /telegram/* → 404  │
                          └─────────────────┬──────────────┘
                                            │ proxy_pass
                                            ▼
                          ┌────────────────────────────────┐
                          │ multichannel-access:8020       │
                          │ FastAPI /telegram/webhook      │
                          │ → command handler              │
                          │ → forwards to haystack-chatqna │
                          │ → calls Telegram sendMessage / │
                          │   sendVoice with bot's reply   │
                          └────────────────────────────────┘
```

---

## 2. Defence-in-depth — three independent layers

| Layer | What it does | What happens if it fails |
|---|---|---|
| **Cloudflare WAF Skip rule** | Lets Telegram's webhook POSTs reach our origin (without it, CF returns a "Just a moment…" Managed Challenge that Telegram can't solve, breaking the bot). | If the rule is deleted, Telegram deliveries get HTTP 403; the bot goes silent. The `amina-telegram-watchdog` cron will keep retrying setWebhook, surfacing repeated `403 Forbidden` errors in its log. |
| **nginx secret-token check** | Returns 403 to any POST on `/telegram/webhook` whose `X-Telegram-Bot-Api-Secret-Token` header doesn't exactly match the host's secret. Telegram always sends this header on every delivery. | If an attacker discovers the path AND solves the WAF skip, they still can't reach the app without the secret. nginx 403s them before the request hits FastAPI. |
| **multichannel-access app-layer guards** | The FastAPI handler itself authenticates the *Telegram user* (chat_id) for stateful flows, runs the message through the jailbreak/abuse detector, and only then forwards to the agent. | If the nginx check is bypassed (e.g. secret leaks), the app's existing abuse-defense layer still catches malicious content. |

The first two layers are **infrastructure**. The third is **app-level**. Each is independent — compromising one doesn't compromise the others.

---

## 3. The shared secret

**Where it lives**

- `/root/amina/.telegram_webhook_secret` on the A40 host (mode 0600, owner root)
- Baked into `/root/amina/haystack-stack/gateway-lb/nginx.conf` at deploy time (template placeholder `__TELEGRAM_WEBHOOK_SECRET__` is substituted by the deploy script)
- Registered with Telegram via the `secret_token` parameter on `setWebhook` — Telegram echoes it back as the `X-Telegram-Bot-Api-Secret-Token` HTTP header on every delivery

**What it looks like**

```
$ stat -c "%a %U:%G %s bytes" /root/amina/.telegram_webhook_secret
600 root:root 65 bytes
```

64 hex characters (32 bytes from `openssl rand -hex 32`), within Telegram's allowed range of 1–256 chars from `[A-Za-z0-9_-]`.

**The secret is never committed to git.** The repo nginx template uses the placeholder; the rendered file with the real secret lives only on A40 (and is overwritten on every deploy by reading the .secret file).

---

## 4. Operations

### Daily / weekly

Nothing. The system is self-healing:

| Component | Mechanism | Frequency |
|---|---|---|
| `multichannel-access` container health | `amina-watchdog.sh` (CRITICAL list) restarts on exit/unhealthy | every 5 min |
| Telegram webhook URL drift | `amina-telegram-watchdog.sh` re-registers if Telegram dropped the URL — preserves secret_token | every 15 min |
| `amina-watchdog.sh` heartbeat | Logs `tick actions=N` so ops can confirm cron is firing | every 5 min |

### Rotating the secret

Quarterly, or immediately if the secret leaks (e.g. nginx.conf accidentally committed).

```bash
# 1. Generate a new secret on the host
umask 077
openssl rand -hex 32 > /root/amina/.telegram_webhook_secret
chmod 600 /root/amina/.telegram_webhook_secret

# 2. Re-render nginx.conf with the new value
# (use the deploy script — it substitutes the __TELEGRAM_WEBHOOK_SECRET__
# placeholder with the new file contents)
python3 /root/amina/scripts/_tmp_deploy_telegram_secret.py

# 3. Reload nginx (zero-downtime)
docker exec amina-gateway-lb nginx -t && \
docker exec amina-gateway-lb nginx -s reload

# 4. Tell Telegram about the new secret
/usr/local/bin/amina-telegram-watchdog.sh

# 5. Confirm the bot still works — send a real `/start` to the bot
# and watch:
docker logs --since 60s multichannel-access | grep telegram
```

During steps 1–4 the bot will return 403 to Telegram for ~5–30 seconds. Telegram retries on its own; no message is lost.

### Rotating the bot token

Only if the bot token leaks. Talk to @BotFather, get a new token, update the multichannel-access env (`TELEGRAM_BOT_TOKEN`), recreate the container. The webhook watchdog re-registers automatically because it reads the token from the container at runtime.

### Reading the logs

```bash
# Cron-driven webhook watchdog (15-min cadence)
tail -f /var/log/amina-telegram-watchdog.log

# Application-layer Telegram traffic (every bot interaction)
docker logs -f multichannel-access | grep -E "telegram|webhook"

# nginx 403s from the secret-token check
docker logs amina-gateway-lb | grep -E "403"
```

`OK:` / `RECOVER:` lines are normal. `FAIL:` is the only thing to act on.

---

## 5. Threat model & coverage

| Threat | Mitigation |
|---|---|
| Drive-by scanner POSTs random JSON to `/telegram/webhook` | nginx 403s without the secret header (request never reaches app) |
| Attacker discovers webhook URL via DNS/cert log | Still needs the secret token; nginx 403s without it |
| Attacker scrapes the secret from nginx.conf | Requires SSH access to A40 = full host compromise = much bigger problem |
| Replay of a legitimate Telegram POST (captured in transit) | Each Telegram update has a monotonic `update_id`; the agent layer rejects stale ones |
| Cloudflare WAF Skip rule is too permissive | Skip is scoped to **exact** path `/telegram/webhook` only; every other path keeps full bot-protection |
| Internal /telegram/set-webhook called by attacker | nginx returns 404 — those mgmt endpoints only resolve inside the docker network |
| Cloudflared tunnel JWT leaks | Rotate token in CF Zero Trust dashboard; secret is in `/root/amina/.env.cloudflared` (mode 0600) |
| Telegram bot token leaks | Talk to @BotFather, get a new token, replace in multichannel-access env |

**Not yet covered:**

- IP allow-listing Telegram's known webhook IPs (149.154.160.0/20, 91.108.4.0/22). We could add this in nginx but it's brittle — Telegram occasionally adds new ranges and we'd outage ourselves. The secret_token is the more durable defence.

---

## 6. Reference — files & paths

### On the A40 host
| Path | Contents |
|---|---|
| `/root/amina/.telegram_webhook_secret` | 64-hex shared secret (mode 0600) |
| `/root/amina/haystack-stack/gateway-lb/nginx.conf` | Bind-mounted into amina-gateway-lb; contains the rendered secret in the `/telegram/webhook` location block |
| `/usr/local/bin/amina-telegram-watchdog.sh` | 15-min cron watchdog — re-registers webhook if URL drifts |
| `/var/log/amina-telegram-watchdog.log` | Append-only log of every watchdog cycle |
| `/etc/logrotate.d/amina` | Weekly rotation, 4 archives, applies to all `/var/log/amina-*.log` |

### Containers
| Name | Role |
|---|---|
| `cloudflared` (amina-cloudflared) | Named-tunnel egress to Cloudflare edge |
| `amina-gateway-lb` | nginx — terminates TLS at the tunnel, applies secret-token check, proxies to `multichannel-access:8020` |
| `multichannel-access` | FastAPI app — handles `/telegram/webhook` (and `/whatsapp`, `/messenger`) |
| `multichannel-redis` | Session / rate-limit state for multichannel-access |
| `haystack-chatqna` | The AMINA agent — receives the user's message from multichannel-access, returns a reply |

### Cron entries (`crontab -l` on root)
```
*/5  * * * *   /usr/local/bin/amina-watchdog.sh                ← container health every 5 min
*/15 * * * *   /usr/local/bin/amina-telegram-watchdog.sh       ← webhook drift every 15 min
15   3 * * *   /usr/local/bin/amina-scribe-reaper.sh           ← orphan audio cleanup, daily 03:15 UTC
30   3 1,15 * /usr/local/bin/amina-backup.sh                   ← bi-weekly snapshot 03:30 UTC
```

### Cloudflare WAF rules (zone: amina-design.com)
- `telegram-webhook-bypass` — Skip action, scoped to `URI Path eq "/telegram/webhook"`, skips:
  - All remaining custom rules
  - All rate limiting rules
  - All managed rules
  - All Super Bot Fight Mode rules
  - All Managed Challenges
  - Browser Integrity Check
  - Place: First (executes before any other security rule)

---

## 7. Verification — the 4-scenario test

Run these any time you suspect the secret defence has regressed.

```bash
SECRET=$(cat /root/amina/.telegram_webhook_secret)

# A — correct token → 200
curl -sk -X POST 'https://api.amina-design.com/telegram/webhook' \
  -H 'Content-Type: application/json' \
  -H "X-Telegram-Bot-Api-Secret-Token: ${SECRET}" \
  -d '{"update_id":1}' -w 'HTTP=%{http_code}\n'

# B — missing header → 403
curl -sk -X POST 'https://api.amina-design.com/telegram/webhook' \
  -H 'Content-Type: application/json' \
  -d '{"update_id":2}' -w 'HTTP=%{http_code}\n'

# C — wrong token → 403
curl -sk -X POST 'https://api.amina-design.com/telegram/webhook' \
  -H 'Content-Type: application/json' \
  -H 'X-Telegram-Bot-Api-Secret-Token: nope' \
  -d '{"update_id":3}' -w 'HTTP=%{http_code}\n'

# D — internal mgmt endpoint must not be exposed → 404
curl -sk 'https://api.amina-design.com/telegram/webhook-info' \
  -w 'HTTP=%{http_code}\n'
```

Expected: `200`, `403`, `403`, `404`.

If A is not 200, the WAF skip rule or the secret hasn't propagated yet — wait 60 s and retry, or check the rule is deployed at https://dash.cloudflare.com/?to=/:account/amina-design.com/security/waf/custom-rules.

If B or C is not 403, the nginx check has been removed or the secret in nginx.conf doesn't match the .secret file. Re-render nginx and reload.

If D is not 404, the `location ^~ /telegram/` block has been removed; restore it from this doc.

---

## 8. Initial setup (one-time, already done — kept here for disaster recovery)

```bash
# 1. Add the WAF Skip rule via the Cloudflare dashboard (see §6 above).

# 2. Generate the host secret
umask 077
openssl rand -hex 32 > /root/amina/.telegram_webhook_secret
chmod 600 /root/amina/.telegram_webhook_secret

# 3. Add the /telegram/webhook location + secret check to
#    /root/amina/haystack-stack/gateway-lb/nginx.conf
#    (see this doc §1 architecture diagram & the existing block in nginx.conf)

# 4. Reload nginx
docker exec amina-gateway-lb nginx -t && docker exec amina-gateway-lb nginx -s reload

# 5. Install the watchdog cron
echo '*/15 * * * * /usr/local/bin/amina-telegram-watchdog.sh' | crontab -

# 6. Register the webhook with Telegram (one shot)
/usr/local/bin/amina-telegram-watchdog.sh

# 7. Run the 4-scenario verification above
```

Total time: ~10 minutes once the WAF rule is in place.
