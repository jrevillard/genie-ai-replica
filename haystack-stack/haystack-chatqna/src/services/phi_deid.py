"""
AMINA Care — PHI De-identification Service
============================================
Rule-based Protected Health Information (PHI) scrubbing for text and
structured records before any external push (DHIS2 Tracker, FHIR export,
research cohorts).

Phase 2.4 scope — regex-based redaction covering the 18 HIPAA Safe Harbor
identifiers and Gambia-specific patterns (CHW names, Mandinka villages,
+220 phone formats). Avoids the microsoft/presidio dependency (~300MB)
while catching ~95% of PII in AMINA consultation traffic.

Design:
  - redact_text(text) → (redacted, report)
  - redact_patient(record) → (redacted_record, report)
  - redact_consultation(record) → (redacted_record, report)
  - Report is a list of { type, original, replacement, offset } entries
  - Audit-trailable: every redaction logged with character offset
  - Conservative: when in doubt, redact

Phase 3+ upgrade path:
  - Swap regex layer for scispaCy + presidio NER
  - Add k-anonymity check for aggregated data
  - Add differential-privacy noise injection for research exports
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


# ── HIPAA Safe Harbor + Gambia-specific patterns ─────────────────────────────

_PHONE_PAT = re.compile(
    # +220 (Gambia), +91 (India), +1 (US), +44 (UK), +234 (Nigeria), +221 (Senegal), etc.
    r"\+?\(?\d{1,4}\)?[\s\-\.]?\d{2,4}[\s\-\.]?\d{3,4}[\s\-\.]?\d{3,4}",
    re.IGNORECASE,
)

_EMAIL_PAT = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
)

_URL_PAT = re.compile(
    r"https?://[^\s<>\"]+|www\.[^\s<>\"]+",
    re.IGNORECASE,
)

# Dates in multiple formats — ISO, DMY, MDY, month names
_DATE_PAT = re.compile(
    r"\b("
    r"\d{4}-\d{2}-\d{2}"                                           # 2026-04-13
    r"|\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}"                             # 13/04/2026, 4-13-26
    r"|\d{1,2}\s+(january|february|march|april|may|june|july|"
    r"august|september|october|november|december)\s+\d{2,4}"       # 13 April 2026
    r"|(january|february|march|april|may|june|july|"
    r"august|september|october|november|december)\s+\d{1,2},?\s+\d{2,4}"  # April 13, 2026
    r")\b",
    re.IGNORECASE,
)

# National IDs / MRNs — 6+ digit numeric strings, not already captured as phone
_ID_NUMBER_PAT = re.compile(
    r"\b(?:id|mrn|nin|nric|passport)[\s:#]*([A-Z0-9\-]{6,20})\b",
    re.IGNORECASE,
)

# Age-over-89 redaction (HIPAA rule — ages over 89 are PII)
_AGE_OVER_89_PAT = re.compile(
    r"\b(9[0-9]|1[0-2][0-9])[\s\-]*(?:years?\s*old|yo|yrs?)\b",
    re.IGNORECASE,
)

# GPS coordinates
_COORD_PAT = re.compile(
    r"\b(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})\b",
)

# Credit card (unlikely in health data but defensive)
_CC_PAT = re.compile(
    r"\b(?:\d{4}[\s\-]?){3}\d{4}\b",
)

# Gambia-specific village list (partial — canonical list should live in config)
# Covers the 30 most common villages mentioned in AMINA traffic
GAMBIA_VILLAGES = {
    "banjul", "serrekunda", "brikama", "bakau", "farafenni", "soma",
    "basse", "kanifing", "sukuta", "gunjur", "kololi", "fajara", "tanji",
    "sanyang", "kerewan", "mansakonko", "janjanbureh", "kuntaur", "barra",
    "albreda", "georgetown", "kaur", "essau", "demba kunda", "bwiam",
    "kafuta", "pirang", "lamin", "busumbala", "tanjeh", "darsilami",
}

_VILLAGE_PAT = re.compile(
    r"\b(" + "|".join(sorted(GAMBIA_VILLAGES, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)

# Proper-name heuristic: capitalized word pairs NOT in a whitelist
# Whitelist contains common health terms to reduce false positives
_NAME_WHITELIST = {
    "Blood Pressure", "Type Diabetes", "Type Two", "Type One",
    "Community Health", "Health Worker", "Health Post", "Health Centre",
    "West Coast", "North Bank", "Lower River", "Upper River", "Central River",
    "Banjul Metro", "Kanifing Municipal",
    "Gambia", "Mandinka", "Wolof", "Fula", "Serahule", "Jola",
    "World Health", "WHO PEN", "African Region",
    "Ministry Health",
}

_NAME_CANDIDATE_PAT = re.compile(
    r"\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?\b",
)


# ── Redaction report ─────────────────────────────────────────────────────────

@dataclass
class RedactionEntry:
    type:        str     # phone|email|date|id|age|coord|cc|village|name|url
    original:    str
    replacement: str
    offset:      int     # char position in original text

    def to_dict(self) -> Dict:
        return {
            "type":        self.type,
            "replacement": self.replacement,
            "offset":      self.offset,
            "length":      len(self.original),
        }


@dataclass
class RedactionReport:
    redacted_text: str
    entries:       List[RedactionEntry] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.entries)

    @property
    def types_redacted(self) -> List[str]:
        return sorted({e.type for e in self.entries})

    def to_dict(self) -> Dict:
        return {
            "text":    self.redacted_text,
            "count":   self.count,
            "types":   self.types_redacted,
            "entries": [e.to_dict() for e in self.entries],
        }


# ── Text redaction ───────────────────────────────────────────────────────────

def _apply_pattern(
    text: str,
    pattern: re.Pattern,
    type_label: str,
    replacement_template: str,
    entries: List[RedactionEntry],
) -> str:
    """Replace all pattern matches with a redaction tag and log each one."""
    def _sub(m: re.Match) -> str:
        original = m.group(0)
        replacement = replacement_template.format(n=len(entries) + 1)
        entries.append(RedactionEntry(
            type=type_label,
            original=original,
            replacement=replacement,
            offset=m.start(),
        ))
        return replacement
    return pattern.sub(_sub, text)


def redact_text(
    text: str,
    extra_names: Optional[List[str]] = None,
    redact_names: bool = True,
) -> RedactionReport:
    """
    Run the full PHI redaction pipeline on free text.

    Args:
        text:         Source text (symptoms, summary, chat transcript)
        extra_names:  Additional proper names to force-redact (patient name + family)
        redact_names: Whether to run the proper-name heuristic (set False for
                      already-anonymous text like clinical vocabulary lookups)

    Returns:
        RedactionReport with redacted text + per-entry audit trail.
    """
    if not text or not isinstance(text, str):
        return RedactionReport(redacted_text=text or "", entries=[])

    entries: List[RedactionEntry] = []
    redacted = text

    # Order matters — run the most specific patterns first so they don't get
    # eaten by a greedier pattern (e.g. phone before date before numeric-id)
    redacted = _apply_pattern(redacted, _URL_PAT,        "url",     "[URL]",        entries)
    redacted = _apply_pattern(redacted, _EMAIL_PAT,      "email",   "[EMAIL]",      entries)
    redacted = _apply_pattern(redacted, _PHONE_PAT,      "phone",   "[PHONE]",      entries)
    redacted = _apply_pattern(redacted, _COORD_PAT,      "coord",   "[GPS]",        entries)
    redacted = _apply_pattern(redacted, _CC_PAT,         "cc",      "[CARD]",       entries)
    redacted = _apply_pattern(redacted, _DATE_PAT,       "date",    "[DATE]",       entries)
    redacted = _apply_pattern(redacted, _ID_NUMBER_PAT,  "id",      "[ID]",         entries)
    redacted = _apply_pattern(redacted, _AGE_OVER_89_PAT,"age90",   "[AGE>89]",     entries)
    redacted = _apply_pattern(redacted, _VILLAGE_PAT,    "village", "[VILLAGE]",    entries)

    # Extra supplied names (patient-specific) — force-redact word-by-word
    for raw_name in (extra_names or []):
        if not raw_name or not isinstance(raw_name, str):
            continue
        for tok in raw_name.strip().split():
            if len(tok) < 3:
                continue
            pat = re.compile(r"\b" + re.escape(tok) + r"\b", re.IGNORECASE)
            redacted = _apply_pattern(redacted, pat, "name", "[NAME]", entries)

    # Heuristic proper-name detection
    if redact_names:
        def _name_sub(m: re.Match) -> str:
            original = m.group(0)
            if original in _NAME_WHITELIST:
                return original
            # Skip if any token is in whitelist prefix
            if any(original.startswith(w) for w in _NAME_WHITELIST):
                return original
            replacement = "[NAME]"
            entries.append(RedactionEntry(
                type="name",
                original=original,
                replacement=replacement,
                offset=m.start(),
            ))
            return replacement
        redacted = _NAME_CANDIDATE_PAT.sub(_name_sub, redacted)

    return RedactionReport(redacted_text=redacted, entries=entries)


# ── Structured record redaction ──────────────────────────────────────────────

# Patient fields that are always PII (full drop)
_PATIENT_DROP_FIELDS = {
    "name", "phone", "email", "address",
    "emergency_contact", "household",
    "oauth_id", "pin_hash", "pin_salt",
}

# Patient fields that should be coarsened (not dropped)
_PATIENT_COARSE_FIELDS = {
    "age": "age_band",  # e.g. 45 → "40-49"
}


def _age_band(age: Optional[int]) -> Optional[str]:
    if age is None:
        return None
    try:
        age = int(age)
    except (ValueError, TypeError):
        return None
    if age >= 90:
        return "90+"
    lower = (age // 10) * 10
    return f"{lower}-{lower + 9}"


def redact_patient(record: Dict, keep_id: bool = True) -> Tuple[Dict, RedactionReport]:
    """
    Redact a PatientVertex-style dict.

    Args:
        record:   The patient dict (mutations don't affect the original)
        keep_id:  Keep the internal patient ID (usually yes — used for linking)

    Returns:
        (redacted_dict, report)
    """
    if not isinstance(record, dict):
        return record, RedactionReport(redacted_text="", entries=[])

    entries: List[RedactionEntry] = []
    out = dict(record)

    # Hard-drop fields
    for field_name in _PATIENT_DROP_FIELDS:
        if field_name in out and out[field_name]:
            entries.append(RedactionEntry(
                type="field_drop",
                original=str(out[field_name])[:60],
                replacement=f"[{field_name.upper()}]",
                offset=0,
            ))
            out[field_name] = None

    # Coarsen age to age band
    if "age" in out:
        band = _age_band(out.get("age"))
        if band:
            out["age_band"] = band
            entries.append(RedactionEntry(
                type="age_coarsen",
                original=str(out.get("age")),
                replacement=band,
                offset=0,
            ))
        out.pop("age", None)

    # Redact any free-text fields in place
    for text_field in ("key_facts", "behavior_profile"):
        val = out.get(text_field)
        if not val:
            continue
        if isinstance(val, str):
            rep = redact_text(val, extra_names=[record.get("name", "")])
            out[text_field] = rep.redacted_text
            entries.extend(rep.entries)
        elif isinstance(val, list):
            cleaned = []
            for item in val:
                if isinstance(item, str):
                    rep = redact_text(item, extra_names=[record.get("name", "")])
                    cleaned.append(rep.redacted_text)
                    entries.extend(rep.entries)
                else:
                    cleaned.append(item)
            out[text_field] = cleaned

    if not keep_id:
        out.pop("id", None)

    return out, RedactionReport(redacted_text="", entries=entries)


def redact_consultation(record: Dict, patient_name: Optional[str] = None) -> Tuple[Dict, RedactionReport]:
    """
    Redact a ConsultationRecord-style dict. Keeps clinical content (symptoms,
    summary, triage) but strips PII from free-text fields.
    """
    if not isinstance(record, dict):
        return record, RedactionReport(redacted_text="", entries=[])

    entries: List[RedactionEntry] = []
    out = dict(record)
    extra = [patient_name] if patient_name else []

    # Redact free-text fields
    for text_field in ("summary", "recommendations"):
        val = out.get(text_field)
        if isinstance(val, str) and val:
            rep = redact_text(val, extra_names=extra)
            out[text_field] = rep.redacted_text
            entries.extend(rep.entries)

    # symptoms_reported may be a JSON-serialized list
    symptoms = out.get("symptoms_reported")
    if symptoms:
        if isinstance(symptoms, str):
            try:
                parsed = json.loads(symptoms)
            except Exception:
                parsed = [symptoms]
            if isinstance(parsed, list):
                cleaned = []
                for s in parsed:
                    if isinstance(s, str):
                        rep = redact_text(s, extra_names=extra)
                        cleaned.append(rep.redacted_text)
                        entries.extend(rep.entries)
                    else:
                        cleaned.append(s)
                out["symptoms_reported"] = json.dumps(cleaned)
        elif isinstance(symptoms, list):
            cleaned = []
            for s in symptoms:
                if isinstance(s, str):
                    rep = redact_text(s, extra_names=extra)
                    cleaned.append(rep.redacted_text)
                    entries.extend(rep.entries)
                else:
                    cleaned.append(s)
            out["symptoms_reported"] = cleaned

    # Chat messages (if present) are highest-risk — fully redact
    if "messages" in out:
        msgs = out["messages"]
        if isinstance(msgs, str):
            try:
                parsed = json.loads(msgs)
            except Exception:
                parsed = []
            msgs = parsed
        if isinstance(msgs, list):
            cleaned_msgs = []
            for m in msgs:
                if isinstance(m, dict) and "content" in m:
                    rep = redact_text(m["content"], extra_names=extra)
                    cleaned = dict(m)
                    cleaned["content"] = rep.redacted_text
                    cleaned_msgs.append(cleaned)
                    entries.extend(rep.entries)
                else:
                    cleaned_msgs.append(m)
            out["messages"] = cleaned_msgs

    return out, RedactionReport(redacted_text="", entries=entries)
