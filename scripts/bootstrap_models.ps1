# ============================================
# AMINA Model Bootstrapper (Windows / PowerShell)
# ============================================
# Downloads the AI model weights that voice-stt and voice-tts
# expect to find bind-mounted into their containers. Called
# automatically by start.ps1 on first run; re-running is idempotent
# (already-present files are skipped).
#
# Manual use (e.g. retry after a network blip):
#   .\scripts\bootstrap_models.ps1
#   .\scripts\bootstrap_models.ps1 -Force   # re-download even if present
#
# NOTE: Translation v4.2 ships NLLB-200 inside its own sidecar
# container (haystack-stack/docker-compose.nllb.yml). Docker handles
# the ~7.6 GB NLLB image pull on first sidecar start (model + runtime
# + dependencies) -- no host action needed and no entry in this
# script's models list. Whisper + Piper stay here because they
# bind-mount from the host.
#
# Paths below match haystack-stack/docker-compose.yml exactly:
#   voice-stt:    ../components/voice-gateway/infra/whispercpp/models:/models:ro
#                 command: ... -m /models/ggml-base.en.bin
#   voice-tts:    ../components/voice-gateway/infra/piper/models:/models/piper:ro
#                 PIPER_MODEL_PATH=/models/piper/en_US-lessac-medium.onnx
#   voice-tts-mnk: HuggingFace cache + image PREWARM -- no host download needed.
# ============================================

param([switch]$Force)

# Use Continue (not Stop): curl writes its progress bar to stderr,
# and PowerShell 5.1 wraps every stderr line as NativeCommandError
# under ErrorActionPreference=Stop -- which would throw before curl
# finished. We check $LASTEXITCODE explicitly instead.
$ErrorActionPreference = "Continue"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

Write-Host ""
Write-Host "[MODELS] Checking required AI models..." -ForegroundColor Yellow

$models = @(
    @{
        Name = "Whisper STT (base.en)"
        Url  = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
        Path = "components/voice-gateway/infra/whispercpp/models/ggml-base.en.bin"
        Size = "148 MB"
    },
    @{
        Name = "Piper TTS voice (en_US-lessac-medium)"
        Url  = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
        Path = "components/voice-gateway/infra/piper/models/en_US-lessac-medium.onnx"
        Size = "63 MB"
    },
    @{
        Name = "Piper TTS config (en_US-lessac-medium)"
        Url  = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"
        Path = "components/voice-gateway/infra/piper/models/en_US-lessac-medium.onnx.json"
        Size = "5 KB"
    }
)

$downloaded = 0
$skipped    = 0
$failures   = @()

foreach ($m in $models) {
    $fullPath = Join-Path $RepoRoot $m.Path

    if ((Test-Path $fullPath) -and (-not $Force)) {
        $sz = (Get-Item $fullPath).Length
        if ($sz -gt 1024) {
            $mb = [math]::Round($sz / 1MB, 1)
            Write-Host ("  [OK]       {0,-45}  {1,7} MB (already present)" -f $m.Name, $mb) -ForegroundColor DarkGray
            $skipped++
            continue
        }
        # File exists but is suspiciously small -- treat as corrupt, re-download
        Write-Host ("  [STALE]    {0} (size {1} bytes -- re-downloading)" -f $m.Name, $sz) -ForegroundColor Yellow
    }

    $dir = Split-Path $fullPath -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }

    Write-Host ("  [DOWNLOAD] {0,-45}  ~{1}" -f $m.Name, $m.Size) -ForegroundColor Cyan
    Write-Host ("             {0}" -f $m.Url) -ForegroundColor DarkGray

    $tmp = "$fullPath.partial"
    # Redirect curl's stderr to stdout, then to $null, so the progress
    # bar does not pollute the script's own output (and does not get
    # re-wrapped as NativeCommandError noise). Real failures still
    # surface via $LASTEXITCODE, which we check below.
    & curl.exe -L --fail --retry 2 --silent --show-error -o "$tmp" "$($m.Url)" 2>&1 | Out-Null
    $rc = $LASTEXITCODE
    $err = ""
    if ($rc -ne 0) { $err = "curl exit $rc" }
    elseif (-not (Test-Path $tmp)) { $err = "no file at $tmp after curl" }
    elseif ((Get-Item $tmp).Length -le 1024) { $err = "downloaded file too small ($((Get-Item $tmp).Length) bytes)" }

    if ($err) {
        if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
        Write-Host ("  [FAIL]     {0}" -f $err) -ForegroundColor Red
        Write-Host ("             Manual: curl.exe -L -o `"{0}`" `"{1}`"" -f $fullPath, $m.Url) -ForegroundColor Yellow
        $failures += $m.Name
    } else {
        Move-Item -LiteralPath $tmp -Destination $fullPath -Force
        $mb = [math]::Round((Get-Item $fullPath).Length / 1MB, 1)
        Write-Host ("  [OK]       Saved $mb MB") -ForegroundColor Green
        $downloaded++
    }
}

Write-Host ""
if ($failures.Count -gt 0) {
    Write-Host ("[MODELS] Downloaded {0}, skipped {1}, FAILED {2}" -f $downloaded, $skipped, $failures.Count) -ForegroundColor Yellow
    foreach ($f in $failures) { Write-Host ("         FAIL: {0}" -f $f) -ForegroundColor Yellow }
    Write-Host "         Voice STT/TTS will be unhealthy until the failed models are resolved." -ForegroundColor Yellow
    Write-Host "         Text chat works without them." -ForegroundColor DarkGray
    exit 1
} elseif ($downloaded -gt 0) {
    Write-Host ("[MODELS] Downloaded {0}, skipped {1}" -f $downloaded, $skipped) -ForegroundColor Green
} else {
    Write-Host ("[MODELS] All models present (skipped {0})" -f $skipped) -ForegroundColor Green
}
Write-Host ""
exit 0
