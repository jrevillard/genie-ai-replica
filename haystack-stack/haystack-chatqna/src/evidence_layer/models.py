"""
Evidence Layer — typed models.

Plain dataclasses (not Pydantic) so they are usable from both the
runtime patch and the admin route layer with zero overhead.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass
class EvidenceLayerStatus:
    state: str                                = "off"     # off|loading|on|reverting|error
    last_changed_at: Optional[str]            = None      # ISO-8601 UTC
    last_changed_by: Optional[str]            = None      # admin handle (NOT JWT, NOT email)
    last_enabled_by: Optional[str]            = None
    last_eval_score: Optional[float]          = None      # 0.0–1.0
    last_eval_at: Optional[str]               = None
    last_report_path: Optional[str]           = None
    error: Optional[str]                      = None
    trace_count_recent: int                   = 0
    persistence_backend: str                  = "redis"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class EvidenceLayerToggleRequest:
    note: Optional[str] = None  # optional admin-supplied reason


@dataclass
class EvidenceTrace:
    """Privacy-safe per-turn record. NO raw message, NO phone, NO name."""
    trace_id: str                             = ""
    timestamp: str                            = ""
    session_hash: str                         = ""        # sha256[:10] of session_id
    patient_hash: Optional[str]               = None      # sha256[:10] of patient_id (if any)
    role: str                                 = ""        # guest|patient|chw|admin
    mode: Optional[str]                       = None      # beginner|basic|advanced
    channel: Optional[str]                    = None      # web|telegram|meta|voice
    provider: Optional[str]                   = None      # openai|groq|gemini|amina_lora|...
    fallback_used: bool                       = False
    latency_ms: Optional[float]               = None
    route: Optional[str]                      = None      # routing_source from agent
    intent: Optional[str]                     = None      # intention from agent
    domain_hint: Optional[str]                = None
    triage_level: Optional[str]               = None      # EMERGENCY|FACILITY|...
    is_emergency: bool                        = False
    safety_flags: List[str]                   = field(default_factory=list)
    tools_used: List[str]                     = field(default_factory=list)  # tool NAMES only
    cost_estimate_usd: Optional[float]        = None      # if token data present
    error_kind: Optional[str]                 = None      # exception class name only
    user_message_len: int                     = 0         # length only — never the text

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class EvidenceEvalCase:
    id: str                                   = ""
    domain: str                               = ""        # hypertension|diabetes|...
    mode: str                                 = "beginner"
    language: str                             = "en"
    auth_state: str                           = "guest"   # guest|patient|chw|admin
    user_message: str                         = ""        # synthetic only
    expected_triage: Optional[str]            = None      # EMERGENCY|FACILITY|...
    must_include: List[str]                   = field(default_factory=list)
    must_not_include: List[str]               = field(default_factory=list)
    privacy_expectation: Optional[str]        = None
    severity: str                             = "medium"  # critical|high|medium|low
    reference: str                            = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class EvidenceEvalResult:
    case_id: str                              = ""
    domain: str                               = ""
    severity: str                             = "medium"
    passed: bool                              = False
    must_include_passed: bool                 = True
    must_not_include_passed: bool             = True
    triage_match: Optional[bool]              = None
    privacy_check_passed: bool                = True
    emergency_check_passed: Optional[bool]    = None
    reason: str                               = ""
    response_len: int                         = 0
    latency_ms: Optional[float]               = None
    error: Optional[str]                      = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class EvalProgress:
    """Snapshot of an in-flight or just-finished synthetic eval run.

    Polled by the admin UI at /api/v1/admin/evidence/eval/progress. The
    only PHI-adjacent field is `current_case_id`, which is a synthetic
    case id (e.g. 'HTN-EMERG-001') — never a real session/patient id.
    """
    running: bool                              = False
    eval_id: Optional[str]                     = None
    total: int                                 = 0
    done: int                                  = 0
    started_at: Optional[str]                  = None      # ISO-8601 UTC
    finished_at: Optional[str]                 = None
    duration_s: Optional[float]                = None
    current_case_id: Optional[str]             = None
    cancel_requested: bool                     = False
    cancelled: bool                            = False
    error: Optional[str]                       = None
    # Live counters (updated as cases complete)
    passed: int                                = 0
    failed: int                                = 0
    critical_failures: int                     = 0
    # Final outcome (only populated when running=False after a run)
    final_summary: Optional[Dict[str, Any]]    = None
    final_report_path: Optional[str]           = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @property
    def percent(self) -> int:
        if self.total <= 0:
            return 0
        return min(100, int(round(100.0 * self.done / self.total)))


@dataclass
class EvidenceSummary:
    total: int                                = 0
    passed: int                               = 0
    failed: int                               = 0
    critical_failures: int                    = 0
    overall_pass_rate: float                  = 0.0
    emergency_pass_rate: Optional[float]      = None
    privacy_pass_rate: Optional[float]        = None
    medication_safety_pass_rate: Optional[float] = None
    started_at: Optional[str]                 = None
    finished_at: Optional[str]                = None
    duration_s: Optional[float]               = None
    report_path: Optional[str]                = None
    notes: List[str]                          = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
