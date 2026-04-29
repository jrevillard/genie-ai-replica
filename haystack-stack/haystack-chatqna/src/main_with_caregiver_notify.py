"""
AMINA Care — Caregiver Inbox + Notifications Entry Point
=========================================================
Strict superset of main_with_dualpath_ledger. Adds:

  - /api/v1/caregiver/inbox/list                  (GET)
  - /api/v1/caregiver/inbox/unread-count          (GET)
  - /api/v1/caregiver/inbox/{id}/read             (POST)
  - /api/v1/caregiver/inbox/mark-all-read         (POST)
  - /api/v1/caregiver/chat/send                   (POST) — sends msg + inbox push
  - /api/v1/caregiver/emergency/send              (POST) — SOS SMS + inbox push

Caregivers finally have a proper in-app inbox backed by the same
InboxItemVertex store the patient inbox uses — no schema change, just
id-agnostic keying.

Uvicorn target: src.main_with_caregiver_notify:app
"""

from __future__ import annotations

import logging

# Inherit the whole stack (dualpath-ledger → ... → main).
from src.main_with_dualpath_ledger import app  # noqa: E402,F401

for name in (
    "src.api.caregiver_inbox_routes",
    "src.services.caregiver_notify",
):
    logging.getLogger(name).setLevel(logging.INFO)

_log = logging.getLogger("src.main_with_caregiver_notify")

from src.api.caregiver_inbox_routes import router as _cg_inbox_router  # noqa: E402
app.include_router(_cg_inbox_router, prefix="/api/v1")
_log.info("✅ Caregiver inbox + chat/emergency notify routes mounted at "
          "/api/v1/caregiver/{inbox,chat,emergency}")


__all__ = ["app"]
