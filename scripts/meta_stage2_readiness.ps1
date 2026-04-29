<#
.SYNOPSIS
    Meta channels Stage 2 readiness checker (WhatsApp + Messenger).

.DESCRIPTION
    Read-only ops/test script. Never prints secrets, never calls Meta APIs.
    Classifies the running deployment as one of:

        DEMO_READY      handshake works; enabled=false; signature_checks=false
                        (current default state with empty credentials)

        LIVE_READY      enabled=true AND signature_checks=true
                        (real access token + APP_SECRET both present)

        MISCONFIGURED   enabled=true AND signature_checks=false
                        (access token present but APP_SECRET missing --
                         do NOT use with real users; signature spoofing risk)

    The script can run any combination of three checks:
        -CheckStatus        GET /api/v1/meta/status (lightweight HTTP probe)
        -CheckEnv           inspect env vars in haystack-chatqna container
                            (presence + length only, never values)
        -VerifyHandshake    GET /webhook/{channel} with verify token + challenge

    Pass -PublicUrl to print exact callback URLs for the Meta dashboard.

.PARAMETER ServiceUrl
    Base URL of the haystack-chatqna service. Default: http://localhost:8000

.PARAMETER Channel
    Which channel to check: whatsapp | messenger | both. Default: both

.PARAMETER VerifyToken
    Verify token to use for the handshake test. Default: amina_health_2026

.PARAMETER PublicUrl
    Public-facing tunnel URL. When supplied, prints the exact callback URLs
    you paste into Meta's webhook configuration. Trailing slash is normalised.

.PARAMETER CheckStatus
    Switch. Run the /api/v1/meta/status probe.

.PARAMETER CheckEnv
    Switch. Inspect env-var presence inside the haystack-chatqna container.

.PARAMETER VerifyHandshake
    Switch. Run the GET /webhook/{channel} verify handshake.

.EXAMPLE
    .\scripts\meta_stage2_readiness.ps1 -CheckStatus -CheckEnv -VerifyHandshake -Channel both

.EXAMPLE
    .\scripts\meta_stage2_readiness.ps1 -CheckStatus -PublicUrl "https://amina.example.com/"

.NOTES
    Stage 2 readiness hardening -- does NOT enable real credentials,
    does NOT call Meta/Facebook APIs, does NOT print secrets.
#>

[CmdletBinding()]
param(
    [string]   $ServiceUrl       = "http://localhost:8000",
    [ValidateSet("whatsapp","messenger","both")]
    [string]   $Channel          = "both",
    [string]   $VerifyToken      = "amina_health_2026",
    [string]   $PublicUrl        = "",
    [switch]   $CheckStatus,
    [switch]   $CheckEnv,
    [switch]   $VerifyHandshake
)

# ── Constants ────────────────────────────────────────────────────────────
$Script:CONTAINER = "haystack-chatqna"
$Script:WHATSAPP_VARS = @(
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_APP_SECRET"
)
$Script:MESSENGER_VARS = @(
    "MESSENGER_PAGE_ACCESS_TOKEN",
    "MESSENGER_VERIFY_TOKEN",
    "MESSENGER_APP_SECRET"
)
$Script:SHARED_VARS = @("META_GRAPH_VERSION")

