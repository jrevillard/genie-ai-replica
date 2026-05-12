# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""JSON extraction from LLM output with markdown fence stripping and light repair."""

from __future__ import annotations

import json
import re
from typing import Any


_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def strip_prompt_injection_snippets(text: str) -> str:
    """Remove common instruction-injection patterns from model responses (best-effort)."""
    if not text:
        return ""
    # Drop lines that look like injected system directives
    lines = []
    for line in text.splitlines():
        low = line.lower().strip()
        if low.startswith(("ignore previous", "disregard ", "you are now", "new instructions:")):
            continue
        lines.append(line)
    return "\n".join(lines)


def extract_json_object(raw: str) -> dict[str, Any] | None:
    """Parse the first JSON object found in raw text."""
    if not raw:
        return None
    text = strip_prompt_injection_snippets(raw).strip()

    m = _FENCE_RE.search(text)
    if m:
        text = m.group(1).strip()

    # Direct parse
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        pass

    # Brace slice
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start : end + 1])
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            pass

    # Trailing comma repair (single pass)
    repaired = re.sub(r",\s*}", "}", text[start : end + 1] if start >= 0 and end > start else text)
    try:
        data = json.loads(repaired)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None
