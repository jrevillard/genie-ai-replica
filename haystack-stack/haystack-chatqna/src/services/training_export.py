"""
AMINA Care — Training Data Exporter
====================================
Walks Redis interaction events for opted-in actors and writes a JSONL file
in the same schema used by training/finetune_lora_v2.py's SFT corpus:

  {"messages": [
       {"role":"system","content":"..."},
       {"role":"user","content":"..."},
       {"role":"assistant","content":"..."}
   ],
   "metadata": {...}}

Privacy controls (data minimization at export time):
  - Only actors with training_consent.value == True are scanned.
  - Patient/caregiver IDs are hashed (SHA-256 first 16 chars) before
    being written to disk — the raw ID never leaves Redis/Arcade.
  - Turns tagged with thumbs-down + wrong_info (clinical_accuracy < 0.2)
    are dropped even for consented actors — we never train on turns a
    user has flagged as wrong.
  - Optionally restrict to thumbs-up turns only (TRAINING_EXPORT_QUALITY_ONLY=1).

Invoked via POST /api/v1/training/export/run (admin-gated).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import redis

from src.services.training_consent import list_consented_actor_ids

logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
EXPORT_DIR = Path(os.environ.get("TRAINING_EXPORT_DIR", "/app/training/collected"))

QUALITY_ONLY = os.environ.get("TRAINING_EXPORT_QUALITY_ONLY", "0").lower() in ("1", "true", "yes")
_MIN_CLINICAL_ACCURACY = 0.2  # below this we always drop, even for consented actors

_DEFAULT_SYSTEM_PROMPT = (
    "You are AMINA, a warm, culturally-grounded health companion for The Gambia. "
    "Respond in the user's language, follow WHO protocols, and keep answers clear and kind."
)


def _hash_id(raw: str) -> str:
    return hashlib.sha256(f"amina-train::{raw}".encode()).hexdigest()[:16]


def _redis_client():
    return redis.Redis.from_url(REDIS_URL, decode_responses=True)


def _load_events(r, key: str, cap: int = 200) -> List[Dict]:
    try:
        raw = r.lrange(key, 0, cap - 1) or []
        out: List[Dict] = []
        for x in raw:
            try:
                out.append(json.loads(x))
            except Exception:
                continue
        return out
    except Exception as e:
        logger.warning(f"training_export: failed to load {key}: {e}")
        return []


def _event_to_example(event: Dict, system_prompt: str, actor_role: str) -> Optional[Dict]:
    user_msg = (event.get("user_msg") or "").strip()
    bot_resp = (event.get("bot_response") or "").strip()
    if not user_msg or not bot_resp:
        return None

    feedback = event.get("feedback")
    if QUALITY_ONLY and feedback != "up":
        return None

    quality = event.get("quality") or {}
    if float(quality.get("clinical_accuracy", 1.0)) < _MIN_CLINICAL_ACCURACY:
        return None

    pid = event.get("patient_id") or ""
    return {
        "messages": [
            {"role": "system",    "content": system_prompt},
            {"role": "user",      "content": user_msg},
            {"role": "assistant", "content": bot_resp},
        ],
        "metadata": {
            "actor_role":      actor_role,
            "patient_id_hash": _hash_id(pid) if pid else None,
            "session_id":      event.get("session_id"),
            "topics":          event.get("topics", []),
            "tools":           event.get("tools", []),
            "engagement":      event.get("engagement"),
            "feedback":        feedback,
            "quality":         quality,
            "captured_at":     event.get("timestamp"),
        },
    }


def run_export(
    system_prompt: Optional[str] = None,
    dry_run: bool = False,
) -> Dict:
    """Walk Redis events for all consented actors and write one JSONL file.

    Returns a summary dict. If dry_run=True, counts only — no file written.
    """
    sys_prompt = system_prompt or _DEFAULT_SYSTEM_PROMPT
    r = _redis_client()

    patient_ids   = list_consented_actor_ids("patient")
    caregiver_ids = list_consented_actor_ids("caregiver")

    stats: Dict = {
        "started_at":            datetime.utcnow().isoformat() + "Z",
        "consented_patients":    len(patient_ids),
        "consented_caregivers":  len(caregiver_ids),
        "events_scanned":        0,
        "events_exported":       0,
        "events_skipped":        0,
        "output_file":           None,
        "quality_only":          QUALITY_ONLY,
        "dry_run":               dry_run,
    }

    examples: List[Dict] = []

    for pid in patient_ids:
        events = _load_events(r, f"events:{pid}")
        stats["events_scanned"] += len(events)
        for ev in events:
            ex = _event_to_example(ev, sys_prompt, "patient")
            if ex:
                examples.append(ex)
            else:
                stats["events_skipped"] += 1

    # Caregivers: events are logged under the linked patient's ID in the
    # existing pipeline. We re-walk those same events but tag them with
    # actor_role='caregiver' for the metadata when the event session_id
    # starts with the caregiver prefix. In practice we rely on consent
    # at the patient level; caregiver-only consent is reserved for a
    # future CaregiverInteractionEvent stream.
    for cg in caregiver_ids:
        events = _load_events(r, f"events:cg:{cg}")
        stats["events_scanned"] += len(events)
        for ev in events:
            ex = _event_to_example(ev, sys_prompt, "caregiver")
            if ex:
                examples.append(ex)
            else:
                stats["events_skipped"] += 1

    stats["events_exported"] = len(examples)

    if not dry_run and examples:
        try:
            EXPORT_DIR.mkdir(parents=True, exist_ok=True)
            ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
            out = EXPORT_DIR / f"amina_collected_{ts}.jsonl"
            with out.open("w", encoding="utf-8") as f:
                for ex in examples:
                    f.write(json.dumps(ex, ensure_ascii=False) + "\n")
            stats["output_file"] = str(out)
            logger.info(f"training_export: wrote {len(examples)} examples to {out}")
        except Exception as e:
            logger.error(f"training_export: write failed: {e}")
            stats["error"] = f"write failed: {e}"

    stats["finished_at"] = datetime.utcnow().isoformat() + "Z"
    return stats


def export_status() -> Dict:
    """Dashboard view: how many consented users, latest export file (no scan, no write)."""
    latest = None
    try:
        if EXPORT_DIR.exists():
            files = sorted(EXPORT_DIR.glob("amina_collected_*.jsonl"))
            if files:
                f = files[-1]
                st = f.stat()
                latest = {
                    "file":       f.name,
                    "size_bytes": st.st_size,
                    "modified":   datetime.utcfromtimestamp(st.st_mtime).isoformat() + "Z",
                }
    except Exception as e:
        logger.debug(f"export_status: latest file probe failed: {e}")

    return {
        "consented_patients":   len(list_consented_actor_ids("patient")),
        "consented_caregivers": len(list_consented_actor_ids("caregiver")),
        "export_dir":           str(EXPORT_DIR),
        "latest_export":        latest,
        "quality_only":         QUALITY_ONLY,
    }
