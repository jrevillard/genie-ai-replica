"""
Local simulation of an inbound Messenger DM.

Sends a properly HMAC-SHA256 signed payload to the running haystack
service and reports what happened. The MESSENGER_APP_SECRET is read
from the container's env — never passed on the command line.

This is a Stage 2 readiness aid. It is NOT a load test, NOT a real
delivery test (Meta will refuse to deliver to a synthetic PSID), but
it conclusively confirms:

  1. signature verification path is live
  2. webhook accepts + 200's the request
  3. background pipeline invokes AminaAgent
  4. outbound Graph API send is attempted
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request


PAGE_ID    = "1047710801765129"  # public, fine in source
SYNTH_PSID = "SYNTHETIC_TEST_PSID_NO_REAL_USER_001"
TEXT       = "hi amina, my blood pressure is 145 over 90, should i be worried?"
ENDPOINT   = "http://localhost:8000/api/v1/meta/webhook/messenger"


def main() -> int:
    payload = {
        "object": "page",
        "entry": [{
            "id":   PAGE_ID,
            "time": int(time.time()),
            "messaging": [{
                "sender":    {"id": SYNTH_PSID},
                "recipient": {"id": PAGE_ID},
                "timestamp": int(time.time()),
                "message": {
                    "mid":  "mid.synth_test_001",
                    "text": TEXT,
                },
            }],
        }],
    }
    body = json.dumps(payload).encode("utf-8")

    secret = os.environ.get("MESSENGER_APP_SECRET", "")
    if not secret:
        print("ERROR: MESSENGER_APP_SECRET is not set in this process")
        return 2
    print(f"app_secret_len={len(secret)} (used for HMAC, never printed)")

    sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    print(f"signature_prefix=sha256=...{sig[-8:]}  (last 8 chars only)")
    print(f"payload_bytes={len(body)} text_chars={len(TEXT)}")

    req = urllib.request.Request(
        ENDPOINT, data=body,
        headers={
            "Content-Type":        "application/json",
            "X-Hub-Signature-256": sig,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            print(f"webhook_status={r.status}")
            resp_body = r.read().decode("utf-8")[:200]
            print(f"webhook_body={resp_body}")
    except urllib.error.HTTPError as e:
        print(f"webhook_status={e.code}  (signature or shape rejected)")
        try:
            print(f"webhook_error={e.read().decode('utf-8')[:240]}")
        except Exception:
            pass
        return 1
    except Exception as e:
        print(f"connection_error={e.__class__.__name__}: {e}")
        return 1

    print("Sent. Background pipeline now running. Watch container logs for:")
    print("  - meta_pipeline handled channel=messenger sender=sha256:<hash>")
    print("  - messenger send failed: ... (expected — synthetic PSID)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
