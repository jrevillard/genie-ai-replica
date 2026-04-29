#!/usr/bin/env bash
#
# setup-data-dirs.sh — bootstrap host bind-mount directories for haystack-stack.
#
# Why this exists:
#   docker-compose.yml (and its overlays) bind-mount host paths into
#   containers:
#     ./data/arcadedb  -> /home/arcadedb/databases  (UID 1000 inside container)
#     ./data/redis     -> /data
#     ./data/superset  -> /app/superset_home
#     ./inbox_files    -> /app/data/inbox_files     (docker-compose.inbox.yml)
#     ./scribe_audio   -> /app/data/scribe          (docker-compose.gap-closers.yml)
#   On a fresh clone, if these host directories do not exist, Docker creates
#   them as root:root. ArcadeDB then fails on first start with:
#     "Cannot create directory './databases/genie'"
#   because the in-container user `arcadedb` (UID 1000) cannot write to a
#   root-owned bind-mount target. Inbox and scribe writes from haystack-chatqna
#   fail the same way on overlays that mount those paths.
#
# Platform notes:
#   - Windows + Docker Desktop: pre-creating the dirs is enough. Docker
#     Desktop handles UID mapping for bind mounts via its file-sharing
#     layer. No chown needed.
#   - Linux / native WSL2 (no Docker Desktop): the kernel respects host
#     UIDs literally. The arcadedb host dir must be owned by UID 1000
#     so the in-container user can write. Redis and Superset use other
#     UIDs but tend to run as root or self-fix; we only chown arcadedb
#     to keep the blast radius small.
#
# Long-term fix (not done here, by design):
#   Add a one-shot init service to docker-compose.yml that creates and
#   chowns the dirs before arcadedb starts. That is the right answer but
#   requires editing the existing compose file, which this fix avoids.
#
# Safety:
#   - Idempotent: re-running is a no-op if dirs already exist with right perms.
#   - Never deletes anything.
#   - Never chowns recursively across the whole repo.
#   - chown is restricted to haystack-stack/data/arcadedb only.
#   - Asks for sudo only when actually needed and prints what it will run.

set -u
set -o pipefail

# ---- Resolve repo root relative to this script (so it works from anywhere) --
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DATA_ROOT="${REPO_ROOT}/haystack-stack/data"
HAYSTACK_ROOT="${REPO_ROOT}/haystack-stack"

ARCADEDB_DIR="${DATA_ROOT}/arcadedb"
REDIS_DIR="${DATA_ROOT}/redis"
SUPERSET_DIR="${DATA_ROOT}/superset"

# Overlay-only persistent dirs (inbox + scribe). These live one level up
# from data/ because the compose overlays mount them as `./inbox_files`
# and `./scribe_audio` relative to haystack-stack/.
INBOX_DIR="${HAYSTACK_ROOT}/inbox_files"
SCRIBE_DIR="${HAYSTACK_ROOT}/scribe_audio"

# Container UID/GID for ArcadeDB (matches arcadedata/arcadedb image).
ARCADEDB_UID=1000
ARCADEDB_GID=1000

log()  { printf '[setup-data-dirs] %s\n' "$*"; }
warn() { printf '[setup-data-dirs] WARN: %s\n' "$*" >&2; }
err()  { printf '[setup-data-dirs] ERROR: %s\n' "$*" >&2; }

# ---- Detect platform --------------------------------------------------------
# Possible values: linux, wsl, windows-gitbash, mac, unknown
detect_platform() {
    local uname_s
    uname_s="$(uname -s 2>/dev/null || echo unknown)"
    case "${uname_s}" in
        Linux*)
            if grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
                echo "wsl"
            else
                echo "linux"
            fi
            ;;
        Darwin*)             echo "mac" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows-gitbash" ;;
        *)                   echo "unknown" ;;
    esac
}

PLATFORM="$(detect_platform)"
log "platform detected: ${PLATFORM}"
log "repo root:         ${REPO_ROOT}"
log "data root:         ${DATA_ROOT}"

# ---- Step 1: create directories --------------------------------------------
mkdir_safe() {
    local dir="$1"
    if [[ -d "${dir}" ]]; then
        log "exists: ${dir}"
    else
        if mkdir -p "${dir}"; then
            log "created: ${dir}"
        else
            err "failed to create: ${dir}"
            exit 1
        fi
    fi
}

mkdir_safe "${ARCADEDB_DIR}"
mkdir_safe "${REDIS_DIR}"
mkdir_safe "${SUPERSET_DIR}"

# Overlay-only persistent dirs. No chown here: haystack-chatqna writes
# these as the runtime user inside its image (typically root or a build-
# defined uvicorn user), and pre-creating the directory is enough on
# every platform we support.
mkdir_safe "${INBOX_DIR}"
mkdir_safe "${SCRIBE_DIR}"

# ---- Step 2: ArcadeDB ownership (Linux/WSL only) ----------------------------
needs_chown() {
    # True if dir is not already owned by ARCADEDB_UID:ARCADEDB_GID.
    local dir="$1"
    local owner
    owner="$(stat -c '%u:%g' "${dir}" 2>/dev/null || echo '')"
    [[ "${owner}" != "${ARCADEDB_UID}:${ARCADEDB_GID}" ]]
}

apply_arcadedb_chown() {
    local dir="${ARCADEDB_DIR}"

    if ! needs_chown "${dir}"; then
        log "ownership OK on ${dir} (already ${ARCADEDB_UID}:${ARCADEDB_GID})"
        return 0
    fi

    log "ArcadeDB writes as UID ${ARCADEDB_UID} inside the container."
    log "Host dir ${dir} is not owned by ${ARCADEDB_UID}:${ARCADEDB_GID}."
    log "Will fix with: chown -R ${ARCADEDB_UID}:${ARCADEDB_GID} ${dir}"

    if [[ "$(id -u)" -eq 0 ]]; then
        chown -R "${ARCADEDB_UID}:${ARCADEDB_GID}" "${dir}"
        log "chown done (running as root)."
        return 0
    fi

    if command -v sudo >/dev/null 2>&1; then
        log "Re-running chown via sudo (you may be prompted for a password)..."
        if sudo chown -R "${ARCADEDB_UID}:${ARCADEDB_GID}" "${dir}"; then
            log "chown done."
        else
            warn "sudo chown failed. Run manually:"
            warn "    sudo chown -R ${ARCADEDB_UID}:${ARCADEDB_GID} ${dir}"
        fi
        return 0
    fi

    warn "sudo not available. Run this manually as root:"
    warn "    chown -R ${ARCADEDB_UID}:${ARCADEDB_GID} ${dir}"
}

case "${PLATFORM}" in
    linux|wsl)
        apply_arcadedb_chown
        ;;
    windows-gitbash)
        log "Windows / Git Bash detected — skipping chown."
        log "Docker Desktop handles UID mapping for bind mounts via its"
        log "file-sharing layer. If ArcadeDB still cannot write, open"
        log "Docker Desktop -> Settings -> Resources -> File Sharing and"
        log "make sure the drive containing this repo is shared."
        ;;
    mac)
        log "macOS detected — skipping chown."
        log "Docker Desktop on macOS handles UID mapping for bind mounts."
        ;;
    *)
        warn "Unknown platform '${PLATFORM}' — skipping chown."
        warn "If ArcadeDB fails to start with a 'Cannot create directory'"
        warn "error, run manually:"
        warn "    sudo chown -R ${ARCADEDB_UID}:${ARCADEDB_GID} ${ARCADEDB_DIR}"
        ;;
esac

log "done. You can now run: docker compose up -d (from haystack-stack/)"
