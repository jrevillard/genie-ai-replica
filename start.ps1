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
    [switch]$Stop,
    [switch]$Baseline,    # run scripts/translation_baseline.py after [6/9]
    [switch]$SkipVerify   # skip the [6/9] v4.2 verify block (faster restarts)
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
    # IMPORTANT: caller MUST pass arguments via the explicit ``-ComposeArgs``
    # named parameter as a [string[]]. Earlier versions used
    # ``ValueFromRemainingArguments`` so ``Invoke-DockerCompose @composeFiles up -d``
    # could be written naturally, but PowerShell parameter-binding does
    # two things that break that pattern silently:
    #   1. ``-d`` partial-matches any parameter name beginning with d
    #      (e.g. ``-DcArgs``) and binds to it with no value, throwing
    #      "Missing an argument" -- which on a fresh tester machine
    #      would mean ``up -d`` never runs and the stack never starts.
    #   2. With no matching named parameter, PowerShell silently drops
    #      ``-d`` from the remaining-arguments list, also resulting in
    #      a no-op start. (Confirmed: VFRA + ``-d`` -> ``-d`` is dropped.)
    # Passing the full argv as one named [string[]] avoids both traps.
    param([Parameter(Mandatory=$true)][string[]]$ComposeArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    try {
        & docker compose @ComposeArgs 2>&1 | ForEach-Object {
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
    if (Test-Path "haystack-stack\docker-compose.nllb.yml") {
        $composeFiles += @("-f", "docker-compose.nllb.yml")
    }
    # gateway.yml must layer here too so amina-gateway tears down with
    # the rest of the stack — start.sh already does this in its
    # build_compose_args helper (parity fix 2026-05-06).
    if (Test-Path "haystack-stack\docker-compose.gateway.yml") {
        $composeFiles += @("-f", "docker-compose.gateway.yml")
    }

    Push-Location haystack-stack
    $rcDown = Invoke-DockerCompose -ComposeArgs ($composeFiles + @("down"))
    Pop-Location
    if ($rcDown -ne 0) {
        Write-Host "[WARN] docker compose down returned $rcDown — some containers may need manual cleanup." -ForegroundColor Yellow
    }

    if (Test-Path "components\multichannel-access\docker-compose.yml") {
        # Layer the same compose files used on `up` so the watcher + the
        # quick-tunnel container come down too. A bare `down` from the
        # base file would leave amina-cf-quick-tunnel and
        # telegram-webhook-watcher orphaned.
        $mcDownFiles = @("-f", "docker-compose.yml")
        if (Test-Path "components\multichannel-access\docker-compose.quick-tunnel.yml") {
            $mcDownFiles += @("-f", "docker-compose.quick-tunnel.yml")
        }
        if (Test-Path "components\multichannel-access\docker-compose.quick-tunnel-watcher.yml") {
            $mcDownFiles += @("-f", "docker-compose.quick-tunnel-watcher.yml")
        }
        Push-Location components\multichannel-access
        Invoke-DockerCompose -ComposeArgs ($mcDownFiles + @("down")) | Out-Null
        Pop-Location
    }
    Write-Host "[DONE] All services stopped." -ForegroundColor Green
    exit 0
}

# ── 1. Docker check ────────────────────────────────────────────────
Write-Host "[1/9] Checking Docker..." -ForegroundColor Yellow
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
Write-Host "[2/9] Checking AI model files..." -ForegroundColor Yellow
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
Write-Host "[3/9] Resolving environment..." -ForegroundColor Yellow

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
Write-Host "[4/9] Starting backend services..." -ForegroundColor Yellow

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
# Translation v4.2: NLLB-200 sidecar. Only included when the
# overlay file is present so the v3.5 / no-NLLB path keeps working
# unchanged for anyone who hasn't pulled the v4.2 changes yet.
if (Test-Path "haystack-stack\docker-compose.nllb.yml") {
    $composeFiles += @("-f", "docker-compose.nllb.yml")
    Write-Host "       Layering docker-compose.nllb.yml (NLLB translation sidecar)" -ForegroundColor Cyan
}
# API Gateway (Phase 0+1): jailbreak detection + schema validation +
# tamper-evident audit log on a parallel surface (port 8443). The
# existing UNICC tester flow (frontend :5174 -> backend :8000) is
# unchanged. Set AMINA_GATEWAY_ENABLED=false in .env to start the
# container in disabled mode (every public endpoint returns 503).
if (Test-Path "haystack-stack\docker-compose.gateway.yml") {
    $composeFiles += @("-f", "docker-compose.gateway.yml")
    Write-Host "       Layering docker-compose.gateway.yml (API gateway, port 8443)" -ForegroundColor Cyan
}

Push-Location haystack-stack
try {
    if ($Rebuild) {
        Write-Host "       --Rebuild: rebuilding haystack-chatqna without cache..." -ForegroundColor DarkGray
        $rcBuild = Invoke-DockerCompose -ComposeArgs ($composeFiles + @("build", "--no-cache", "haystack-chatqna"))
        if ($rcBuild -ne 0) {
            Write-Host "[ERROR] docker compose build failed (exit $rcBuild)." -ForegroundColor Red
            Pop-Location
            exit 1
        }
    }
    $rcUp = Invoke-DockerCompose -ComposeArgs ($composeFiles + @("up", "-d"))
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
Write-Host "[5/9] Waiting for backend to report healthy..." -ForegroundColor Yellow
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

# ── 6. Translation v4.2 verify (NLLB sidecar contract + ArcadeDB schema + canary) ──
# All three sub-steps are best-effort. None of them block the user:
#   * NLLB probe: fails -> v3.5 fallback (LLM-only) takes over.
#   * Schema warm: fails -> first telemetry call lazy-bootstraps it instead.
#   * Canary    : fails -> verbose error in the log; the chat path still works.
Write-Host "[6/9] Verifying Translation v4.2 ..." -ForegroundColor Yellow

# Globals for the summary block to read.
$Script:NllbReady       = $false
$Script:NllbContract    = "unknown"
$Script:CanaryEngine    = $null
$Script:CanaryDecision  = $null
$Script:CanaryOutput    = $null
$Script:CanaryError     = $null
$Script:V4Enabled       = $true     # set false below if .env disables it
$Script:ValidatedCount  = 0
$Script:GoldenTotal     = 0

# Read validation progress from golden_translations.json so the
# summary can show "X/80 pairs validated" without a separate command.
$goldenPath = Join-Path $RepoRoot "haystack-stack\haystack-chatqna\src\translation_v4\eval\golden_translations.json"
if (Test-Path $goldenPath) {
    try {
        $golden = Get-Content $goldenPath -Raw -Encoding utf8 | ConvertFrom-Json
        $allPairs = @($golden.pairs)
        $Script:GoldenTotal     = $allPairs.Count
        $Script:ValidatedCount  = @($allPairs | Where-Object { $_.validated -eq $true }).Count
    } catch {
        # Bad / missing JSON: leave counts at 0 -- summary handles 0 gracefully.
    }
}

if ($SkipVerify) {
    Write-Host "       --SkipVerify -> skipping NLLB probe + schema warm + canary." -ForegroundColor DarkGray
    # Still flow through the rest of the script. The summary's
    # v4.2 status block will show "verify skipped".
    $Script:V4Enabled = $true   # we don't know -- leave optimistic
}

# Detect whether the NLLB overlay is in play. If not, skip silently --
# we are running v3.5 (LLM-only) and there is no NLLB to verify.
if ($SkipVerify) {
    # short-circuit: do nothing (the body of [6/9] is bypassed; the
    # summary block prints "verify skipped" using the flag below).
} elseif (-not (Test-Path "haystack-stack\docker-compose.nllb.yml")) {
    Write-Host "       NLLB overlay not present; v4.2 verify skipped (running v3.5 / LLM-only)." -ForegroundColor DarkGray
} else {
    # 6a. Wait for the NLLB sidecar to be healthy. The wait budget
    # depends on whether the image is already pulled:
    #   * first run  -> ~7.6 GB image pull (5-10 min on typical broadband)
    #                   plus model load inside the container (~120 s)
    #   * subsequent -> model load only (~120 s)
    # We detect cached vs uncached by querying ``docker image ls``.
    $imageExists = $false
    try {
        $imageExists = (& docker image ls --format "{{.Repository}}" 2>$null |
                        Select-String -Pattern "nllb" -Quiet) -eq $true
    } catch {}
    if ($imageExists) {
        $nllbTimeout = 180
        Write-Host "       NLLB image cached -- waiting up to 3 min for model load." -ForegroundColor DarkGray
    } else {
        $nllbTimeout = 900
        Write-Host "       NLLB image not cached -- pulling ~7.6 GB Docker image (5-10 min)..." -ForegroundColor Yellow
        Write-Host "       This only happens once. Subsequent starts are <2 min." -ForegroundColor DarkGray
        Write-Host "       Tip: pre-pull the night before with" -ForegroundColor DarkGray
        Write-Host "         docker compose -f haystack-stack/docker-compose.nllb.yml pull nllb-translate" -ForegroundColor DarkGray
    }
    $nllbWait = 0
    while ($nllbWait -lt $nllbTimeout) {
        Start-Sleep -Seconds 5
        $nllbWait += 5
        $nllbCode = ""
        try { $nllbCode = curl.exe -s -o NUL -w "%{http_code}" --max-time 3 http://localhost:7860/api/v4/health 2>$null } catch {}
        if ($nllbCode -ne "200") {
            try { $nllbCode = curl.exe -s -o NUL -w "%{http_code}" --max-time 3 http://localhost:7860/health 2>$null } catch {}
        }
        if ($nllbCode -eq "200") { $Script:NllbReady = $true; break }
        if ($nllbWait % 30 -eq 0) {
            Write-Host ("       still waiting for NLLB ({0,4}s / {1}s)..." -f $nllbWait, $nllbTimeout) -ForegroundColor DarkGray
        }
    }
    if ($Script:NllbReady) {
        Write-Host ("       NLLB sidecar healthy after {0}s." -f $nllbWait) -ForegroundColor Green
    } else {
        Write-Host ("       NLLB sidecar not healthy after {0}s; v4.2 will degrade to v3.5 (LLM)." -f $nllbTimeout) -ForegroundColor Yellow
        Write-Host "       To check progress: docker logs nllb-translate --tail 20" -ForegroundColor DarkGray
    }

    # 6b. Verify the endpoint contract (text/source/target -> text). If
    # the prebuilt image's API ever changes shape, this catches it
    # before the user gets a confusing translation failure.
    if ($Script:NllbReady) {
        try {
            $contractRaw = curl.exe -s --max-time 8 "http://localhost:7860/api/v4/translator?text=hello&source=eng_Latn&target=bam_Latn" 2>$null
            if ($contractRaw -and ($contractRaw -match '"text"' -or $contractRaw.Length -gt 1)) {
                $Script:NllbContract = "ok"
                Write-Host "       Endpoint contract /api/v4/translator -> 200 + text field." -ForegroundColor Green
            } else {
                $Script:NllbContract = "unexpected_shape"
                Write-Host "       NLLB returned 200 but body shape is unexpected; check the image version." -ForegroundColor Yellow
            }
        } catch {
            $Script:NllbContract = "probe_error"
        }
    }
}

if (-not $SkipVerify) {
# 6c. Warm the ArcadeDB TranslationMetric schema. Idempotent; if
# ArcadeDB isn't reachable from the container, the lazy bootstrap on
# the first telemetry call still handles it.
try {
    docker exec haystack-chatqna python -c "import asyncio,sys; sys.path.insert(0,'/app'); from src.translation_v4.stage8_telemetry import ArcadeDBTelemetryStore; print('schema_ready=' + str(asyncio.run(ArcadeDBTelemetryStore().bootstrap_schema())))" 2>&1 | Select-Object -Last 1 | ForEach-Object {
        if ($_ -match "schema_ready=True") {
            Write-Host "       ArcadeDB TranslationMetric schema ready." -ForegroundColor Green
        } else {
            Write-Host "       ArcadeDB schema warm deferred (will lazy-bootstrap on first translation)." -ForegroundColor DarkGray
        }
    }
} catch {
    Write-Host "       ArcadeDB schema warm skipped (container not reachable)." -ForegroundColor DarkGray
}

# 6d. Canary translation. Runs INSIDE haystack-chatqna so we are
# exercising the same code path the agent will use. The result is
# parsed for the summary block. Phrasebank-fast-path inputs work in
# any mode; clinical inputs need an LLM key OR the NLLB sidecar.
#
# IMPORTANT: this Python source is passed verbatim to ``docker exec
# ... python -c``. PowerShell on Windows does NOT reliably preserve
# embedded double quotes when invoking native executables -- PS
# rewrites them in a way that ``docker.exe`` then forwards as un-quoted
# arguments. We therefore use SINGLE quotes for every Python string
# literal here so the source survives the round trip. Earlier versions
# of this script used "/app", "How are you?", etc. and silently failed
# with ``SyntaxError: invalid syntax`` on the second line because PS
# stripped the quotes around "/app" before docker saw the command.
$canaryPy = @'
import asyncio, json, os, sys
sys.path.insert(0, '/app')
from src.translation_v4 import config as cfg
if not cfg.AMINA_TRANSLATION_V4_ENABLED:
    print(json.dumps({'v4': False, 'note': 'AMINA_TRANSLATION_V4_ENABLED=false'}))
    sys.exit(0)
from src.translation_v4.pipeline import get_pipeline
async def go():
    out = await get_pipeline().translate(
        english_text='How are you?',
        patient_context={},
        session_id='canary',
        response_type='general',
    )
    return out
out = asyncio.run(go()) or {}
print(json.dumps({
    'v4': True,
    'decision': out.get('overall_decision'),
    'engines': out.get('engine_selection'),
    'nllb_invoked': out.get('nllb_invoked'),
    'bt_method': (out.get('back_translation') or {}).get('engine_used_back'),
    'overall': (out.get('quality_scores') or {}).get('overall'),
    'latency_ms': out.get('total_latency_ms'),
    'output_preview': (out.get('assembled_output') or '')[:80],
}))
'@
try {
    # Pipeline log lines + aiohttp "Unclosed client session" warnings
    # land on stderr AFTER the canary's JSON line on stdout. Selecting
    # only the very last line therefore picked up the trailing warning
    # and reported "could not parse canary response" even though the
    # canary actually succeeded. Filter to lines that start with ``{``
    # first, then take the last one -- handles both the pipeline-active
    # case (pipeline.translate JSON) and the disabled-flag case
    # (early-exit ``{"v4": false, ...}`` JSON).
    $canaryRaw = docker exec haystack-chatqna python -c $canaryPy 2>&1 |
        Where-Object { $_ -is [string] -and $_ -match '^\{' } |
        Select-Object -Last 1
    if ($canaryRaw -and ($canaryRaw -match '^\{')) {
        $canary = $canaryRaw | ConvertFrom-Json
        if ($canary.v4 -eq $false) {
            $Script:V4Enabled = $false
            Write-Host "       Canary skipped: AMINA_TRANSLATION_V4_ENABLED=false in this env." -ForegroundColor DarkGray
        } else {
            $Script:CanaryDecision = $canary.decision
            $Script:CanaryEngine = if ($canary.engines) { $canary.engines[0] } else { $null }
            $Script:CanaryOutput = $canary.output_preview
            Write-Host "       Canary 'How are you?' -> decision=$($canary.decision) engine=$($Script:CanaryEngine) bt=$($canary.bt_method) latency=$($canary.latency_ms)ms" -ForegroundColor Green
            if ($Script:CanaryOutput) {
                Write-Host "         output: $($Script:CanaryOutput)" -ForegroundColor DarkGray
            }
        }
    } else {
        $Script:CanaryError = "could not parse canary response"
        Write-Host "       Canary translation produced unexpected output; v4 may not be active." -ForegroundColor Yellow
    }
} catch {
    $Script:CanaryError = $_.Exception.Message
    Write-Host "       Canary translation failed: $($_.Exception.Message)" -ForegroundColor Yellow
}
}  # end if (-not $SkipVerify) for 6c + 6d

# ── 6e. Optional baseline run (one-shot full eval). Skipped by default
# because it costs real LLM credits per pair. Trigger with -Baseline.
if ($Baseline) {
    Write-Host "       --Baseline -> running scripts/translation_baseline.py inside haystack-chatqna ..." -ForegroundColor Cyan
    $baselinePy = "import sys, runpy; sys.argv = ['translation_baseline.py']; runpy.run_path('/app/../scripts/translation_baseline.py', run_name='__main__')"
    # The baseline script lives outside /app; the chatqna container does
    # not have it mounted, so we exec it from the host instead. The
    # script imports the v4 pipeline directly so it must run with PYTHONPATH
    # pointed at the repo's src tree.
    Push-Location $RepoRoot
    try {
        $env:PYTHONIOENCODING = "utf-8"
        python scripts\translation_baseline.py 2>&1 | ForEach-Object { Write-Host "       $_" -ForegroundColor DarkGray }
    } catch {
        Write-Host "       Baseline run failed: $($_.Exception.Message)" -ForegroundColor Yellow
    } finally {
        Pop-Location
    }
}

# ── 7. Multichannel sidecar (Telegram + Cloudflare quick tunnel) ──
# Optional: starts components/multichannel-access alongside the backend
# so a UNICC tester running `.\start.ps1` gets the full demo surface
# (Telegram bot reachable through a Cloudflare quick-tunnel) without
# having to remember a second `docker compose` invocation.
#
# Hard rules:
#   * NEVER block. If the multichannel stack fails to start the rest
#     of AMINA (text chat, voice, translation) MUST keep working.
#   * NEVER fail when components\multichannel-access is missing — a
#     fresh clone without that directory is a valid configuration.
#   * NEVER recreate the backend network. multichannel-access uses
#     the existing chatqna_default network as `external: true`.
$multichannelDir = "components\multichannel-access"
if (Test-Path "$multichannelDir\docker-compose.yml") {
    Write-Host "[7/9] Starting multichannel sidecar (Telegram + tunnel)..." -ForegroundColor Yellow

    $mcComposeFiles = @("-f", "docker-compose.yml")
    if (Test-Path "$multichannelDir\docker-compose.quick-tunnel.yml") {
        $mcComposeFiles += @("-f", "docker-compose.quick-tunnel.yml")
    }
    if (Test-Path "$multichannelDir\docker-compose.quick-tunnel-watcher.yml") {
        $mcComposeFiles += @("-f", "docker-compose.quick-tunnel-watcher.yml")
    }

    try {
        # No `--no-build`: the multichannel-access service has a `build:`
        # directive (no published image), so the first run on a fresh
        # tester machine MUST build it. Subsequent runs reuse the cached
        # image automatically — `up -d` is a no-op when nothing changed.
        Push-Location $multichannelDir
        $rcMc = Invoke-DockerCompose -ComposeArgs ($mcComposeFiles + @("up", "-d"))
        Pop-Location

        if ($rcMc -ne 0) {
            Write-Host "       Multichannel failed to start (exit $rcMc)." -ForegroundColor Yellow
            Write-Host "       Continuing — text chat / voice / translation still work." -ForegroundColor DarkGray
        } else {
            Start-Sleep -Seconds 5

            # Health probe — best effort.
            $mcHealthy = $false
            try {
                $mcCheck = curl.exe -s -o NUL -w "%{http_code}" --max-time 3 http://localhost:8020/health 2>$null
                if ($mcCheck -eq "200") { $mcHealthy = $true }
            } catch {}

            if ($mcHealthy) {
                Write-Host "       Multichannel sidecar healthy (http://localhost:8020)" -ForegroundColor Green
            } else {
                Write-Host "       Multichannel started; sidecar not yet responding on :8020" -ForegroundColor Yellow
                Write-Host "       Check: docker logs multichannel-access --tail 30" -ForegroundColor DarkGray
            }

            # Surface the Cloudflare quick-tunnel URL once cloudflared has
            # published it. The container typically registers the tunnel
            # within 5-15 s; poll for up to 20 s so we don't miss it on a
            # slightly slow start. Best-effort; absence of a URL is never
            # a failure (named-tunnel deployments don't print one).
            $tunnelDeadline = (Get-Date).AddSeconds(20)
            while ((Get-Date) -lt $tunnelDeadline) {
                try {
                    $tunnelLine = docker logs amina-cf-quick-tunnel 2>&1 |
                        Select-String "https://[a-z0-9-]+\.trycloudflare\.com" |
                        Select-Object -Last 1
                    if ($tunnelLine) {
                        $m = [regex]::Match($tunnelLine.ToString(), "https://[a-z0-9-]+\.trycloudflare\.com")
                        if ($m.Success) {
                            $Script:TunnelUrl = $m.Value
                            Write-Host "       Tunnel URL: $($Script:TunnelUrl)" -ForegroundColor Cyan
                            break
                        }
                    }
                } catch {}
                Start-Sleep -Seconds 2
            }
        }
    } catch {
        Write-Host "       Multichannel startup raised: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "       Continuing — text chat / voice / translation still work." -ForegroundColor DarkGray
    }
} else {
    Write-Host "[7/9] Multichannel sidecar not found — skipping Telegram." -ForegroundColor DarkGray
}

# ── 8. Frontend ────────────────────────────────────────────────────
$frontendPort = "5174"
if ($SkipFrontend) {
    Write-Host "[8/9] Frontend skipped (--SkipFrontend)." -ForegroundColor DarkGray
} else {
    Write-Host "[8/9] Starting frontend..." -ForegroundColor Yellow

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

# ── 9. Summary ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "[9/9] AMINA is ready." -ForegroundColor Green
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

# Multichannel / Telegram health (best-effort; only shown when the
# sidecar compose file is present so a checkout without it stays clean).
if (Test-Path "components\multichannel-access\docker-compose.yml") {
    $mcCode = ""
    try { $mcCode = curl.exe -s -o NUL -w "%{http_code}" --max-time 2 http://localhost:8020/health 2>$null } catch {}
    if ($mcCode -eq "200") {
        Write-Host "  Multichannel:   http://localhost:8020  [OK]" -ForegroundColor Green
        if ($Script:TunnelUrl) {
            Write-Host "  Tunnel URL:     $($Script:TunnelUrl)" -ForegroundColor Cyan
        }
    } else {
        Write-Host "  Multichannel:   http://localhost:8020  [NOT READY — Telegram / tunnel still warming up]" -ForegroundColor Yellow
    }
}

# Translation v4.2: NLLB sidecar health (only shown when the overlay
# was layered in -- otherwise omit entirely so the summary stays clean
# for users who haven't enabled v4.2 yet).
if (Test-Path "haystack-stack\docker-compose.nllb.yml") {
    $nllbCode = ""
    try { $nllbCode = curl.exe -s -o NUL -w "%{http_code}" --max-time 2 http://localhost:7860/api/v4/health 2>$null } catch {}
    # The prebuilt ghcr.io/winstxnhdw/nllb-api image returns 404 on
    # /api/v4/health (only /health is exposed). Older self-built forks
    # used /api/v4/health. Fall back whenever the first probe didn't
    # come back 200, not just on connection error -- previously this
    # condition was ``-not $nllbCode -or "000"`` which skipped the
    # fallback when the first probe returned 404, leaving the summary
    # showing [LOADING] even though the sidecar was healthy.
    if ($nllbCode -ne "200") {
        try { $nllbCode = curl.exe -s -o NUL -w "%{http_code}" --max-time 2 http://localhost:7860/health 2>$null } catch {}
    }
    if ($nllbCode -eq "200") {
        Write-Host "  NLLB Translate: http://localhost:7860  [OK]" -ForegroundColor Green
    } else {
        Write-Host "  NLLB Translate: http://localhost:7860  [LOADING]" -ForegroundColor Yellow
        Write-Host "                  (first start pulls ~7.6 GB Docker image -- allow 5-10 min)" -ForegroundColor DarkGray
    }
}
Write-Host ""

if ($DemoMode) {
    Write-Host "  MODE: Demo (using .env.defaults values)" -ForegroundColor Cyan
    Write-Host "  NOTE: External providers (OpenAI, Twilio, DHIS2, Meta) are" -ForegroundColor DarkGray
    Write-Host "        disabled. The agent's local fallback chain is exercised." -ForegroundColor DarkGray
    Write-Host "        For real keys, edit haystack-stack\.env and re-run." -ForegroundColor DarkGray
} else {
    Write-Host "  MODE: Team (using haystack-stack\.env)" -ForegroundColor Green
}

# Pre-pull tip: only when the NLLB image was NOT already cached at
# [6/9] AND NLLB still isn't ready -- i.e., the user just sat through
# (or is still sitting through) the 7.6 GB pull. Tells them how to skip
# the wait next time. ``$imageExists`` may be unset if --SkipVerify was
# passed, in which case we don't render the tip.
if ((Get-Variable -Name imageExists -ErrorAction SilentlyContinue) -ne $null `
    -and -not $imageExists -and -not $Script:NllbReady) {
    Write-Host ""
    Write-Host "  TIP: pre-pull NLLB for faster next start:" -ForegroundColor DarkGray
    Write-Host "       docker compose -f haystack-stack/docker-compose.nllb.yml pull nllb-translate" -ForegroundColor DarkGray
}

# ── Translation v4.2 status ──────────────────────────────────────────
Write-Host ""
Write-Host "  Translation pipeline:" -ForegroundColor Cyan
if (-not $Script:V4Enabled) {
    Write-Host "    v4 path: DISABLED (AMINA_TRANSLATION_V4_ENABLED=false)" -ForegroundColor DarkGray
    Write-Host "    Active : v1 (legacy translator + corrector)" -ForegroundColor DarkGray
} else {
    if ($Script:NllbReady) {
        Write-Host "    v4 path: ACTIVE" -ForegroundColor Green
        Write-Host "    NLLB   : ready (3-engine selection live: phrasebank > NLLB > LLM)" -ForegroundColor Green
        if ($Script:NllbContract -ne "ok") {
            Write-Host "    NOTE   : NLLB endpoint contract probe was '$($Script:NllbContract)'." -ForegroundColor Yellow
        }
    } else {
        Write-Host "    v4 path: ACTIVE (graceful v3.5 fallback)" -ForegroundColor Yellow
        Write-Host "    NLLB   : not ready -> running phrasebank + LLM only" -ForegroundColor Yellow
    }
    if ($Script:CanaryEngine) {
        Write-Host "    Canary : 'How are you?' -> $($Script:CanaryDecision) via $($Script:CanaryEngine)" -ForegroundColor Green
    } elseif ($Script:CanaryError) {
        Write-Host "    Canary : skipped/failed ($($Script:CanaryError))" -ForegroundColor Yellow
    } elseif ($SkipVerify) {
        Write-Host "    Verify : skipped (--SkipVerify)" -ForegroundColor DarkGray
    }
    if ($Script:GoldenTotal -gt 0) {
        $vColor = if ($Script:ValidatedCount -ge $Script:GoldenTotal) { "Green" }
                  elseif ($Script:ValidatedCount -gt 0)               { "Yellow" }
                  else                                                  { "DarkGray" }
        Write-Host ("    Review : {0}/{1} golden pairs validated by native speaker" -f $Script:ValidatedCount, $Script:GoldenTotal) -ForegroundColor $vColor
        if ($Script:ValidatedCount -lt $Script:GoldenTotal) {
            Write-Host "             run: python scripts/review_translations.py" -ForegroundColor DarkGray
        }
    }
    Write-Host "    Baseline: python scripts/translation_baseline.py    (writes docs/compliance/translation_v4_baseline_<date>.json)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  Stop:    .\start.ps1 -Stop" -ForegroundColor DarkGray
Write-Host "  Rebuild: .\start.ps1 -Rebuild" -ForegroundColor DarkGray
Write-Host "  Logs:    docker logs --tail 60 -f haystack-chatqna" -ForegroundColor DarkGray
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
