#!/usr/bin/env python3
"""
Amina Care — Meta Channels Setup Wizard
=========================================
Wires live WhatsApp Business Cloud + Facebook Messenger credentials into
the already-running Amina stack. Idempotent: re-runnable, only touches
`*_META*` / `*_WHATSAPP*` / `*_MESSENGER*` lines in env files, never
overwrites other settings.

What it does:
  1. Collect tokens (CLI args OR interactive prompts).
  2. Validate tokens by calling the Meta Graph API directly:
       • WhatsApp  -> GET /{phone_number_id}     (checks the token works)
       • Messenger -> GET /me                    (checks the page token works)
  3. Append/update WHATSAPP_* and MESSENGER_* lines in haystack-stack/.env
     so the haystack-chatqna container picks them up via env_file.
  4. Append/update VITE_AMINA_* lines in components/frontend/.env.local
     so the frontend "Talk to us" widget shows real handles.
  5. Restart haystack-chatqna so the new env is loaded.
  6. Probe /api/v1/meta/status and confirm both channels show enabled=True.
  7. If --webhook-url is given, subscribe the Meta app to the `messages`
     field via POST /{phone_number_id}/subscribed_apps and POST
     /{page_id}/subscribed_apps — so Meta starts pushing events to us.
  8. If --send-test is given along with a WA recipient, POST a "hello"
     message via WhatsApp so you can see a message land on your phone.

Usage examples:

    # Fully interactive — easiest path the first time
    python scripts/setup_meta_channels.py

    # Non-interactive with all creds
    python scripts/setup_meta_channels.py \\
        --wa-token EAAG... --wa-phone-id 123456789012345 \\
        --wa-display "+220999xxxxx" \\
        --mg-token EAAG... --mg-page-handle aminacare \\
        --webhook-url https://xyz.trycloudflare.com \\
        --send-test --wa-recipient 919xxxxxxxxx

    # Only WhatsApp (Messenger will stay "coming soon")
    python scripts/setup_meta_channels.py --wa-token ... --wa-phone-id ...
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import requests


GREEN = "\033[92m"
RED   = "\033[91m"
YELL  = "\033[93m"
CYAN  = "\033[96m"
RESET = "\033[0m"


def banner(text: str) -> None:
    print(f"\n{'═' * 62}\n  {text}\n{'═' * 62}")


def ok(t: str)   -> None: print(f"  {GREEN}[OK]{RESET}  {t}")
def warn(t: str) -> None: print(f"  {YELL}[..]{RESET}  {t}")
def bad(t: str)  -> None: print(f"  {RED}[!!]{RESET}  {t}")
def info(t: str) -> None: print(f"  {CYAN}[i]{RESET}   {t}")


REPO_ROOT = Path(__file__).resolve().parent.parent
HS_ENV    = REPO_ROOT / "haystack-stack" / ".env"
FE_ENV    = REPO_ROOT / "components" / "frontend" / ".env.local"

GRAPH_VERSION = "v19.0"
GRAPH_BASE    = f"https://graph.facebook.com/{GRAPH_VERSION}"


# ── Env file upsert ──────────────────────────────────────────────────────────

def upsert_env(path: Path, updates: dict[str, str]) -> None:
    """
    Update or append KEY=VALUE lines in a .env file without touching
    unrelated lines. Creates the file if missing.
    """
    path.parent.mkdir(parents=True, exist_ok=True)

    existing: list[str] = []
    if path.exists():
        existing = path.read_text(encoding="utf-8").splitlines()

    seen: set[str] = set()
    out:  list[str] = []
    for line in existing:
        stripped = line.lstrip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            out.append(line)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in updates:
            out.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            out.append(line)

    # Append any unseen keys at the bottom under a header
    missing = [k for k in updates if k not in seen]
    if missing:
        if out and out[-1].strip():
            out.append("")
        out.append("# Amina Care — Meta channels (auto-added)")
        for k in missing:
            out.append(f"{k}={updates[k]}")

    path.write_text("\n".join(out) + "\n", encoding="utf-8")


# ── Interactive prompt helper ────────────────────────────────────────────────

def prompt(label: str, default: str = "", secret: bool = False) -> str:
    if default:
        suffix = f" [{default}]"
    else:
        suffix = ""
    if secret:
        try:
            import getpass
            v = getpass.getpass(f"  {label}{suffix}: ").strip()
        except Exception:
            v = input(f"  {label}{suffix}: ").strip()
    else:
        v = input(f"  {label}{suffix}: ").strip()
    return v or default


def confirm(label: str, default: bool = True) -> bool:
    d = "Y/n" if default else "y/N"
    v = input(f"  {label} [{d}]: ").strip().lower()
    if not v:
        return default
    return v in ("y", "yes")


# ── Meta Graph API validation ────────────────────────────────────────────────

def validate_whatsapp(token: str, phone_id: str) -> tuple[bool, str]:
    if not token or not phone_id:
        return False, "token or phone_number_id missing"
    try:
        r = requests.get(
            f"{GRAPH_BASE}/{phone_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
    except Exception as e:
        return False, f"network error: {e}"
    if r.status_code != 200:
        return False, f"HTTP {r.status_code}: {r.text[:200]}"
    body = r.json()
    display = body.get("display_phone_number") or "?"
    name    = body.get("verified_name") or body.get("quality_rating") or ""
    return True, f"display={display} name={name}"


def validate_messenger(token: str) -> tuple[bool, str, str]:
    if not token:
        return False, "token missing", ""
    try:
        r = requests.get(
            f"{GRAPH_BASE}/me",
            params={"access_token": token},
            timeout=10,
        )
    except Exception as e:
        return False, f"network error: {e}", ""
    if r.status_code != 200:
        return False, f"HTTP {r.status_code}: {r.text[:200]}", ""
    body = r.json()
    name    = body.get("name", "?")
    page_id = body.get("id",   "")
    return True, f"page={name} id={page_id}", page_id


# ── Webhook subscription ─────────────────────────────────────────────────────

def subscribe_whatsapp_webhook(token: str, phone_id: str) -> tuple[bool, str]:
    """Subscribes the app to WhatsApp Business Account webhook events."""
    try:
        r = requests.post(
            f"{GRAPH_BASE}/{phone_id}/subscribed_apps",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
    except Exception as e:
        return False, f"network error: {e}"
    if r.status_code != 200:
        return False, f"HTTP {r.status_code}: {r.text[:200]}"
    return True, r.text[:120]


def subscribe_messenger_webhook(token: str, page_id: str) -> tuple[bool, str]:
    try:
        r = requests.post(
            f"{GRAPH_BASE}/{page_id}/subscribed_apps",
            params={
                "access_token":       token,
                "subscribed_fields":  "messages,messaging_postbacks,message_deliveries,message_reads",
            },
            timeout=10,
        )
    except Exception as e:
        return False, f"network error: {e}"
    if r.status_code != 200:
        return False, f"HTTP {r.status_code}: {r.text[:200]}"
    return True, r.text[:120]


# ── WhatsApp test-send ───────────────────────────────────────────────────────

def send_whatsapp_test(token: str, phone_id: str, to: str) -> tuple[bool, str]:
    """
    Send a 'hello_world' template message — the only message type allowed
    before a 24h user-initiated session exists. Works out of the box on
    every Meta test number.
    """
    try:
        r = requests.post(
            f"{GRAPH_BASE}/{phone_id}/messages",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type":  "application/json",
            },
            json={
                "messaging_product": "whatsapp",
                "to":                to,
                "type":              "template",
                "template":          {"name": "hello_world", "language": {"code": "en_US"}},
            },
            timeout=15,
        )
    except Exception as e:
        return False, f"network error: {e}"
    if r.status_code >= 300:
        return False, f"HTTP {r.status_code}: {r.text[:200]}"
    return True, r.text[:200]


# ── Haystack restart + status probe ──────────────────────────────────────────

def restart_haystack() -> tuple[bool, str]:
    try:
        r = subprocess.run(
            ["docker", "restart", "haystack-chatqna"],
            capture_output=True, text=True, timeout=60,
        )
    except Exception as e:
        return False, f"docker restart failed: {e}"
    if r.returncode != 0:
        return False, r.stderr.strip()[:300] or "non-zero exit"
    return True, r.stdout.strip()[:80]


def wait_for_haystack_ready(api: str, timeout_s: int = 90) -> bool:
    info(f"waiting for {api}/health …")
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            r = requests.get(f"{api}/health", timeout=3)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def probe_meta_status(api: str) -> dict:
    try:
        r = requests.get(f"{api}/api/v1/meta/status", timeout=8)
        if r.status_code != 200:
            return {"_error": f"HTTP {r.status_code}"}
        return r.json() or {}
    except Exception as e:
        return {"_error": str(e)}


# ── Main flow ────────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--wa-token",     help="WhatsApp Cloud API access token")
    p.add_argument("--wa-phone-id",  help="WhatsApp phone_number_id")
    p.add_argument("--wa-display",   help="WhatsApp business number in E.164 (for frontend FAB)")
    p.add_argument("--wa-app-secret", default="", help="WhatsApp App Secret (optional)")
    p.add_argument("--wa-verify-token", default="amina_health_2026")
    p.add_argument("--mg-token",     help="Messenger Page Access Token")
    p.add_argument("--mg-page-handle", help="Facebook Page username for m.me/<handle>")
    p.add_argument("--mg-app-secret", default="", help="Messenger App Secret (optional)")
    p.add_argument("--mg-verify-token", default="amina_health_2026")
    p.add_argument("--webhook-url",   help="Public HTTPS base URL (e.g. https://xyz.trycloudflare.com). "
                                           "If set, will call /subscribed_apps to subscribe the app.")
    p.add_argument("--send-test", action="store_true",
                   help="After setup, send a WhatsApp 'hello_world' template to --wa-recipient")
    p.add_argument("--wa-recipient",  help="E.164 recipient (no +) for --send-test")
    p.add_argument("--api", default="http://localhost:8000")
    p.add_argument("--no-restart", action="store_true",
                   help="Skip docker restart haystack-chatqna (useful in CI)")
    args = p.parse_args()

    api = args.api.rstrip("/")

    banner("Amina Care — Meta Channels Setup Wizard")
    info(f"haystack-stack/.env      → {HS_ENV}")
    info(f"frontend/.env.local      → {FE_ENV}")
    info(f"haystack API             → {api}")
    info(f"Graph API                → {GRAPH_BASE}")

    # ── Step 1: collect credentials ──────────────────────────────────────────

    banner("Step 1 · Collect credentials")

    wa_token    = args.wa_token     or ""
    wa_phone_id = args.wa_phone_id  or ""
    wa_display  = args.wa_display   or ""
    mg_token    = args.mg_token     or ""
    mg_handle   = args.mg_page_handle or ""

    if not any([wa_token, mg_token]):
        info("No tokens given on CLI — interactive mode.")
        info("Leave blank to skip a channel (it will stay 'coming soon').")
        print()
        print(f"  {CYAN}-- WhatsApp Business Cloud --{RESET}")
        wa_token    = prompt("WhatsApp access token", secret=True)
        if wa_token:
            wa_phone_id = prompt("WhatsApp phone_number_id")
            wa_display  = prompt("Business phone in E.164 (e.g. 220999xxxxx, no +)")
        print()
        print(f"  {CYAN}-- Facebook Messenger --{RESET}")
        mg_token  = prompt("Messenger page access token", secret=True)
        if mg_token:
            mg_handle = prompt("Facebook Page username (for m.me/<handle>)")

    if not wa_token and not mg_token:
        bad("No credentials provided for either channel. Nothing to do.")
        return 1

    # ── Step 2: validate tokens against Graph API ────────────────────────────

    banner("Step 2 · Validate tokens against Meta Graph API")

    mg_page_id = ""
    wa_valid = mg_valid = False

    if wa_token:
        wa_valid, note = validate_whatsapp(wa_token, wa_phone_id)
        (ok if wa_valid else bad)(f"WhatsApp token  {note}")
    else:
        warn("WhatsApp skipped (no token)")

    if mg_token:
        mg_valid, note, mg_page_id = validate_messenger(mg_token)
        (ok if mg_valid else bad)(f"Messenger token {note}")
    else:
        warn("Messenger skipped (no token)")

    if wa_token and not wa_valid:
        bad("Aborting: WhatsApp token invalid. Re-check in Meta dashboard.")
        return 2
    if mg_token and not mg_valid:
        bad("Aborting: Messenger token invalid. Re-check in Meta dashboard.")
        return 2

    # ── Step 3: write env files ──────────────────────────────────────────────

    banner("Step 3 · Write env files")

    hs_updates: dict[str, str] = {}
    if wa_valid:
        hs_updates.update({
            "WHATSAPP_ACCESS_TOKEN":    wa_token,
            "WHATSAPP_PHONE_NUMBER_ID": wa_phone_id,
            "WHATSAPP_VERIFY_TOKEN":    args.wa_verify_token,
            "WHATSAPP_APP_SECRET":      args.wa_app_secret,
        })
    if mg_valid:
        hs_updates.update({
            "MESSENGER_PAGE_ACCESS_TOKEN": mg_token,
            "MESSENGER_VERIFY_TOKEN":      args.mg_verify_token,
            "MESSENGER_APP_SECRET":        args.mg_app_secret,
        })
    if hs_updates:
        upsert_env(HS_ENV, hs_updates)
        ok(f"updated {HS_ENV.name} with {len(hs_updates)} keys")

    fe_updates: dict[str, str] = {}
    if wa_valid and wa_display:
        fe_updates["VITE_AMINA_WHATSAPP_NUMBER"] = wa_display.lstrip("+").replace(" ", "")
    if mg_valid and mg_handle:
        fe_updates["VITE_AMINA_MESSENGER_HANDLE"] = mg_handle.lstrip("@")
    if fe_updates:
        upsert_env(FE_ENV, fe_updates)
        ok(f"updated {FE_ENV.name} with {len(fe_updates)} keys (restart Vite to pick up)")

    # ── Step 4: restart haystack-chatqna ─────────────────────────────────────

    if not args.no_restart:
        banner("Step 4 · Restart haystack-chatqna")
        good, note = restart_haystack()
        if good:
            ok(f"docker restart → {note}")
        else:
            bad(f"docker restart failed: {note}")
            return 3
        if not wait_for_haystack_ready(api):
            bad("haystack did not become healthy in 90s")
            return 3
        ok("haystack-chatqna healthy")

    # ── Step 5: probe /meta/status ───────────────────────────────────────────

    banner("Step 5 · Verify /api/v1/meta/status")
    status = probe_meta_status(api)
    if "_error" in status:
        bad(f"probe failed: {status['_error']}")
        return 4
    wa_state = status.get("whatsapp",  {})
    mg_state = status.get("messenger", {})
    print(f"    whatsapp  → enabled={wa_state.get('enabled')}  "
          f"signatures={wa_state.get('signature_checks')}")
    print(f"    messenger → enabled={mg_state.get('enabled')}  "
          f"signatures={mg_state.get('signature_checks')}")
    if wa_token and not wa_state.get("enabled"):
        bad("WhatsApp still not enabled — check env propagation")
        return 4
    if mg_token and not mg_state.get("enabled"):
        bad("Messenger still not enabled — check env propagation")
        return 4
    ok("backend sees both channels as configured")

    # ── Step 6: subscribe webhook (optional) ─────────────────────────────────

    if args.webhook_url:
        banner("Step 6 · Subscribe webhooks via Graph API")
        base = args.webhook_url.rstrip("/")
        info(f"WhatsApp  webhook URL  → {base}/api/v1/meta/webhook/whatsapp")
        info(f"Messenger webhook URL  → {base}/api/v1/meta/webhook/messenger")
        info("Remember: you must also set the Callback URL + Verify Token in the "
             "Meta app dashboard UI for the initial handshake. This step only "
             "subscribes the app to field events once the webhook is verified.")
        if wa_valid:
            good, note = subscribe_whatsapp_webhook(wa_token, wa_phone_id)
            (ok if good else bad)(f"WhatsApp  subscribed_apps  {note}")
        if mg_valid and mg_page_id:
            good, note = subscribe_messenger_webhook(mg_token, mg_page_id)
            (ok if good else bad)(f"Messenger subscribed_apps  {note}")
    else:
        warn("skipping webhook subscription (no --webhook-url)")
        info("after starting your cloudflared / ngrok tunnel, re-run with "
             "--webhook-url https://<your-tunnel> to auto-subscribe.")

    # ── Step 7: optional WhatsApp test send ──────────────────────────────────

    if args.send_test:
        banner("Step 7 · Send WhatsApp hello_world template")
        if not (wa_valid and args.wa_recipient):
            bad("--send-test requires --wa-recipient and valid WhatsApp creds")
        else:
            good, note = send_whatsapp_test(wa_token, wa_phone_id, args.wa_recipient)
            (ok if good else bad)(f"send → {note}")

    # ── Done ─────────────────────────────────────────────────────────────────

    banner("Summary")
    ok(f"WhatsApp  : {'LIVE' if (wa_valid and wa_state.get('enabled')) else 'off'}")
    ok(f"Messenger : {'LIVE' if (mg_valid and mg_state.get('enabled')) else 'off'}")
    info("Next: if you haven't already, register the webhook callback URL in")
    info("the Meta app dashboard — it needs the initial GET handshake to pass")
    info("before Meta will deliver POST events.")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
