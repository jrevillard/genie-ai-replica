"""
Phase 7 — rollback proof.

Confirms after `AMINA_CAREGIVER_PRIVACY_REQUIRED=false docker compose up
-d --force-recreate --no-deps haystack-chatqna` that:
  - /privacy/version reports required_flag=false
  - /privacy/status returns required_flag=false for an existing caregiver
  - All 8 gated routes return non-403 for a caregiver with NO consent
  - The canonical 403 detail is no longer surfaced anywhere

Pure HTTP. Synthetic JWTs only. Run inside the container.
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Any, Dict, List, Tuple

import jwt as pyjwt
import requests

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


def mint_caregiver_jwt(sub: str) -> str:
    now = int(time.time())
    return pyjwt.encode({
        "sub":            sub,
        "phone":          "+220-rollback-synthetic",
        "name":           "Rollback Synthetic",
        "role":           "caregiver",
        "caregiver_role": "vhw",
        "patient_id":     "p7-rollback-patient",
        "permissions":    ["read"],
        "iat":            now,
        "exp":            now + 3600,
    }, JWT_SECRET, algorithm=JWT_ALG)


GATED = [
    ("GET",  "/api/v1/caregiver/patients",                          None),
    ("GET",  "/api/v1/caregiver/dashboard",                         None),
    ("GET",  "/api/v1/caregiver/insights",                          None),
    ("GET",  "/api/v1/caregiver/alerts",                            None),
    ("POST", "/api/v1/caregiver/chat",                              {"message": "hi"}),
    ("POST", "/api/v1/caregiver/voice-chat",                        {"message": "hi"}),
    ("GET",  "/api/v1/caregiver/predictions/p7-rollback-patient",   None),
    ("GET",  "/api/v1/caregiver/panel",                             None),
]


def call_route(method: str, path: str, token: str,
               body: Dict[str, Any] | None) -> Dict[str, Any]:
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    try:
        resp = requests.request(method, f"{BASE}{path}",
                                headers=headers,
                                data=json.dumps(body) if body else None,
                                timeout=15)
    except Exception as e:
        return {"status": -1, "error": repr(e), "json": {}}
    out = {"status": resp.status_code, "headers": dict(resp.headers)}
    ct = resp.headers.get("content-type", "")
    if ct.startswith("application/json"):
        try:
            out["json"] = resp.json()
        except Exception:
            out["json"] = {}
    return out


def main() -> int:
    section("env probe (after rollback)")
    required = os.getenv("AMINA_CAREGIVER_PRIVACY_REQUIRED", "<unset>")
    print(f"  AMINA_CAREGIVER_PRIVACY_REQUIRED = {required}")
    check("flag REQUIRED is false (rolled back)", required == "false",
          detail=f"got {required!r}")

    section("/privacy/version reports required_flag=false")
    r = requests.get(f"{BASE}/api/v1/caregiver/privacy/version", timeout=5).json()
    check("/privacy/version required_flag=false", r.get("required_flag") is False,
          detail=str(r))

    token = mint_caregiver_jwt("cg-rb-noconsent")

    section("/privacy/status reports required_flag=false")
    r = call_route("GET", "/api/v1/caregiver/privacy/status", token, None)
    check("/privacy/status returns 200", r.get("status") == 200,
          detail=str(r.get("status")))
    check("/privacy/status required_flag=false",
          (r.get("json") or {}).get("required_flag") is False,
          detail=str(r.get("json")))

    section("all 8 gated routes pass for a NO-consent caregiver (flag=false)")
    for method, path, body in GATED:
        r = call_route(method, path, token, body)
        not_403 = r.get("status") != 403
        check(f"{method} {path}: status != 403",
              not_403, detail=f"got {r.get('status')}: {r.get('json')}")

        # And specifically NOT a consent-required 403.
        detail = (r.get("json") or {}).get("detail") or {}
        is_consent_403 = (r.get("status") == 403 and
                          isinstance(detail, dict) and
                          detail.get("code") == "caregiver_privacy_consent_required")
        check(f"{method} {path}: not a consent-required 403",
              not is_consent_403)

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
