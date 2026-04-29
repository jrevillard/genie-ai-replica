"""
AMINA Agent Platform v1 — typed data models.

Pure dataclasses, no I/O, no logging. Used as the wire format between
planner / policy gate / executor / tracing.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional


# ── Risk classification ──────────────────────────────────────────────
class ToolRisk(Enum):
    """
    All tools are tagged with a risk class. ONLY the first three risk
    classes execute in v1. Everything else is registered for schema
    completeness + shadow comparison but blocked by the policy gate.
    """
    SAFE_READ_ONLY            = "safe_read_only"
    READ_ONLY_CLINICAL        = "read_only_clinical"
    CLINICAL_ADVICE_SUPPORT   = "clinical_advice_support"
    WRITE_PATIENT_RECORD      = "write_patient_record"
    EXTERNAL_SIDE_EFFECT      = "external_side_effect"
    ADMIN_ONLY                = "admin_only"
    FORBIDDEN_PATIENT_FACING  = "forbidden_patient_facing"


# Tools whose risk falls in this set MAY actually execute in v1.
# Everything else is denied by the policy gate.
V1_ALLOWED_RISKS = frozenset({
    ToolRisk.SAFE_READ_ONLY,
    ToolRisk.READ_ONLY_CLINICAL,
    ToolRisk.CLINICAL_ADVICE_SUPPORT,
})


# ── Inbound request (from amina_agent.process_message) ──────────────
@dataclass
class AgenticRequest:
    message:           str
    session_id:        str
    patient_id:        Optional[str] = None
    patient_name:      Optional[str] = None
    phone:             Optional[str] = None
    mode:              Optional[str] = "basic"
    channel:           Optional[str] = "web"
    auth_context:      Optional[dict] = None
    domain_hint:       Optional[str] = None
    existing_context:  Optional[dict] = None
    role:              Optional[str] = "patient"
    is_emergency:      bool = False
    conditions:        List[str] = field(default_factory=list)


# ── Tool catalogue entry ────────────────────────────────────────────
@dataclass
class ToolSpec:
    name:                  str
    description:           str
    input_schema:          dict
    output_schema:         dict
    risk:                  ToolRisk
    allowed_modes:         List[str]
    allowed_roles:         List[str] = field(
        default_factory=lambda: ["patient", "family", "vhw", "chn", "admin"],
    )
    requires_auth:         bool = True
    emergency_allowed:     bool = False
    side_effecting:        bool = False
    adapter_name:          Optional[str] = None
    max_calls_per_turn:    int = 1
    timeout_ms:            int = 5000

    def to_llm_schema(self) -> dict:
        """
        Strip session-injected fields (anything with `injected: True`)
        before exposing the schema to the LLM. The LLM must NEVER
        receive `patient_id` or other server-controlled fields.
        """
        props = (self.input_schema or {}).get("properties", {}) or {}
        public_props = {
            k: v for k, v in props.items()
            if not (isinstance(v, dict) and v.get("injected"))
        }
        public_required = [
            r for r in (self.input_schema or {}).get("required", []) or []
            if r in public_props
        ]
        return {
            "name":        self.name,
            "description": self.description,
            "parameters":  {
                "type":       "object",
                "properties": public_props,
                "required":   public_required,
            },
        }


# ── A single tool call proposed by the planner ──────────────────────
@dataclass
class AgenticToolCall:
    call_id:       str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    tool_name:     str = ""
    arguments:     dict = field(default_factory=dict)
    reason:        str = ""
    risk:          str = ""
    requires_auth: bool = True


# ── Output of the planner ───────────────────────────────────────────
@dataclass
class AgenticPlan:
    plan_id:                 str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    intent:                  str = "unknown"
    confidence:              float = 0.0
    route:                   str = "normal"   # normal | emergency_bypass | guest_block | no_tool
    tool_calls:              List[AgenticToolCall] = field(default_factory=list)
    final_response_strategy: str = "answer_with_tool_context"
    reason:                  str = ""
    planner_latency_ms:      float = 0.0


# ── Result of executing a single tool call ─────────────────────────
@dataclass
class ToolResult:
    call_id:      str = ""
    tool_name:    str = ""
    ok:           bool = False
    data:         dict = field(default_factory=dict)
    error_code:   Optional[str] = None
    safe_summary: str = ""
    latency_ms:   float = 0.0


# ── Output of the policy gate ──────────────────────────────────────
@dataclass
class PolicyDecision:
    allowed:             bool = False
    reason:              str = ""
    risk:                str = ""
    tool_name:           str = ""
    redacted_arguments:  dict = field(default_factory=dict)
    timestamp:           datetime = field(default_factory=datetime.utcnow)


# ── Trace record (PHI-redacted) ────────────────────────────────────
# NOTE on Phase-3 enrichment: every new field below is OPTIONAL with a
# safe default. The runtime populates them when meaningful and leaves
# them at default otherwise. Existing v1/v2 trace assertions (no
# phone / patient_name / patient_id / message / raw fields) are
# preserved because to_safe_dict() never emits any of those.
POLICY_GATE_VERSION = "v1.13"  # bump when policy check set or order changes


@dataclass
class AgentTrace:
    trace_id:        str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    session_hash:    str = ""
    mode:            str = ""        # advanced|basic|beginner
    agentic_mode:    str = ""        # off|shadow|assist|strict
    channel:         str = ""
    domain_hint:     str = ""
    planner_used:    bool = False
    plan_intent:     str = ""
    tool_decisions:  List[dict] = field(default_factory=list)
    tool_results:    List[dict] = field(default_factory=list)
    provider:        str = ""
    fallback_used:   bool = False
    safety_flags:    List[str] = field(default_factory=list)
    latency_ms:      float = 0.0
    error:           Optional[str] = None
    timestamp:       datetime = field(default_factory=datetime.utcnow)

    # ── Phase-3 enrichment (all defaults safe; populated where known) ─
    native_tools_enabled:   bool = False
    native_format_requested: str = ""
    native_format_detected:  str = ""
    native_attempted:       bool = False
    native_fallback_reason: str = ""
    tool_schema_count:      int = 0
    tool_call_count_requested: int = 0
    tool_call_count_allowed:   int = 0
    tool_call_count_denied:    int = 0
    denied_reasons:         List[str] = field(default_factory=list)
    policy_gate_version:    str = POLICY_GATE_VERSION
    planner_path:           str = ""   # heuristic | json_native | json_string | fallback
    # Cost/token placeholders — None means upstream provider didn't surface.
    # NEVER populate with invented numbers; leave None when unknown.
    prompt_tokens:          Optional[int] = None
    completion_tokens:      Optional[int] = None
    cost_usd:               Optional[float] = None

    def to_safe_dict(self) -> dict:
        """Return a JSON-friendly dict with PHI/secrets stripped."""
        return {
            "trace_id":       self.trace_id,
            "session_hash":   self.session_hash,
            "mode":           self.mode,
            "agentic_mode":   self.agentic_mode,
            "channel":        self.channel,
            "domain_hint":    self.domain_hint,
            "planner_used":   self.planner_used,
            "plan_intent":    self.plan_intent,
            "tool_decisions": list(self.tool_decisions),
            "tool_results": [
                {
                    "tool":       (r.get("tool_name") or r.get("tool") or ""),
                    "ok":          bool(r.get("ok", False)),
                    "latency_ms":  float(r.get("latency_ms", 0.0)),
                    "error_code":  r.get("error_code"),
                }
                for r in self.tool_results
            ],
            "provider":       self.provider,
            "fallback_used":  self.fallback_used,
            "safety_flags":   list(self.safety_flags),
            "latency_ms":     self.latency_ms,
            "error":          self.error,
            "timestamp":      self.timestamp.isoformat(),
            # Phase-3 enrichment (safe — no PHI by construction).
            "native_tools_enabled":      self.native_tools_enabled,
            "native_format_requested":   self.native_format_requested,
            "native_format_detected":    self.native_format_detected,
            "native_attempted":          self.native_attempted,
            "native_fallback_reason":    self.native_fallback_reason,
            "tool_schema_count":         self.tool_schema_count,
            "tool_call_count_requested": self.tool_call_count_requested,
            "tool_call_count_allowed":   self.tool_call_count_allowed,
            "tool_call_count_denied":    self.tool_call_count_denied,
            "denied_reasons":            list(self.denied_reasons),
            "policy_gate_version":       self.policy_gate_version,
            "planner_path":              self.planner_path,
            # Token/cost: emit only when upstream supplied them. Never
            # invent numbers. None values are intentional and meaningful.
            "prompt_tokens":             self.prompt_tokens,
            "completion_tokens":         self.completion_tokens,
            "cost_usd":                  self.cost_usd,
        }


# ── Output of the runtime prepass (consumed by amina_agent) ────────
@dataclass
class AgenticPrepassResult:
    enabled:               bool = False
    mode:                  str = "off"
    trace_id:              str = ""
    plan:                  Optional[AgenticPlan] = None
    approved_tool_results: List[ToolResult] = field(default_factory=list)
    denied_tool_calls:     List[PolicyDecision] = field(default_factory=list)
    context_block:         str = ""
    error:                 Optional[str] = None


__all__ = [
    "ToolRisk",
    "V1_ALLOWED_RISKS",
    "AgenticRequest",
    "ToolSpec",
    "AgenticToolCall",
    "AgenticPlan",
    "ToolResult",
    "PolicyDecision",
    "AgentTrace",
    "AgenticPrepassResult",
]
