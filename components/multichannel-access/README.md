# multichannel-access — Telegram / WhatsApp / Messenger sidecar

Channel-bridge service that receives webhooks from Telegram, WhatsApp,
and Messenger and forwards them into the Haystack chat pipeline at
`haystack-chatqna:8000`. Runs as a separate container so that
provider quirks (rate limits, signature verification, voice-note
download, file size caps) stay out of the main agent codepath.

This README is the **operations** guide — for ops actions like
"the bot stopped responding on Telegram", "I just rotated the bot
token", "I switched ISPs and the public URL changed".

It is **not** a guide to changing how Telegram messages are
processed. That logic lives in
[`app/channels/telegram.py`](app/channels/telegram.py) and should
not be edited to fix stale-webhook failures — those are tunnel-side
problems.

---

## 1. Architecture (short version)

```
                 (public internet)
                       |
                       |  HTTPS POST  (every Telegram message + callback_query)
                       v
            ┌────────────────────┐
            │   public tunnel    │   ngrok / cloudflared
            │   :443 -> :8020    │
            └─────────┬──────────┘
                      |
          ┌───────────▼──────────────┐
          │  multichannel-access     │  this container, port 8020
          │  /telegram/webhook       │
          │  /whatsapp/webhook       │
          │  /messenger/webhook      │
          └───────────┬──────────────┘
                      |
                      |  internal docker network (chatqna_default)
                      v
          ┌──────────────────────────┐
          │  haystack-chatqna:8000   │  /api/v1/agent/chat (+ chat-stream)
          │   • LoRA / Groq / Gemini │
          │   • RAG, intent_router,  │
          │     guest_chat_patch,    │
          │     basic_beginner_*,    │
          │     llm_provider_policy  │
          └──────────────────────────┘
```

Sessions, dedup, and rate-limit state live in `multichannel-redis`
(separate Redis instance — independent from `amina-redis`).

---

## 2. Quick health check

```powershell
# Local sidecar reachable + plumbed to Haystack + Redis?
curl -s http://localhost:8020/health | ConvertFrom-Json
```

Expected:

```json
{
  "status":   "ok",
  "service":  "multichannel-access",
  "haystack": "connected",
  "redis":    "connected",
  "telegram": true
}
```

`telegram: true` only confirms the env var is **set inside the
container**, not that Telegram can actually reach the webhook. For
that, see §4 (webhook state).

---

## 3. Open a public tunnel to :8020

The sidecar binds to `localhost:8020` on the docker host. Telegram
needs a public HTTPS URL that maps to it. Four options, ranked from
fastest-to-start to most-durable:

### Option A — fully automatic: quick tunnel + auto-webhook watcher (zero account, recommended)

The repo bundles **two** opt-in compose overrides plus a small Python
watcher so that when you bring up the bridge, the bot comes up with it
and self-heals after every tunnel rotation. **No copy/paste**, **no
account**, **no domain**.

```powershell
docker compose `
  -f components/multichannel-access/docker-compose.yml `
  -f components/multichannel-access/docker-compose.quick-tunnel.yml `
  -f components/multichannel-access/docker-compose.quick-tunnel-watcher.yml `
  up -d
```

That command brings up four containers:

| Container | Role |
|---|---|
| `multichannel-redis` | session/dedup store |
| `multichannel-access` | the FastAPI bridge on `:8020` |
| `amina-cf-quick-tunnel` | cloudflared in quick-tunnel mode, gets a free `*.trycloudflare.com` URL |
| `telegram-webhook-watcher` | tails cloudflared's logfile via a shared volume, calls `/telegram/set-webhook` whenever the URL changes |

Within ~30-90 seconds (DNS propagation for the trycloudflare hostname),
the watcher logs:

```
tunnel_url_detected url=https://....trycloudflare.com
webhook_updated     old=...               new=https://....trycloudflare.com/telegram/webhook
webhook_verified    url=https://....trycloudflare.com/telegram/webhook
```

Tear it all down with:

```powershell
docker compose `
  -f components/multichannel-access/docker-compose.yml `
  -f components/multichannel-access/docker-compose.quick-tunnel.yml `
  -f components/multichannel-access/docker-compose.quick-tunnel-watcher.yml `
  down
```

#### Limitations

