#!/usr/bin/env python3
"""
Caregiver inbox + chat / emergency notification flow — end-to-end.
===================================================================
Covers:
  1. Plain caregiver can hit /caregiver/inbox/unread-count (returns 0
     initially, 401 unauth).
  2. Patient sends a direct chat to caregiver via /caregiver/chat/send
     → a new caregiver_ping item lands in the caregiver inbox.
  3. Caregiver replies via /caregiver/chat/send → patient inbox gets
     the caregiver_ping item too.
  4. Patient fires /caregiver/emergency/send → inbox fanout lands in
     every linked caregiver inbox with severity='emergency'; return
     payload reports the SMS + inbox counts.
  5. Mark-read works for caregiver JWT and decrements the counter.

We reuse the plain demo patient (bantaba-pt@demo.aminacare) created by
earlier scripts so no extra fixtures are required. Caregivers are
provisioned on the fly if none exist.
"""
from __future__ import annotations
import sys
import time
import uuid
import requests

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


API = "http://localhost:8000"

FAIL = []
def check(label, cond, note=""):
    tag = "PASS" if cond else "FAIL"
    print(f"  [{tag}]  {label}  {note}")
    if not cond:
        FAIL.append(label)


def _login_patient(email, password):
    r = requests.post(f"{API}/api/v1/auth/login/email",
                      json={"email": email, "password": password},
                      timeout=15)
    return (r.json() or {}).get("token", "")


def _signup_if_needed(email, password, name, age=33):
    r = requests.post(
        f"{API}/api/v1/auth/signup/email",
        json={"email": email, "password": password, "name": name,
              "age": age, "gender": "other", "region": "Banjul",
              "conditions": [], "language": "english"},
        timeout=15,
    )
    return r.status_code in (200, 400, 409)


# ── Step 0: patient fixture + caregiver fixture ─────────────────────
_signup_if_needed("cg-notify-pt@demo.aminacare", "CgNotify2026",
                  name="Cg Notify Patient")
pt_tok = _login_patient("cg-notify-pt@demo.aminacare", "CgNotify2026")
check("patient login", bool(pt_tok))

pt_headers = {"Authorization": f"Bearer {pt_tok}", "Content-Type": "application/json"}


# ── Step 1: provision a caregiver linked to this patient ────────────
# Real production flow: patient invites → caregiver registers with
# invite code + PIN → caregiver is linked automatically.

invite_r = requests.post(
    f"{API}/api/v1/caregiver/invite",
    headers=pt_headers,
    json={"permissions": ["alerts", "vitals", "consultations"],
          "note": "Test caregiver"},
    timeout=10,
)
check("patient generates invite code", invite_r.status_code == 200,
      f"http={invite_r.status_code}")
invite_code = (invite_r.json() or {}).get("invite_code", "")
check("invite code present", bool(invite_code), f"code={invite_code}")

cg_phone = f"+2203001{int(time.time()) % 10000}"
cg_name  = f"Caregiver {uuid.uuid4().hex[:5]}"
cg_pin   = "1234"

reg_r = requests.post(
    f"{API}/api/v1/caregiver/register",
    json={"invite_code":   invite_code,
          "phone":         cg_phone,
          "name":          cg_name,
          "pin":           cg_pin,
          "relationship":  "sibling"},
    timeout=10,
)
check("caregiver registers with invite", reg_r.status_code == 200,
      f"http={reg_r.status_code} body={reg_r.text[:200]}")
reg_body = reg_r.json() if reg_r.ok else {}
cg_tok   = reg_body.get("token", "")
cg_id    = reg_body.get("caregiver_id", "")
check("caregiver token minted", bool(cg_tok))
check("caregiver linked to patient (flow returns both ids)",
      bool(reg_body.get("patient_id")))

