<#
.SYNOPSIS
    AMINA Care -- Telegram webhook operational helper.

.DESCRIPTION
    Health-checks the multichannel-access sidecar, inspects the currently
    registered Telegram webhook, optionally registers a new public URL,
    and emits hint commands for common public-tunnel tools.

    Designed to recover from the most common failure mode: a stale ngrok
    URL still registered with Telegram while the local /telegram/webhook
    endpoint is healthy. This script never touches the Telegram message-
    handling code, never prints the bot token, and never starts a tunnel
    on its own.

.PARAMETER PublicUrl
    Public HTTPS base URL that maps to http://localhost:8020. Trailing
    slash is normalized away. The script appends "/telegram/webhook"
    automatically when registering.

.PARAMETER ServiceUrl
    URL of the local multichannel-access service. Default
    "http://localhost:8020".

.PARAMETER SetWebhook
    Register the webhook at "$PublicUrl/telegram/webhook" via the
    sidecar's POST /telegram/set-webhook endpoint. Requires -PublicUrl.

.PARAMETER Verify
    After every action, fetch /telegram/webhook-info and validate
    common failure signals (empty URL, ngrok hostname, missing
    callback_query subscription, large pending update count, recent
    last_error_date / last_error_message).

.PARAMETER OpenTunnelHint
    Print the exact commands to open a temporary or persistent public
    tunnel with ngrok or cloudflared. Does NOT start anything.

.EXAMPLE
    # Read-only inspection (default action when no switches given).
    .\scripts\telegram_webhook_ops.ps1

.EXAMPLE
    # Register a fresh ngrok URL and verify it took.
    .\scripts\telegram_webhook_ops.ps1 -PublicUrl "https://ab12-cd34.ngrok-free.app" -SetWebhook -Verify

.EXAMPLE
    # Just print tunnel commands and current state.
    .\scripts\telegram_webhook_ops.ps1 -OpenTunnelHint -Verify

.NOTES
    Exit codes:
      0  success
      1  local sidecar unhealthy
      2  webhook set failed (Telegram returned ok=false)
      3  webhook URL mismatch after set (Telegram registered something else)
      4  invalid parameter combination
    Never prints TELEGRAM_BOT_TOKEN. The local sidecar endpoints don't
    return the token; we defensively redact any field that looks like one.
#>
[CmdletBinding()]
param(
    [string]$PublicUrl,
    [string]$ServiceUrl    = "http://localhost:8020",
    [switch]$SetWebhook,
    [switch]$Verify,
    [switch]$OpenTunnelHint
)

$ErrorActionPreference = "Stop"

# -- Color helpers ----------------------------------------------------
function Write-Info ([string]$msg) { Write-Host "[..] $msg" -ForegroundColor Cyan }
function Write-Ok   ([string]$msg) { Write-Host "[ok] $msg" -ForegroundColor Green }
function Write-Warn ([string]$msg) { Write-Host "[!!] $msg" -ForegroundColor Yellow }
function Write-Err  ([string]$msg) { Write-Host "[xx] $msg" -ForegroundColor Red }
function Write-Sect ([string]$msg) {
    Write-Host ""
    Write-Host ("== $msg ".PadRight(64, "=")) -ForegroundColor White
}

# Defensive redaction -- should never trigger because the local
# sidecar API doesn't return tokens, but keeps us safe if upstream
# behaviour changes later.
function _Redact ([string]$s) {
    if ($null -eq $s) { return "" }
    # Telegram bot tokens look like "<digits>:<35+ url-safe chars>"
    return [regex]::Replace($s, '\b\d{6,}:[A-Za-z0-9_-]{30,}\b', '<TOKEN-REDACTED>')
}

# -- Param validation -------------------------------------------------
if ($SetWebhook -and -not $PublicUrl) {
    Write-Err "-SetWebhook requires -PublicUrl <https://...>."
    exit 4
}
if ($PublicUrl) {
    $PublicUrl = $PublicUrl.TrimEnd("/")
    if ($PublicUrl -notmatch '^https://') {
        Write-Err "-PublicUrl must start with https:// (Telegram refuses plain http)."
        exit 4
    }
}
$ServiceUrl = $ServiceUrl.TrimEnd("/")

