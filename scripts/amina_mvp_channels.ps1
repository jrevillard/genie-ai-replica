<#
.SYNOPSIS
    AMINA MVP Multichannel Control Plane (ops-only).

.DESCRIPTION
    One PowerShell entrypoint to bring up, check, verify, and tear down the
    AMINA channels stack:

        Haystack            (canonical AminaAgent backend)        :8000
        Messenger / WhatsApp routes mounted in Haystack            (/api/v1/meta/*)
        Telegram via the multichannel-access sidecar               :8020
        Optional Cloudflare quick / named tunnel for either

    This script is an OPS CONTROL PLANE -- not a new channel framework. It
    composes existing tools (meta_stage2_readiness.ps1, telegram_webhook_ops.ps1,
    docker compose) and never modifies clinical / RAG / STT / policy /
    AminaAgent / Meta-bridge / Telegram-runtime code.

    Hard rules:
      * Never prints secrets, tokens, app secrets, raw PSIDs, or raw phone
        numbers. Env vars surface as "present (len=N)" only.
      * Treats Telegram and Meta as separate adapters; does not merge them.
      * Haystack is the canonical AminaAgent backend.
      * Idempotent. Re-running -Action up does not break anything.

.PARAMETER Action
    up      | bring up the requested channels' compose stacks (and tunnels)
    status  | read-only summary (default)
    verify  | run handshake + readiness probes for the requested channels
    down    | stop ONLY the quick tunnels this script started (Haystack and
              multichannel-access stay up unless you tear them down by hand)

.PARAMETER Channels
    telegram | messenger | whatsapp | meta (= messenger+whatsapp) | all
    Default: all

.PARAMETER Tunnel
    none  | no tunnel work is performed (default)
    quick | spin up Cloudflare quick tunnels (ephemeral *.trycloudflare.com)
    named | use existing Cloudflare named tunnel (requires
            CLOUDFLARED_TUNNEL_TOKEN env var for Telegram; Meta has no
            built-in named-tunnel compose -- this script does NOT invent one)

.PARAMETER MetaPublicUrl
    Public HTTPS base URL to use when verifying Meta channels. If omitted
    in -Action verify, the script falls back to the most recently captured
    Meta quick-tunnel URL (if this script started one).

.PARAMETER TelegramPublicUrl
    Public HTTPS base URL the operator wants registered with Telegram.
    Only used when -Action up -Tunnel quick (script auto-detects from
    cloudflared logs) OR when -Action verify -TelegramPublicUrl <url>
    is supplied for an externally-provided tunnel.

.PARAMETER NoRestart
    If set during -Action up, existing healthy containers are NOT recreated.

.PARAMETER FollowLogs
    If set after -Action up, tails haystack-chatqna logs filtered to
    Meta + Telegram lines.

.EXAMPLE
    # Read-only status of everything.
    .\scripts\amina_mvp_channels.ps1 -Action status -Channels all

.EXAMPLE
    # Verify Messenger only.
    .\scripts\amina_mvp_channels.ps1 -Action verify -Channels messenger

.EXAMPLE
    # Bring up Messenger + Telegram with quick tunnels for both.
    .\scripts\amina_mvp_channels.ps1 -Action up -Channels all -Tunnel quick

.EXAMPLE
    # Tear down ONLY the quick tunnels this script started.
    .\scripts\amina_mvp_channels.ps1 -Action down -Tunnel quick

.NOTES
    Exit codes:
      0  success / MVP_READY
      1  PARTIAL_READY (at least one channel up, others not)
      2  NOT_READY
      3  invalid parameters / preconditions
      4  internal error
#>

[CmdletBinding()]
param(
    [ValidateSet("up","status","down","verify")]
        [string]$Action            = "status",
    [ValidateSet("telegram","messenger","whatsapp","meta","all")]
        [string]$Channels          = "all",
    [ValidateSet("none","quick","named")]
        [string]$Tunnel            = "none",
    [string]$MetaPublicUrl         = "",
    [string]$TelegramPublicUrl     = "",
    [switch]$NoRestart,
    [switch]$FollowLogs,
    # When set during -Action up + -Tunnel quick, automatically calls
    # telegram_webhook_ops.ps1 -SetWebhook -Verify against the captured
    # Telegram tunnel URL (or -TelegramPublicUrl if supplied). Without
    # this switch, we ONLY print the command -- never auto-register --
    # so a one-call startup stays safe by default.
    [switch]$RegisterTelegramWebhook,
    # When set, prints the manual smoke checklist (DM 'hi' instructions
    # for each channel + the docker logs commands).
    [switch]$PrintManualSmoke
)

# Don't auto-fail on a single missing-tool / connection error -- we want to
# report partial state.
$ErrorActionPreference = "Continue"

# ── Constants ────────────────────────────────────────────────────────────
$Script:REPO_ROOT             = Split-Path -Parent $PSScriptRoot
$Script:HAYSTACK_CONTAINER    = "haystack-chatqna"
$Script:MULTI_CONTAINER       = "multichannel-access"
$Script:CFQUICK_MULTI         = "amina-cf-quick-tunnel"
$Script:CFNAMED_MULTI         = "amina-cloudflared"
$Script:HAYSTACK_URL          = "http://localhost:8000"
$Script:MULTI_URL             = "http://localhost:8020"
$Script:META_TUNNEL_LOG       = Join-Path $env:TEMP "amina_meta_quick_tunnel.log"
$Script:META_TUNNEL_PIDFILE   = Join-Path $env:TEMP "amina_meta_quick_tunnel.pid"
$Script:META_TUNNEL_URLFILE   = Join-Path $env:TEMP "amina_meta_quick_tunnel.url"

$Script:HAYSTACK_BASE         = "haystack-stack/docker-compose.yml"
$Script:HAYSTACK_OVERRIDE     = "haystack-stack/docker-compose.override.yml"
$Script:HAYSTACK_META         = "haystack-stack/docker-compose.meta-channels.yml"
$Script:MULTI_BASE            = "components/multichannel-access/docker-compose.yml"
$Script:MULTI_QUICK_TUN       = "components/multichannel-access/docker-compose.quick-tunnel.yml"
$Script:MULTI_NAMED_TUN       = "components/multichannel-access/docker-compose.cloudflare-tunnel.yml"

$Script:READINESS_PS1         = "scripts/meta_stage2_readiness.ps1"
$Script:TELEGRAM_OPS_PS1      = "scripts/telegram_webhook_ops.ps1"

$Script:WHATSAPP_VARS = @(
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_APP_SECRET"
)
$Script:TWILIO_VARS = @(
    "TWILIO_AUTH_TOKEN",
    "TWILIO_VALIDATE_SIGNATURE"
)
$Script:MESSENGER_VARS = @(
    "MESSENGER_PAGE_ACCESS_TOKEN",
    "MESSENGER_VERIFY_TOKEN",
    "MESSENGER_APP_SECRET"
)
$Script:TELEGRAM_VARS = @(
    "TELEGRAM_BOT_TOKEN"
)

# ── Output helpers (no secrets, ever) ────────────────────────────────────
function Write-Section ([string]$title) {
    Write-Host ""
    Write-Host ("=" * 64) -ForegroundColor DarkGray
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ("=" * 64) -ForegroundColor DarkGray
}
function Write-Ok    ([string]$msg) { Write-Host "  [PASS] $msg" -ForegroundColor Green }
function Write-Fail  ([string]$msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-Warn  ([string]$msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Info  ([string]$msg) { Write-Host "  [INFO] $msg" -ForegroundColor Gray }

# Defensive redaction: bot tokens look like "<digits>:<35+ url-safe chars>";
# Meta tokens are "EAA..."; we strip both shapes from any string we print.
function Hide-Tokens ([string]$s) {
    if ([string]::IsNullOrEmpty($s)) { return "" }
    $s = [regex]::Replace($s, '\b\d{6,}:[A-Za-z0-9_-]{30,}\b', '<TOKEN-REDACTED>')
    $s = [regex]::Replace($s, '\bEAA[A-Za-z0-9]{20,}\b',       '<TOKEN-REDACTED>')
    return $s
}

# ── Channel resolution ──────────────────────────────────────────────────
function Resolve-Channels ([string]$ch) {
    $r = @{ telegram = $false; messenger = $false; whatsapp = $false }
    switch ($ch) {
        "telegram"  { $r.telegram  = $true }
        "messenger" { $r.messenger = $true }
        "whatsapp"  { $r.whatsapp  = $true }
        "meta"      { $r.messenger = $true; $r.whatsapp = $true }
        "all"       { $r.telegram  = $true; $r.messenger = $true; $r.whatsapp = $true }
    }
    return $r
}

# ── Per-channel classification (mirrors meta_stage2_readiness.ps1) ──────
# Returns LIVE_READY / DEMO_READY / MISCONFIGURED based on the booleans
# from /api/v1/meta/status. DEMO_READY = "infrastructure healthy, channel
# intentionally inactive (no creds yet)" -- handshake works, send is
# suppressed. MISCONFIGURED = "access token present but APP_SECRET
# missing", which is unsafe to use with real users (signature spoofable).
function Get-MetaChannelClass {
    param([bool]$Enabled, [bool]$SignatureChecks)
    if ($Enabled       -and $SignatureChecks)       { return "LIVE_READY" }
    if (-not $Enabled  -and -not $SignatureChecks)  { return "DEMO_READY" }
    if ($Enabled       -and -not $SignatureChecks)  { return "MISCONFIGURED" }
    return "UNKNOWN"
}

# ── HTTP via curl.exe (avoids non-interactive Invoke-WebRequest prompts) ─
function Invoke-CurlGet ([string]$Url, [int]$TimeoutSec = 8) {
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        $args = @(
            "--silent", "--show-error",
            "--max-time", $TimeoutSec,
            "--write-out", "%{http_code}",
            "--output", $tmp,
            $Url
        )
        $code = & curl.exe @args 2>&1
        $body = ""
        if (Test-Path $tmp) { $body = Get-Content -Raw -Path $tmp -ErrorAction SilentlyContinue }
        return @{
            ok          = ($LASTEXITCODE -eq 0)
            status_code = ([int]([string]$code).Trim() -as [int])
            body        = $body
            error       = if ($LASTEXITCODE -ne 0) { ($code | Out-String).Trim() } else { $null }
        }
    } finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

# ── Docker probes ────────────────────────────────────────────────────────
function Test-DockerAvailable {
    try {
        $null = & docker version --format "{{.Server.Version}}" 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}
function Test-ContainerRunning ([string]$Name) {
    try {
        $names = & docker ps --filter "name=$Name" --format "{{.Names}}" 2>$null
        return ($names -match "^$Name$")
    } catch { return $false }
}
function Get-EnvLengthInContainer ([string]$Container, [string]$VarName) {
    $script = "import os; v = os.environ.get('$VarName',''); print(len(v))"
    try {
        $out = & docker exec $Container python -c $script 2>$null
        if ($LASTEXITCODE -ne 0) { return -1 }
        $n = 0
        if ([int]::TryParse(("$out").Trim(), [ref]$n)) { return $n }
        return -1
    } catch { return -1 }
}
function Show-EnvCheck ([string]$Container, [string[]]$Vars) {
    foreach ($v in $Vars) {
        $len = Get-EnvLengthInContainer -Container $Container -VarName $v
        if     ($len -lt 0) { Write-Warn ("{0,-32} unreadable" -f $v) }
        elseif ($len -eq 0) { Write-Info ("{0,-32} <unset>" -f $v) }
        else                { Write-Ok   ("{0,-32} present (len={1})" -f $v, $len) }
    }
}

# ── Health probes ────────────────────────────────────────────────────────
function Get-HaystackMetaStatus ([string]$BaseUrl = $Script:HAYSTACK_URL) {
    $r = Invoke-CurlGet -Url "$BaseUrl/api/v1/meta/status" -TimeoutSec 8
    if (-not $r.ok -or $r.status_code -ne 200) {
        return @{ ok = $false; data = $null; error = ("HTTP {0} {1}" -f $r.status_code, $r.error) }
    }
    try {
        $parsed = $r.body | ConvertFrom-Json
        return @{ ok = $true; data = $parsed; error = $null }
    } catch {
        return @{ ok = $false; data = $null; error = "JSON parse error: $($_.Exception.Message)" }
    }
}

function Get-MultiHealth ([string]$BaseUrl = $Script:MULTI_URL) {
    $r = Invoke-CurlGet -Url "$BaseUrl/health" -TimeoutSec 6
    if (-not $r.ok -or $r.status_code -ne 200) {
        return @{ ok = $false; data = $null; error = ("HTTP {0} {1}" -f $r.status_code, $r.error) }
    }
    try {
        $parsed = $r.body | ConvertFrom-Json
        return @{ ok = $true; data = $parsed; error = $null }
    } catch {
        return @{ ok = $false; data = $null; error = "JSON parse error" }
    }
}

function Get-TwilioWhatsAppHealth ([string]$BaseUrl = $Script:HAYSTACK_URL) {
    $r = Invoke-CurlGet -Url "$BaseUrl/api/v1/twilio/whatsapp/health" -TimeoutSec 6
    if (-not $r.ok -or $r.status_code -ne 200) {
        return @{ ok = $false; data = $null; error = ("HTTP {0} {1}" -f $r.status_code, $r.error) }
    }
    try {
        $parsed = $r.body | ConvertFrom-Json
        return @{ ok = $true; data = $parsed; error = $null }
    } catch {
        return @{ ok = $false; data = $null; error = "JSON parse error" }
    }
}

function Get-TelegramWebhookInfo ([string]$BaseUrl = $Script:MULTI_URL) {
    $r = Invoke-CurlGet -Url "$BaseUrl/telegram/webhook-info" -TimeoutSec 8
    if (-not $r.ok -or $r.status_code -ne 200) {
        return @{ ok = $false; data = $null; error = ("HTTP {0} {1}" -f $r.status_code, $r.error) }
    }
    try {
        $parsed = $r.body | ConvertFrom-Json
        return @{ ok = $true; data = $parsed; error = $null }
    } catch {
        return @{ ok = $false; data = $null; error = "JSON parse error" }
    }
}

function Show-TelegramWebhookInfo ($info) {
    if (-not $info.ok)            { Write-Fail "webhook-info: $($info.error)"; return }
    if (-not $info.data.ok)       { Write-Warn "Telegram getWebhookInfo did not return ok=true"; return }
    $r = $info.data.result
    $url = if ([string]::IsNullOrWhiteSpace($r.url)) { "<NONE>" } else { Hide-Tokens $r.url }
    Write-Info ("webhook url             : {0}" -f $url)
    Write-Info ("pending_update_count    : {0}" -f $r.pending_update_count)
    if ($r.last_error_message) {
        Write-Warn ("telegram last_error     : {0}" -f (Hide-Tokens $r.last_error_message))
    }
    if ($r.allowed_updates) {
        Write-Info ("allowed_updates         : {0}" -f ($r.allowed_updates -join ", "))
    }
}

# ── Tunnel: Meta quick (host cloudflared process) ────────────────────────
function Test-MetaTunnelRunning {
    if (-not (Test-Path $Script:META_TUNNEL_PIDFILE)) { return $false }
    try {
        $pidVal = (Get-Content $Script:META_TUNNEL_PIDFILE -ErrorAction Stop).Trim()
        if (-not $pidVal) { return $false }
        $proc = Get-Process -Id ([int]$pidVal) -ErrorAction SilentlyContinue
        return ($null -ne $proc)
    } catch { return $false }
}
function Get-MetaTunnelUrl {
    if (Test-Path $Script:META_TUNNEL_URLFILE) {
        return (Get-Content $Script:META_TUNNEL_URLFILE -ErrorAction SilentlyContinue).Trim()
    }
    return ""
}
function Start-MetaQuickTunnel {
    if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
        Write-Fail "cloudflared CLI not found in PATH; cannot start Meta quick tunnel."
        Write-Info "Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
        return $false
    }
    if (Test-MetaTunnelRunning) {
        $existing = Get-MetaTunnelUrl
        if ($existing) {
            Write-Info ("Meta quick tunnel already running -> {0}" -f $existing)
        } else {
            Write-Info "Meta quick tunnel already running (URL not yet captured; check log)."
        }
        return $true
    }
    Write-Info "Starting cloudflared quick tunnel against http://localhost:8000 ..."
    Remove-Item $Script:META_TUNNEL_LOG -Force -ErrorAction SilentlyContinue
    Remove-Item $Script:META_TUNNEL_URLFILE -Force -ErrorAction SilentlyContinue
    $cmdArgs = @(
        "tunnel",
        "--no-autoupdate",
        "--url", "http://localhost:8000",
        "--logfile", $Script:META_TUNNEL_LOG
    )
    $proc = Start-Process -FilePath "cloudflared" -ArgumentList $cmdArgs `
            -WindowStyle Hidden -PassThru
    if (-not $proc) { Write-Fail "Could not start cloudflared."; return $false }
    Set-Content -Path $Script:META_TUNNEL_PIDFILE -Value $proc.Id -Encoding ASCII

    # Wait up to ~25s for the tunnel to print its hostname.
    $deadline = (Get-Date).AddSeconds(25)
    $url = ""
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        if (Test-Path $Script:META_TUNNEL_LOG) {
            $log = Get-Content $Script:META_TUNNEL_LOG -ErrorAction SilentlyContinue -Raw
            if ($log) {
                $m = [regex]::Match($log, "https://[a-z0-9-]+\.trycloudflare\.com")
                if ($m.Success) { $url = $m.Value; break }
            }
        }
        if (-not (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)) {
            Write-Fail "cloudflared exited unexpectedly while starting Meta tunnel."
            return $false
        }
    }
    if (-not $url) {
        Write-Warn "Meta quick tunnel did not surface a URL within 25s. It may still be starting."
        return $true
    }
    Set-Content -Path $Script:META_TUNNEL_URLFILE -Value $url -Encoding ASCII
    Write-Ok ("Meta quick tunnel up: {0}" -f $url)
    return $true
}
function Stop-MetaQuickTunnel {
    if (-not (Test-Path $Script:META_TUNNEL_PIDFILE)) {
        Write-Info "No Meta quick-tunnel PID file; nothing to stop from this script."
        return
    }
    try {
        $pidVal = (Get-Content $Script:META_TUNNEL_PIDFILE -ErrorAction Stop).Trim()
        if ($pidVal) {
            $proc = Get-Process -Id ([int]$pidVal) -ErrorAction SilentlyContinue
            if ($proc) {
                Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                Write-Ok ("Stopped Meta quick tunnel (pid {0})." -f $pidVal)
            } else {
                Write-Info ("Meta quick tunnel pid {0} no longer running." -f $pidVal)
            }
        }
    } catch {
        Write-Warn ("Could not stop Meta tunnel cleanly: {0}" -f $_.Exception.Message)
    } finally {
        Remove-Item $Script:META_TUNNEL_PIDFILE -Force -ErrorAction SilentlyContinue
        Remove-Item $Script:META_TUNNEL_URLFILE -Force -ErrorAction SilentlyContinue
    }
}

# ── Telegram tunnel URL discovery ────────────────────────────────────────
# Reads the cf-quick-tunnel container's logs and extracts the assigned
# *.trycloudflare.com hostname. Empty string when not running or URL
# not yet visible (cloudflared takes a few seconds to register).
function Get-TelegramTunnelUrl {
    if (-not (Test-DockerAvailable)) { return "" }
    if (-not (Test-ContainerRunning $Script:CFQUICK_MULTI)) { return "" }
    try {
        $log = & docker logs $Script:CFQUICK_MULTI 2>&1 | Out-String
        $m = [regex]::Match($log, "https://[a-z0-9-]+\.trycloudflare\.com")
        if ($m.Success) { return $m.Value }
    } catch {}
    return ""
}

# ── Unified output blocks (printed at the end of -Action up) ─────────────
function Show-CallbackUrls {
    param(
        [hashtable]$want,
        [string]$metaUrl,
        [string]$telegramUrl
    )
    Write-Section "Operator URLs (paste these into the channel dashboards)"
    if ($want.messenger) {
        if ($metaUrl) {
            Write-Info ("Messenger          : {0}/api/v1/meta/webhook/messenger" -f $metaUrl.TrimEnd('/'))
        } else {
            Write-Warn "Messenger          : <no public URL captured -- pass -MetaPublicUrl <https://...>>"
        }
    }
    if ($want.whatsapp) {
        if ($metaUrl) {
            Write-Info ("WhatsApp / Twilio  : {0}/api/v1/twilio/whatsapp/webhook" -f $metaUrl.TrimEnd('/'))
            Write-Info ("WhatsApp / Meta    : {0}/api/v1/meta/webhook/whatsapp     (fallback when Meta API surfaces)" -f $metaUrl.TrimEnd('/'))
        } else {
            Write-Warn "WhatsApp           : <no public URL captured -- pass -MetaPublicUrl <https://...>>"
        }
    }
    if ($want.telegram) {
        if ($telegramUrl) {
            Write-Info ("Telegram           : {0}/telegram/webhook" -f $telegramUrl.TrimEnd('/'))
        } else {
            Write-Warn "Telegram           : <no public URL captured -- pass -TelegramPublicUrl <https://...>>"
        }
    }
    if ($want.messenger -or $want.whatsapp) {
        Write-Info "Verify token (Meta) : amina_health_2026"
    }
}

function Show-NextCommands {
    param(
        [hashtable]$want,
        [string]$metaUrl,
        [string]$telegramUrl,
        [bool]$telegramRegistered
    )
    Write-Section "Next commands"
    if ($want.telegram -and $telegramUrl) {
        if ($telegramRegistered) {
            Write-Ok ("Telegram webhook auto-registered against {0}/telegram/webhook" -f $telegramUrl.TrimEnd('/'))
        } else {
            Write-Info "Register Telegram webhook (one-shot):"
            Write-Host  ("  .\scripts\telegram_webhook_ops.ps1 -PublicUrl `"{0}`" -SetWebhook -Verify" -f $telegramUrl.TrimEnd('/')) -ForegroundColor White
            Write-Info "(or re-run this script with -RegisterTelegramWebhook to do it inline)"
        }
    }
    Write-Info "Run unified verify:"
    $verifyParts = @(
        ".\scripts\amina_mvp_channels.ps1",
        "-Action verify",
        ("-Channels {0}" -f $Channels)
    )
    if ($metaUrl)     { $verifyParts += ("-MetaPublicUrl `"{0}`""     -f $metaUrl.TrimEnd('/')) }
    if ($telegramUrl) { $verifyParts += ("-TelegramPublicUrl `"{0}`"" -f $telegramUrl.TrimEnd('/')) }
    Write-Host ("  " + ($verifyParts -join " ")) -ForegroundColor White
}

function Show-ManualSmoke {
    param([hashtable]$want)
    Write-Section "Manual smoke checklist"
    if ($want.messenger) {
        Write-Info "Messenger : DM 'hi' to the connected Page from an App admin/dev/tester FB account."
    }
    if ($want.whatsapp) {
        Write-Info "WhatsApp  : send 'hi' from your WhatsApp to the Twilio sandbox (after sending the join code once)."
        Write-Info "            Sandbox number : +1 415 523 8886"
        Write-Info "            Join code      : (printed in Twilio Console, e.g. 'join milk-shot')"
    }
    if ($want.telegram) {
        Write-Info "Telegram  : open the bot in Telegram and send 'hi'."
    }
    Write-Info ""
    Write-Info "Watch logs in two terminals:"
    Write-Host  "  docker logs -f --tail 80 haystack-chatqna" -ForegroundColor White
    Write-Host  "  docker logs -f --tail 80 multichannel-access" -ForegroundColor White
}

# ── Compose lifecycle (idempotent) ───────────────────────────────────────
function Invoke-Compose {
    param([string[]]$Files, [string[]]$Args)
    $argList = @()
    foreach ($f in $Files) { $argList += @("-f", $f) }
    $argList += $Args
    Push-Location $Script:REPO_ROOT
    try {
        & docker compose @argList
        $rc = $LASTEXITCODE
    } finally { Pop-Location }
    return $rc
}

function Invoke-MetaUp ([bool]$Recreate) {
    Write-Info "Bringing up haystack-chatqna with Meta channels overlay..."
    $files = @($Script:HAYSTACK_BASE, $Script:HAYSTACK_OVERRIDE, $Script:HAYSTACK_META)
    $args  = @("up", "-d")
    if ($Recreate) { $args += "--force-recreate" }
    $args += @("--no-deps", $Script:HAYSTACK_CONTAINER)
    $rc = Invoke-Compose -Files $files -Args $args
    if ($rc -eq 0) { Write-Ok "haystack-chatqna up" }
    else           { Write-Fail "haystack-chatqna up failed (compose rc=$rc)" }
    return ($rc -eq 0)
}

function Invoke-TelegramUp ([string]$TunnelMode, [bool]$Recreate) {
    Write-Info "Bringing up multichannel-access (Telegram sidecar)..."
    $files = @($Script:MULTI_BASE)
    if ($TunnelMode -eq "quick") {
        if (Test-Path (Join-Path $Script:REPO_ROOT $Script:MULTI_QUICK_TUN)) {
            $files += $Script:MULTI_QUICK_TUN
            Write-Info "Layering quick-tunnel sidecar (cf-quick-tunnel)."
        } else {
            Write-Warn "Telegram quick-tunnel compose file missing; bringing up base only."
        }
    } elseif ($TunnelMode -eq "named") {
        if (-not $env:CLOUDFLARED_TUNNEL_TOKEN) {
            Write-Fail "CLOUDFLARED_TUNNEL_TOKEN env var is not set; cannot bring up Telegram named tunnel."
            Write-Info "Set it first: `$env:CLOUDFLARED_TUNNEL_TOKEN = '<your-token>'"
            return $false
        }
        if (Test-Path (Join-Path $Script:REPO_ROOT $Script:MULTI_NAMED_TUN)) {
            $files += $Script:MULTI_NAMED_TUN
            Write-Info "Layering named-tunnel sidecar (cloudflared)."
        } else {
            Write-Warn "Telegram named-tunnel compose file missing; bringing up base only."
        }
    }
    $args = @("up", "-d")
    if ($Recreate) { $args += "--force-recreate" }
    $rc = Invoke-Compose -Files $files -Args $args
    if ($rc -eq 0) { Write-Ok "multichannel-access stack up" }
    else           { Write-Fail "multichannel-access stack up failed (compose rc=$rc)" }
    return ($rc -eq 0)
}

# ── Verify wrappers ──────────────────────────────────────────────────────
function Invoke-MetaVerify ([string]$ChannelArg, [string]$PublicUrl) {
    $script = Join-Path $Script:REPO_ROOT $Script:READINESS_PS1
    if (-not (Test-Path $script)) {
        Write-Fail ("Readiness script not found: {0}" -f $Script:READINESS_PS1)
        return
    }
    $invokeArgs = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", $script,
        "-CheckStatus", "-CheckEnv", "-VerifyHandshake",
        "-Channel", $ChannelArg
    )
    if ($PublicUrl) { $invokeArgs += @("-PublicUrl", $PublicUrl) }
    & powershell @invokeArgs
}

function Invoke-TelegramVerify ([string]$PublicUrl) {
    $script = Join-Path $Script:REPO_ROOT $Script:TELEGRAM_OPS_PS1
    if (-not (Test-Path $script)) {
        Write-Warn ("Telegram ops script not found: {0}" -f $Script:TELEGRAM_OPS_PS1)
        return
    }
    $invokeArgs = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass",
        "-File", $script
    )
    if ($PublicUrl) { $invokeArgs += @("-PublicUrl", $PublicUrl, "-SetWebhook") }
    $invokeArgs += "-Verify"
    & powershell @invokeArgs
}

# ── Status orchestrator ──────────────────────────────────────────────────
function Show-DockerState ([hashtable]$wantTel, [hashtable]$wantMeta) {
    if (-not (Test-DockerAvailable)) {
        Write-Warn "Docker CLI not available; skipping container state checks."
        return
    }
    $rows = @()
    $rows += [pscustomobject]@{ Container = $Script:HAYSTACK_CONTAINER; Required = ($wantMeta.messenger -or $wantMeta.whatsapp) }
    $rows += [pscustomobject]@{ Container = $Script:MULTI_CONTAINER;    Required = $wantTel.telegram }
    foreach ($cf in @($Script:CFQUICK_MULTI, $Script:CFNAMED_MULTI)) {
        $rows += [pscustomobject]@{ Container = $cf; Required = $false }
    }
    foreach ($r in $rows) {
        $running = Test-ContainerRunning -Name $r.Container
        if ($running) {
            Write-Ok ("docker: {0,-26} running" -f $r.Container)
        } elseif ($r.Required) {
            Write-Fail ("docker: {0,-26} NOT running (required)" -f $r.Container)
        } else {
            Write-Info ("docker: {0,-26} not running" -f $r.Container)
        }
    }
}

function Show-Status {
    param([hashtable]$want)
    $haystack = $null
    $multi    = $null
    $tg       = $null

    Write-Section "1. Containers"
    Show-DockerState -wantTel $want -wantMeta $want

    Write-Section "2. Haystack /api/v1/meta/status"
    $haystack = Get-HaystackMetaStatus
    if (-not $haystack.ok) {
        Write-Fail ("Haystack unreachable: {0}" -f $haystack.error)
    } else {
        $d = $haystack.data
        Write-Ok  "Haystack reachable on :8000"
        if ($want.messenger) {
            $cls = Get-MetaChannelClass -Enabled $d.messenger.enabled -SignatureChecks $d.messenger.signature_checks
            Write-Info ("Messenger enabled={0,-5} signature_checks={1}  [{2}]" -f `
                $d.messenger.enabled, $d.messenger.signature_checks, $cls)
            if ($cls -eq "MISCONFIGURED") {
                Write-Fail "        MESSENGER_APP_SECRET missing -- do not use with real users (signature spoofable)."
            }
        }
        if ($want.whatsapp) {
            $cls = Get-MetaChannelClass -Enabled $d.whatsapp.enabled -SignatureChecks $d.whatsapp.signature_checks
            Write-Info ("WhatsApp  enabled={0,-5} signature_checks={1}  [{2}]" -f `
                $d.whatsapp.enabled, $d.whatsapp.signature_checks, $cls)
            if ($cls -eq "DEMO_READY") {
                Write-Info "        WhatsApp is DEMO_READY -- credentials absent. Set WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET to go LIVE."
            } elseif ($cls -eq "MISCONFIGURED") {
                Write-Fail "        WHATSAPP_APP_SECRET missing -- do not use with real users (signature spoofable)."
            }
        }
    }

    Write-Section "3. Multichannel-access (Telegram sidecar)"
    if ($want.telegram) {
        $multi = Get-MultiHealth
        if (-not $multi.ok) {
            Write-Fail ("multichannel-access unreachable on :8020 -> {0}" -f $multi.error)
        } else {
            $h = $multi.data
            Write-Ok  ("multichannel-access /health: status={0}" -f $h.status)
            Write-Info ("haystack reachable from sidecar : {0}" -f $h.haystack)
            Write-Info ("redis reachable from sidecar    : {0}" -f $h.redis)
            Write-Info ("TELEGRAM_BOT_TOKEN env present  : {0}" -f $h.telegram)
        }
        Write-Section "3b. Telegram webhook info"
        $tg = Get-TelegramWebhookInfo
        Show-TelegramWebhookInfo $tg
    } else {
        Write-Info "Telegram not in -Channels selection; skipping."
    }

    Write-Section "4. Env-var presence (length only, no values)"
    if (Test-DockerAvailable) {
        if (Test-ContainerRunning $Script:HAYSTACK_CONTAINER) {
            if ($want.messenger) {
                Write-Host "  -- Messenger --" -ForegroundColor DarkGray
                Show-EnvCheck $Script:HAYSTACK_CONTAINER $Script:MESSENGER_VARS
            }
            if ($want.whatsapp) {
                Write-Host "  -- WhatsApp --" -ForegroundColor DarkGray
                Show-EnvCheck $Script:HAYSTACK_CONTAINER $Script:WHATSAPP_VARS
            }
        } else {
            Write-Warn "haystack-chatqna not running; skipping Meta env check."
        }
        if ($want.telegram) {
            if (Test-ContainerRunning $Script:MULTI_CONTAINER) {
                Write-Host "  -- Telegram --" -ForegroundColor DarkGray
                Show-EnvCheck $Script:MULTI_CONTAINER $Script:TELEGRAM_VARS
            } else {
                Write-Warn "multichannel-access not running; skipping Telegram env check."
            }
        }
    } else {
        Write-Warn "Docker not available; skipping env check."
    }

    Write-Section "5. Tunnel state"
    if (Test-MetaTunnelRunning) {
        $url = Get-MetaTunnelUrl
        if ($url) { Write-Ok ("Meta quick tunnel running -> {0}" -f $url) }
        else      { Write-Info "Meta quick tunnel running (URL pending in log)" }
    } else {
        Write-Info "No Meta quick tunnel started by this script."
    }
    if (Test-ContainerRunning $Script:CFQUICK_MULTI) {
        Write-Ok "Telegram quick tunnel container running."
    } elseif (Test-ContainerRunning $Script:CFNAMED_MULTI) {
        Write-Ok "Telegram named tunnel container running."
    } else {
        Write-Info "No Telegram tunnel container running."
    }

    # ── Twilio WhatsApp probe ─────────────────────────────────────
    # Only meaningful when WhatsApp is in scope and Meta WhatsApp is not
    # LIVE_READY. Twilio is a parallel/fallback adapter for the same
    # logical "WhatsApp" channel.
    $twilio = $null
    if ($want.whatsapp) {
        Write-Section "3c. Twilio WhatsApp Sandbox (fallback adapter)"
        $twilio = Get-TwilioWhatsAppHealth
        if (-not $twilio.ok) {
            Write-Warn ("Twilio WhatsApp route unreachable -> {0}" -f $twilio.error)
        } else {
            $t = $twilio.data
            Write-Ok  ("Twilio WhatsApp route mounted: channel={0}" -f $t.channel)
            Write-Info ("signature_validation : {0}" -f $t.signature_validation)
            Write-Info ("auth_token_present   : {0}" -f $t.auth_token_present)
            if ($t.signature_validation -and -not $t.auth_token_present) {
                Write-Fail "        signature_validation=true but TWILIO_AUTH_TOKEN unset -- inbound POSTs will be rejected."
            }
            if (-not $t.signature_validation) {
                Write-Info "        Sandbox mode: signature validation OFF (acceptable for sandbox MVP; turn ON before production)."
            }
        }
        if (Test-DockerAvailable -and (Test-ContainerRunning $Script:HAYSTACK_CONTAINER)) {
            Write-Host "  -- Twilio env --" -ForegroundColor DarkGray
            Show-EnvCheck $Script:HAYSTACK_CONTAINER $Script:TWILIO_VARS
        }
    }

    return @{
        haystack = $haystack
        multi    = $multi
        telegram = $tg
        twilio   = $twilio
    }
}

# ── Classification ───────────────────────────────────────────────────────
function Compute-Classification {
    param([hashtable]$want, [hashtable]$state)
    $blocking_reasons = @()  # cause PARTIAL/NOT_READY
    $info_notes       = @()  # surface even on MVP_READY (e.g. WhatsApp DEMO_READY)
    $required_ok      = @()

    # Haystack must be reachable for ANY Meta channel.
    $haystackOk = $state.haystack -and $state.haystack.ok
    if (($want.messenger -or $want.whatsapp) -and -not $haystackOk) {
        $blocking_reasons += "haystack /meta/status unreachable"
    }

    if ($want.messenger) {
        $m = if ($haystackOk) { $state.haystack.data.messenger } else { $null }
        $cls = if ($m) {
            Get-MetaChannelClass -Enabled $m.enabled -SignatureChecks $m.signature_checks
        } else { "UNKNOWN" }
        $ok = ($haystackOk -and $cls -eq "LIVE_READY")
        $required_ok += $ok
        if (-not $ok) {
            if (-not $haystackOk)              { $blocking_reasons += "messenger: haystack unreachable" }
            elseif ($cls -eq "MISCONFIGURED")  { $blocking_reasons += "messenger: MISCONFIGURED (token set, APP_SECRET missing)" }
            elseif ($cls -eq "DEMO_READY")     { $blocking_reasons += "messenger: DEMO_READY (credentials absent -- set MESSENGER_PAGE_ACCESS_TOKEN + APP_SECRET)" }
            else                               { $blocking_reasons += ("messenger: classification={0}" -f $cls) }
        }
    }
    if ($want.whatsapp) {
        # WhatsApp has TWO valid adapters for MVP:
        #   1. Meta WhatsApp Cloud API (production target). LIVE_READY when
        #      WHATSAPP_ACCESS_TOKEN + PHONE_NUMBER_ID + APP_SECRET set.
        #   2. Twilio WhatsApp Sandbox (fallback when Meta WhatsApp isn't
        #      surfaced in the dashboard yet). LIVE_READY when /twilio/
        #      whatsapp/health responds 200 and signature config is sane.
        # If Meta is LIVE_READY -> WhatsApp LIVE.
        # Else if Twilio sandbox route is up -> WhatsApp LIVE (via Twilio).
        # Else if Meta is DEMO_READY -> WhatsApp DEMO (acceptable per MVP rules).
        # Else MISCONFIGURED.
        $w = if ($haystackOk) { $state.haystack.data.whatsapp } else { $null }
        $metaCls = if ($w) {
            Get-MetaChannelClass -Enabled $w.enabled -SignatureChecks $w.signature_checks
        } else { "UNKNOWN" }
        $twilioUp = $false
        if ($state.twilio -and $state.twilio.ok -and $state.twilio.data) {
            $td = $state.twilio.data
            # Twilio sandbox is "ready" iff route is mounted AND signature
            # config is sane (off, OR on with auth_token present).
            $twilioUp = (-not $td.signature_validation) -or ($td.signature_validation -and $td.auth_token_present)
        }

        $ok = $false
        if ($haystackOk -and $metaCls -eq "LIVE_READY") {
            $ok = $true
            $info_notes += "whatsapp: LIVE via Meta WhatsApp Cloud API"
        } elseif ($twilioUp) {
            $ok = $true
            if ($metaCls -eq "DEMO_READY") {
                $info_notes += "whatsapp: LIVE via Twilio Sandbox (Meta WhatsApp DEMO_READY -- using fallback adapter)"
            } else {
                $info_notes += "whatsapp: LIVE via Twilio Sandbox"
            }
        } elseif ($haystackOk -and $metaCls -eq "DEMO_READY") {
            $ok = $true   # DEMO_READY for Meta is acceptable per MVP rules.
            $info_notes += "whatsapp: DEMO_READY (Meta credentials absent; Twilio fallback also unavailable)"
        }

        $required_ok += $ok
        if (-not $ok) {
            if (-not $haystackOk)              { $blocking_reasons += "whatsapp: haystack unreachable" }
            elseif ($metaCls -eq "MISCONFIGURED") {
                $blocking_reasons += "whatsapp: Meta MISCONFIGURED (token set, APP_SECRET missing) and Twilio fallback not available"
            } else {
                $blocking_reasons += ("whatsapp: classification={0} and Twilio not ready" -f $metaCls)
            }
        }
    }
    if ($want.telegram) {
        $multiOk = $state.multi -and $state.multi.ok -and $state.multi.data.status -eq "ok"
        $tokenOk = $multiOk -and $state.multi.data.telegram -eq $true
        $hookOk  = $false
        if ($state.telegram -and $state.telegram.ok -and $state.telegram.data.ok) {
            $u = $state.telegram.data.result.url
            $hookOk = -not [string]::IsNullOrWhiteSpace($u)
        }
        $ok = ($multiOk -and $tokenOk -and $hookOk)
        $required_ok += $ok
        if (-not $ok) {
            if (-not $multiOk)     { $blocking_reasons += "telegram: multichannel-access /health not ok" }
            elseif (-not $tokenOk) { $blocking_reasons += "telegram: TELEGRAM_BOT_TOKEN missing in sidecar" }
            elseif (-not $hookOk)  { $blocking_reasons += "telegram: webhook URL not registered" }
        }
    }

    if ($required_ok.Count -eq 0) {
        return @{ class = "NOT_READY"; reasons = @("no channels selected"); notes = @() }
    }
    if ($required_ok -notcontains $false) {
        return @{ class = "MVP_READY"; reasons = @(); notes = $info_notes }
    }
    if ($required_ok -contains $true) {
        return @{ class = "PARTIAL_READY"; reasons = $blocking_reasons; notes = $info_notes }
    }
    return @{ class = "NOT_READY"; reasons = $blocking_reasons; notes = $info_notes }
}

function Show-Classification ($cls) {
    Write-Section "Final classification"
    switch ($cls.class) {
        "MVP_READY"     { Write-Ok    "MVP_READY      every selected channel is acceptable (LIVE_READY, or DEMO_READY where allowed)." }
        "PARTIAL_READY" { Write-Warn  "PARTIAL_READY  some channels are acceptable; others are not." }
        "NOT_READY"     { Write-Fail  "NOT_READY      no selected channel is acceptable." }
        default         { Write-Warn ("UNKNOWN classification: {0}" -f $cls.class) }
    }
    if ($cls.reasons -and $cls.reasons.Count -gt 0) {
        Write-Host "  Blocking reasons:" -ForegroundColor DarkYellow
        foreach ($r in $cls.reasons) { Write-Host ("    - {0}" -f $r) -ForegroundColor DarkYellow }
    }
    if ($cls.notes -and $cls.notes.Count -gt 0) {
        Write-Host "  Notes:" -ForegroundColor DarkGray
        foreach ($n in $cls.notes) { Write-Host ("    - {0}" -f $n) -ForegroundColor DarkGray }
    }
}

# ── Operator manual-DM checklist (after verify) ─────────────────────────
function Show-OperatorChecklist ([hashtable]$want, [string]$metaUrl) {
    Write-Section "Operator manual smoke test"
    if ($metaUrl) {
        $base = $metaUrl.TrimEnd("/")
        if ($want.messenger) {
            Write-Info ("Messenger callback URL  : {0}/api/v1/meta/webhook/messenger" -f $base)
        }
        if ($want.whatsapp) {
            Write-Info ("WhatsApp  (Meta) URL    : {0}/api/v1/meta/webhook/whatsapp"  -f $base)
            Write-Info ("WhatsApp  (Twilio) URL  : {0}/api/v1/twilio/whatsapp/webhook" -f $base)
        }
        if ($want.messenger -or $want.whatsapp) {
            Write-Info "  Meta verify token: amina_health_2026"
            if ($want.whatsapp) {
                Write-Info "  Twilio: paste WhatsApp URL in Twilio Console -> Messaging -> Try it -> WhatsApp Sandbox -> When a message comes in (POST)."
            }
        }
    }
    if ($want.messenger) {
        Write-Info "Messenger: DM 'hi' to the connected Page from an App admin/dev/tester FB account."
    }
    if ($want.whatsapp) {
        Write-Info "WhatsApp (Meta):   ensure test recipient added in API Setup, then send 'hi' from that phone."
        Write-Info "WhatsApp (Twilio): join the sandbox via the BotFather-style code Twilio shows (e.g. 'join <two-words>'), then send 'hi'."
    }
    if ($want.telegram) {
        Write-Info "Telegram: open the bot in Telegram and send 'hi'."
    }
    Write-Info "Watch logs:  docker logs -f --tail 60 haystack-chatqna"
    Write-Info "             docker logs -f --tail 60 multichannel-access"
}

# ── Logs ────────────────────────────────────────────────────────────────
function Start-LogsTail ([hashtable]$want) {
    if (-not (Test-DockerAvailable)) { return }
    Write-Section "Following logs (Ctrl+C to stop)"
    $names = @()
    if ($want.messenger -or $want.whatsapp) { $names += $Script:HAYSTACK_CONTAINER }
    if ($want.telegram)                     { $names += $Script:MULTI_CONTAINER }
    if ($names.Count -eq 0) { return }
    foreach ($n in $names) {
        if (Test-ContainerRunning $n) {
            Write-Info ("docker logs -f --tail 60 {0}" -f $n)
        }
    }
    & docker logs -f --tail 60 $names[0]
}

# ── Main dispatch ────────────────────────────────────────────────────────
$want = Resolve-Channels $Channels

Write-Host ""
Write-Host "  AMINA MVP Multichannel Control Plane" -ForegroundColor White
Write-Host ("  Action={0}  Channels={1}  Tunnel={2}" -f $Action, $Channels, $Tunnel) -ForegroundColor DarkGray

switch ($Action) {

    "status" {
        $state = Show-Status -want $want
        $cls   = Compute-Classification -want $want -state $state
        Show-Classification $cls
        switch ($cls.class) {
            "MVP_READY"     { exit 0 }
            "PARTIAL_READY" { exit 1 }
            default         { exit 2 }
        }
    }

    "up" {
        if (-not (Test-DockerAvailable)) {
            Write-Fail "Docker CLI not available; cannot bring services up."
            exit 3
        }
        $ok = $true
        if ($want.messenger -or $want.whatsapp) {
            $needRecreate = (-not $NoRestart)
            if ($needRecreate -and (Test-ContainerRunning $Script:HAYSTACK_CONTAINER) -and $NoRestart) {
                Write-Info "haystack-chatqna already running; -NoRestart set, skipping."
            } else {
                $ok = (Invoke-MetaUp -Recreate $needRecreate) -and $ok
            }
        }
        if ($want.telegram) {
            $needRecreate = (-not $NoRestart)
            if (-not $needRecreate -and (Test-ContainerRunning $Script:MULTI_CONTAINER)) {
                Write-Info "multichannel-access already running; -NoRestart set, skipping."
            } else {
                $ok = (Invoke-TelegramUp -TunnelMode $Tunnel -Recreate $needRecreate) -and $ok
            }
        }
        # Meta tunnel (host cloudflared on :8000, separate from Telegram).
        if (($want.messenger -or $want.whatsapp) -and $Tunnel -eq "quick") {
            $ok = (Start-MetaQuickTunnel) -and $ok
        } elseif (($want.messenger -or $want.whatsapp) -and $Tunnel -eq "named") {
            Write-Warn "Meta has no built-in named-tunnel compose file; configure your own ingress and re-run with -Tunnel none."
        }
        # Give the Telegram quick tunnel a few seconds to surface its URL
        # in the container logs before we read it.
        if ($want.telegram -and $Tunnel -eq "quick") {
            Start-Sleep -Seconds 6
        }

        # Resolve effective public URLs: prefer flags, then captured tunnels.
        $metaUrl = if ($MetaPublicUrl) { $MetaPublicUrl } else { Get-MetaTunnelUrl }
        $tgUrl   = if ($TelegramPublicUrl) { $TelegramPublicUrl } else { Get-TelegramTunnelUrl }

        # Optionally register the Telegram webhook in-line. Off by default
        # so a one-call startup is non-destructive (no external API write
        # without explicit consent).
        $registered = $false
        if ($want.telegram -and $RegisterTelegramWebhook -and $tgUrl) {
            Write-Section "Auto-registering Telegram webhook"
            Invoke-TelegramVerify -PublicUrl $tgUrl
            $registered = $true
        } elseif ($want.telegram -and $RegisterTelegramWebhook -and -not $tgUrl) {
            Write-Warn "-RegisterTelegramWebhook requested but no Telegram public URL is available (pass -TelegramPublicUrl, or wait for the quick tunnel)."
        }

        # Unified URL block + next-commands block (always printed when
        # Meta or Telegram are in scope and we have at least one URL).
        if ($metaUrl -or $tgUrl) {
            Show-CallbackUrls   -want $want -metaUrl $metaUrl -telegramUrl $tgUrl
            Show-NextCommands   -want $want -metaUrl $metaUrl -telegramUrl $tgUrl `
                                -telegramRegistered $registered
        } elseif ($Tunnel -eq "quick") {
            Write-Warn "No tunnel URLs were captured. Re-run -Action status, or pass -MetaPublicUrl / -TelegramPublicUrl explicitly."
        }

        if ($PrintManualSmoke) { Show-ManualSmoke -want $want }
        if ($FollowLogs)       { Start-LogsTail $want }
        if ($ok) { exit 0 } else { exit 1 }
    }

    "verify" {
        if ($want.messenger -or $want.whatsapp) {
            $ch = if ($want.messenger -and $want.whatsapp) { "both" }
                  elseif ($want.messenger)                 { "messenger" }
                  else                                     { "whatsapp" }
            $url = if ($MetaPublicUrl) { $MetaPublicUrl } else { Get-MetaTunnelUrl }
            Invoke-MetaVerify -ChannelArg $ch -PublicUrl $url
        }
        if ($want.telegram) {
            Write-Section "Telegram verification"
            $tgFlag = if ($TelegramPublicUrl) { $TelegramPublicUrl } else { Get-TelegramTunnelUrl }
            # Default verify behavior: read-only inspection (no SetWebhook)
            # unless -RegisterTelegramWebhook was passed alongside.
            if ($RegisterTelegramWebhook -and $tgFlag) {
                Invoke-TelegramVerify -PublicUrl $tgFlag
            } else {
                Invoke-TelegramVerify -PublicUrl ""
            }
        }
        $state = Show-Status -want $want
        $cls   = Compute-Classification -want $want -state $state
        Show-Classification $cls
        $metaUrlFinal = if ($MetaPublicUrl) { $MetaPublicUrl } else { Get-MetaTunnelUrl }
        $tgUrlFinal   = if ($TelegramPublicUrl) { $TelegramPublicUrl } else { Get-TelegramTunnelUrl }
        Show-CallbackUrls -want $want -metaUrl $metaUrlFinal -telegramUrl $tgUrlFinal
        if ($PrintManualSmoke) { Show-ManualSmoke -want $want }
        switch ($cls.class) {
            "MVP_READY"     { exit 0 }
            "PARTIAL_READY" { exit 1 }
            default         { exit 2 }
        }
    }

    "down" {
        Write-Section "Stopping ONLY tunnels this script started"
        if ($Tunnel -eq "quick") {
            Stop-MetaQuickTunnel
            if (Test-DockerAvailable -and (Test-ContainerRunning $Script:CFQUICK_MULTI)) {
                Write-Info ("Stopping {0} via compose..." -f $Script:CFQUICK_MULTI)
                $rc = Invoke-Compose -Files @($Script:MULTI_BASE, $Script:MULTI_QUICK_TUN) `
                                     -Args @("stop", "cf-quick-tunnel")
                if ($rc -eq 0) { Write-Ok "Telegram quick tunnel stopped." }
            }
        } elseif ($Tunnel -eq "named") {
            Write-Warn "Refusing to stop named tunnel automatically (operator-managed). Run docker compose down on it manually."
        } else {
            Stop-MetaQuickTunnel
            Write-Info "No -Tunnel mode specified; only Meta quick tunnel was a candidate to stop."
        }
        Write-Section "Still running"
        Show-DockerState -wantTel $want -wantMeta $want
        Write-Info "Haystack and multichannel-access were NOT stopped by this script. Use docker compose down manually if you need to fully tear them down."
        exit 0
    }
}
