# ============================================
# AMINA — One-Command Start (Windows / PowerShell)
# ============================================
# UNICC evaluators:
#   .\start.ps1
#   open http://localhost:5174
#
# Team developers (real keys):
#   cp haystack-stack\.env.example haystack-stack\.env
#   # fill in real keys
#   .\start.ps1
# ============================================

param(
    [switch]$SkipFrontend,
    [switch]$Rebuild,
    [switch]$Stop
)

$ErrorActionPreference = "Continue"
$RepoRoot = $PSScriptRoot

# ── Ensure we run from the repo root no matter where the user is ───
Set-Location $RepoRoot

# ── Quiet docker compose wrapper ───────────────────────────────────
# PowerShell 5.1 wraps any line a native command writes to stderr as a
# NativeCommandError, which surfaces in red as if something failed.
# Docker writes routine progress (Container Creating / Started / etc.)
# to stderr, so the default behavior makes a clean run look broken.
# This helper redirects stderr to stdout, prints every line in gray,
# and propagates the real exit code so true failures still bubble up.
function Invoke-DockerCompose {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$DcArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    try {
        & docker compose @DcArgs 2>&1 | ForEach-Object {
            $line = if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { $_ }
            Write-Host "       $line" -ForegroundColor DarkGray
        }
    } finally {
        $ErrorActionPreference = $prev
    }
    return $LASTEXITCODE
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AMINA - NCD Healthcare AI for Gambia"   -ForegroundColor Cyan
Write-Host "  Starting all services..."               -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Stop mode ──────────────────────────────────────────────────────
if ($Stop) {
    Write-Host "[STOP] Shutting down all services..." -ForegroundColor Yellow

    $composeFiles = @(
        "-f", "docker-compose.yml",
        "-f", "docker-compose.demo.yml"
    )
    if (Test-Path "haystack-stack\docker-compose.override.yml") {
        $composeFiles += @("-f", "docker-compose.override.yml")
    }
    if (Test-Path "haystack-stack\docker-compose.meta-channels.yml") {
        $composeFiles += @("-f", "docker-compose.meta-channels.yml")
    }

    Push-Location haystack-stack
    $rcDown = Invoke-DockerCompose @composeFiles down
    Pop-Location
    if ($rcDown -ne 0) {
        Write-Host "[WARN] docker compose down returned $rcDown — some containers may need manual cleanup." -ForegroundColor Yellow
    }

    if (Test-Path "components\multichannel-access\docker-compose.yml") {
        Push-Location components\multichannel-access
        Invoke-DockerCompose down | Out-Null
        Pop-Location
    }
    Write-Host "[DONE] All services stopped." -ForegroundColor Green
    exit 0
}

# ── 1. Docker check ────────────────────────────────────────────────
Write-Host "[1/6] Checking Docker..." -ForegroundColor Yellow
$dockerInfo = docker info 2>&1
$dockerOk   = ($LASTEXITCODE -eq 0) -and ($dockerInfo -match "Server Version")
if (-not $dockerOk) {
    Write-Host "[ERROR] Docker is not running." -ForegroundColor Red
    Write-Host "        Please start Docker Desktop, wait for it to fully load," -ForegroundColor Red
    Write-Host "        then re-run .\start.ps1" -ForegroundColor Red
    exit 1
}
Write-Host "       Docker is running." -ForegroundColor Green

# ── 2. AI model bootstrap ──────────────────────────────────────────
# Whisper + Piper model files are gitignored (too large for git) but
# the voice-stt and voice-tts containers fail to start without them.
# bootstrap_models.ps1 downloads on first run and skips on subsequent
# runs. A failure here is non-fatal: text chat still works, the
# script just warns and proceeds.
Write-Host "[2/7] Checking AI model files..." -ForegroundColor Yellow
$prevPref = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& "$PSScriptRoot\scripts\bootstrap_models.ps1"
$bootstrapExit = $LASTEXITCODE
$ErrorActionPreference = $prevPref

if ($bootstrapExit -ne 0) {
    Write-Host "[WARN] Model bootstrap returned $bootstrapExit." -ForegroundColor Yellow
    Write-Host "       Voice STT/TTS will be unhealthy. Text chat is unaffected." -ForegroundColor Yellow
    Write-Host "       Retry: .\scripts\bootstrap_models.ps1" -ForegroundColor DarkGray
}

# ── 3. Environment resolution ──────────────────────────────────────
# Strategy: the base haystack-stack/docker-compose.yml hard-codes
#   env_file: - .env
# for two services. If a real .env is missing, compose fails. We
# bridge that gap by copying .env.defaults -> .env on first run.
# .env is gitignored, so this never gets committed accidentally.
Write-Host "[3/7] Resolving environment..." -ForegroundColor Yellow

$EnvFile     = Join-Path $RepoRoot "haystack-stack\.env"
$EnvDefaults = Join-Path $RepoRoot "haystack-stack\.env.defaults"

if (-not (Test-Path $EnvDefaults)) {
    Write-Host "[ERROR] haystack-stack\.env.defaults is missing." -ForegroundColor Red
    Write-Host "        This file ships with the repo. Re-clone or restore it." -ForegroundColor Red
    exit 1
}

$DemoMode = $false
if (Test-Path $EnvFile) {
    Write-Host "       Found haystack-stack\.env (team mode)." -ForegroundColor Green
} else {
    Write-Host "       No haystack-stack\.env found." -ForegroundColor Cyan
    Write-Host "       Bootstrapping from .env.defaults (demo mode)..." -ForegroundColor Cyan
    Copy-Item -LiteralPath $EnvDefaults -Destination $EnvFile -Force
    Write-Host "       Wrote haystack-stack\.env (gitignored)." -ForegroundColor Green
    Write-Host "       To use real API keys later: edit haystack-stack\.env or" -ForegroundColor DarkGray
    Write-Host "       'cp haystack-stack\.env.example haystack-stack\.env'." -ForegroundColor DarkGray
    $DemoMode = $true
}

# ── 3. Backend services up ─────────────────────────────────────────
Write-Host "[4/7] Starting backend services..." -ForegroundColor Yellow

$composeFiles = @("-f", "docker-compose.yml")

# Demo overlay (DEMO_MODE=true + tightened healthchecks) is layered
# only when we just bootstrapped from .env.defaults. A team developer
# with a real .env keeps DEMO_MODE off so their code paths stay
# production-shaped.
if ($DemoMode) {
    $composeFiles += @("-f", "docker-compose.demo.yml")
    Write-Host "       Layering docker-compose.demo.yml (demo overlay)" -ForegroundColor Cyan
} else {
    Write-Host "       Skipping demo overlay (custom .env present)" -ForegroundColor DarkGray
}

if (Test-Path "haystack-stack\docker-compose.override.yml") {
    $composeFiles += @("-f", "docker-compose.override.yml")
}
if (Test-Path "haystack-stack\docker-compose.meta-channels.yml") {
    $composeFiles += @("-f", "docker-compose.meta-channels.yml")
}

Push-Location haystack-stack
try {
    if ($Rebuild) {
        Write-Host "       --Rebuild: rebuilding haystack-chatqna without cache..." -ForegroundColor DarkGray
        $rcBuild = Invoke-DockerCompose @composeFiles build --no-cache haystack-chatqna
        if ($rcBuild -ne 0) {
            Write-Host "[ERROR] docker compose build failed (exit $rcBuild)." -ForegroundColor Red
            Pop-Location
            exit 1
        }
    }
    $rcUp = Invoke-DockerCompose @composeFiles up -d
    if ($rcUp -ne 0) {
        Write-Host "[ERROR] docker compose up failed (exit $rcUp)." -ForegroundColor Red
        Pop-Location
        exit 1
    }
} finally {
    Pop-Location
}
Write-Host "       Backend containers launched." -ForegroundColor Green

# ── 4. Wait for backend health ─────────────────────────────────────
Write-Host "[5/7] Waiting for backend to report healthy..." -ForegroundColor Yellow
$maxWait = 180
$waited  = 0
$healthy = $false

while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 5
    $waited += 5

    $code = ""
    try {
        $code = curl.exe -s -o NUL -w "%{http_code}" http://localhost:8000/health 2>$null
    } catch {}

    if ($code -eq "200") {
        $healthy = $true
        break
    }

    $pct = [math]::Round(($waited / $maxWait) * 100)
    Write-Host ("       Still waiting... ({0,3}s / {1,3}s) [{2}%]" -f $waited, $maxWait, $pct) -ForegroundColor DarkGray
}