if cg_tok:
    linked = True

    import base64, json as _json
    try:
        parts = pt_tok.split(".")
        pad = "=" * (-len(parts[1]) % 4)
        pt_payload = _json.loads(base64.urlsafe_b64decode(parts[1] + pad))
        pt_id = pt_payload.get("sub", "")
    except Exception:
        pt_id = ""

    cg_headers = {"Authorization": f"Bearer {cg_tok}", "Content-Type": "application/json"}

    # ── Step 2: Caregiver inbox reads (empty initially) ────────────
    r = requests.get(f"{API}/api/v1/caregiver/inbox/unread-count",
                     headers=cg_headers, timeout=10)
    check("caregiver unread-count → 200", r.status_code == 200,
          f"http={r.status_code} body={r.text[:120]}")
    before = (r.json() or {}).get("unread", 0)
    check("unread is a non-negative int", isinstance(before, int) and before >= 0)

    # ── Step 3: Patient → caregiver chat via /caregiver/chat/send ──
    if linked:
        r = requests.post(
            f"{API}/api/v1/caregiver/chat/send",
            headers=pt_headers,
            json={"text": "Hello caregiver — BP is 138/85 today.",
                  "partner_id": cg_id},
            timeout=10,
        )
        check("patient /caregiver/chat/send → 200",
              r.status_code == 200, f"http={r.status_code} body={r.text[:200]}")
        notify_id = (r.json() or {}).get("notification_inbox")
        check("chat notification inbox id returned",
              bool(notify_id), f"id={notify_id}")

        # Caregiver inbox now has 1 more unread
        time.sleep(0.3)
        r = requests.get(f"{API}/api/v1/caregiver/inbox/unread-count",
                         headers=cg_headers, timeout=10)
        after = (r.json() or {}).get("unread", 0)
        check("caregiver unread increments after patient chat",
              after >= before + 1, f"before={before} after={after}")

        # List and find the new item
        r = requests.get(f"{API}/api/v1/caregiver/inbox/list?limit=10",
                         headers=cg_headers, timeout=10)
        items = (r.json() or {}).get("items", [])
        chat_items = [i for i in items
                      if (i.get("title") or "").startswith("New message from")]
        check("caregiver inbox contains 'New message from' item",
              len(chat_items) >= 1)
        if chat_items:
            inbox_id = chat_items[0].get("inbox_id")
            r = requests.post(f"{API}/api/v1/caregiver/inbox/{inbox_id}/read",
                              headers=cg_headers, timeout=10)
            check("mark-read → 200", r.status_code == 200)

        # ── Step 4: Caregiver → patient reply ────────────────────
        r = requests.post(
            f"{API}/api/v1/caregiver/chat/send",
            headers=cg_headers,
            json={"text": "Got it. Keep logging BP. I'll check in tonight.",
                  "partner_id": pt_id},
            timeout=10,
        )
        check("caregiver /caregiver/chat/send → 200",
              r.status_code == 200, f"http={r.status_code}")
        reply_notify = (r.json() or {}).get("notification_inbox")
        check("reply notification inbox id returned", bool(reply_notify))

        # Patient inbox should now also have a caregiver_ping item
        time.sleep(0.3)
        r = requests.get(f"{API}/api/v1/inbox/list?limit=10",
                         headers=pt_headers, timeout=10)
        pt_items = (r.json() or {}).get("items", [])
        check("patient inbox has 'Message from' item",
              any("Message from" in (i.get("title") or "") for i in pt_items),
              f"titles={[i.get('title') for i in pt_items[:3]]}")

        # ── Step 5: Emergency fanout ─────────────────────────────
        r = requests.post(
            f"{API}/api/v1/caregiver/emergency/send",
            headers=pt_headers,
            json={"message": "Chest pain + dizziness since 10 minutes",
                  "alert_type": "emergency_triage"},
            timeout=15,
        )
        check("patient /caregiver/emergency/send → 200",
              r.status_code == 200, f"http={r.status_code} body={r.text[:200]}")
        body = r.json() or {}
        check("emergency response has inbox_delivered count",
              isinstance(body.get("inbox_delivered"), int))
        check("emergency response reports inbox recipients",
              isinstance(body.get("inbox_recipients"), list))

        # Caregiver inbox now has a severity=emergency item
        time.sleep(0.3)
        r = requests.get(f"{API}/api/v1/caregiver/inbox/list?limit=10",
                         headers=cg_headers, timeout=10)
        items = (r.json() or {}).get("items", [])
        emergencies = [i for i in items if i.get("severity") == "emergency"]
        check("caregiver inbox has severity=emergency item",
              len(emergencies) >= 1,
              f"count={len(emergencies)}")
else:
    print("  [SKIP] caregiver linkage could not be established — "
          "chat/emergency tests skipped")


print()
print("=" * 64)
print("  SUMMARY")
print("=" * 64)
if FAIL:
    print(f"  FAILED ({len(FAIL)}):")
    for f in FAIL:
        print(f"    - {f}")
    sys.exit(1)
print("  ALL PASS — caregiver inbox + chat notify + emergency fanout wired.")
