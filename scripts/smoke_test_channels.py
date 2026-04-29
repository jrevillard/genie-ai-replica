#!/usr/bin/env python3
"""
Amina Care — All-Channels Smoke Test
=====================================
Verifies every piece of the three-channel stack is alive and talking:

  1. haystack-chatqna /health
  2. multichannel-access /health (Telegram)
  3. haystack-chatqna /api/v1/meta/status (WhatsApp + Messenger)
  4. WhatsApp verify handshake
  5. Messenger verify handshake
  6. Telegram getMe (direct Telegram API call using the bot token)
  7. Agent end-to-end (POST /api/v1/agent/chat with a trivial prompt)

Usage:
    python scripts/smoke_test_channels.py
    python scripts/smoke_test_channels.py --api http://localhost:8000 \
                                           --mc http://localhost:8020

Exit code:
    0 — all checks green
    1 — at least one check failed (prints the bad ones at the end)
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Callable

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import requests


# ── Pretty output ────────────────────────────────────────────────────────────

GREEN = "\033[92m"
RED   = "\033[91m"
YELL  = "\033[93m"
RESET = "\033[0m"


def banner(text: str) -> None:
    print(f"\n{'=' * 60}\n  {text}\n{'=' * 60}")


def ok(text: str)   -> None: print(f"  {GREEN}[PASS]{RESET} {text}")
def warn(text: str) -> None: print(f"  {YELL}[SKIP]{RESET} {text}")
def fail(text: str) -> None: print(f"  {RED}[FAIL]{RESET} {text}")


results: list[tuple[str, bool, str]] = []


def run(name: str, fn: Callable[[], tuple[bool, str]]) -> None:
    try:
        success, note = fn()
        results.append((name, success, note))
        if success:
            ok(f"{name}  {note}" if note else name)
        else:
            fail(f"{name}  {note}")
    except Exception as e:
        results.append((name, False, f"{type(e).__name__}: {e}"))
        fail(f"{name}  {type(e).__name__}: {e}")


# ── Check helpers ────────────────────────────────────────────────────────────

def check_haystack_health(api: str):
    def inner():
        r = requests.get(f"{api}/health", timeout=8)
        if r.status_code != 200:
            return False, f"HTTP {r.status_code}"
        body = r.json()
        svc  = body.get("service", "")
        return ("haystack" in svc, f"service={svc}")
    return inner


def check_multichannel_health(mc: str):
    def inner():
        try:
            r = requests.get(f"{mc}/health", timeout=5)
        except requests.ConnectionError:
            return False, "connection refused (container not running?)"
        if r.status_code != 200:
            return False, f"HTTP {r.status_code}"
        body = r.json()
        tg = body.get("telegram")
        hs = body.get("haystack")
        return (bool(tg), f"telegram={tg}, haystack={hs}")
    return inner


def check_meta_status(api: str):
    def inner():
        r = requests.get(f"{api}/api/v1/meta/status", timeout=8)
        if r.status_code == 404:
            return False, "meta_routes NOT mounted — rebuild haystack-chatqna"
        if r.status_code != 200:
            return False, f"HTTP {r.status_code}"
        body = r.json()
        wa = body.get("whatsapp",  {})
        mg = body.get("messenger", {})
        return (True,
            f"whatsapp.enabled={wa.get('enabled')} "
            f"messenger.enabled={mg.get('enabled')}")
    return inner


def check_whatsapp_verify(api: str, token: str):
    def inner():
        r = requests.get(
            f"{api}/api/v1/meta/webhook/whatsapp",
            params={
                "hub.mode":         "subscribe",
                "hub.verify_token": token,
                "hub.challenge":    "SMOKE_WA",
            },
            timeout=5,
        )
        if r.status_code == 404:
            return False, "webhook not mounted"
        return (r.status_code == 200 and r.text == "SMOKE_WA",
                f"HTTP {r.status_code}, body={r.text[:20]!r}")
    return inner


def check_messenger_verify(api: str, token: str):
    def inner():
        r = requests.get(
            f"{api}/api/v1/meta/webhook/messenger",
            params={
                "hub.mode":         "subscribe",
                "hub.verify_token": token,
                "hub.challenge":    "SMOKE_MG",
            },
            timeout=5,
        )
        if r.status_code == 404:
            return False, "webhook not mounted"
        return (r.status_code == 200 and r.text == "SMOKE_MG",
                f"HTTP {r.status_code}, body={r.text[:20]!r}")
    return inner


def check_telegram_bot(token: str):
    def inner():
        if not token:
            return False, "TELEGRAM_BOT_TOKEN not set (expected in mc/.env)"
        r = requests.get(
            f"https://api.telegram.org/bot{token}/getMe",
            timeout=8,
        )
        if r.status_code != 200:
            return False, f"telegram HTTP {r.status_code}"
        body = r.json()
        if not body.get("ok"):
            return False, f"telegram ok=false: {body}"
        u = body.get("result", {}).get("username", "")
        return (True, f"bot=@{u}")
    return inner


def check_agent_chat(api: str):
    def inner():
        r = requests.post(
            f"{api}/api/v1/agent/chat",
            json={
                "message":    "Hello, this is a smoke test.",
                "session_id": "smoke_test_channels",
                "channel":    "smoke",
            },
            timeout=60,
        )
        if r.status_code != 200:
            return False, f"HTTP {r.status_code} {r.text[:200]}"
        body = r.json()
        reply = body.get("response", "")
        return (bool(reply), f"reply={reply[:60]!r}")
    return inner


# ── Env helpers ──────────────────────────────────────────────────────────────

def read_env_file(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if not os.path.exists(path):
        return out
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip('"').strip("'")
    except Exception:
        pass
    return out


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="http://localhost:8000",
                   help="haystack-chatqna base URL")
    p.add_argument("--mc",  default="http://localhost:8020",
                   help="multichannel-access base URL")
    args = p.parse_args()
    api = args.api.rstrip("/")
    mc  = args.mc.rstrip("/")

    # Read creds from the usual env file locations so the script doesn't
    # need the user to re-export them.
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    hs_env    = read_env_file(os.path.join(repo_root, "haystack-stack", ".env"))
    mc_env    = read_env_file(os.path.join(repo_root, "components", "multichannel-access", ".env"))

    wa_verify_tok = hs_env.get("WHATSAPP_VERIFY_TOKEN", "amina_health_2026")
    mg_verify_tok = hs_env.get("MESSENGER_VERIFY_TOKEN", "amina_health_2026")
    tg_token      = mc_env.get("TELEGRAM_BOT_TOKEN", "")

    banner("AMINA Care — All-Channels Smoke Test")
    print(f"  api : {api}")
    print(f"  mc  : {mc}")
    print(f"  wa verify token : {wa_verify_tok}")
    print(f"  mg verify token : {mg_verify_tok}")
    print(f"  tg bot token    : {('set (' + tg_token[:8] + '…)') if tg_token else 'NOT SET'}")

    banner("1. Core backend health")
    run("haystack-chatqna /health",    check_haystack_health(api))
    run("multichannel-access /health", check_multichannel_health(mc))

    banner("2. Meta ingestion endpoints")
    run("meta /status",                check_meta_status(api))
    run("WhatsApp verify handshake",   check_whatsapp_verify(api, wa_verify_tok))
    run("Messenger verify handshake",  check_messenger_verify(api, mg_verify_tok))

    banner("3. Channel credentials live")
    run("Telegram getMe",              check_telegram_bot(tg_token))

    banner("4. Agent end-to-end")
    run("agent /chat",                 check_agent_chat(api))

    banner("SUMMARY")
    total  = len(results)
    passed = sum(1 for _, ok_, _ in results if ok_)
    failed = total - passed
    color  = GREEN if failed == 0 else RED
    print(f"  {color}{passed}/{total} passed{RESET}")
    if failed:
        print(f"  {RED}FAILURES:{RESET}")
        for name, ok_, note in results:
            if not ok_:
                print(f"    - {name}: {note}")
        return 1
    print(f"  {GREEN}All smoke checks passed.{RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
