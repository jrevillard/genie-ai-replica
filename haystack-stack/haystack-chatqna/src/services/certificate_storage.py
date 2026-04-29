"""
AMINA Care — Education Certificate Storage
===========================================
Safe, minimal file-upload helper for education verification certificates.

Design:
  - Files are written to /app/data/education_certs (bind-mounted from the
    host so they survive container recreate).
  - Filenames on disk are UUIDv4.{ext}. The original filename is retained
    in the EducationCertificateVertex row but never used for disk paths
    (prevents path traversal via crafted names).
  - Allowed MIME types: image/jpeg, image/png, image/webp, application/pdf.
  - Max size: 5 MB. Enforced here so routes can stay thin.
  - Per the no-delete policy, certificates are never removed. Rejected
    certs stay on disk; their status in Arcade is flipped.
"""

from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)

CERT_DIR = Path(os.environ.get("EDUCATION_CERT_DIR", "/app/data/education_certs"))
MAX_BYTES = 5 * 1024 * 1024  # 5 MB

ALLOWED_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg":  ".jpg",
    "image/png":  ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}


def ensure_cert_dir() -> None:
    try:
        CERT_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        logger.error(f"certificate_storage: cannot create {CERT_DIR}: {e}")


def validate(mime_type: str, size_bytes: int) -> Optional[str]:
    """Return an error string if invalid, else None."""
    mt = (mime_type or "").lower().split(";")[0].strip()
    if mt not in ALLOWED_MIME:
        return f"unsupported file type {mt!r} — use JPG, PNG, WEBP or PDF"
    if size_bytes <= 0:
        return "empty file"
    if size_bytes > MAX_BYTES:
        return f"file too large ({size_bytes} bytes, max {MAX_BYTES})"
    return None


def save_bytes(
    payload: bytes,
    mime_type: str,
) -> Dict:
    """
    Persist an uploaded file and return its on-disk path + metadata.

    Returns {"ok": bool, "storage_path": str, "ext": str, "size": int,
             "error"?: str}
    """
    err = validate(mime_type, len(payload))
    if err:
        return {"ok": False, "error": err}

    ensure_cert_dir()
    mt = (mime_type or "").lower().split(";")[0].strip()
    ext = ALLOWED_MIME.get(mt, ".bin")
    cert_uuid = uuid.uuid4().hex
    filename_on_disk = f"{cert_uuid}{ext}"
    full_path = CERT_DIR / filename_on_disk

    try:
        with full_path.open("wb") as f:
            f.write(payload)
    except Exception as e:
        logger.error(f"certificate_storage: write failed: {e}")
        return {"ok": False, "error": f"write failed: {e}"}

    return {
        "ok":           True,
        "storage_path": str(full_path),
        "filename":     filename_on_disk,
        "ext":          ext,
        "size":         len(payload),
    }


def read_file(storage_path: str) -> Optional[bytes]:
    """Read a certificate from disk (admin-only use)."""
    try:
        p = Path(storage_path)
        # Safety: the path must live inside CERT_DIR. Prevents an admin
        # endpoint from being tricked into serving arbitrary files via a
        # spoofed cert row.
        p_resolved = p.resolve()
        base = CERT_DIR.resolve()
        if not str(p_resolved).startswith(str(base)):
            logger.warning(f"certificate_storage: refusing to read outside cert dir: {p}")
            return None
        if not p_resolved.exists():
            return None
        return p_resolved.read_bytes()
    except Exception as e:
        logger.error(f"certificate_storage: read failed for {storage_path}: {e}")
        return None
