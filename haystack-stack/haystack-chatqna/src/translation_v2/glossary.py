"""Glossary service — forced term overrides for clinical translation.

Loaded from a CSV with columns:
  en_term, mnk_term, domain, do_not_translate

Usage patterns:
  - LLM providers (OpenAI, Gemma): glossary is formatted as a prompt
    snippet and injected into the system prompt so the model honors it
    during translation.
  - Mechanical providers (NLLB): glossary is applied as a
    post-processing word-boundary replacement pass.
  - "do_not_translate" marks terms (medication names, place names,
    Gambian food names) that must be preserved verbatim.

Matching is case-insensitive and respects word boundaries — a term
"bp" does not match inside "backup".
"""
from __future__ import annotations

import csv
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GlossaryEntry:
    en: str
    mnk: str
    domain: str
    do_not_translate: bool


class Glossary:
    def __init__(self) -> None:
        self._entries: list[GlossaryEntry] = []

    def __len__(self) -> int:
        return len(self._entries)

    def load(self, path: str | Path) -> int:
        """Load glossary from CSV. Returns number of entries added."""
        path = Path(path)
        if not path.exists():
            logger.warning("Glossary CSV not found: %s", path)
            return 0

        added = 0
        with path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                en = (row.get("en_term") or "").strip()
                mnk = (row.get("mnk_term") or "").strip()
                if not en:
                    continue
                self._entries.append(
                    GlossaryEntry(
                        en=en,
                        mnk=mnk,
                        domain=(row.get("domain") or "general").strip(),
                        do_not_translate=(row.get("do_not_translate") or "").strip().lower()
                        in ("1", "true", "yes", "on"),
                    )
                )
                added += 1
        logger.info("Glossary loaded: %d entries from %s", added, path)
        return added

    def add(self, entry: GlossaryEntry) -> None:
        self._entries.append(entry)

    def entries(self) -> Iterable[GlossaryEntry]:
        return tuple(self._entries)

    def apply_en_to_mnk(self, text: str) -> str:
        """Post-process: replace English terms with their Mandinka equivalents.

        Skips do_not_translate entries (those must be preserved verbatim).
        """
        out = text
        for e in self._entries:
            if e.do_not_translate or not e.mnk:
                continue
            pattern = r"\b" + re.escape(e.en) + r"\b"
            out = re.sub(pattern, e.mnk, out, flags=re.IGNORECASE)
        return out

    def terms_to_preserve(self) -> list[str]:
        """English terms that must appear unchanged in the output."""
        return [e.en for e in self._entries if e.do_not_translate and e.en]

    def prompt_snippet(self) -> str:
        """Format the glossary for inclusion in an LLM system prompt."""
        if not self._entries:
            return ""
        lines = ["Glossary (use these exact translations; keep do-not-translate terms unchanged):"]
        for e in self._entries:
            if e.do_not_translate:
                lines.append(f"- {e.en}: keep unchanged")
            elif e.en and e.mnk:
                lines.append(f"- {e.en} -> {e.mnk}")
        return "\n".join(lines)
