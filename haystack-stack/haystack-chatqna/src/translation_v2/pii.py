"""PII detection for translation requests.

Detect likely PII before an outbound LLM call. **Detection-only** —
this module flags and reports, it does not mutate or redact text.
Masking policy is deferred to a tech-lead decision (inventory open
question Q9). Once that decision lands, redaction can layer on top of
this detector without changing its interface.

Patterns tuned for AMINA's Gambia context:
  - Phone numbers: +220 prefix + 7 digits (with optional spaces/hyphens)
  - Emails (standard RFC-ish)
  - National ID-like tokens (2-3 uppercase letters + 5-9 digits)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


_PHONE_RE = re.compile(
    r"\+?220[\s-]?\d{3}[\s-]?\d{4}"     # Gambian international
    r"|\b\d{3}[\s-]?\d{4}\b",            # Local 7-digit (220 prefix implicit)
)
_EMAIL_RE = re.compile(
    r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
    re.IGNORECASE,
)
_NID_RE = re.compile(r"\b[A-Z]{2,3}\d{5,9}\b")


@dataclass
class PIIReport:
    phones: list[str] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)
    national_ids: list[str] = field(default_factory=list)

    @property
    def has_pii(self) -> bool:
        return bool(self.phones or self.emails or self.national_ids)

    def summary(self) -> dict[str, int]:
        """Counts-only summary — safe to log (no PII values)."""
        return {
            "phones": len(self.phones),
            "emails": len(self.emails),
            "national_ids": len(self.national_ids),
        }


class PIIDetector:
    """Stateless PII scanner.

    Usage:
        detector = PIIDetector()
        report = detector.scan(user_text)
        if report.has_pii:
            log_event("pii_detected", **report.summary())
    """

    def scan(self, text: str) -> PIIReport:
        if not text:
            return PIIReport()
        return PIIReport(
            phones=_PHONE_RE.findall(text),
            emails=_EMAIL_RE.findall(text),
            national_ids=_NID_RE.findall(text),
        )