# -- 1. Local sidecar health -----------------------------------------
Write-Sect "Local sidecar health"
try {
    $health = Invoke-RestMethod -Uri "$ServiceUrl/health" -TimeoutSec 5 -ErrorAction Stop
    Write-Ok "GET $ServiceUrl/health"
    Write-Host "    status   : $($health.status)"
    Write-Host "    haystack : $($health.haystack)"
    Write-Host "    redis    : $($health.redis)"
    Write-Host "    telegram : $($health.telegram)  (true = TELEGRAM_BOT_TOKEN env is set)"
    if ($health.status -ne "ok") {
        Write-Err "Sidecar reports degraded status. Fix Haystack/Redis before continuing."
        exit 1
    }
    if (-not $health.telegram) {
        Write-Err "TELEGRAM_BOT_TOKEN is NOT set inside the multichannel-access container."
        Write-Err "Set it via .env / docker-compose and recreate the container."
        exit 1
    }
} catch {
    Write-Err "Could not reach $ServiceUrl/health -- is multichannel-access running?"
    Write-Err "  $($_.Exception.Message)"
    exit 1
}

# -- 2. Current webhook info -----------------------------------------
function Get-WebhookInfo {
    try {
        $r = Invoke-RestMethod -Uri "$ServiceUrl/telegram/webhook-info" -TimeoutSec 8 -ErrorAction Stop
        return $r
    } catch {
        Write-Err "Could not fetch webhook-info: $($_.Exception.Message)"
        return $null
    }
}

function Show-WebhookInfo ($info) {
    if (-not $info) { return }
    if ($info.error) {
        Write-Warn "Server reported: $($info.error)"
        return
    }
    if (-not $info.ok) {
        Write-Warn ("Telegram getWebhookInfo did not return ok=true: " + (_Redact ($info | ConvertTo-Json -Depth 4)))
        return
    }
    $r = $info.result
    if ([string]::IsNullOrWhiteSpace($r.url)) {
        $url = "<NONE>"
    } else {
        $url = _Redact $r.url
    }
    Write-Host "    url                    : $url"
    Write-Host "    pending_update_count   : $($r.pending_update_count)"
    if ($r.allowed_updates) {
        Write-Host "    allowed_updates        : $($r.allowed_updates -join ', ')"
    } else {
        Write-Host "    allowed_updates        : <empty -- receiving all default types>"
    }
    if ($r.last_error_date) {
        $epoch = [int64]$r.last_error_date
        $when  = ([System.DateTimeOffset]::FromUnixTimeSeconds($epoch)).LocalDateTime
        Write-Host "    last_error_date        : $when"
    }
    if ($r.last_error_message) {
        Write-Host "    last_error_message     : $(_Redact $r.last_error_message)"
    }
    if ($r.max_connections) {
        Write-Host "    max_connections        : $($r.max_connections)"
    }
    if ($r.ip_address) {
        Write-Host "    ip_address             : $($r.ip_address)"
    }
}

Write-Sect "Current Telegram webhook"
$before = Get-WebhookInfo
Show-WebhookInfo $before

