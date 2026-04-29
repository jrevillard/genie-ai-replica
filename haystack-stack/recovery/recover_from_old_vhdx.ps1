#Requires -RunAsAdministrator
<#
    AMINA Care — VHDX Recovery Script
    ==================================

    Purpose:
      Non-destructively recover yesterday's ArcadeDB data from the old
      Docker Desktop / WSL2 VHDX files that survived the OS reinstall.
      The old drive (former C:) is now D:. All source files under D:
      are read-only to this script — every write goes under E:\...\_recovery\.

    What it does (safe / additive only):
      1. Creates E:\...\haystack-stack\_recovery\ staging tree.
      2. Copies the OLD Docker Desktop child + parent VHDX to staging.
      3. Copies the OLD standalone WSL distro VHDX to staging.
      4. Re-bases the differencing chain to the copies so the parent
         link resolves on this fresh OS install.
      5. Merges the differencing chain into a single standalone VHDX.
      6. Registers BOTH candidates as new WSL distros:
            amina-standalone-recovery   (1.5 GB — likely user distro)
            amina-docker-recovery       (merged Docker Desktop distro)
      7. Probes both for ArcadeDB data markers (bucket files, volume dirs).
      8. Prints a short report so we know which distro has the data.

    What it does NOT do:
      - Never touches files under D:\ except reads.
      - Never touches the running docker-desktop WSL distro on C:.
      - Never writes to ./data/arcadedb on E: (that step comes later,
        only after we confirm where the data is and you approve the copy).

    Run:
      Open PowerShell as Administrator, then:
          Set-ExecutionPolicy -Scope Process Bypass -Force
          .\recover_from_old_vhdx.ps1

    Rollback (if you want to undo everything this script did):
          wsl --unregister amina-standalone-recovery
          wsl --unregister amina-docker-recovery
          Remove-Item -Recurse -Force E:\GenAI\amina\genie-ai-replica\haystack-stack\_recovery
#>

$ErrorActionPreference = "Stop"

# ──────────────────────────────────────────────────────────────────────────────
# Paths
# ──────────────────────────────────────────────────────────────────────────────

$OldDockerChild   = "D:\Users\User\AppData\Local\Docker\wsl\main\ext4.vhdx"
$OldDockerParent  = "D:\Program Files\Docker\Docker\resources\wsl\ext4.vhdx"
$OldStandaloneWsl = "D:\Users\User\AppData\Local\wsl\{f5df99dd-00ee-4857-92e4-fd9d0dd3b6e0}\ext4.vhdx"

$RecoveryRoot = "E:\GenAI\amina\genie-ai-replica\haystack-stack\_recovery"
$StageDocker  = Join-Path $RecoveryRoot "docker"
$StageStandal = Join-Path $RecoveryRoot "standalone"
$StageMerged  = Join-Path $RecoveryRoot "merged"

$LogFile      = Join-Path $RecoveryRoot "recovery.log"

$DockerDistroName     = "amina-docker-recovery"
$StandaloneDistroName = "amina-standalone-recovery"

# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

function Log {
    param([string]$Msg, [string]$Color = "White")
    $ts = Get-Date -Format "HH:mm:ss"
    $line = "[$ts] $Msg"
    Write-Host $line -ForegroundColor $Color
    if (Test-Path (Split-Path $LogFile -Parent)) {
        Add-Content -Path $LogFile -Value $line
    }
}

function Section {
    param([string]$Title)
    $bar = "─" * 70
    Write-Host ""
    Write-Host $bar -ForegroundColor Cyan
    Write-Host "  $Title" -ForegroundColor Cyan
    Write-Host $bar -ForegroundColor Cyan
}

function Fail {
    param([string]$Msg)
    Log "FATAL: $Msg" "Red"
    exit 1
}

function Require-Path {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path)) {
        Fail "$Label not found at: $Path"
    }
    $info = Get-Item -LiteralPath $Path
    Log ("  {0,-12} {1,10:N0} bytes  {2}" -f $Label, $info.Length, $Path)
}

# ──────────────────────────────────────────────────────────────────────────────
# 0. Pre-flight
# ──────────────────────────────────────────────────────────────────────────────

Section "0. Pre-flight — verify source files exist"