- **`*.trycloudflare.com` URLs are ephemeral.** Cloudflare may rotate
  them when their edge restarts; your URL also changes if you
  `docker compose down` the cf-quick-tunnel container. The watcher
  catches every rotation within the poll interval (default 10s) and
  re-registers automatically — there's no manual step.
- **Quick tunnels have no SLA.** Cloudflare's terms of service for
  account-less tunnels explicitly disclaim uptime. For staging or
  production you should switch to a named tunnel (Option D below).
- **DNS warm-up after a fresh start.** Brand-new trycloudflare hostnames
  take 30-90 seconds to be resolvable from Telegram's edge. The watcher
  retries `set-webhook` on each poll until Telegram accepts it.

#### Why the watcher avoids the Docker socket

Reading the cloudflared URL from `docker logs` would normally require
mounting `/var/run/docker.sock` into the watcher container — a
significant security trade-off (socket access ≈ root on the host).
Instead, cloudflared is configured with `--logfile /shared/quick-tunnel.log`
and writes to a **shared named volume** (`cf-tunnel-logs`). The watcher
mounts that volume **read-only** at `/var/log/cloudflared/`. Same data,
no privileged socket.

#### Manual option (no watcher)

If you'd rather drive the registration by hand once and forget it (URL
won't auto-recover after a tunnel rotation):

```powershell
# Bring up just the tunnel (no watcher)
docker compose `
  -f components/multichannel-access/docker-compose.yml `
  -f components/multichannel-access/docker-compose.quick-tunnel.yml `
  up -d cf-quick-tunnel

# Read the URL from the sidecar logs
docker logs amina-cf-quick-tunnel 2>&1 | Select-String -Pattern 'trycloudflare\.com'

# Register it with Telegram in one call
.\scripts\telegram_webhook_ops.ps1 -PublicUrl "https://<the-url-above>" -SetWebhook -Verify
```

### Option B — ngrok (free tier, ephemeral)

Free-tier URL changes every time you restart it. Requires an ngrok
account / authtoken locally.

```powershell
ngrok http 8020
# copy the https URL it prints
```

### Option C — cloudflared quick tunnel from the host (no docker)

If you'd rather run the tunnel directly on your machine instead of in
Docker:

```powershell
cloudflared tunnel --url http://localhost:8020
```

Same free-tier `*.trycloudflare.com` URL as Option A, but tied to your
host process instead of the docker network.

### Option D — cloudflared NAMED tunnel (persistent, recommended for prod)

One-time setup, then the URL never changes again:

```bash
cloudflared login
cloudflared tunnel create amina-telegram
cloudflared tunnel route dns amina-telegram telegram.yourdomain.com
# write ~/.cloudflared/config.yml mapping the tunnel UUID to localhost:8020
cloudflared tunnel run amina-telegram
```

Or run the bundled cloudflared sidecar via the opt-in compose override
(see §6 below).

---

## 4. Register the webhook with Telegram

After you have a public HTTPS URL pointing at `:8020`, register it.
The repo ships an ops script that does the safe thing:

```powershell
# Inspect (read-only): current health + currently registered webhook
.\scripts\telegram_webhook_ops.ps1

# Set a new webhook URL + verify it took
.\scripts\telegram_webhook_ops.ps1 -PublicUrl "https://YOUR-PUBLIC-URL" -SetWebhook -Verify