if ($healthy) {
    Write-Host "       Backend is healthy." -ForegroundColor Green
} else {
    Write-Host "       Backend not healthy after ${maxWait}s." -ForegroundColor Yellow
    Write-Host "       It may still be loading. Tail logs with:" -ForegroundColor Yellow
    Write-Host "         docker logs --tail 60 -f haystack-chatqna" -ForegroundColor Yellow
}

# ── 5. Frontend ────────────────────────────────────────────────────
$frontendPort = "5174"
if ($SkipFrontend) {
    Write-Host "[6/7] Frontend skipped (--SkipFrontend)." -ForegroundColor DarkGray
} else {
    Write-Host "[6/7] Starting frontend..." -ForegroundColor Yellow

    $frontendPath = Join-Path $RepoRoot "components\frontend"
    if (-not (Test-Path $frontendPath)) {
        Write-Host "       components\frontend not found - skipping frontend." -ForegroundColor Yellow
    } else {
        if (-not (Test-Path (Join-Path $frontendPath "node_modules"))) {
            Write-Host "       First-run: installing frontend dependencies (this takes a minute)..." -ForegroundColor DarkGray
            Push-Location $frontendPath
            try {
                npm install --silent 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "[WARN] npm install returned $LASTEXITCODE - check the frontend manually." -ForegroundColor Yellow
                }
            } finally {
                Pop-Location
            }
        }

        # Detached frontend in a new PowerShell window so this script
        # can keep moving / exit cleanly. Closing that window stops it.
        $startCmd = "Set-Location '$frontendPath'; Write-Host 'AMINA frontend - close this window to stop' -ForegroundColor Cyan; npm run dev"
        Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", $startCmd | Out-Null
        Write-Host "       Frontend launching at http://localhost:$frontendPort" -ForegroundColor Green
    }
}