# -- 3. Optional: register new webhook -------------------------------
$registered = $false
$after      = $null
if ($SetWebhook) {
    Write-Sect "Registering new webhook"
    $target = "$PublicUrl/telegram/webhook"
    Write-Info "Setting webhook -> $target"
    try {
        $body = @{ url = $target } | ConvertTo-Json -Compress
        $resp = Invoke-RestMethod -Uri "$ServiceUrl/telegram/set-webhook" `
                                  -Method Post `
                                  -ContentType "application/json" `
                                  -Body $body `
                                  -TimeoutSec 12 `
                                  -ErrorAction Stop
        if (-not $resp.ok) {
            Write-Err "Telegram refused the webhook: $(_Redact ($resp | ConvertTo-Json -Depth 4))"
            exit 2
        }
        Write-Ok "Telegram accepted the webhook (ok=true, description='$($resp.description)')"
        $registered = $true
    } catch {
        Write-Err "set-webhook call failed: $($_.Exception.Message)"
        exit 2
    }

    # Re-fetch and verify
    Write-Info "Re-checking webhook-info to confirm Telegram persisted the new URL..."
    $after = Get-WebhookInfo
    Show-WebhookInfo $after
    if (-not $after -or -not $after.ok) {
        Write-Err "Could not verify the new webhook."
        exit 3
    }
    $newUrl = $after.result.url
    if ($newUrl -ne $target) {
        Write-Err "URL mismatch -- Telegram registered '$newUrl' but we asked for '$target'."
        exit 3
    }
    Write-Ok "Webhook persisted at $target"
}

# -- 4. Verification (warnings only -- does not exit non-zero) -------
if ($Verify) {
    Write-Sect "Verification"
    if ($registered) { $info = $after } else { $info = $before }
    if (-not $info -or -not $info.ok) {
        Write-Warn "No usable webhook-info to verify."
    } else {
        $r = $info.result
        $issues = 0

        if ([string]::IsNullOrWhiteSpace($r.url)) {
            Write-Warn "No webhook URL is registered -- Telegram cannot deliver messages."
            $issues++
        }

        if ($r.url -and ($r.url -match 'ngrok-free\.app|ngrok\.io')) {
            Write-Warn "Webhook is pointed at an ngrok tunnel -- these are ephemeral. The URL changes every time you restart 'ngrok http 8020' on the free tier; consider a Cloudflare named tunnel for persistence."
            $issues++
        }

        if ($r.allowed_updates) {
            if ($r.allowed_updates -notcontains 'callback_query') {
                Write-Warn "allowed_updates is missing 'callback_query' -- inline feedback buttons (up/down vote) won't fire. Re-register with this script (which subscribes to message + callback_query)."
                $issues++
            }
        } else {
            Write-Info "allowed_updates is unset on the Telegram side -- bot receives the default set (which DOES include message + callback_query)."
        }

        if ([int]($r.pending_update_count) -gt 50) {
            Write-Warn "pending_update_count = $($r.pending_update_count) -- the webhook is backlogged. If the URL is healthy, Telegram will drain it shortly. If you see this growing, the webhook URL is probably unreachable."
            $issues++
        }

        if ($r.last_error_message) {
            $errEpoch = [int64]$r.last_error_date
            $errWhen  = ([System.DateTimeOffset]::FromUnixTimeSeconds($errEpoch)).LocalDateTime
            Write-Warn "Telegram last reported an error: '$(_Redact $r.last_error_message)' at $errWhen"
            $issues++
        }

        if ($issues -eq 0) {
            Write-Ok "No issues detected -- Telegram should be delivering to the registered webhook."
        } else {
            Write-Warn "$issues issue(s) flagged. Review the warnings above."
        }
    }
}

# -- 5. Tunnel-open hints --------------------------------------------
if ($OpenTunnelHint) {
    Write-Sect "Public tunnel -- copy/paste examples (this script does NOT start them)"
    Write-Host ""
    Write-Host "  # Option A -- ngrok (free tier, ephemeral URL each start):"
    Write-Host "  ngrok http 8020"
    Write-Host ""
    Write-Host "  # Option B -- cloudflared quick tunnel (free, ephemeral name):"
    Write-Host "  cloudflared tunnel --url http://localhost:8020"
    Write-Host ""
    Write-Host "  # Option C -- cloudflared NAMED tunnel (persistent, recommended for prod):"
    Write-Host "  #    1. cloudflared login"
    Write-Host "  #    2. cloudflared tunnel create amina-telegram"
    Write-Host "  #    3. add the tunnel UUID + hostname to ~/.cloudflared/config.yml"
    Write-Host "  #    4. cloudflared tunnel route dns amina-telegram telegram.yourdomain.com"
    Write-Host "  #    5. cloudflared tunnel run amina-telegram"
    Write-Host ""
    Write-Host "  # Or, run the cloudflared sidecar via the bundled compose override"
    Write-Host "  # (env-driven, opt-in):"
    Write-Host ""
    Write-Host '  #   $env:CLOUDFLARED_TUNNEL_TOKEN = "<your-tunnel-token>"'
    Write-Host "  #   docker compose -f components/multichannel-access/docker-compose.yml ``"
    Write-Host "  #                  -f components/multichannel-access/docker-compose.cloudflare-tunnel.yml ``"
    Write-Host "  #                  up -d"
    Write-Host ""
    Write-Host "  Once you have a public URL, register it with this script:"
    Write-Host '    .\scripts\telegram_webhook_ops.ps1 -PublicUrl "https://YOUR-URL" -SetWebhook -Verify'
    Write-Host ""
}

# -- 6. Final summary ------------------------------------------------
Write-Sect "Summary"
Write-Ok "Local sidecar healthy at $ServiceUrl"
if ($registered) { $current = $after } else { $current = $before }
if ($current -and $current.ok) {
    $u = $current.result.url
    if ([string]::IsNullOrWhiteSpace($u)) {
        Write-Warn "Webhook is currently UNSET. Telegram messages will not reach AMINA until you set one."
    } elseif ($u -match 'ngrok-free\.app|ngrok\.io') {
        Write-Warn "Webhook is set to an ngrok URL (ephemeral): $(_Redact $u)"
    } else {
        Write-Ok "Webhook URL: $(_Redact $u)"
    }
} else {
    Write-Warn "Webhook state unknown."
}

if (-not $SetWebhook -and -not $OpenTunnelHint) {
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  - To register a new tunnel URL : -PublicUrl <https://...> -SetWebhook -Verify"
    Write-Host "  - To see tunnel commands       : -OpenTunnelHint"
    Write-Host "  - To re-verify only            : -Verify"
}

exit 0
