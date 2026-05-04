"""Per-endpoint JSON schema validation.

Lightweight — uses python's stdlib for type/length checks. We don't pull
in jsonschema as a dep because the rules are simple and explicit checks
are easier to debug than schema-engine errors.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from . import config


@dataclass
class ValidationError:
    field:   str
    reason:  str


# Allowed values for shared fields.
_LANGS = {"en", "mandinka", "auto"}


def validate_chat(body: Any) -> Optional[ValidationError]:
    if not isinstance(body, dict):
        return ValidationError("body", "request body must be a JSON object")

    msg = body.get("message")
    if msg is None:
        return ValidationError("message", "required field missing")
    if not isinstance(msg, str):
        return ValidationError("message", "must be a string")
    if not msg.strip():
        return ValidationError("message", "must not be empty or whitespace")
    if len(msg) > 2000:
        return ValidationError("message", f"max 2000 chars (got {len(msg)})")

    sid = body.get("session_id")
    if sid is not None:
        if not isinstance(sid, str):
            return ValidationError("session_id", "must be a string")
        if len(sid) > 64:
            return ValidationError("session_id", "max 64 chars")
        # Alphanumeric + dash + underscore only
        if not all(c.isalnum() or c in "-_" for c in sid):
            return ValidationError("session_id", "only alphanumeric, '-', '_' allowed")

    lang = body.get("language")
    if lang is not None and lang not in _LANGS:
        return ValidationError("language", f"must be one of {sorted(_LANGS)}")

    # Reject unexpected fields — stops prompt-smuggling via random keys.
    allowed = {"message", "session_id", "language"}
    extras = set(body.keys()) - allowed
    if extras:
        return ValidationError(
            field=",".join(sorted(extras)),
            reason="unexpected field(s); allowed: " + ", ".join(sorted(allowed)),
        )

    return None


def validate_translate(body: Any) -> Optional[ValidationError]:
    if not isinstance(body, dict):
        return ValidationError("body", "request body must be a JSON object")

    text = body.get("text")
    if text is None:
        return ValidationError("text", "required field missing")
    if not isinstance(text, str):
        return ValidationError("text", "must be a string")
    if not text.strip():
        return ValidationError("text", "must not be empty")
    if len(text) > 5000:
        return ValidationError("text", f"max 5000 chars (got {len(text)})")

    target = body.get("target_language")
    if target is None:
        return ValidationError("target_language", "required field missing")
    if target not in _LANGS - {"auto"}:
        return ValidationError("target_language", "must be 'en' or 'mandinka'")

    source = body.get("source_language")
    if source is not None and source not in _LANGS:
        return ValidationError("source_language", f"must be one of {sorted(_LANGS)}")

    allowed = {"text", "target_language", "source_language"}
    extras = set(body.keys()) - allowed
    if extras:
        return ValidationError(
            field=",".join(sorted(extras)),
            reason="unexpected field(s); allowed: " + ", ".join(sorted(allowed)),
        )

    return None


def max_body_bytes_for(path: str) -> int:
    if "/translate" in path:
        return config.MAX_BODY_BYTES_TRANSLATE
    return config.MAX_BODY_BYTES_CHAT
