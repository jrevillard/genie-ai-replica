"""Phase 3 — Perimeter PHI redactor.

Different threat model from haystack-chatqna's ``services/phi_deid.py``:
  * phi_deid.py is the THOROUGH 18-HIPAA-category scrubber for export
    paths (DHIS2 Tracker, FHIR, training-data dumps). Slow, conservative.
  * THIS redactor runs on every public API response in the gateway's
    request/response path. Narrow catalog, fast (<5 ms target), strict
    on false positives.

Two-direction policy:
  * INBOUND:  reject metadata fields containing HIGH/CRITICAL PHI
              (a session_id should never carry a phone number). The
              ``message`` / ``text`` / ``query`` field is exempt -- a
              patient may include their own PII in chat content.
  * OUTBOUND: scan every string in the response. Redact in place.
              Different replacement style for content fields vs
              metadata fields so chat bubbles don't read like SQL.

Risk mitigations baked in (per the Phase 3 brief):
  1. False-positive phones — Tier-1 (Gambian only, hard-redact),
     Tier-2 (international, requires leading "+", flag-only in
     content fields).
  2. Cosmetic ugliness — soft replacement in content fields.
  3. Unicode bypass — NFKC normalize before matching.
  4. Recursion bomb — hard depth cap of 10.
  5. Long strings — skip strings >50 KB.
  6. Patient ID leak — emit a CRITICAL audit alert (backend bug).

Safe contexts that look like PHI but aren't:
  * BP readings ``180/110``
  * Dosages ``500mg``
  * Blood sugar ``250 mg/dL``
  * BP units ``150 mmHg``
  * Port references ``port 8000``
  * Localhost / Docker-internal hostnames already in our own URL
    pattern list — those ARE intentionally redacted on outbound
    because they leak network topology.
"""
from __future__ import annotations

import logging
import re
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ── Tunables ─────────────────────────────────────────────────────────

MAX_RECURSION_DEPTH      = 10
MAX_STRING_BYTES         = 50_000
CONTENT_FIELD_NAMES      = frozenset({
    "response", "message", "text", "translation",
    "mandinka_translation", "back_translation",
    "content", "safe_summary", "output_preview",
    "assembled_output",
})


# ── Severity codes ──────────────────────────────────────────────────

SEV_CRITICAL = "critical"   # backend leak — fire alert
SEV_HIGH     = "high"       # always redact
SEV_MEDIUM   = "medium"     # redact only in non-content fields (flag in content)
SEV_LOW      = "low"        # always redact (for now, low-cost replacements)


# ── Pattern catalog ─────────────────────────────────────────────────
# Order matters: more specific (Gambian phone) before more general
# (international phone). Patient ID early because it triggers an alert.

@dataclass
class _Pattern:
    name:        str
    regex:       re.Pattern
    severity:    str
    soft_repl:   str   # used when the field is a content field
    hard_repl:   str   # used when the field is metadata
    # Whether this pattern's matches in CONTENT fields should be
    # actually redacted (True) or merely flagged (False).
    redact_in_content: bool