New-Item -ItemType Directory -Force -Path $RecoveryRoot  | Out-Null
"" | Out-File -FilePath $LogFile -Encoding utf8

Require-Path $OldDockerChild   "docker-child"
Require-Path $OldDockerParent  "docker-parent"
Require-Path $OldStandaloneWsl "standalone"

Log "Admin mode: OK"

# Confirm Hyper-V cmdlets are available (needed for VHD merge/rebase).
if (-not (Get-Command Get-VHD -ErrorAction SilentlyContinue)) {
    Fail "Hyper-V PowerShell module not available. Run: Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-Management-PowerShell -All"
}

# Confirm wsl.exe is available.
if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    Fail "wsl.exe not found on PATH."
}

Log "Hyper-V module: OK"
Log "wsl.exe: OK"

# ──────────────────────────────────────────────────────────────────────────────
# 1. Stage copies (so source D:\ files are never modified)
# ──────────────────────────────────────────────────────────────────────────────

Section "1. Copying source VHDX files to E:\...\_recovery\ staging"

New-Item -ItemType Directory -Force -Path $StageDocker  | Out-Null
New-Item -ItemType Directory -Force -Path $StageStandal | Out-Null
New-Item -ItemType Directory -Force -Path $StageMerged  | Out-Null

$stagedChild  = Join-Path $StageDocker  "main-ext4.vhdx"
$stagedParent = Join-Path $StageDocker  "parent-ext4.vhdx"
$stagedStand  = Join-Path $StageStandal "ext4.vhdx"

Log "Copying docker-child..."
Copy-Item -LiteralPath $OldDockerChild -Destination $stagedChild -Force

Log "Copying docker-parent..."
Copy-Item -LiteralPath $OldDockerParent -Destination $stagedParent -Force

Log "Copying standalone-wsl (1.5 GB, this takes ~30-60 seconds)..."
Copy-Item -LiteralPath $OldStandaloneWsl -Destination $stagedStand -Force

Log "Staging done:"
Get-ChildItem -Recurse -File $RecoveryRoot | ForEach-Object {
    Log ("  {0,12:N0}  {1}" -f $_.Length, $_.FullName)
}

# ──────────────────────────────────────────────────────────────────────────────
# 2. Inspect and re-base the differencing chain
# ──────────────────────────────────────────────────────────────────────────────

Section "2. Inspecting docker-child VHDX differencing chain"

$child = Get-VHD -Path $stagedChild
Log ("  VhdType       : {0}" -f $child.VhdType)
Log ("  Parent path   : {0}" -f $child.ParentPath)
Log ("  Size (logical): {0:N0}" -f $child.Size)

if ($child.VhdType -eq "Differencing") {
    Log "Re-basing parent link to $stagedParent ..." "Yellow"
    try {
        Set-VHD -Path $stagedChild -ParentPath $stagedParent -IgnoreIdMismatch
        Log "Re-base OK"
    } catch {
        Log "Set-VHD failed: $_" "Red"
        Log "Falling back: will try direct Convert-VHD which sometimes auto-resolves." "Yellow"
    }
}

# ──────────────────────────────────────────────────────────────────────────────
# 3. Merge child + parent into a standalone dynamic VHDX
# ──────────────────────────────────────────────────────────────────────────────

Section "3. Merging child + parent into standalone docker-merged.vhdx"

$mergedVhdx = Join-Path $StageMerged "docker-merged.vhdx"

try {
    Convert-VHD -Path $stagedChild -DestinationPath $mergedVhdx -VHDType Dynamic
    Log "Merge OK → $mergedVhdx"
} catch {
    Log "Convert-VHD failed: $_" "Red"
    Log "You may need to run: Set-VHD -Path '$stagedChild' -ParentPath '$stagedParent' -IgnoreIdMismatch" "Yellow"
    Log "Continuing — we still have the standalone WSL candidate." "Yellow"
}

# ──────────────────────────────────────────────────────────────────────────────
# 4. Register recovery distros with WSL
# ──────────────────────────────────────────────────────────────────────────────

Section "4. Registering recovery distros with WSL"

# Unregister any stale recovery distros from a previous run (non-destructive to
# anything else — these names are only ever used by this script).
wsl --list --quiet | Out-Null
$existing = (wsl --list --quiet) -replace "`0",""  # de-UTF16
foreach ($name in @($StandaloneDistroName, $DockerDistroName)) {
    if ($existing -match [regex]::Escape($name)) {
        Log "Unregistering stale $name (safe — it's only a recovery distro)..." "Yellow"
        wsl --unregister $name | Out-Null
    }
}