# ── Output helpers (no secrets ever) ─────────────────────────────────────
function Write-Section ($title) {
    Write-Host ""
    Write-Host ("=" * 64) -ForegroundColor DarkGray
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ("=" * 64) -ForegroundColor DarkGray
}
function Write-Ok    ($msg) { Write-Host "  [PASS] $msg" -ForegroundColor Green }
function Write-Fail  ($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-Warn  ($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Info  ($msg) { Write-Host "  [INFO] $msg" -ForegroundColor Gray }

# ── HTTP helper (uses curl.exe to avoid Invoke-WebRequest's interactive
#    auth prompts in -NonInteractive PowerShell sessions) ────────────────
function Invoke-CurlGet {
    param([string]$Url, [int]$TimeoutSec = 8)
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

# ── /meta/status probe ───────────────────────────────────────────────────
function Get-MetaStatus {
    param([string]$Url)
    $endpoint = "$Url/api/v1/meta/status"
    $r = Invoke-CurlGet -Url $endpoint -TimeoutSec 8
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

function Show-Status {
    param($Status)
    if (-not $Status.ok) {
        Write-Fail "Could not reach /api/v1/meta/status -- $($Status.error)"
        return $null
    }
    $d = $Status.data
    $wa  = $d.whatsapp
    $msg = $d.messenger

    Write-Info ("WhatsApp  enabled={0,-5} signature_checks={1}" -f $wa.enabled,  $wa.signature_checks)
    Write-Info ("Messenger enabled={0,-5} signature_checks={1}" -f $msg.enabled, $msg.signature_checks)
    return $d
}

# ── Classification ───────────────────────────────────────────────────────
function Get-ChannelClassification {
    param($ChannelStatus)
    if (-not $ChannelStatus) { return "UNKNOWN" }
    $enabled = [bool]$ChannelStatus.enabled
    $sig     = [bool]$ChannelStatus.signature_checks
    if ($enabled -and $sig)        { return "LIVE_READY" }
    if ($enabled -and -not $sig)   { return "MISCONFIGURED" }
    if (-not $enabled -and -not $sig) { return "DEMO_READY" }
    return "UNKNOWN"
}

function Show-Classification {
    param([string]$ChannelName, [string]$Classification)
    switch ($Classification) {
        "LIVE_READY" {
            Write-Ok ("{0}: LIVE_READY  (enabled=true, signature_checks=true)" -f $ChannelName)
        }
        "DEMO_READY" {
            Write-Info ("{0}: DEMO_READY  (handshake OK, no real credentials yet)" -f $ChannelName)
        }
        "MISCONFIGURED" {
            Write-Fail ("{0}: MISCONFIGURED  (enabled=true but signature_checks=false)" -f $ChannelName)
            Write-Fail "        Access token is present but APP_SECRET is missing. Do not use with real users."
        }
        default {
            Write-Warn ("{0}: classification=UNKNOWN" -f $ChannelName)
        }
    }
}

# ── Env-var presence (no values, ever) ───────────────────────────────────
function Test-DockerAvailable {
    try {
        $null = & docker version --format "{{.Server.Version}}" 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch { return $false }
}

function Test-ContainerRunning {
    param([string]$Name)
    try {
        $names = & docker ps --filter "name=$Name" --format "{{.Names}}" 2>$null
        return ($names -match "^$Name$")
    } catch { return $false }
}

function Get-EnvLengthInContainer {
    param([string]$Container, [string]$VarName)
    $script = "import os; v = os.environ.get('$VarName',''); print(len(v))"
    try {
        $out = & docker exec $Container python -c $script 2>$null
        if ($LASTEXITCODE -ne 0) { return -1 }
        $n = 0
        if ([int]::TryParse(("$out").Trim(), [ref]$n)) { return $n }
        return -1
    } catch { return -1 }
}

function Show-EnvCheck {
    param([string]$Container, [string[]]$Vars)
    foreach ($v in $Vars) {
        $len = Get-EnvLengthInContainer -Container $Container -VarName $v
        if     ($len -lt 0) { Write-Warn  ("{0,-32} unreadable" -f $v) }
        elseif ($len -eq 0) { Write-Info  ("{0,-32} <unset>" -f $v) }
        else                { Write-Ok    ("{0,-32} present (len={1})" -f $v, $len) }
    }
}

# ── Handshake verification ───────────────────────────────────────────────
function Test-Handshake {
    param([string]$Url, [string]$Path, [string]$Token, [string]$Challenge)
    $qs = "hub.mode=subscribe&hub.verify_token=$([uri]::EscapeDataString($Token))&hub.challenge=$([uri]::EscapeDataString($Challenge))"
    $endpoint = "$Url$Path" + "?" + $qs
    $r = Invoke-CurlGet -Url $endpoint -TimeoutSec 8
    if (-not $r.ok) {
        Write-Fail ("{0}  -> request failed: {1}" -f $Path, $r.error)
        return $false
    }
    $body = ($r.body | Out-String).Trim()
    if ($r.status_code -eq 200 -and $body -ceq $Challenge) {
        Write-Ok ("{0}  -> 200 + exact challenge echo" -f $Path)
        return $true
    }
    Write-Fail ("{0}  -> status={1} body-length={2} (expected exact echo of '{3}')" -f $Path, $r.status_code, $body.Length, $Challenge)
    return $false
}

# ── Public callback URL printer ──────────────────────────────────────────
function Show-CallbackUrls {
    param([string]$Public)
    $base = $Public.TrimEnd('/')
    $wa   = "$base/api/v1/meta/webhook/whatsapp"
    $msg  = "$base/api/v1/meta/webhook/messenger"
    Write-Info ("WhatsApp  callback URL: {0}" -f $wa)
    Write-Info ("Messenger callback URL: {0}" -f $msg)
    Write-Info "Verify token (do NOT commit) is whatever you pass to -VerifyToken."
    Write-Info "Configure these in Meta App Dashboard -> Webhooks -> Edit subscription."
}

# ── Body ─────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  Meta channels Stage 2 readiness check" -ForegroundColor White
Write-Host ("  service={0}  channel={1}" -f $ServiceUrl, $Channel) -ForegroundColor DarkGray

# If no flags passed, default to running all three checks.
$noFlagsGiven = -not ($CheckStatus -or $CheckEnv -or $VerifyHandshake -or $PublicUrl)
if ($noFlagsGiven) {
    Write-Info "No -Check* flag passed; running -CheckStatus + -VerifyHandshake by default."
    $CheckStatus     = $true
    $VerifyHandshake = $true
}

# State carried between sections so the final classification can use both.
$statusData = $null

if ($CheckStatus) {
    Write-Section "1. Status probe (/api/v1/meta/status)"
    $resp = Get-MetaStatus -Url $ServiceUrl
    $statusData = Show-Status -Status $resp
}

if ($CheckEnv) {
    Write-Section "2. Env-var presence (length only, no values)"
    if (-not (Test-DockerAvailable)) {
        Write-Warn "Docker CLI not available; skipping env-var check."
    } elseif (-not (Test-ContainerRunning -Name $Script:CONTAINER)) {
        Write-Warn ("Container '{0}' not running; skipping env-var check." -f $Script:CONTAINER)
    } else {
        if ($Channel -in @("whatsapp","both")) {
            Write-Host "  -- WhatsApp --"  -ForegroundColor DarkGray
            Show-EnvCheck -Container $Script:CONTAINER -Vars $Script:WHATSAPP_VARS
        }
        if ($Channel -in @("messenger","both")) {
            Write-Host "  -- Messenger --" -ForegroundColor DarkGray
            Show-EnvCheck -Container $Script:CONTAINER -Vars $Script:MESSENGER_VARS
        }
        Write-Host "  -- Shared --" -ForegroundColor DarkGray
        Show-EnvCheck -Container $Script:CONTAINER -Vars $Script:SHARED_VARS
    }
}

if ($VerifyHandshake) {
    Write-Section "3. Webhook GET handshake verification"
    $challenge = "AMINA_OK"
    $waOk  = $true
    $msgOk = $true
    if ($Channel -in @("whatsapp","both")) {
        $waOk  = Test-Handshake -Url $ServiceUrl -Path "/api/v1/meta/webhook/whatsapp"  -Token $VerifyToken -Challenge $challenge
    }
    if ($Channel -in @("messenger","both")) {
        $msgOk = Test-Handshake -Url $ServiceUrl -Path "/api/v1/meta/webhook/messenger" -Token $VerifyToken -Challenge $challenge
    }
    if (-not ($waOk -and $msgOk)) {
        Write-Warn "One or more handshakes failed. Check VerifyToken matches what's configured in the container."
    }
}

if ($PublicUrl) {
    Write-Section "4. Public callback URLs (paste into Meta dashboard)"
    Show-CallbackUrls -Public $PublicUrl
}

# ── Final classification ────────────────────────────────────────────────
Write-Section "Final classification"
if (-not $statusData) {
    Write-Warn "No /status data fetched; cannot classify. Re-run with -CheckStatus."
} else {
    if ($Channel -in @("whatsapp","both")) {
        Show-Classification -ChannelName "WhatsApp"  -Classification (Get-ChannelClassification -ChannelStatus $statusData.whatsapp)
    }
    if ($Channel -in @("messenger","both")) {
        Show-Classification -ChannelName "Messenger" -Classification (Get-ChannelClassification -ChannelStatus $statusData.messenger)
    }
}

Write-Host ""
Write-Host "  Done. No secrets printed; no Meta API calls made." -ForegroundColor DarkGray
Write-Host ""
