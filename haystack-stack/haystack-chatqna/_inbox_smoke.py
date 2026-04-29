#!/usr/bin/env python3
"""Smoke test the inbox API end-to-end against a running haystack-chatqna."""
import sys, json
import requests

API = "http://localhost:8000"
JWT = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
       ".eyJzdWIiOiJQXzc4QjdCNTcyIiwicGhvbmUiOiJiZWdpbm5lckBkZW1vLmFtaW5hY2FyZSIs"
       "Im5hbWUiOiJPdXNtYW4gRGVtIiwiaWF0IjoxNzc2NTE1OTUxLCJleHAiOjE3NzcxMjA3NTF9"
       ".40FW3Gq_zEb_usvg9GCvxsmGrtXLsfi_1ouQ4Rwgzlg")
H = {"Authorization": f"Bearer {JWT}"}

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

FAILED = []
def ok(label, cond, note=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}  {note}")
    if not cond:
        FAILED.append(label)

print("=== 1. capture-file (multipart) ===")
pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" \
      b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" \
      b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" \
      b"xref\n0 4\ntrailer<</Root 1 0 R/Size 4>>\nstartxref\n%%EOF"
r = requests.post(
    f"{API}/api/v1/inbox/capture-file",
    headers=H,
    files={"file": ("care-plan.pdf", pdf, "application/pdf")},
    data={"kind": "pdf", "title": "Care plan — hypertension",
          "body": "30-day plan", "source": "agent"},
    timeout=15,
)
ok("capture-file status=200", r.status_code == 200, f"http={r.status_code}")
body = r.json() if r.ok else {}
ok("token returned", bool(body.get("token")), body.get("token", "")[:25])
ok("inbox item has attachment", body.get("item", {}).get("attachment") is not None)
ok("attachment size > 0", (body.get("item") or {}).get("attachment", {}).get("size", 0) > 0,
   f"size={(body.get('item') or {}).get('attachment', {}).get('size')}")
token  = body.get("token", "")
iid    = (body.get("item") or {}).get("inbox_id", "")

print("\n=== 2. GET /inbox/file/<token>/peek (no auth) ===")
r = requests.get(f"{API}/api/v1/inbox/file/{token}/peek", timeout=10)
ok("peek 200", r.status_code == 200, f"http={r.status_code}")
pk = r.json() if r.ok else {}
ok("peek.name set", pk.get("name") == "care-plan.pdf", f"name={pk.get('name')}")
ok("peek.mime pdf",  pk.get("mime") == "application/pdf")

print("\n=== 3. GET /inbox/file/<token> download (no auth) ===")
r = requests.get(f"{API}/api/v1/inbox/file/{token}", timeout=10, stream=True)
ok("download 200", r.status_code == 200, f"http={r.status_code}")
data = r.content
ok("bytes begin with %PDF", data[:4] == b"%PDF", f"got={data[:8]}")
ok("content-type pdf", "pdf" in (r.headers.get("content-type") or ""))
ok("Content-Disposition attachment", "attachment" in r.headers.get("content-disposition", ""))

print("\n=== 4. POST /inbox/<id>/read ===")
r = requests.post(f"{API}/api/v1/inbox/{iid}/read", headers=H, timeout=10)
ok("mark-read 200", r.status_code == 200, f"http={r.status_code}")
ok("updated=1", r.json().get("updated") == 1)

print("\n=== 5. GET /inbox/unread-count — should drop ===")
r = requests.get(f"{API}/api/v1/inbox/unread-count", headers=H, timeout=10)
cur = r.json().get("unread", -1)
print(f"  unread_now = {cur}")

print("\n=== 6. GET /inbox/list (default) ===")
r = requests.get(f"{API}/api/v1/inbox/list", headers=H, timeout=10)
lst = r.json() if r.ok else {}
ok("list 200", r.status_code == 200)
ok("contains care plan", any(i.get("inbox_id") == iid for i in lst.get("items", [])))

print("\n=== 7. Authorization checks ===")
r = requests.get(f"{API}/api/v1/inbox/list", timeout=5)
ok("list without auth → 401/403", r.status_code in (401, 403), f"http={r.status_code}")
# Wrong patient_id on /send
r = requests.post(f"{API}/api/v1/inbox/send", headers=H,
                  json={"patient_id": "P_OTHER", "kind": "notification",
                        "title": "cross-patient"}, timeout=5)
ok("cross-patient send → 403", r.status_code == 403, f"http={r.status_code}")

print("\n=== SUMMARY ===")
if FAILED:
    print(f"  FAILED ({len(FAILED)}): {FAILED}")
    sys.exit(1)
print("  ALL PASS")