Log "Registering $StandaloneDistroName ..."
wsl --import-in-place $StandaloneDistroName $stagedStand

if (Test-Path $mergedVhdx) {
    Log "Registering $DockerDistroName ..."
    wsl --import-in-place $DockerDistroName $mergedVhdx
} else {
    Log "Merged docker VHDX missing — skipping docker distro registration." "Yellow"
}

Section "4a. Current WSL distros"
wsl --list --verbose

# ──────────────────────────────────────────────────────────────────────────────
# 5. Probe both distros for ArcadeDB data markers
# ──────────────────────────────────────────────────────────────────────────────

Section "5. Probing $StandaloneDistroName for ArcadeDB markers"

Write-Host "--- Uname / release ---"
wsl -d $StandaloneDistroName -- sh -c "uname -a ; cat /etc/os-release 2>/dev/null | head -5" 2>&1 | ForEach-Object { Log $_ }

Write-Host ""
Write-Host "--- Mount points ---"
wsl -d $StandaloneDistroName -- sh -c "mount | grep -v '^none\|^tmpfs' | head -20" 2>&1 | ForEach-Object { Log $_ }

Write-Host ""
Write-Host "--- Looking for genie directory / arcadedb directory ---"
wsl -d $StandaloneDistroName -- sh -c "find / -maxdepth 7 \( -name 'genie' -o -iname 'arcadedb' \) -type d 2>/dev/null | head -20" 2>&1 | ForEach-Object { Log $_ }

Write-Host ""
Write-Host "--- Looking for non-empty Chunk bucket files (real data indicator) ---"
wsl -d $StandaloneDistroName -- sh -c "find / -type f -name 'Chunk_*.bucket' -size +0 2>/dev/null | head -20" 2>&1 | ForEach-Object { Log $_ }

Write-Host ""
Write-Host "--- Looking for PatientVertex / CaregiverVertex bucket files ---"
wsl -d $StandaloneDistroName -- sh -c "find / -type f \( -name 'PatientVertex_*.bucket' -o -name 'CaregiverVertex_*.bucket' \) -size +0 2>/dev/null | head -20" 2>&1 | ForEach-Object { Log $_ }

if (Test-Path $mergedVhdx) {
    Section "6. Probing $DockerDistroName for Docker volume paths"

    Write-Host "--- Classic docker volumes dir ---"
    wsl -d $DockerDistroName -- sh -c "ls -la /var/lib/docker/volumes/ 2>/dev/null | head -30" 2>&1 | ForEach-Object { Log $_ }

    Write-Host ""
    Write-Host "--- containerd-snapshotter daemon-data ---"
    wsl -d $DockerDistroName -- sh -c "ls -la /var/lib/desktop-containerd/daemon-data/volumes/ 2>/dev/null | head -30 ; ls -la /var/lib/desktop-containerd/daemon-data/io.containerd.snapshotter.v1.overlayfs/snapshots/ 2>/dev/null | head -30" 2>&1 | ForEach-Object { Log $_ }

    Write-Host ""
    Write-Host "--- Full bucket file search on docker distro ---"
    wsl -d $DockerDistroName -- sh -c "find / -type f -name 'Chunk_*.bucket' -size +0 2>/dev/null | head -20" 2>&1 | ForEach-Object { Log $_ }
}

# ──────────────────────────────────────────────────────────────────────────────
# 7. Summary
# ──────────────────────────────────────────────────────────────────────────────

Section "7. Summary"

Log "Staging dir : $RecoveryRoot"
Log "Log file    : $LogFile"
Log ""
Log "If the probes above showed non-empty Chunk_*.bucket / PatientVertex_*.bucket files,"
Log "the data is recoverable. Send the output back to me and I'll give you the next"
Log "step — the one write operation that copies the recovered genie/ folder into"
Log "the live bind mount ./data/arcadedb/genie/."
Log ""
Log "If both probes came up empty, we pivot to forensic block-level recovery on"
Log "the VHDX files or to re-running the upstream seed source."
Log ""
Log "DONE." "Green"
