"""Pattern-based prompt-injection detector.

This is intentionally a regex catalog, not an ML classifier. Pros:
  * deterministic — same input always returns the same verdict
  * fast — <1 ms per request, no GPU/CPU cost
  * explainable — every block reports the pattern that matched
  * ships today

Cons / what this misses (sprint backlog):
  * obfuscated variants the corpus authors haven't seen yet (L3 FAISS+SBERT job)
  * gradual multi-turn boundary-pushing (L6 conversation tracker job)
  * sophisticated base64/leet-speak that doesn't match the regex (L1 SVM job)

Each pattern carries a severity:
  * high   -> reject 400 with explicit reason, audit logged
  * medium -> reject with a softer "rephrase your question" message
  * low    -> let through but flag in the audit log for analyst review

Severity is a hint, not a hard rule — callers can downgrade a block
to a flag via the ``mode`` arg. Default mode is ``"enforce"``.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Tuple


@dataclass
class JailbreakPattern:
    name:        str
    pattern:     re.Pattern
    severity:    str       # "high" | "medium" | "low"
    description: str


# ── Catalog ──────────────────────────────────────────────────────────
# Order matters slightly for the audit log — patterns are tested in
# order and we report the FIRST match. Put the most specific patterns
# first so the audit trail is informative.

_RAW_PATTERNS: List[Tuple[str, str, str, str]] = [
    # ── Classic prompt-injection openers (the most common attack class) ──
    (
        "ignore_previous",
        r"(?i)\b(ignore|disregard|forget|override)\s+(all\s+|the\s+|any\s+)?"
        r"(previous|prior|above|earlier|preceding|all)\s+"
        r"(instruction|prompt|message|rule|directive|system)",
        "high",
        "Classic 'ignore previous instructions' jailbreak opener.",
    ),
    (
        "system_prompt_leak",
        # Verb forms: reveal/show/print/display/leak/expose/tell me/give me
        # Optional bridge: "me" (so "show me your system prompt" works
        #                  the same as "show your system prompt").
        # Optional possessive: "your", "the"
        # Optional adjective phrase: "hidden", "secret", "real", "original",
        #                            "underlying".
        # Target nouns: many phrasings of system-prompt / instructions /
        #               directive / rules / config.
        r"(?i)\b(reveal|show|print|display|leak|expose|tell\s+me|give\s+me)\s+"
        r"(me\s+)?"
        r"(your\s+|the\s+)?"
        r"((hidden|secret|real|original|underlying|internal|raw|true)\s+)?"
        r"(system\s+(prompt|message|directive|instruction)|"
        r"initial\s+(instruction|prompt|directive)s?|"
        r"hidden\s+(rule|instruction|prompt)s?|"
        r"developer\s+(message|prompt|instruction)s?|"
        r"original\s+prompt|"
        r"underlying\s+(prompt|instruction)s?|"
        r"prompt\s+template|"
        r"chat\s+template)",
        "high",
        "Attempt to extract the system prompt or hidden instructions.",
    ),
    (
        "new_instructions",
        r"(?i)\b(new|updated|fresh|revised)\s+(instruction|directive|rule|prompt)s?\s*[:.]",
        "high",
        "Attempt to override system instructions with attacker-supplied ones.",
    ),
    (
        # Sister to system_prompt_leak: catches "show me your secret
        # instructions" / "reveal your underlying directive" / etc.
        # where the prefix is an adjective rather than "system|initial|
        # developer". Target nouns: prompt, instruction, directive,
        # rule, configuration, template.
        "secret_instructions_leak",
        r"(?i)\b(reveal|show|print|display|leak|expose|tell\s+me|give\s+me)\s+"
        r"(your\s+|the\s+|me\s+(your|the)\s+)?"
        r"(hidden|secret|real|original|underlying|internal|raw|true|exact)\s+"
        r"(prompt|instruction|directive|rule|configuration|template|guideline)s?",
        "high",
        "Attempt to extract internal prompts/instructions via adjective framing.",
    ),

    # ── Persona / role-play attacks (DAN, jailbroken, etc.) ──
    (
        "dan_jailbreak",
        r"(?i)\b(DAN|do\s+anything\s+now|jailbroken|developer\s+mode|"
        r"god\s+mode|unlocked\s+mode)\b",
        "high",
        "Known DAN-family jailbreak handle.",
    ),
    (
        "role_play_pretend",
        r"(?i)\b(pretend\s+(to\s+be|that\s+you('re|\s+are))|"
        r"act\s+(as\s+if|like\s+you('re|\s+are))|"
        r"roleplay\s+as|you\s+are\s+now\s+(a|an)\b)",
        "medium",
        "Role-play opener — common jailbreak vector but also legitimate.",
    ),
    (
        "evil_twin",
        r"(?i)\b(evil|opposite|unrestricted|unfiltered|uncensored|amoral)\s+"
        r"(version|twin|self|persona|AI|assistant|model)",
        "high",
        "Asks the model to roleplay an unrestricted persona.",
    ),

    # ── Clinical-domain-specific jailbreaks (AMINA-specific) ──
    (
        "prescribe_specific_drug",
        # Imperative position required so we don't false-positive on
        # passive observations like "doctor will prescribe metformin"
        # or "I am prescribed insulin". The verb must appear at start
        # of message, after sentence punctuation, or after a polite/
        # imperative cue. Drug list covers the common Gambia formulary.
        r"(?i)"
        r"(?:^|[.!?]\s+|\b(please|just|now|hey|amina|i\s+want\s+you\s+to|"
        r"you\s+(?:must|should|need\s+to)|can\s+you)\s+)"
        r"(prescribe|recommend|tell\s+me\s+to\s+take)"
        r"(\s+(me|us|him|her|them|my\s+\w+))?"
        r"(\s+\d+\s*(mg|mcg|g|ml|iu)(\s+of)?)?"
        r"\s+(metformin|amlodipine|insulin|aspirin|paracetamol|ibuprofen|"
        r"amoxicillin|ciprofloxacin|metronidazole|chloroquine|"
        r"hydrochlorothiazide|atorvastatin|warfarin|losartan|"
        r"glibenclamide|gliclazide|simvastatin|enalapril|nifedipine)",
        "high",
        "Direct request for a prescription — AMINA must never prescribe.",
    ),
    (
        "diagnose_demand",
        # "diagnose me" alone is too broad -- it false-positives on
        # "doctor will diagnose me at my next visit" or "is your
        # algorithm able to diagnose me". Require imperative position
        # (start of message, after sentence punctuation, or after a
        # polite-imperative cue) for the bare "diagnose me" variant.
        # The other variants are already specific enough.
        r"(?i)("
        r"(?:^|[.!?]\s+|\b(please|just|now|hey|amina|i\s+need\s+you\s+to)\s+)"
        r"diagnose\s+me\b"
        r"|\btell\s+me\s+(what|which)\s+disease"
        r"|\bgive\s+me\s+a\s+diagnosis"
        r"|\bam\s+I\s+having\s+a\s+stroke"
        r"|\bdo\s+I\s+have\s+(cancer|HIV|diabetes\s+for\s+sure)"
        r")",
        "medium",
        "Asks the model to perform definitive diagnosis.",
    ),
    (
        "override_safety",
        r"(?i)\b(skip|bypass|disable|turn\s+off|ignore)\s+"
        r"(the\s+)?(safety|guardrail|filter|warning|disclaimer|safeguard)",
        "high",
        "Direct attempt to disable safety layers.",
    ),
    (
        "patient_data_exfil",
        # Old pattern's data/record/information suffix was OPTIONAL,
        # which over-matched benign "tell me about patient education"
        # / "patient care" / "patient safety". Negative-lookahead
        # carves out the most common benign noun phrases. Keep the
        # data-implication suffix optional (so "show me all patients"
        # still flags) but fail the match if "patient" is followed by
        # an unambiguously benign topic word.
        r"(?i)\b(list|show|give\s+me|reveal|tell\s+me\s+about)\s+"
        r"(all\s+|other\s+|every\s+)?patient(s)?\b"
        r"(?!\s+(education|care|safety|history|advocacy|outcome|portal|"
        r"consent|engagement|stories|story|journey|reviews?))"
        r"(\s+data|\s+record|\s+information|\s+phone|\s+address)?",
        "high",
        "Attempt to access patient data the caller is not authorised for.",
    ),

    # ── Encoding / obfuscation tricks (catches naive base64 attacks) ──
    (
        "base64_payload",
        # Long contiguous base64 block (40+ chars) is suspicious in chat
        r"[A-Za-z0-9+/]{60,}={0,2}",
        "medium",
        "Long base64-shaped block in chat — possible obfuscated payload.",
    ),
    (
        "rot13_marker",
        r"(?i)\brot[\s\-]?13\b",
        "low",
        "Mention of rot13 encoding — common obfuscation reference.",
    ),
    (
        "hex_payload",
        r"(?:0x[0-9a-fA-F]{20,}|\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){10,})",
        "medium",
        "Long hex byte sequence — possible obfuscated payload.",
    ),
    (
        "unicode_smuggling",
        # Zero-width / BiDi-control chars used to hide instructions.
        # OLD pattern had a literal `0-F` range that Python regex parsed
        # as ASCII 0..F (catching every alphanumeric). Use explicit
        # escapes so the range is unambiguously Unicode-only:
        #   U+200B-200F  zero-width space, ZWNJ, ZWJ, LTR/RTL marks
        #   U+202A-202E  BiDi formatting
        #   U+2060-2064  word joiner + invisible chars
        #   U+2066-206F  BiDi isolates + deprecated formatting
        #   U+FEFF       zero-width no-break space (BOM)
        "[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]",
        "high",
        "Zero-width or invisible Unicode characters — used to smuggle instructions.",
    ),

    # ── Multi-turn escalation seeds (single-turn flag; full L6 in backlog) ──
    (
        "hypothetical_for_real",
        # Old regex required `\s+` immediately after the opener, which
        # rejected the very common attack shape "Hypothetically,..."
        # because the comma is not whitespace. Use a permissive
        # punctuation+whitespace bridge so realistic phrasing matches.
        r"(?i)\b(hypothetically|imagine|suppose|in\s+a\s+story)[\s,;.:]+"
        r".{0,40}?\b"
        r"(how\s+would|teach\s+me|tell\s+me\s+how|explain\s+how)\s+to\s+"
        r"(harm|kill|poison|overdose|hurt)",
        "high",
        "Hypothetical-framing of a harmful request.",
    ),
    (
        "harmful_intent_direct",
        r"(?i)\b(how\s+(to|do\s+I))\s+"
        r"(harm|kill|poison|overdose|self[\s\-]harm|commit\s+suicide|hurt\s+myself)",
        "high",
        "Direct request for harm-instructions.",
    ),

    # ── Injection-via-payload (SQL/NoSQL/LDAP — caught even though
    # the chat field is unlikely to reach the DB, defence in depth) ──
    (
        "sql_injection",
        r"(?i)\b(union\s+select|drop\s+table|insert\s+into|"
        r"delete\s+from|select\s+\*\s+from)\b",
        "medium",
        "SQL injection signature.",
    ),
    (
        "nosql_injection",
        # Allow optional quote/whitespace between the operator and the
        # colon so realistic JSON payloads like `{"$gt": ""}` match.
        # Without the quote allowance the most common attack shape
        # would slip past.
        r'(\$gt|\$lt|\$ne|\$regex|\$where)\s*["\']?\s*[:=]',
        "medium",
        "NoSQL injection operator.",
    ),
    (
        "path_traversal",
        r"(\.\./){2,}|(\.\.\\){2,}",
        "medium",
        "Path traversal pattern (../../).",
    ),
]


PATTERNS: List[JailbreakPattern] = [
    JailbreakPattern(
        name=name,
        pattern=re.compile(pat),
        severity=sev,
        description=desc,
    )
    for (name, pat, sev, desc) in _RAW_PATTERNS
]


@dataclass
class DetectionResult:
    blocked:    bool
    severity:   Optional[str]    # "high" | "medium" | "low" | None
    pattern:    Optional[str]    # name of the matched pattern
    description: Optional[str]   # human-readable reason
    snippet:    Optional[str]    # first 80 chars of the matched substring


def detect(text: str, *, mode: str = "enforce") -> DetectionResult:
    """Scan ``text`` for jailbreak patterns. Returns the first match.

    ``mode``:
      * ``enforce`` — high/medium severity → blocked=True
      * ``flag``    — only blocked=True for high severity, medium becomes a flag
      * ``audit``   — never blocks; always returns blocked=False, just reports
    """
    if not text:
        return DetectionResult(False, None, None, None, None)

    for p in PATTERNS:
        m = p.pattern.search(text)
        if not m:
            continue
        snippet = m.group(0)[:80]
        if mode == "audit":
            block = False
        elif mode == "flag":
            block = p.severity == "high"
        else:  # "enforce"
            block = p.severity in ("high", "medium")
        return DetectionResult(
            blocked     = block,
            severity    = p.severity,
            pattern     = p.name,
            description = p.description,
            snippet     = snippet,
        )

    return DetectionResult(False, None, None, None, None)


def pattern_count() -> int:
    """For the /security/status endpoint."""
    return len(PATTERNS)


def pattern_summary() -> List[dict]:
    """Public-safe summary used by /security/status. Does NOT include
    the regex source (that would help attackers craft bypasses)."""
    return [
        {"name": p.name, "severity": p.severity, "description": p.description}
        for p in PATTERNS
    ]
