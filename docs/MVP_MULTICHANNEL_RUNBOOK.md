# AMINA MVP Multichannel Runbook

**Scope:** Bring up and verify Haystack + Messenger + WhatsApp + Telegram with one
command, without merging their runtime code.

**Status:** Ops control plane only. No clinical / RAG / STT / policy / frontend
changes. The Messenger E2E DM has already been proven once
([META_STAGE2_READINESS.md](META_STAGE2_READINESS.md)). This document is the
day-to-day driver.

---

## Table of contents

1. [Architecture](#1-architecture)
2. [The one script you run](#2-the-one-script-you-run)
3. [MVP definition](#3-mvp-definition)
4. [One-command flows](#4-one-command-flows)
5. [Required environment variables](#5-required-environment-variables)
6. [Callback URLs](#6-callback-urls)
7. [Tunnel options](#7-tunnel-options)
8. [Common failures](#8-common-failures)
9. [Security](#9-security)
10. [WhatsApp activation walkthrough (Meta)](#10-whatsapp-activation-walkthrough)
11. [WhatsApp via Twilio Sandbox (MVP fallback)](#11-whatsapp-via-twilio-sandbox-mvp-fallback)
12. [Production: one public host + path routing](#12-production-one-public-host--path-routing)
13. [What this runbook does NOT do](#13-what-this-runbook-does-not-do)

---

## 1. Architecture

```
                ┌─────────────┐         ┌─────────────┐
                │  Messenger  │         │   Telegram  │
                │  (Meta)     │         │             │
                └──────┬──────┘         └──────┬──────┘
                       │                       │
                       ▼                       ▼
              POST /api/v1/meta/        POST /telegram/
              webhook/messenger         webhook
                       │                       │
                       ▼                       ▼
            ┌─────────────────┐      ┌─────────────────┐
            │ haystack-chatqna│      │ multichannel-   │
            │   (Haystack)    │◄─────│ access sidecar  │
            │   :8000         │      │ :8020           │
            └────────┬────────┘      └────────┬────────┘
                     │                        │
                     │  meta_bridge.py        │  HTTP to Haystack
                     │                        │  (gateway URL)
                     ▼                        ▼
                  ┌──────────────────────────────┐
                  │     AminaAgent (canonical)   │
                  │     RAG / safety / policy    │
                  └──────────────────────────────┘
```

**Key invariants:**

- Messenger and WhatsApp routes live **inside Haystack**
  ([haystack-chatqna/src/api/meta_routes.py](../haystack-stack/haystack-chatqna/src/api/meta_routes.py),
  [meta_bridge.py](../haystack-stack/haystack-chatqna/src/services/meta_bridge.py)).
  Meta webhooks hit Haystack directly on `:8000`.
- Telegram lives in the **multichannel-access** sidecar
  ([components/multichannel-access](../components/multichannel-access)). Telegram
  webhooks hit the sidecar on `:8020`. The sidecar forwards turns to Haystack
  via `GATEWAY_URL`.
- **Both** ultimately route to the same `AminaAgent`. Adapters are kept
  separate; ops are unified.
- The legacy stub files
  [components/multichannel-access/app/channels/messenger.py](../components/multichannel-access/app/channels/messenger.py)
  and `whatsapp.py` are **NOT** used by Meta — they are 1-line placeholders.

---

## 2. The one script you run

[scripts/amina_mvp_channels.ps1](../scripts/amina_mvp_channels.ps1) — a single
PowerShell entrypoint that wraps the existing tools and never duplicates them.

```
Param                       Values                                         Default
─────────────────────────────────────────────────────────────────────────────────
-Action                     up | status | down | verify                    status
-Channels                   telegram | messenger | whatsapp | meta | all   all
-Tunnel                     none | quick | named                           none
-MetaPublicUrl              <https URL>                                    (auto)
-TelegramPublicUrl          <https URL>                                    ""
-NoRestart                  switch                                         off
-FollowLogs                 switch                                         off
-RegisterTelegramWebhook    switch (auto-runs telegram_webhook_ops.ps1)    off
-PrintManualSmoke           switch (prints DM checklist + log commands)    off
```

`meta` is shorthand for `messenger,whatsapp`. `all` is shorthand for
`telegram,messenger,whatsapp`.

**Exit codes:** `0` = MVP_READY, `1` = PARTIAL_READY, `2` = NOT_READY,
`3` = invalid params/preconditions, `4` = internal error. Useful in CI.

---

## 3. MVP definition

Each channel gets an individual classification (`LIVE_READY`, `DEMO_READY`,
`MISCONFIGURED`) plus an overall MVP classification.

### 3.1 Per-channel states

| State | Meaning |
|---|---|
| `LIVE_READY` | Real credentials present; Meta-side path is end-to-end functional. For Meta channels: `enabled=true` AND `signature_checks=true`. For Telegram: sidecar `/health.status="ok"`, bot token loaded, webhook URL registered. |
| `DEMO_READY` | Infrastructure healthy, channel intentionally inactive (no credentials yet). Handshake works. Outbound is suppressed. **Acceptable for WhatsApp by design** — see §3.3. |
| `MISCONFIGURED` | Access token present but `APP_SECRET` missing → signature checks bypassed → spoofable. **Never acceptable**, even in a demo. |

### 3.2 Overall MVP_READY

The script reports **MVP_READY** when **all** selected channels are acceptable
for their channel-specific rule:

| Channel | What must be true for MVP_READY |
|---|---|
| Messenger | Channel state == `LIVE_READY` |
| Telegram | Channel state == `LIVE_READY` |
| **WhatsApp** | Channel state == `LIVE_READY` **OR** `DEMO_READY` (credentials NOT required) |

### 3.3 Why WhatsApp is special

WhatsApp's developer onboarding is more involved than Messenger's: temporary
tokens expire every 24 hours, test recipients are restricted until business
verification, and the production path requires app review. To avoid making the
MVP block on a multi-day Meta verification process, the runbook explicitly
treats `whatsapp: DEMO_READY` as acceptable. The script surfaces that state as
a *note* (informational), not a *blocking reason*.

**Caveat:** when you do go live, `whatsapp: MISCONFIGURED` (token set, no
`APP_SECRET`) is still a hard fail — never run with real users in that state.

### 3.4 Other classifications

- `PARTIAL_READY` = at least one channel acceptable, at least one not.
- `NOT_READY` = no selected channel is acceptable, or no channel selected.

The classification is mechanical, deterministic, and prints both blocking
reasons and informational notes.

---

## 4. One-command flows

### 4.0 The MVP startup command (start here)

```powershell
.\scripts\amina_mvp_channels.ps1 -Action up -Channels all -Tunnel quick -RegisterTelegramWebhook -PrintManualSmoke
```

This single command:

1. Recreates `haystack-chatqna` with the Meta channels overlay.
2. Recreates `multichannel-access` (Telegram sidecar) with its quick-tunnel sidecar.
3. Starts a host-side cloudflared quick tunnel on `:8000` (Haystack), captures the public URL.
4. Reads the `amina-cf-quick-tunnel` container logs, captures the Telegram public URL.
5. **Auto-registers** the Telegram webhook against the captured URL via
   `telegram_webhook_ops.ps1 -SetWebhook -Verify` (because of `-RegisterTelegramWebhook`).
6. Prints **all four operator URLs** in one block, ready to paste:
   ```
   Messenger          : <META_URL>/api/v1/meta/webhook/messenger
   WhatsApp / Twilio  : <META_URL>/api/v1/twilio/whatsapp/webhook
   WhatsApp / Meta    : <META_URL>/api/v1/meta/webhook/whatsapp     (fallback when Meta API surfaces)
   Telegram           : <TG_URL>/telegram/webhook
   Verify token (Meta): amina_health_2026
   ```
7. Prints the **next commands** block (the verify command pre-filled with both URLs).
8. Prints the **manual smoke checklist** (DM `hi` instructions for each channel + the docker-logs commands).

**Drop `-RegisterTelegramWebhook`** if you want the script to print the
`telegram_webhook_ops.ps1` command rather than execute it (safe one-call
mode — no external API writes without explicit consent).

**Drop `-PrintManualSmoke`** if you don't want the smoke checklist
printed.

### 4.0.1 The MVP verify command

```powershell
.\scripts\amina_mvp_channels.ps1 -Action verify -Channels all `
  -MetaPublicUrl     "https://<meta-tunnel>.trycloudflare.com" `
  -TelegramPublicUrl "https://<telegram-tunnel>.trycloudflare.com"
```

Runs the Meta readiness probe, the Telegram inspection, the unified
status, the classification, and prints the same callback URL block so
you can re-paste the URLs into Meta/Twilio/Telegram dashboards if
something looks off.

### 4.1 Day-to-day status (no side effects)

```powershell
.\scripts\amina_mvp_channels.ps1 -Action status -Channels all
```

Prints container state, Haystack `/meta/status`, multichannel-access `/health`,
Telegram webhook info (URL redacted of any token-shape strings), env-var
presence (length only, never values), and a final classification.

### 4.2 Verify a single channel before a demo

```powershell
.\scripts\amina_mvp_channels.ps1 -Action verify -Channels messenger
.\scripts\amina_mvp_channels.ps1 -Action verify -Channels telegram
```

This **delegates** to:

- [scripts/meta_stage2_readiness.ps1](../scripts/meta_stage2_readiness.ps1) for
  Meta channels (handshake + env presence + signature checks).
- [scripts/telegram_webhook_ops.ps1](../scripts/telegram_webhook_ops.ps1) for
  Telegram (sidecar health + webhook-info + verification heuristics).

It then composes the unified status + classification + an operator checklist
("DM `hi` to the Page / `@amina_care_bot`").

### 4.3 Bring everything up with quick tunnels (demo / first run)

```powershell
.\scripts\amina_mvp_channels.ps1 -Action up -Channels all -Tunnel quick
```

What happens:

1. `docker compose -f haystack-stack/docker-compose.yml -f .../docker-compose.override.yml -f .../docker-compose.meta-channels.yml up -d --force-recreate haystack-chatqna`
2. `docker compose -f components/multichannel-access/docker-compose.yml -f .../docker-compose.quick-tunnel.yml up -d`
3. Spawns a host-side `cloudflared tunnel --url http://localhost:8000` for the
   **Meta** channels (Haystack), captures the `*.trycloudflare.com` URL into
   a temp file, and prints the exact callback URLs to paste into Meta's
   dashboard.
4. Reads the **Telegram** quick-tunnel URL from the
   `amina-cf-quick-tunnel` container logs and prints the
   `telegram_webhook_ops.ps1` command to register it.

The host-side cloudflared PID is stored in
`%TEMP%\amina_meta_quick_tunnel.pid` so `-Action down` can stop just that
process without touching anything else.

### 4.4 Bring up with a Cloudflare named tunnel for Telegram

```powershell
$env:CLOUDFLARED_TUNNEL_TOKEN = "<your-token>"
.\scripts\amina_mvp_channels.ps1 -Action up -Channels telegram -Tunnel named
```

This layers
[components/multichannel-access/docker-compose.cloudflare-tunnel.yml](../components/multichannel-access/docker-compose.cloudflare-tunnel.yml)
which runs the `amina-cloudflared` sidecar against your pre-created named
tunnel. The token is read once from the host shell — never written to disk by
this script.

For **Meta** with a named tunnel: there is currently no built-in Meta
named-tunnel compose file. The script will explicitly say so and refuse to
invent one. Configure your own ingress (existing reverse proxy, Caddy, named
cloudflared on `:8000`, etc.) and re-run with `-Tunnel none`.

### 4.5 Tear down only the quick tunnels we started

```powershell
.\scripts\amina_mvp_channels.ps1 -Action down -Tunnel quick
```

- Stops the host-side `cloudflared` process by PID-file lookup.
- Stops the `cf-quick-tunnel` container via `docker compose stop`.
- **Does NOT** stop `haystack-chatqna` or `multichannel-access`.
- Prints what is still running so you can decide to tear them down by hand.

### 4.6 Refresh and follow logs

```powershell
.\scripts\amina_mvp_channels.ps1 -Action up -Channels all -NoRestart -FollowLogs
```

`-NoRestart` skips `--force-recreate` if the containers are already healthy.
`-FollowLogs` then tails `docker logs -f` after bring-up so you can watch the
next inbound webhook arrive.

---

## 5. Required environment variables

Set these in `haystack-stack/.env` (gitignored) for Meta channels and in
`components/multichannel-access/.env` (gitignored) for Telegram.

### 5.1 Messenger

| Var | Required for LIVE | Notes |
|---|---|---|
| `MESSENGER_PAGE_ACCESS_TOKEN` | yes | Meta App Dashboard → Messenger → Settings → Access Tokens |
| `MESSENGER_VERIFY_TOKEN` | yes | Any string; default `amina_health_2026` |
| `MESSENGER_APP_SECRET` | **yes (must set before real users)** | Meta App Dashboard → Settings → Basic → App Secret |

### 5.2 WhatsApp

| Var | Required for LIVE | Notes |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | yes | Meta App → WhatsApp → API Setup → Temporary Access Token |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | Same screen, the 15-digit "Phone number ID" |
| `WHATSAPP_VERIFY_TOKEN` | yes | Default `amina_health_2026` |
| `WHATSAPP_APP_SECRET` | **yes (must set before real users)** | Same App Secret as Messenger if same Meta App |

**See [§10. WhatsApp activation walkthrough](#10-whatsapp-activation-walkthrough)** for step-by-step setup.

### 5.3 Telegram

| Var | Required for LIVE | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | yes | BotFather DM. The multichannel-access sidecar reads it directly. |
| `GATEWAY_URL` | yes | `http://haystack-chatqna:8000` inside docker, set automatically by the compose file |
| `CLOUDFLARED_TUNNEL_TOKEN` | only when `-Tunnel named` | Operator-managed; never stored by this script |

### 5.4 Shared

| Var | Required | Notes |
|---|---|---|
| `META_GRAPH_VERSION` | optional | Defaults to `v19.0`. Pin if upstream forces |

The script's env-var check prints `present (len=N)` or `<unset>` — never a
value, ever.

---

## 6. Callback URLs

Once your tunnel is up at, say, `https://your-tunnel.example.com`, the URLs
that go into the respective dashboards are:

```
Messenger callback URL:
    https://your-tunnel.example.com/api/v1/meta/webhook/messenger

WhatsApp callback URL:
    https://your-tunnel.example.com/api/v1/meta/webhook/whatsapp

Telegram webhook URL (registered via the bot API, NOT pasted in a dashboard):
    https://your-telegram-tunnel.example.com/telegram/webhook
```

For Meta, both Messenger and WhatsApp use the same verify token by default
(`amina_health_2026`). They are configured separately on Meta's side because
they sit under different products.

The script can print these for you any time:

```powershell
# After -Action up with -Tunnel quick, the URLs are auto-captured.
# Or fetch them on demand:
.\scripts\meta_stage2_readiness.ps1 -PublicUrl "https://your-tunnel.example.com"
```

---

## 7. Tunnel options

| Mode | Best for | URL stability | Notes |
|---|---|---|---|
| `none` | Production behind your own reverse proxy or pre-existing ingress | as stable as your ingress | The script does no tunnel work |
| `quick` | Demos, first-time setup, tester invitations | **ephemeral** — new URL every restart | Telegram uses a containerized sidecar (`amina-cf-quick-tunnel`); Meta uses a host-side `cloudflared` process so the script can stop it cleanly |
| `named` | Stable demos, internal staging | as stable as Cloudflare's edge | Telegram is wired up; Meta needs you to bring your own ingress |

Switching modes is just re-running with a different `-Tunnel`. The script
detects already-running components and skips redundant work.

---

## 8. Common failures

| Symptom | Most likely cause | Fix |
|---|---|---|
| Real Messenger DM never reaches `/api/v1/meta/webhook/messenger` (no POST in logs) | Page subscription not active in Meta Dashboard, OR sender is not an App admin/dev/tester (Development mode) | Re-tick `messages` + `messaging_postbacks` for the Page; verify the sending FB account is on the App Roles list |
| Messenger inbound returns `403` on POST | `MESSENGER_APP_SECRET` mismatch with the value Meta is signing with | Re-paste the App Secret into `.env`; restart `haystack-chatqna`; re-run `-Action verify -Channels messenger` |
| `messenger.enabled=true` but `signature_checks=false` | Access token is set but `MESSENGER_APP_SECRET` is empty — **MISCONFIGURED**, do not use with real users | Set the App Secret; restart |
| Telegram never delivers a new update | Stale webhook URL pointing at a dead tunnel | `.\scripts\telegram_webhook_ops.ps1 -PublicUrl "<new-url>" -SetWebhook -Verify` |
| Telegram `pending_update_count` keeps growing | Webhook URL is unreachable from the public internet | Check the tunnel container; quick-tunnel URLs change on restart |
| Token present in env but outbound `send_text` fails | Wrong Page / wrong bot connected to the token | Confirm the Page ID in `https://m.me/<page-id>` matches the one Meta shows under "Generate Access Tokens"; for Telegram, send a test `getMe` |
| Meta dashboard "Verify and Save" stays orange (won't go green) | Tunnel not reachable from Meta's edge, or wrong verify token | Run `-Action verify -Channels messenger` — if local handshake passes but Meta's doesn't, re-check the URL pasted in the dashboard |
| Script reports `cloudflared CLI not found` | Not installed locally | Install from cloudflare.com; only required for Meta `-Tunnel quick` mode |

---

## 9. Security

- **Never commit tokens.** `haystack-stack/.env` and
  `components/multichannel-access/.env` are gitignored. Confirm with
  `git check-ignore haystack-stack/.env`.
- **Never paste tokens into chat / screenshots / commits.** If a token leaks,
  rotate it immediately (Meta App Dashboard → Settings → Reset App Secret;
  BotFather → `/revoke` for Telegram).
- **APP_SECRETs must be set before real users.** Without them,
  `signature_checks=false` and an attacker can spoof Meta-signed webhooks.
- **Sender PII is hashed in logs.** PSIDs and phone numbers appear as
  `sha256:<10>` only. The script's redactor strips any token-shape strings
  defensively before printing.
- **Env-var checks are length-only.** Values are never echoed, even on
  failure paths.

---

## 10. WhatsApp activation walkthrough

The WhatsApp adapter is **already wired** — the same Meta routes
(`/api/v1/meta/webhook/whatsapp` GET + POST), the same shared
`handle_meta_payload("whatsapp", ...)` pipeline, and the same Cloudflare
tunnel as Messenger. Activation is purely a credentials + dashboard exercise.

### 11.1 Prerequisites

- The Meta App you used for Messenger (or any Meta App you control).
- A Cloudflare tunnel pointing at Haystack on `:8000`. The same tunnel that
  serves Messenger works for WhatsApp — both routes live in Haystack.
- A test recipient phone number on a phone you can read SMS / WhatsApp on
  (Meta's "Add recipient" flow sends a verification code to that number).

### 11.2 Activation steps

1. **Add the WhatsApp product to your Meta App.**
   App Dashboard → "Add a Product" → find "WhatsApp" → click "Set up".
2. **Open WhatsApp → API Setup.** This page has everything you need on a
   single screen.
3. **Copy the Temporary Access Token** into `WHATSAPP_ACCESS_TOKEN` in
   `haystack-stack/.env`.
   Note: this token expires after **24 hours**. For anything longer, you
   must create a System User in Business Manager and use a permanent
   System User token (requires business verification).
4. **Copy the Phone Number ID** (15-digit number under the "From" phone
   number) into `WHATSAPP_PHONE_NUMBER_ID`. The phone number itself is
   informational; the API uses the Phone Number ID for routing.
5. **Re-use the App Secret you already set for Messenger** as
   `WHATSAPP_APP_SECRET`. If the App Secret is per-Meta-App, the same value
   applies to both channels.
6. **Set the verify token:**
   ```
   WHATSAPP_VERIFY_TOKEN=amina_health_2026
   ```
7. **Restart Haystack picking up the meta-channels override:**
   ```powershell
   .\scripts\amina_mvp_channels.ps1 -Action up -Channels whatsapp
   ```
   Or directly:
   ```bash
   docker compose -f haystack-stack/docker-compose.yml \
                  -f haystack-stack/docker-compose.override.yml \
                  -f haystack-stack/docker-compose.meta-channels.yml \
                  up -d --force-recreate haystack-chatqna
   ```
   You should see in the boot logs:
   ```
   Meta channels routes registered (whatsapp=live, messenger=live)
   ```
8. **Configure the webhook callback in Meta App Dashboard:**
   ```
   Callback URL: https://<PUBLIC_URL>/api/v1/meta/webhook/whatsapp
   Verify token: amina_health_2026
   ```
   Click **Verify and Save**. The handshake should green-tick within ~2 s.
9. **Subscribe the WhatsApp Business Account to `messages`.**
   On the Webhooks panel, tick the `messages` field. Click Save. Without
   this, Meta won't forward incoming messages to our endpoint even after
   the URL is verified.
10. **Add your test recipient phone number** in the WhatsApp → API Setup
    "To" dropdown ("Add recipient"). Meta sends a one-time verification
    code to that phone via WhatsApp; enter it in the dashboard.
11. **Send `hi`** from the test recipient phone to the "From" phone number
    listed at the top of API Setup. Watch logs:
    ```bash
    docker logs -f --tail 60 haystack-chatqna | grep -i meta_pipeline
    ```
    Expected pattern (similar to Messenger):
    ```
    POST /api/v1/meta/webhook/whatsapp HTTP/1.1 200 OK
    meta_pipeline handled channel=whatsapp sender=sha256:<hash>
                    msg_id_present=True in_chars=2 out_chars=<n> sent=True
    ```

### 11.3 Verify

```powershell
.\scripts\amina_mvp_channels.ps1 -Action verify -Channels whatsapp
```

Expected:

```
WhatsApp  enabled=True  signature_checks=True  [LIVE_READY]
...
WHATSAPP_ACCESS_TOKEN            present (len=...)
WHATSAPP_PHONE_NUMBER_ID         present (len=...)
WHATSAPP_VERIFY_TOKEN            present (len=17)
WHATSAPP_APP_SECRET              present (len=32)
META_GRAPH_VERSION               present (len=5)
...
[PASS] /api/v1/meta/webhook/whatsapp  -> 200 + exact challenge echo
[PASS] WhatsApp: LIVE_READY  (enabled=true, signature_checks=true)
```

### 11.4 Development-mode constraints (real)

These will bite you the first time you try to scale up — surface them now so
you don't hit them in a demo:

| Constraint | Detail |
|---|---|
| **Temporary token expires every 24 h** | API Setup tokens are dev-only. To send messages without daily token rotation, create a System User token in Business Manager. That requires business verification. |
| **Test recipients are restricted** | In dev mode, you can send WhatsApp messages only to the recipients you have explicitly added + verified in API Setup → "To". Up to 5 test recipients. Random users cannot receive your messages. |
| **From-number is a Meta test number, not yours** | Until you add and verify your own business number (with two-factor + display name approval), you send from a Meta-pool number. Customers see this number, not yours. |
| **App Review required for production** | Permissions like `whatsapp_business_messaging` require App Review before you can message arbitrary users. Submission requires a privacy policy URL + terms URL + a recorded demo video. |
| **Conversation pricing** | WhatsApp charges per conversation (varies by country and category). Meta gives you a free tier of "service conversations" but template/marketing conversations are billed. Cost is on Meta's invoice, not yours. |

### 11.5 If WhatsApp DEMO_READY is good enough for now

The script accepts `whatsapp: DEMO_READY` as MVP-acceptable (see §3.3). If you
want to:

- ship Messenger LIVE,
- keep WhatsApp routes mounted and webhook handshake-able,
- but defer real WhatsApp credentials until your business verification clears

…that is supported as a first-class state. The status output will say:

```
WhatsApp  enabled=False  signature_checks=False  [DEMO_READY]
[INFO]   WhatsApp is DEMO_READY -- credentials absent...

[PASS] MVP_READY      every selected channel is acceptable...
  Notes:
    - whatsapp: DEMO_READY (credentials absent - channel inactive but infra
      healthy; acceptable per MVP rules)
```

You can re-run `-Action verify -Channels whatsapp` later, after the creds
land, without restarting anything else.

---

## 10.5 AMINA LoRA — temporarily disabled (maintenance)

**Current state:** the AMINA LoRA fine-tuned model is offline. Its
cloudflared tunnel (`roads-converter-fragrance-tract.trycloudflare.com`)
isn't reachable, and waiting for it to time out adds 10–15 seconds to
every reply on every channel before the fallback chain fires.

To stop bleeding latency, LoRA is **disabled at every layer**:

| Layer | Change | Source |
|---|---|---|
| Backend default | `USE_FINETUNED_MODEL=false` (hardcoded in `docker-compose.override.yml`) | server-wide default model is no longer LoRA |
| Fallback chain | `LLM_FALLBACK_CHAIN=mistral,groq,gemini,base` | LoRA removed from chain entirely |
| Twilio WhatsApp | `TWILIO_AGENT_MODEL_PREFERENCE=mistral` | Twilio explicitly prefers Mistral |
| Frontend (web chat) | "AMINA LoRA" option is **disabled with maintenance tooltip** in App.jsx, CaregiverPortal.jsx, BeginnerChat.jsx | clicking it shows "AMINA LoRA is disabled for maintenance…" |
| Cached preference migration | If `localStorage.AMINA_MODEL_PREF === "amina"` it's silently re-mapped to `"mistral"` on mount | users with a cached LoRA preference don't get stuck waiting on dead endpoint |

### 10.5.1 What channels use now

| Channel | Effective model |
|---|---|
| Web chat (App.jsx, CaregiverPortal.jsx) | whatever the user picks (default `mistral`); LoRA option visible but disabled |
| BeginnerChat | default `mistral`; LoRA option disabled |
| Messenger / Meta WhatsApp | server default → currently OpenAI gpt-4o (the "base" client) |
| Twilio WhatsApp | Mistral (env-pinned via `TWILIO_AGENT_MODEL_PREFERENCE=mistral`) |
| Telegram (multichannel-access) | server default → currently OpenAI gpt-4o |

If `MISTRAL_API_KEY` is set in `.env`, the `mistral` client activates
and Mistral actually answers; otherwise calls fall through the chain
silently.

### 10.5.2 Optional: provide a Mistral key

Add to `haystack-stack/.env`:
```
MISTRAL_API_KEY=<your key from https://console.mistral.ai/>
MISTRAL_MODEL=open-mistral-7b
```
Then restart Haystack:
```powershell
docker compose -f haystack-stack\docker-compose.yml `
  -f haystack-stack\docker-compose.override.yml `
  -f haystack-stack\docker-compose.meta-channels.yml `
  up -d --force-recreate --no-deps haystack-chatqna
```
The boot log will show `Mistral client ready: open-mistral-7b`.

### 10.5.3 Re-enabling LoRA when the endpoint is back

1. Bring the LoRA tunnel back up on the host that runs the
   fine-tuned model.
2. Edit `haystack-stack/docker-compose.override.yml`:
   - `USE_FINETUNED_MODEL: "true"`
   - `LLM_FALLBACK_CHAIN: "amina-lora,mistral,groq,gemini,base"`
   - `TWILIO_AGENT_MODEL_PREFERENCE: ${TWILIO_AGENT_MODEL_PREFERENCE:-amina-lora}` (back to default)
3. Edit the three frontend files to remove `disabled: true` /
   `disabledReason` from the LoRA option:
   - `components/frontend/src/App.jsx` line ~3649
   - `components/frontend/src/CaregiverPortal.jsx` line ~4005
   - `components/frontend/src/BeginnerChat.jsx` line ~55
4. Recreate haystack-chatqna; rebuild frontend.
5. Verify boot log shows `AMINA v2 client ready` and `Default: AMINA v2 fine-tuned model`.

### 10.5.4 If you want Messenger / Telegram to use Mistral specifically (not server-default)

Currently those channels use whatever the agent's `_default_pref()`
returns (now OpenAI gpt-4o). If you want them pinned to Mistral the
way Twilio is, two paths:

- **Cleanest, no edits**: set `LLM_FALLBACK_CHAIN: "mistral,base,groq,gemini"` so Mistral is tried first when the default fails. Works only when MISTRAL_API_KEY is set.
- **Per-channel pin (small edit)**: mirror Twilio's pattern — add `MESSENGER_AGENT_MODEL_PREFERENCE=mistral` env + a one-line read in `meta_bridge.py`. Ask if you want this; it's a 3-line additive change to a runtime file.

---

## 11. WhatsApp via Twilio Sandbox (MVP fallback)

When Meta WhatsApp Cloud API is **not yet available** in your Meta dashboard
(e.g. fresh App without Business Portfolio activation, or region without
WhatsApp Cloud API surfaced yet), AMINA ships a parallel **Twilio WhatsApp
Sandbox** adapter so you can stand up a working WhatsApp channel for
demos in under 5 minutes.

This adapter is **additive**: it does not remove or modify the Meta
WhatsApp routes. The moment Meta WhatsApp becomes available, you keep
both adapters wired and switch traffic by changing which webhook URL the
WhatsApp client posts to.

### 11.1 What this is and is not

| | Twilio Sandbox (this section) | Meta WhatsApp Cloud API ([§10](#10-whatsapp-activation-walkthrough)) |
|---|---|---|
| Setup time | ~5 min, no business verification | hours-to-days incl. business verification |
| Sender phone | Twilio's pool sandbox number | Your own (verified) business number |
| Recipients | Anyone who joins your sandbox via code | Test recipients in dev mode; anyone after App Review |
| Outbound delivery | TwiML reply (Twilio sends for us) | Graph API call (we send) |
| Signature validation | Optional (`X-Twilio-Signature`, HMAC-SHA1) | Required (`X-Hub-Signature-256`, HMAC-SHA256) |
| Cost | Twilio per-message + free conversations | Meta conversation pricing |
| Production readiness | OK for demos / pilots; for production switch to Twilio WhatsApp Self Sign-up or Meta direct | Production target |

### 11.2 Route surface

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/twilio/whatsapp/webhook` | Inbound from Twilio (form-urlencoded) → returns TwiML |
| `GET`  | `/api/v1/twilio/whatsapp/health` | Liveness probe (no secrets in response) |

The route is implemented in
[src/api/twilio_whatsapp_routes.py](../haystack-stack/haystack-chatqna/src/api/twilio_whatsapp_routes.py)
and mounted by `main_with_rag_tuning.py` via the same additive try/except
pattern as the Meta routes.

### 11.3 Activation steps (sandbox)

1. **Create / sign in to a Twilio account** at https://www.twilio.com/console.
   Free trial gets you a few dollars of credit — enough for testing.
2. **Open the WhatsApp Sandbox.**
   Console → Messaging → **Try it out** → **Send a WhatsApp message**.
   Or directly: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn
3. **Note the sandbox number and join code.** Twilio shows something like:
   ```
   Send "join <two-words>" from your WhatsApp to +1 415 523 8886
   ```
   That's the Twilio sandbox number you (and any tester) will WhatsApp.
4. **From your own WhatsApp**, send the join phrase to the sandbox number.
   Twilio replies confirming you're in. **Each tester must do this** to
   receive AMINA replies.
5. **Configure the inbound webhook.** On the same sandbox page, find
   **"When a message comes in"** → set to:
   ```
   https://<PUBLIC_URL>/api/v1/twilio/whatsapp/webhook
   ```
   Method: **HTTP POST**. Click Save.

   `<PUBLIC_URL>` is whatever Cloudflare quick-tunnel / named tunnel /
   ingress fronts your `localhost:8000`. The same tunnel that serves
   Messenger works for Twilio (both routes live in Haystack on `:8000`).

6. **Send "hi" from your WhatsApp** to the sandbox number. Within ~2 s you
   should see AMINA's reply in WhatsApp. Watch logs:
   ```bash
   docker logs -f --tail 60 haystack-chatqna | grep -i twilio_whatsapp
   ```
   Expected pattern:
   ```
   POST /api/v1/twilio/whatsapp/webhook  HTTP/1.1  200 OK
   twilio_whatsapp handled sender=sha256:<hash> msg_id_present=True
                   in_chars=<n> out_chars=<m>
   ```

### 11.4 Test scenarios

After joining the sandbox, send these from your WhatsApp:

| Send | Expect |
|---|---|
| `hi` | conversational greeting reply |
| `my sugar is high` | clinical engagement: clarifying questions, no medication advice without confirmation |
| `my BP is 180/120` | emergency surface (call 116 / nearest facility); `triage_level=EMERGENCY` |
| any image / voice / file (no caption) | canned reply: "I can only read text messages right now. Please type your question and I'll help." |
| caption + image | same canned reply (media path, ignores caption for MVP) |

The Twilio sandbox may also rate-limit pings — keep tests at a sensible
cadence, especially during free-trial.

### 11.5 Required env vars

| Var | Required | Notes |
|---|---|---|
| `TWILIO_AUTH_TOKEN` | optional in sandbox; **required for production signature checks** | Console → Account → Auth Token. Never commit. |
| `TWILIO_VALIDATE_SIGNATURE` | default `false` | Flip to `true` before any real-user traffic. Without it, anyone who knows the URL can POST as if they were Twilio. |

The script reports both via length-only env presence checks
(see `Show-EnvCheck` in
[scripts/amina_mvp_channels.ps1](../scripts/amina_mvp_channels.ps1)).

### 11.6 Verify

```powershell
.\scripts\amina_mvp_channels.ps1 -Action status -Channels whatsapp
```

Expected when sandbox is wired but Meta WhatsApp is not yet:

```
3c. Twilio WhatsApp Sandbox (fallback adapter)
[PASS] Twilio WhatsApp route mounted: channel=twilio_whatsapp
[INFO] signature_validation : False
[INFO] auth_token_present   : True
[INFO]   Sandbox mode: signature validation OFF (acceptable for sandbox MVP; turn ON before production).

Final classification
[PASS] MVP_READY      every selected channel is acceptable (LIVE_READY, or DEMO_READY where allowed).
  Notes:
    - whatsapp: LIVE via Twilio Sandbox (Meta WhatsApp DEMO_READY -- using fallback adapter)
```

### 11.7 Manual smoke from the command line (no real WhatsApp needed)

```bash
curl -i -X POST http://localhost:8000/api/v1/twilio/whatsapp/webhook \
     -H "Content-Type: application/x-www-form-urlencoded" \
     --data-urlencode "From=whatsapp:+2207700001234" \
     --data-urlencode "To=whatsapp:+14155238886" \
     --data-urlencode "Body=hi" \
     --data-urlencode "MessageSid=SMTEST" \
     --data-urlencode "ProfileName=Tester" \
     --data-urlencode "NumMedia=0"
```

Expected: HTTP 200, `Content-Type: application/xml`, body:

```xml
<?xml version="1.0" encoding="UTF-8"?><Response><Message>...AMINA reply...</Message></Response>
```

### 11.8 Security — sandbox vs production

| Concern | Sandbox MVP | Production |
|---|---|---|
| `X-Twilio-Signature` validation | optional; default OFF | **REQUIRED**. Set `TWILIO_VALIDATE_SIGNATURE=true` and `TWILIO_AUTH_TOKEN=<value>` |
| Webhook URL secrecy | low (just a URL) | URL alone is not enough — signature gates spoofers |
| Auth token rotation | on demand | rotate quarterly, after any leak |
| Phone-number leakage in logs | hashed to `sha256[:10]` already | same |
| Reply length cap | 1500 chars (set in `MAX_REPLY_CHARS`) | same |
| Failure mode | always 200 + TwiML fallback (Twilio retries on 5xx) | same |

### 11.9 Production path — Twilio WhatsApp Self Sign-up

Sandbox is enough for an MVP, but for real users you want:

1. **Twilio WhatsApp Self Sign-up**:
   https://www.twilio.com/docs/whatsapp/self-sign-up
   - Submit a Facebook Business Manager profile.
   - Choose / verify a phone number.
   - Pick a display name (Meta approves it).
   - This gives you a non-sandbox WhatsApp sender that any user can DM
     without joining via a sandbox code.
2. Replace the sandbox number webhook with your sender number's webhook
   in Twilio Console → Phone Numbers → your WhatsApp number.
3. Flip `TWILIO_VALIDATE_SIGNATURE=true` and set `TWILIO_AUTH_TOKEN`.
4. Restart Haystack picking up the new env:
   ```powershell
   .\scripts\amina_mvp_channels.ps1 -Action up -Channels whatsapp
   .\scripts\amina_mvp_channels.ps1 -Action verify -Channels whatsapp
   ```

If/when Meta WhatsApp Cloud API becomes available in your dashboard, you
can switch to Meta-direct (lower per-message markup at scale) by setting
the Meta env vars and pointing your WhatsApp number's webhook there
instead. The Twilio adapter remains in place — both adapters can coexist.

---

## 12. Production: one public host + path routing

The MVP uses **two separate Cloudflare quick tunnels** — one to
`haystack-chatqna:8000` for Meta + Twilio routes, one to
`multichannel-access:8020` for Telegram. That works, but the URLs are
ephemeral and operators have to paste two different hostnames into
three dashboards. For production, fold both behind **one public host**
with path-based routing.

### 12.1 Routing table

```
https://amina.your-domain.com/
    │
    ├── /api/v1/meta/*       ──►  haystack-chatqna:8000   (Messenger + Meta WhatsApp)
    ├── /api/v1/twilio/*     ──►  haystack-chatqna:8000   (Twilio WhatsApp)
    └── /telegram/*          ──►  multichannel-access:8020 (Telegram)
```

The ingress can be:

- **Cloudflare named tunnel** with multiple `ingress` rules (recommended;
  free and persistent).
- **Caddy / nginx / Traefik** in front of both containers.
- **Any reverse proxy** that supports path prefixes.

### 12.2 Cloudflare named tunnel example

One-time setup on the host:

```bash
cloudflared login
cloudflared tunnel create amina-prod
cloudflared tunnel route dns amina-prod amina.your-domain.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: <UUID-from-create-output>
credentials-file: /root/.cloudflared/<UUID>.json

ingress:
  # Meta channels (Messenger + WhatsApp Cloud API webhooks)
  - hostname: amina.your-domain.com
    path: /api/v1/meta/*
    service: http://haystack-chatqna:8000
    originRequest:
      noTLSVerify: true

  # Twilio WhatsApp inbound webhook
  - hostname: amina.your-domain.com
    path: /api/v1/twilio/*
    service: http://haystack-chatqna:8000
    originRequest:
      noTLSVerify: true

  # Telegram webhook (multichannel-access sidecar)
  - hostname: amina.your-domain.com
    path: /telegram/*
    service: http://multichannel-access:8020
    originRequest:
      noTLSVerify: true

  # Catch-all required by cloudflared
  - service: http_status:404
```

Then:

```bash
cloudflared tunnel run amina-prod
```

Or run it as a sidecar in the docker network — see
[components/multichannel-access/docker-compose.cloudflare-tunnel.yml](../components/multichannel-access/docker-compose.cloudflare-tunnel.yml)
for the existing pattern (currently scoped to multichannel-access only;
the same shape extends to Haystack with the routing rules above).

### 12.3 Updated dashboard URLs

Once routing is in place, replace the per-channel quick-tunnel URLs in
each dashboard:

| Channel | Production URL |
|---|---|
| Messenger callback | `https://amina.your-domain.com/api/v1/meta/webhook/messenger` |
| Meta WhatsApp callback | `https://amina.your-domain.com/api/v1/meta/webhook/whatsapp` |
| Twilio sandbox "When a message comes in" | `https://amina.your-domain.com/api/v1/twilio/whatsapp/webhook` |
| Telegram setWebhook | `https://amina.your-domain.com/telegram/webhook` |

### 12.4 Why one host matters

- **Stable URL across restarts.** Quick tunnels rotate hostnames — every
  rotation forces re-pasting the URL into three dashboards.
- **Uniform TLS / cert management.** One ACME-managed cert from
  Cloudflare (or your own CA), not three.
- **Logs / metrics / WAF rules** sit on one ingress edge instead of two.
- **Demo continuity.** Clients can bookmark a single domain.

The MVP control script (`amina_mvp_channels.ps1`) doesn't manage the
named tunnel directly — that's a one-time operator setup. Once the
named tunnel is live, run the script with `-Tunnel none` and pass
`-MetaPublicUrl https://amina.your-domain.com` and
`-TelegramPublicUrl https://amina.your-domain.com`. The unified
verify+status flow works the same.

---

## 13. What this runbook does NOT do

- It does **not** modify `AminaAgent`, RAG, STT/TTS, policy review, the
  basic/beginner router, or the Meta bridge. The runtime code is untouched.
- It does **not** invent named-tunnel tokens for Meta. If you need a stable
  Meta URL, configure your own ingress.
- It does **not** start arbitrary Cloudflare tunnels — only the two specific
  use cases documented above (Meta host-side process, Telegram containerized
  sidecar).
- It does **not** stop `haystack-chatqna` or `multichannel-access` on
  `-Action down`. Tearing those down is a deliberate operator action.
- It does **not** send real DMs automatically. The closest it gets is a
  signed synthetic POST to `/api/v1/meta/webhook/messenger`, which proves the
  internal path without involving Meta delivery (covered in
  [META_STAGE2_READINESS.md](META_STAGE2_READINESS.md)).

---

## Appendix A — File map

### New file in this MVP

| Path | Role |
|---|---|
| [scripts/amina_mvp_channels.ps1](../scripts/amina_mvp_channels.ps1) | One PowerShell control plane — wraps everything below |
| [docs/MVP_MULTICHANNEL_RUNBOOK.md](MVP_MULTICHANNEL_RUNBOOK.md) | This document |

### Existing tools the script wraps (unchanged)

| Path | Role |
|---|---|
| [scripts/meta_stage2_readiness.ps1](../scripts/meta_stage2_readiness.ps1) | Meta channels readiness probe |
| [scripts/telegram_webhook_ops.ps1](../scripts/telegram_webhook_ops.ps1) | Telegram webhook manage / verify |
| [scripts/setup_meta_channels.py](../scripts/setup_meta_channels.py) | Interactive Meta credentials wizard (orthogonal — call directly when needed) |

### Compose files the script orchestrates (unchanged)

| Path | Role |
|---|---|
| [haystack-stack/docker-compose.yml](../haystack-stack/docker-compose.yml) | Haystack base |
| [haystack-stack/docker-compose.override.yml](../haystack-stack/docker-compose.override.yml) | Haystack feature mounts (Evidence Layer, Agent Platform v1, Meta routes mount) |
| [haystack-stack/docker-compose.meta-channels.yml](../haystack-stack/docker-compose.meta-channels.yml) | Meta env passthroughs |
| [components/multichannel-access/docker-compose.yml](../components/multichannel-access/docker-compose.yml) | Telegram sidecar base |
| [components/multichannel-access/docker-compose.quick-tunnel.yml](../components/multichannel-access/docker-compose.quick-tunnel.yml) | Telegram quick tunnel sidecar |
| [components/multichannel-access/docker-compose.cloudflare-tunnel.yml](../components/multichannel-access/docker-compose.cloudflare-tunnel.yml) | Telegram named tunnel sidecar |

### Runtime code the script never touches

| Path | Why hands-off |
|---|---|
| [haystack-stack/haystack-chatqna/src/api/meta_routes.py](../haystack-stack/haystack-chatqna/src/api/meta_routes.py) | Meta webhook routes — proven E2E |
| [haystack-stack/haystack-chatqna/src/services/meta_bridge.py](../haystack-stack/haystack-chatqna/src/services/meta_bridge.py) | Meta adapters + shared pipeline |
| `components/multichannel-access/app/**` | Telegram bot runtime |
| `haystack-stack/haystack-chatqna/src/agent/amina_agent.py` | Canonical AminaAgent |
| `haystack-stack/haystack-chatqna/src/services/{rag_*,stt_*,policy_*,basic_beginner_*,...}` | Clinical safety stack |

---

## Appendix B — When you're done

```powershell
# Stop only the tunnels you started.
.\scripts\amina_mvp_channels.ps1 -Action down -Tunnel quick

# Then if you want to fully tear down (you almost never need this):
docker compose -f components/multichannel-access/docker-compose.yml down
docker compose -f haystack-stack/docker-compose.yml \
               -f haystack-stack/docker-compose.override.yml down
```

Quick-tunnel URLs are temporary by design — every restart of the tunnel gets
a fresh `*.trycloudflare.com` hostname, which means you must re-paste it into
the Meta dashboard. For demos lasting more than a few hours, switch to a
Cloudflare named tunnel for Telegram and your own stable ingress for Meta.
