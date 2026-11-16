#!/bin/bash
# This script is used to start the document repository service.
#
# The app's scanner (src/services/securityService.js) reads its host from
# CLAMSCAN_HOST — the CLAMSCAN_* family is the ONE contract; this script now
# reads the same variables instead of ignoring them (#1064, remote-canonical
# ruling 2026-11-15). The loopback list below is hand-synced with the
# appConfig localFallback IIFE and the appConfig.clamscan test matrix — keep
# all three in lock-step:
#
#   - OFF (VIRUS_SCANNING is not 'true'): the app never initializes a
#     scanner (appConfig.virusScanning gates NodeClam.init), so no daemon
#     is started — not the freshclam download, not the daemon, not the
#     readiness wait.
#   - LOCAL (scanning on, CLAMSCAN_HOST unset or loopback): start the
#     embedded clamd as before — the image stays complete for this mode.
#   - REMOTE (scanning on, CLAMSCAN_HOST set to a non-local host): the
#     remote clamd is the scanner — starting a local one here was dead
#     weight (a freshclam signature download plus a daemon plus a readiness
#     wait, every boot, for a scanner the app would not use). Go straight
#     to Node.
echo "#Starting document-repository..."

is_local_host() {
  case "$1" in
    "" | 127.0.0.1 | localhost | ::1) return 0 ;;
    *) return 1 ;;
  esac
}

if [ "$VIRUS_SCANNING" != "true" ]; then
  echo "Virus scanning disabled (VIRUS_SCANNING!=true) — ClamAV stays down."
elif is_local_host "$CLAMSCAN_HOST"; then
  echo "Local ClamAV mode (no CLAMSCAN_HOST configured) — starting ClamAV daemon..."
  freshclam --quiet --no-warnings || true
  clamd &

  echo "Wait a moment for clamav to start"
  sleep 15

  while ! clamdscan --version > /dev/null 2>&1; do
      echo "Waiting for ClamAV daemon to start..."
      sleep 5
  done

  echo "ClamAV daemon started successfully"
else
  echo "Remote ClamAV mode (CLAMSCAN_HOST=$CLAMSCAN_HOST) — the local daemon stays down."
fi

echo "Starting Node.js application..."
exec node src/server.js