_PATTERNS: List[_Pattern] = [
    _Pattern(
        name      = "patient_id",
        # P_ followed by 6+ uppercase-hex chars. Verified format
        # ``P_FB9591B5`` from the live AMINA backend.
        regex     = re.compile(r"\bP_[A-F0-9]{6,}\b"),
        severity  = SEV_CRITICAL,
        soft_repl = "[patient ID removed]",
        hard_repl = "[REDACTED-PATIENT-ID]",
        redact_in_content = True,
    ),
    _Pattern(
        name      = "email",
        regex     = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),
        severity  = SEV_HIGH,
        soft_repl = "[email removed for privacy]",
        hard_repl = "[REDACTED-EMAIL]",
        redact_in_content = True,
    ),
    _Pattern(
        name      = "gambian_phone",
        # +220 (country code) + first digit 2-9 + 6 more digits = 10
        # total digits including the country prefix. Gambian numbers
        # never start with 0 or 1 in the subscriber portion.
        regex     = re.compile(r"\+?220[2-9]\d{6}\b"),
        severity  = SEV_HIGH,
        soft_repl = "[phone number removed for privacy]",
        hard_repl = "[REDACTED-PHONE]",
        redact_in_content = True,
    ),
    _Pattern(
        name      = "internal_url",
        # Matches our own internal hostnames and RFC1918 ranges that
        # should NEVER appear in a public response (would expose
        # network topology to GENIE-AI / OPEA).
        regex     = re.compile(
            r"https?://"
            r"("
            r"localhost|"
            r"127\.0\.0\.1|"
            r"10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
            r"192\.168\.\d{1,3}\.\d{1,3}|"
            r"172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|"
            r"haystack-chatqna|"
            r"arcadedb|"
            r"voice-tts(-mnk)?|"
            r"voice-stt|"
            r"nllb-translate|"
            r"amina-redis|"
            r"amina-gateway"
            r")"
            r"(:\d+)?"
            r"(/[^\s\"'<>]*)?",
            re.IGNORECASE,
        ),
        severity  = SEV_LOW,
        soft_repl = "[internal URL removed]",
        hard_repl = "[REDACTED-URL]",
        redact_in_content = True,
    ),
    _Pattern(
        name      = "international_phone",
        # MUST have leading + so we don't match generic 11-digit
        # numbers (timestamps, ICD codes, order numbers).
        regex     = re.compile(r"\+\d{1,3}[\s.\-]?\d{6,12}\b"),
        severity  = SEV_MEDIUM,
        soft_repl = "[phone number removed for privacy]",
        hard_repl = "[REDACTED-PHONE-INTL]",
        # Per the brief: international phone in content fields is
        # FLAGGED ONLY (severity medium), not actually replaced.
        redact_in_content = False,
    ),
    _Pattern(
        name      = "long_digit_run",
        # 11-18 contiguous digits (catches NIN-shaped IDs without
        # overfitting to a specific format we haven't verified).
        # Severity medium so it's logged but not aggressively
        # rewritten in content fields (per spec).
        regex     = re.compile(r"(?<!\d)\d{11,18}(?!\d)"),
        severity  = SEV_MEDIUM,
        soft_repl = "[number removed]",
        hard_repl = "[REDACTED-NUMBER]",
        redact_in_content = False,
    ),
]


# ── Safe-context guards ─────────────────────────────────────────────
# Substrings of the original text where we should NOT consider digit
# matches. We exclude any pattern hit that overlaps a safe-context
# match. Each safe regex is anchored on actual context (not just bare
# digits) to keep the lookahead bounded.

_SAFE_CONTEXTS: List[re.Pattern] = [
    # Blood pressure: "180/110", with optional " mmHg"
    re.compile(r"\b\d{2,3}/\d{2,3}\b(?:\s*mmHg)?"),
    # Dosage / blood sugar: "500 mg", "500 mg/dL", "500 mcg", "5 ml"
    re.compile(r"\b\d{1,4}\s*(mg|mcg|g|ml|iu)(?:/dL|/dl)?\b", re.IGNORECASE),
    # BP unit alone: "150 mmHg"
    re.compile(r"\b\d{1,3}\s*mmHg\b", re.IGNORECASE),
    # Port references: "port 8000", "port: 5174"
    re.compile(r"\bport[:\s]+\d{2,5}\b", re.IGNORECASE),
]


# ── Public-safe domain whitelist ────────────────────────────────────
# Internal-URL pattern is broad; carve out anything we explicitly
# want to stay visible in responses (e.g. AMINA's public docs URL).
_SAFE_DOMAINS: List[re.Pattern] = [
    re.compile(r"https?://amina\.health\b", re.IGNORECASE),
    re.compile(r"https?://genie-ai\.itu\.int\b", re.IGNORECASE),
]