# Just print the tunnel-open command examples
.\scripts\telegram_webhook_ops.ps1 -OpenTunnelHint
```

The script:

- Runs `GET /health` and bails with exit 1 if the sidecar is degraded.
- Pulls `GET /telegram/webhook-info` and prints url, pending count,
  last error, allowed_updates.
- If `-SetWebhook` is given, POSTs to `/telegram/set-webhook` and
  re-verifies that Telegram persisted the URL (exit 3 on mismatch).
- If `-Verify` is given, flags warning conditions:
  - empty webhook URL
  - ngrok URL (likely ephemeral)
  - missing `callback_query` subscription (breaks 👍/👎 buttons)
  - high `pending_update_count` (webhook unreachable)
  - any `last_error_message` from Telegram
- **Never prints `TELEGRAM_BOT_TOKEN`.** The local sidecar API does
  not return it; the script also defensively redacts anything that
  matches the token shape.

---

## 5. Verify the webhook

```powershell
# Equivalent direct curl (no script needed)
curl -s http://localhost:8020/telegram/webhook-info | ConvertFrom-Json
```

Look for:

| Field | Healthy value |
|---|---|
| `result.url` | your public URL ending in `/telegram/webhook` |
| `result.pending_update_count` | `0` or single digits |
| `result.last_error_message` | absent / not present |
| `result.allowed_updates` | empty list (default = all) **or** must include `message` and `callback_query` |

---

## 6. Optional: persistent Cloudflare named tunnel (compose override)

Only use if you want the tunnel to come up automatically alongside
`multichannel-access`.

1. Create a Cloudflare tunnel and copy its **tunnel token**:

   ```bash
   cloudflared tunnel create amina-telegram   # one time
   cloudflared tunnel token amina-telegram    # prints the token
   ```

2. Set the env var on your shell (do **not** commit it):

   ```powershell
   $env:CLOUDFLARED_TUNNEL_TOKEN = "<paste-token>"
   ```

3. Bring up `multichannel-access` with the override layered in:

   ```powershell
   docker compose `
     -f components/multichannel-access/docker-compose.yml `
     -f components/multichannel-access/docker-compose.cloudflare-tunnel.yml `
     up -d
   ```

The override file ([`docker-compose.cloudflare-tunnel.yml`](docker-compose.cloudflare-tunnel.yml))
adds a `cloudflared` sidecar that runs `cloudflared tunnel run`. It
does NOT modify the existing service. If `CLOUDFLARED_TUNNEL_TOKEN`
is unset, docker compose will refuse to start the tunnel container,
leaving `multichannel-access` running alone (same as today).

---

## 7. Tail the logs

```powershell
# All sidecar activity
docker logs -f --tail 80 multichannel-access

# Only Telegram-related lines
docker logs -f --tail 200 multichannel-access | Select-String -Pattern "telegram|webhook"
```

---

## 8. End-to-end smoke checklist

Once the webhook is registered and you can see logs, run through
these in DM with `@amina_care_bot`:

| Send | Expected |
|---|---|
| `/start` | Welcome / onboarding card |
| `/help` | Command list |
| `hi` | Neutral greeting (Basic/Beginner intent gate, if mode header set) or LoRA reply |
| `my sugar is high` | NCD response (LoRA / RAG path; `X-AMINA-Domain-Hint: vitals_glucose` server-side) |
| voice note (≤ 6 min) | Whisper transcription → reply |
| `/login` or `/pin` | Account-link flow → asks for AMINA phone + PIN |
| `/profile` | Patient summary card (after login) |
| `/vitals` | Latest vitals readings (after login) |
| `/careplan` | Active care-plan items (after login) |
| `/logout` | Unlinks the chat_id |

If `hi` works but `/profile` says you're not signed in, the gateway
account-link round-trip is broken, **not** the webhook. Check
`docker logs haystack-chatqna` for `/api/v1/patient/telegram/save-chat-id`
errors.

---

## 9. Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Bot is silent for ALL messages | Webhook URL is stale (ngrok died) | Run §3 + §4 to re-register |
| Bot is silent only in groups | `can_read_all_group_messages = false` (privacy mode) | `@BotFather → /setprivacy → Disable` |
| 👍 / 👎 feedback buttons don't fire | `allowed_updates` missing `callback_query` | Re-run `-SetWebhook` (script subscribes correctly) |
| `health` returns `haystack: unreachable` | Network misconfig | Confirm `chatqna_default` network exists; both services on it |
| `health` says `telegram: false` | `TELEGRAM_BOT_TOKEN` unset in container env | Add to `.env`, `docker compose up -d --force-recreate multichannel-access` |
| `pending_update_count` keeps climbing | Public URL is up but proxy returns non-2xx | Check tunnel health; `curl https://YOUR-URL/telegram/webhook -X POST -d '{}' -H 'Content-Type: application/json'` should return `200` |
| `last_error_message: SSL handshake failed` | Self-signed cert behind proxy | Use ngrok / cloudflared / a real cert |

---

## 10. Do NOT change

The Telegram channel app code (everything under `app/channels/telegram.py`)
is **not** the right place to fix any of:

- stale tunnel URL  → fix the tunnel, re-register
- bot token rotation → update the env var, recreate container
- webhook backlog → fix the public URL reachability
- missing inline buttons → re-register with `callback_query` subscribed

If you find yourself editing message-handling code to work around
infrastructure issues, stop and use this README's checklist instead.
