#!/usr/bin/env python3
"""
AMINA Care -- Telegram quick-tunnel auto-webhook watcher.
==========================================================
Watches a cloudflared --logfile output for the latest
https://*.trycloudflare.com URL and re-registers it with Telegram via
the existing multichannel-access /telegram/set-webhook endpoint when
it changes.

Why not the Docker socket?
--------------------------
Mounting /var/run/docker.sock into a container grants effective root
on the host (anyone with socket access can launch privileged
containers, exec into others, etc.). This watcher avoids the socket
entirely: cloudflared is configured to write a logfile into a shared
named volume; the watcher mounts that volume read-only and tails the
file. Same operational outcome, much smaller blast radius.

Flow per poll
-------------
  1. GET {service_url}/health
       - status=ok AND telegram=true  -> proceed
       - else                         -> log health_failed + skip
  2. Read the cloudflared logfile, find the LATEST trycloudflare URL.
       - none yet                     -> log waiting_for_tunnel_url
  3. GET {service_url}/telegram/webhook-info
       - extract result.url
  4. Compare result.url against "<detected>/telegram/webhook":
       - already match                -> log webhook_already_current
       - differ                       -> POST set-webhook + verify
  5. After a successful set, re-fetch webhook-info and confirm the
     registered URL matches what we asked for. If not, log
     webhook_verify_failed and (in --once mode) exit non-zero.

Env vars (all optional, sensible defaults)
------------------------------------------
  SERVICE_URL          http://localhost:8020
  TUNNEL_LOG_FILE      /var/log/cloudflared/quick-tunnel.log
  POLL_SECONDS         10
  STARTUP_GRACE_SECS   15      (extra delay before first check on cold-start)

CLI flags override env. --once exits after a single cycle. --dry-run
never POSTs set-webhook (it just reports what it would do).

The watcher NEVER reads or prints TELEGRAM_BOT_TOKEN. The token lives
in the multichannel-access container's env only; we drive everything
through the sidecar's HTTP interface.

Exit codes (only meaningful with --once)
----------------------------------------
  0  success, webhook is current and verified
  1  multichannel-access health check failed
  2  no tunnel URL detected yet (logfile empty or unreachable)
  3  set-webhook call failed
  4  registered URL didn't match what we asked Telegram to set

In loop mode (default), the script keeps running and never exits on
its own; container restart_policy handles process death.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from typing import Optional, Tuple
from urllib import error as urlerr
from urllib import request as urlreq

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | telegram_auto_webhook | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger(__name__)

# Matches every quick-tunnel hostname Cloudflare hands out. We always
# pick the LAST occurrence in the file so a tunnel rotation supersedes
# the previous URL automatically.
_TRYCF_RE = re.compile(r"https://[a-z0-9][a-z0-9-]*\.trycloudflare\.com")


# ── HTTP helpers (stdlib only — no extra deps in the watcher image) ──
def _http_get_json(url: str, timeout: int = 8) -> Optional[dict]:
    try:
        with urlreq.urlopen(url, timeout=timeout) as r:
            return json.load(r)
    except (urlerr.HTTPError, urlerr.URLError, OSError, ValueError) as e:
        log.warning("http_get_failed url=%s err=%s", url, e.__class__.__name__)
        return None


def _http_post_json(url: str, body: dict, timeout: int = 12) -> Optional[dict]:
    payload = json.dumps(body).encode("utf-8")
    req = urlreq.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlreq.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except (urlerr.HTTPError, urlerr.URLError, OSError, ValueError) as e:
        log.error("http_post_failed url=%s err=%s", url, e.__class__.__name__)
        return None


# ── Health + log readers ─────────────────────────────────────────────
def check_health(service_url: str) -> bool:
    data = _http_get_json(f"{service_url.rstrip('/')}/health", timeout=5)
    if not data:
        return False
    return data.get("status") == "ok" and bool(data.get("telegram"))


def read_latest_tunnel_url(log_path: str) -> Optional[str]:
    if not os.path.exists(log_path):
        return None
    try:
        # Read the whole file — quick-tunnel logs stay small, ~KB-scale.
        # If this ever grows, switch to a tail strategy.
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError as e:
        log.warning("logfile_read_failed path=%s err=%s", log_path, e.__class__.__name__)
        return None
    matches = _TRYCF_RE.findall(content)
    return matches[-1] if matches else None


def fetch_webhook_url(service_url: str) -> Tuple[Optional[str], Optional[dict]]:
    info = _http_get_json(f"{service_url.rstrip('/')}/telegram/webhook-info", timeout=8)
    if not info or not info.get("ok"):
        return None, info
    return ((info.get("result") or {}).get("url") or ""), info


def set_webhook(service_url: str, target: str) -> Optional[dict]:
    return _http_post_json(
        f"{service_url.rstrip('/')}/telegram/set-webhook",
        {"url": target},
        timeout=12,
    )


# ── Single-poll cycle (used by --once and the loop) ──────────────────
def run_once(args) -> int:
    if not check_health(args.service_url):
        log.error("health_failed service_url=%s", args.service_url)
        return 1

    detected = read_latest_tunnel_url(args.log_file)
    if not detected:
        log.info("waiting_for_tunnel_url log_file=%s", args.log_file)
        return 2 if args.once else 0  # loop mode treats this as not-yet-ready

    log.info("tunnel_url_detected url=%s", detected)
    target = f"{detected.rstrip('/')}/telegram/webhook"

    current, _ = fetch_webhook_url(args.service_url)
    if current is None:
        log.warning("webhook_info_unavailable")

    if current == target:
        log.info("webhook_already_current url=%s", target)
        return 0

    if args.dry_run:
        log.info(
            "dry_run_would_update old=%s new=%s",
            current if current else "<empty>",
            target,
        )
        return 0

    resp = set_webhook(args.service_url, target)
    if not resp or not resp.get("ok"):
        log.error("webhook_update_failed response=%s", json.dumps(resp or {}, default=str)[:200])
        return 3

    log.info(
        "webhook_updated old=%s new=%s",
        current if current else "<empty>",
        target,
    )

    # Verify
    verified, _ = fetch_webhook_url(args.service_url)
    if verified != target:
        log.error("webhook_verify_failed expected=%s registered=%s", target, verified)
        return 4
    log.info("webhook_verified url=%s", verified)
    return 0


# ── Loop mode ────────────────────────────────────────────────────────
def run_forever(args) -> None:
    log.info(
        "watcher_started service_url=%s log_file=%s poll_seconds=%d",
        args.service_url, args.log_file, args.poll_seconds,
    )
    if args.startup_grace > 0:
        log.info("startup_grace sleeping=%ds", args.startup_grace)
        time.sleep(args.startup_grace)

    while True:
        try:
            run_once(args)
        except KeyboardInterrupt:
            log.info("watcher_interrupted")
            break
        except Exception as e:  # pragma: no cover — defensive
            log.exception("run_once_uncaught err=%s", e)
        time.sleep(args.poll_seconds)


# ── Entrypoint ───────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument(
        "--service-url",
        default=os.environ.get("SERVICE_URL", "http://localhost:8020"),
        help="multichannel-access base URL",
    )
    ap.add_argument(
        "--log-file",
        default=os.environ.get("TUNNEL_LOG_FILE", "/var/log/cloudflared/quick-tunnel.log"),
        help="cloudflared logfile path (read-only)",
    )
    ap.add_argument(
        "--poll-seconds",
        type=int,
        default=int(os.environ.get("POLL_SECONDS", "10")),
        help="seconds between polls in loop mode",
    )
    ap.add_argument(
        "--startup-grace",
        type=int,
        default=int(os.environ.get("STARTUP_GRACE_SECS", "15")),
        help="seconds to wait before the first poll (lets cf-quick-tunnel write its log banner)",
    )
    ap.add_argument(
        "--once",
        action="store_true",
        help="run a single poll cycle and exit",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="don't POST set-webhook, just log what would happen",
    )
    args = ap.parse_args()

    if args.once:
        rc = run_once(args)
        sys.exit(rc)

    run_forever(args)
    return 0


if __name__ == "__main__":
    main()
