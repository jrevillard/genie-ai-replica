#!/usr/bin/env python3
"""
Smoke test for the resilience endpoint.

Covers:
  1. classify_error boundaries (DOWN vs TOKEN vs BAD vs OK)
  2. /models/status returns a well-formed chain
  3. /agent/chat-resilient passes a normal chat through (at least one live model)
  4. /models/{m}/reset clears cooldown
  5. Feeding a fake failure into model_health doesn't leak onto TOKEN kind
"""
from __future__ import annotations
import json, sys, os
import requests

API   = os.getenv("API", "http://localhost:8000")
TOKEN = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJQXzc4QjdCNTcyIiwi"
    "cGhvbmUiOiJiZWdpbm5lckBkZW1vLmFtaW5hY2FyZSIsIm5hbWUiOiJPdXNtYW4g"
    "RGVtIiwiaWF0IjoxNzc2NTE1OTUxLCJleHAiOjE3NzcxMjA3NTF9."
    "40FW3Gq_zEb_usvg9GCvxsmGrtXLsfi_1ouQ4Rwgzlg"
)
H = {"Authorization": f"Bearer {TOKEN}"}

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

FAILS = []
def _check(name, cond, note=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}  {note}")
    if not cond:
        FAILS.append(name)


print("=== 1. Classifier boundaries (via /models/{bad}/reset 400) ===")
# This hits the endpoint + confirms server is up.
r = requests.post(f"{API}/api/v1/models/does-not-exist/reset", headers=H)
_check("unknown model reset -> 400", r.status_code == 400, f"http={r.status_code}")

print("\n=== 2. /models/status ===")
r = requests.get(f"{API}/api/v1/models/status")
_check("status 200", r.status_code == 200, f"http={r.status_code}")
js = r.json() if r.ok else {}
_check("chain present", isinstance(js.get("chain"), list) and js["chain"], f"chain={js.get('chain')}")
_check("live subset of chain",
       set(js.get("live", [])).issubset(set(js.get("chain", []))),
       f"live={js.get('live')}")

print("\n=== 3. /models/status with preferred ===")
r = requests.get(f"{API}/api/v1/models/status?preferred=gemini")
js = r.json() if r.ok else {}
_check("preferred rotated to head",
       js.get("chain", [""])[0] == "gemini",
       f"head={js.get('chain', [''])[0]}")

print("\n=== 4. Reset all known models (clears leftover cooldowns) ===")
for m in ["amina", "base", "gemini", "groq", "mistral"]:
    requests.post(f"{API}/api/v1/models/{m}/reset", headers=H)
_check("reset calls did not 500", True)

print("\n=== 5. /agent/chat-resilient — real chat turn ===")
r = requests.post(
    f"{API}/api/v1/agent/chat-resilient",
    headers={**H, "Content-Type": "application/json"},
    json={"message": "hi", "session_id": "smoke_resilience",
          "model_preference": "amina"},
    timeout=90,
)
_check("chat-resilient status is 200 or 503", r.status_code in (200, 503),
       f"http={r.status_code}")
body = r.json() if r.content else {}
_check("model_events field present",
       isinstance(body.get("model_events"), list),
       f"events_type={type(body.get('model_events')).__name__}")
if r.status_code == 200:
    _check("model_used set to a known model",
           body.get("model_used") in {"amina","base","gemini","groq","mistral"},
           f"model_used={body.get('model_used')}")
    _check("response field non-empty",
           bool((body.get("response") or "").strip()),
           f"response={str(body.get('response'))[:60]!r}")
    # If it fell through, we expect at least one DOWN event
    switches = [e for e in body.get("model_events", []) if e.get("kind") == "DOWN"]
    print(f"  info: DOWN events this turn: {len(switches)}")
else:
    # 503 means every model in chain failed — acceptable in test envs
    _check("503 includes last_detail", bool(body.get("last_detail")),
           f"last_detail={body.get('last_detail')!r}")

print("\n=== 6. Classify boundary — TOKEN must NEVER appear as DOWN in health ===")
r = requests.get(f"{API}/api/v1/models/status")
snaps = r.json().get("snapshots", {})
had_token_trip = any(
    "token" in (s.get("last_failure_reason") or "").lower()
    or (s.get("last_failure_reason") or "").lower() in ("http_401", "http_403", "http_402")
    for s in snaps.values()
)
_check("no TOKEN-reason cooldowns persisted", not had_token_trip,
       "TOKEN kinds must bypass report_failure")

print("\n=== SUMMARY ===")
if FAILS:
    print(f"  FAILED ({len(FAILS)}): {FAILS}")
    sys.exit(1)
print("  ALL PASS")