# ── 6. Summary ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "[7/7] AMINA is ready." -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  AMINA Services"                        -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Chat UI:        http://localhost:$frontendPort" -ForegroundColor White
Write-Host "  Backend API:    http://localhost:8000"          -ForegroundColor White
Write-Host "  Health check:   http://localhost:8000/health"   -ForegroundColor White
Write-Host "  ArcadeDB:       http://localhost:2480"          -ForegroundColor White

# Voice service health (best-effort; non-fatal if down)
$sttCode = ""
$ttsCode = ""
try { $sttCode = curl.exe -s -o NUL -w "%{http_code}" --max-time 2 http://localhost:8087/ 2>$null } catch {}
try { $ttsCode = curl.exe -s -o NUL -w "%{http_code}" --max-time 2 http://localhost:5500/health 2>$null } catch {}
$sttOk = ($sttCode -eq "200" -or $sttCode -eq "404")  # whisper-server returns 404 on / but is alive
$ttsOk = ($ttsCode -eq "200")
$sttTag = if ($sttOk) { "[OK]" } else { "[NOT READY — model may still be downloading]" }
$ttsTag = if ($ttsOk) { "[OK]" } else { "[NOT READY — model may still be downloading]" }
$sttColor = if ($sttOk) { "Green" } else { "Yellow" }
$ttsColor = if ($ttsOk) { "Green" } else { "Yellow" }
Write-Host "  Voice STT:      http://localhost:8087  $sttTag" -ForegroundColor $sttColor
Write-Host "  Voice TTS:      http://localhost:5500  $ttsTag" -ForegroundColor $ttsColor
Write-Host ""

if ($DemoMode) {
    Write-Host "  MODE: Demo (using .env.defaults values)" -ForegroundColor Cyan
    Write-Host "  NOTE: External providers (OpenAI, Twilio, DHIS2, Meta) are" -ForegroundColor DarkGray
    Write-Host "        disabled. The agent's local fallback chain is exercised." -ForegroundColor DarkGray
    Write-Host "        For real keys, edit haystack-stack\.env and re-run." -ForegroundColor DarkGray
} else {
    Write-Host "  MODE: Team (using haystack-stack\.env)" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Stop:    .\start.ps1 -Stop" -ForegroundColor DarkGray
Write-Host "  Rebuild: .\start.ps1 -Rebuild" -ForegroundColor DarkGray
Write-Host "  Logs:    docker logs --tail 60 -f haystack-chatqna" -ForegroundColor DarkGray
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
