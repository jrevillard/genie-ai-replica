"""
Phase 7 — live gate-matrix validation.

Runs INSIDE the haystack-chatqna container. Mints two synthetic
caregiver JWTs (no real PHI), exercises all 8 patient-data routes
under flag=true, asserts the canonical 403 shape on the no-consent
caregiver, asserts non-403 on the consented caregiver, and asserts
recovery routes always pass.

Pure HTTP. No DB writes outside what the /privacy/consent route does.

Usage:
    docker exec haystack-chatqna python /app/_phase7_live_gate_matrix.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any, Dict, List, Tuple

import jwt as pyjwt
import requests

# Import the canonical secret from the app's config so we sign JWTs
# the same way /caregiver/login does. This file is a Phase 7
# validation harness — never deployed in production.
sys.path.insert(0, "/app")
from src.config import settings  # noqa: E402

BASE = "http://localhost:8000"
JWT_SECRET = settings.JWT_SECRET
JWT_ALG = "HS256"

passed = 0
failed = 0
errors: List[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {label}")
    else:
        failed += 1
        msg = f"  [FAIL] {label}"
        if detail:
            msg += f" -- {detail}"
        print(msg)
        errors.append(label)


def section(name: str) -> None:
    print(f"\n=== {name} ===")


def mint_caregiver_jwt(sub: str, *, caregiver_role: str = "vhw",
                       patient_id: str = "p7-synthetic-patient") -> str:
    """Mint a JWT shaped like the one /caregiver/login returns."""
    now = int(time.time())
    payload = {
        "sub":             sub,
        "phone":           "+220-synthetic",
        "name":            "Phase7 Synthetic",
        "role":            "caregiver",
        "caregiver_role":  caregiver_role,
        "patient_id":      patient_id,
        "permissions":     ["read"],
        "iat":             now,
        "exp":             now + 3600,
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def submit_consent(token: str) -> Dict[str, Any]:
    """Submit a Phase 2 valid consent payload for the caregiver in `token`."""
    # Use the canonical checkbox ids AND notice version from the
    # service module so this harness auto-tracks future bumps. Phase
    # 9 v4 bumped the version 1.0 → 1.1; the previous hardcoded
    # "1.0" string broke the harness on that bump.
    from src.services.caregiver_privacy_consent import (
        EXPECTED_CHECKBOX_IDS,
        CAREGIVER_PRIVACY_NOTICE_VERSION,
    )
    body = {
        "notice_version":     CAREGIVER_PRIVACY_NOTICE_VERSION,
        "consent_checkboxes": {cid: True for cid in EXPECTED_CHECKBOX_IDS},
        "digital_signature":  "Phase7 Synthetic",
        "consent_timestamp":  "2026-04-30T15:00:00Z",
        "mandinka_viewed":    True,
        "scroll_completed":   True,
    }
    resp = requests.post(
        f"{BASE}/api/v1/caregiver/privacy/consent",
        headers={"Authorization": f"Bearer {token}"},
        json=body,
        timeout=10,
    )
    return {
        "status": resp.status_code,
        "json":   resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {},
    }


GATED_ROUTES: List[Tuple[str, str, Dict[str, Any] | None]] = [
    ("GET",  "/api/v1/caregiver/patients",                     None),
    ("GET",  "/api/v1/caregiver/dashboard",                    None),
    ("GET",  "/api/v1/caregiver/insights",                     None),
    ("GET",  "/api/v1/caregiver/alerts",                       None),
    ("POST", "/api/v1/caregiver/chat",                         {"message": "hi"}),
    ("POST", "/api/v1/caregiver/voice-chat",                   {"message": "hi"}),
    ("GET",  "/api/v1/caregiver/predictions/p7-synthetic-patient", None),
    ("GET",  "/api/v1/caregiver/panel",                        None),
]

RECOVERY_ROUTES: List[Tuple[str, str, Dict[str, Any] | None, bool]] = [
    # method, path, body, requires_token
    ("GET",  "/api/v1/caregiver/privacy/version", None, False),
    ("GET",  "/api/v1/caregiver/privacy/status",  None, True),
    ("GET",  "/api/v1/caregiver/profile",         None, True),
]


def call_route(method: str, path: str, token: str | None,
               body: Dict[str, Any] | None) -> Dict[str, Any]:
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
    try:
        resp = requests.request(method, f"{BASE}{path}",
                                headers=headers,
                                data=json.dumps(body) if body is not None else None,
                                timeout=15)
    except Exception as e:
        return {"status": -1, "error": repr(e), "json": {}}
    out: Dict[str, Any] = {"status": resp.status_code, "headers": dict(resp.headers)}
    ct = resp.headers.get("content-type", "")
    if ct.startswith("application/json"):
        try:
            out["json"] = resp.json()
        except Exception:
            out["json"] = {}
    return out


def assert_canonical_403(label: str, result: Dict[str, Any]) -> None:
    detail = (result.get("json") or {}).get("detail") or {}
    check(f"{label}: status == 403", result.get("status") == 403,
          detail=f"got {result.get('status')}")
    check(f"{label}: detail.code == 'caregiver_privacy_consent_required'",
          detail.get("code") == "caregiver_privacy_consent_required",
          detail=f"got {detail.get('code')!r}")
    check(f"{label}: detail.message == 'Privacy notice consent required'",
          detail.get("message") == "Privacy notice consent required",
          detail=f"got {detail.get('message')!r}")
    check(f"{label}: detail.submit_url is the consent path",
          detail.get("submit_url") == "/api/v1/caregiver/privacy/consent")
    check(f"{label}: detail.status_url is the status path",
          detail.get("status_url") == "/api/v1/caregiver/privacy/status")
    blob_lower = json.dumps(result.get("json") or {}, default=str).lower()
    forbidden = ("phase7 synthetic", "+220-synthetic",
                 "bearer ", "eyj", "sha256",
                 "user-agent", "127.0.0.1",
                 "i understand", "i accept", "pin", "password")
    leaked = [n for n in forbidden if n in blob_lower]
    check(f"{label}: 403 body contains no PHI / token / secrets",
          not leaked, detail=f"leaked: {leaked}")


def main() -> int:
    section("env probe")
    required = os.getenv("AMINA_CAREGIVER_PRIVACY_REQUIRED", "<unset>")
    warn_only = os.getenv("AMINA_CAREGIVER_PRIVACY_WARN_ONLY", "<unset>")
    print(f"  AMINA_CAREGIVER_PRIVACY_REQUIRED = {required}")
    print(f"  AMINA_CAREGIVER_PRIVACY_WARN_ONLY = {warn_only}")
    check("flag REQUIRED is true", required == "true",
          detail=f"got {required!r}")

    token_no = mint_caregiver_jwt("cg-p7-noconsent")
    token_yes = mint_caregiver_jwt("cg-p7-hasconsent")

    # ── Block 1: 8 gated routes, no consent → canonical 403 ───────────
    section("8 gated routes — no-consent caregiver expects 403")
    for method, path, body in GATED_ROUTES:
        r = call_route(method, path, token_no, body)
        assert_canonical_403(f"{method} {path}", r)

    # ── Block 2: submit consent for the second caregiver ──────────────
    section("submit consent for cg-p7-hasconsent")
    out = submit_consent(token_yes)
    check("/privacy/consent returns 200", out["status"] == 200,
          detail=f"got {out['status']}: {out.get('json')}")
    check("/privacy/consent body status accepted/already_accepted",
          out["json"].get("status") in ("accepted", "already_accepted"),
          detail=f"got {out['json']}")

    # ── Block 3: 8 gated routes, with consent → not-403 ────────────────
    section("8 gated routes — consented caregiver expects non-403")
    for method, path, body in GATED_ROUTES:
        r = call_route(method, path, token_yes, body)
        not_403 = r.get("status") != 403
        check(f"{method} {path}: status != 403",
              not_403, detail=f"got {r.get('status')}: {r.get('json')}")

    # ── Block 4: recovery routes still reachable on no-consent caregiver ─
    section("recovery routes — no-consent caregiver must NOT be blocked")
    for method, path, body, needs_token in RECOVERY_ROUTES:
        r = call_route(method, path, token_no if needs_token else None, body)
        not_403_consent = not (
            r.get("status") == 403
            and (r.get("json") or {}).get("detail", {}).get("code")
                == "caregiver_privacy_consent_required"
        )
        check(f"{method} {path}: not blocked by consent gate",
              not_403_consent, detail=f"got {r.get('status')}: {r.get('json')}")

    # ── Block 5: confirm /privacy/status shows required_flag=true ──────
    section("/privacy/status reports required_flag=true")
    r = call_route("GET", "/api/v1/caregiver/privacy/status", token_yes, None)
    check("/privacy/status returns 200", r.get("status") == 200,
          detail=f"got {r.get('status')}")
    check("/privacy/status required_flag=true",
          (r.get("json") or {}).get("required_flag") is True,
          detail=f"got {r.get('json')}")

    print("\n" + "=" * 60)
    print(f"PASSED: {passed}    FAILED: {failed}")
    if failed:
        print("FAILED CASES:")
        for e in errors:
            print(f"  - {e}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