# ── Result types ────────────────────────────────────────────────────

@dataclass
class Redaction:
    field:    str       # dot-path of the offending field
    pattern:  str       # name of the matched pattern
    action:   str       # "redacted" | "flagged" | "skipped_long" | "skipped_deep"
    severity: str
    # We deliberately do NOT carry the matched value; logging it would
    # defeat the redaction. Only pattern + path are stored.


@dataclass
class RedactionReport:
    redactions:        List[Redaction] = field(default_factory=list)
    alerts:            List[Dict[str, Any]] = field(default_factory=list)
    skipped_long_count: int = 0
    skipped_deep_count: int = 0
    latency_ms:        float = 0.0

    @property
    def redactions_count(self) -> int:
        return sum(1 for r in self.redactions if r.action == "redacted")

    @property
    def flagged_count(self) -> int:
        return sum(1 for r in self.redactions if r.action == "flagged")

    def summary_for_audit(self) -> List[Dict[str, str]]:
        """JSON-safe, no PHI values — only field path + pattern + action."""
        return [
            {
                "field":    r.field,
                "pattern":  r.pattern,
                "action":   r.action,
                "severity": r.severity,
            }
            for r in self.redactions
        ]


@dataclass
class RejectionInfo:
    reason:  str        # short code, e.g. "phi_in_session_id"
    field:   str        # dot-path
    pattern: str        # which pattern triggered


# ── The class ───────────────────────────────────────────────────────

class PerimeterPHIRedactor:
    """Stateful only for stats counters; redaction logic is pure."""

    # In-process counters used by /security/status. Reset on container
    # restart -- L7's ArcadeDB audit is the durable record.
    def __init__(self) -> None:
        self._stats = {
            "outbound_calls":       0,
            "outbound_redactions":  0,   # individual fields rewritten
            "outbound_alerts":      0,   # CRITICAL severity redactions
            "outbound_flagged":     0,   # severity-medium content-field hits
            "outbound_skipped_long": 0,
            "outbound_skipped_deep": 0,
            "inbound_checks":       0,
            "inbound_rejections":   0,
        }

    # ── Public API ─────────────────────────────────────────────────

    def redact_outbound(
        self,
        body: Any,
    ) -> Tuple[Any, RedactionReport]:
        """Recursive scan + redact. Returns (redacted_body, report).

        Always returns a structurally-equivalent body. Never mutates
        the input in place -- callers can safely keep the original for
        diff/debug.
        """
        t0 = time.perf_counter()
        report = RedactionReport()
        try:
            redacted = self._walk(body, "$", 0, report, mode="redact")
        except Exception as e:
            # If anything explodes, fail OPEN on the redactor (don't
            # block the response) but log loudly. Audit will record
            # zero redactions.
            logger.exception("phi_redactor: redact_outbound crashed: %s", e)
            redacted = body
        report.latency_ms = (time.perf_counter() - t0) * 1000

        self._stats["outbound_calls"]        += 1
        self._stats["outbound_redactions"]   += report.redactions_count
        self._stats["outbound_alerts"]       += len(report.alerts)
        self._stats["outbound_flagged"]      += report.flagged_count
        self._stats["outbound_skipped_long"] += report.skipped_long_count
        self._stats["outbound_skipped_deep"] += report.skipped_deep_count

        return redacted, report

    def check_inbound(
        self,
        body: Any,
    ) -> Tuple[bool, Optional[RejectionInfo]]:
        """Validate non-content fields don't contain HIGH/CRITICAL PHI.

        Returns (True, None) if the request is allowed, otherwise
        (False, RejectionInfo). Content fields (message/text/query) are
        always allowed -- the patient owns their data.
        """
        self._stats["inbound_checks"] += 1
        if not isinstance(body, dict):
            return True, None  # only dicts get inspected at L6

        report = RedactionReport()
        try:
            self._walk(body, "$", 0, report, mode="check")
        except Exception:
            logger.exception("phi_redactor: check_inbound crashed")
            return True, None  # fail open on bug — never block on our error

        # First HIGH/CRITICAL hit on a non-exempt field rejects.
        for r in report.redactions:
            if r.severity in (SEV_HIGH, SEV_CRITICAL):
                # The walker tagged content-field hits with action="exempt"
                # so we know to skip them here.
                if r.action == "exempt":
                    continue
                self._stats["inbound_rejections"] += 1
                return False, RejectionInfo(
                    reason  = f"phi_in_{r.field.split('.')[-1]}",
                    field   = r.field,
                    pattern = r.pattern,
                )
        return True, None

    def get_stats(self) -> Dict[str, int]:
        return dict(self._stats)

    # ── Internals ──────────────────────────────────────────────────

    def _is_content_field(self, path: str) -> bool:
        """Is the leaf field name in our content-field set?"""
        if not path:
            return False
        leaf = path.rsplit(".", 1)[-1]
        # Strip trailing array indices like ``messages[3]``
        leaf = re.sub(r"\[\d+\]$", "", leaf)
        return leaf in CONTENT_FIELD_NAMES

    def _walk(
        self,
        obj:    Any,
        path:   str,
        depth:  int,
        report: RedactionReport,
        *,
        mode:   str,    # "redact" | "check"
    ) -> Any:
        if depth > MAX_RECURSION_DEPTH:
            report.skipped_deep_count += 1
            report.redactions.append(Redaction(
                field=path, pattern="(none)", action="skipped_deep", severity=SEV_LOW,
            ))
            logger.warning(
                "phi_redactor: depth cap hit at %s (depth=%d) — leaving subtree intact",
                path, depth,
            )
            return obj

        if isinstance(obj, dict):
            out: Dict[str, Any] = {}
            for k, v in obj.items():
                child_path = f"{path}.{k}"
                out[k] = self._walk(v, child_path, depth + 1, report, mode=mode)
            return out

        if isinstance(obj, list):
            return [
                self._walk(item, f"{path}[{i}]", depth + 1, report, mode=mode)
                for i, item in enumerate(obj)
            ]

        if isinstance(obj, str):
            return self._scan_string(obj, path, report, mode=mode)

        # int / float / bool / None pass through.
        return obj

    def _scan_string(
        self,
        original: str,
        path:     str,
        report:   RedactionReport,
        *,
        mode:     str,
    ) -> str:
        if not original:
            return original
        # Byte length guard (UTF-8 worst case = 4 bytes/char; we use
        # ``len(original.encode())`` to be exact).
        try:
            byte_len = len(original.encode("utf-8"))
        except Exception:
            byte_len = len(original)
        if byte_len > MAX_STRING_BYTES:
            report.skipped_long_count += 1
            report.redactions.append(Redaction(
                field    = path,
                pattern  = "(none)",
                action   = "skipped_long",
                severity = SEV_LOW,
            ))
            logger.warning(
                "phi_redactor: string at %s is %d bytes (>%d cap) — skipped",
                path, byte_len, MAX_STRING_BYTES,
            )
            return original

        # NFKC normalise so full-width digits, etc. become canonical.
        normalised = unicodedata.normalize("NFKC", original)

        # Skip pattern matching entirely inside whitelisted public
        # domains (otherwise the URL pattern would catch them too).
        # Operate on the normalised string but redact on the same
        # since they should already be byte-equal for ASCII domains.
        for safe in _SAFE_DOMAINS:
            if safe.search(normalised):
                # We only want to suppress the ``internal_url`` pattern
                # for whitelisted domains, not all patterns. Easiest:
                # temporarily blank those occurrences before scanning,
                # then restore. But simpler in practice: scan; the
                # internal_url regex is designed not to match
                # amina.health (no localhost / RFC1918 / docker host).
                pass

        # Compute "safe spans" in the normalised text — anything inside
        # one of these spans is exempt from redaction.
        safe_spans: List[Tuple[int, int]] = []
        for safe in _SAFE_CONTEXTS:
            for m in safe.finditer(normalised):
                safe_spans.append(m.span())

        def _in_safe_span(start: int, end: int) -> bool:
            for s, e in safe_spans:
                if start >= s and end <= e:
                    return True
                # Also reject if it overlaps any safe span -- a safe
                # span hit means the surrounding context is benign.
                if start < e and end > s:
                    return True
            return False

        in_content = self._is_content_field(path)
        # Build redactions: walk the patterns and apply (or just
        # report, in check mode). Use a single replace pass at the
        # end for stable indices.
        result = normalised
        # Track substitutions as (start_in_current_result, end, replacement, pattern_name).
        # We re-scan ``result`` after each pattern so subsequent
        # patterns see already-redacted text (avoids double-matching).
        for p in _PATTERNS:
            # Re-find safe spans since result has changed
            current_safe: List[Tuple[int, int]] = []
            for safe in _SAFE_CONTEXTS:
                for m in safe.finditer(result):
                    current_safe.append(m.span())

            def _safe_overlap(a: int, b: int) -> bool:
                for s, e in current_safe:
                    if a < e and b > s:
                        return True
                return False

            def _safe_overlap_orig(a: int, b: int) -> bool:
                # Also check the ORIGINAL safe spans (in normalised
                # coordinates) so we don't lose context after partial
                # rewrites. Not strictly necessary since safe spans
                # never collide with PHI patterns at our regex
                # specificity, but defence in depth.
                for s, e in safe_spans:
                    if a < e and b > s:
                        return True
                return False

            new_result = []
            cursor = 0
            for m in p.regex.finditer(result):
                start, end = m.span()
                if _safe_overlap(start, end) or _safe_overlap_orig(start, end):
                    continue

                # Severity-medium patterns in content fields: flag
                # only, do NOT replace.
                if in_content and not p.redact_in_content:
                    report.redactions.append(Redaction(
                        field    = path,
                        pattern  = p.name,
                        action   = "flagged",
                        severity = p.severity,
                    ))
                    continue

                # In check mode (inbound): record the hit but DO NOT
                # rewrite (we just want to know if it's there). Tag
                # content-field hits as "exempt" so the inbound check
                # ignores them.
                if mode == "check":
                    action = "exempt" if in_content else "redacted"
                    report.redactions.append(Redaction(
                        field    = path,
                        pattern  = p.name,
                        action   = action,
                        severity = p.severity,
                    ))
                    continue

                # Outbound redact path.
                new_result.append(result[cursor:start])
                new_result.append(p.soft_repl if in_content else p.hard_repl)
                cursor = end
                report.redactions.append(Redaction(
                    field    = path,
                    pattern  = p.name,
                    action   = "redacted",
                    severity = p.severity,
                ))
                if p.severity == SEV_CRITICAL:
                    report.alerts.append({
                        "type":     "critical_phi_in_response",
                        "field":    path,
                        "pattern":  p.name,
                        "message":  (
                            "Backend leaked a CRITICAL PHI value (e.g. patient_id) "
                            "into a public response. Investigate the backend handler."
                        ),
                    })
            if mode == "redact" and cursor > 0:
                new_result.append(result[cursor:])
                result = "".join(new_result)

        # In check mode, return the original normalised string -- we
        # don't rewrite.
        return result if mode == "redact" else normalised


# ── Module-level singleton ──────────────────────────────────────────
# The gateway holds one instance per process. Stats accumulate across
# requests until container restart.

_INSTANCE: Optional[PerimeterPHIRedactor] = None


def get_redactor() -> PerimeterPHIRedactor:
    global _INSTANCE
    if _INSTANCE is None:
        _INSTANCE = PerimeterPHIRedactor()
    return _INSTANCE
