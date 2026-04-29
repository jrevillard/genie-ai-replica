"""
AMINA Agent Platform v1 — deterministic tool policy gate.

THE POLICY GATE IS MANDATORY. Every proposed tool call passes through
`evaluate()` before the executor sees it. ALL 13 checks must pass; any
failure denies the call.

CRITICAL: this module is FAIL-CLOSED. If our own code throws, we DENY.
Never let the LLM bypass policy by tickling an exception in the gate.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

from src.agent_platform.config import PLANNER_HARD_LIMITS
from src.agent_platform.models import (
    AgenticRequest,
    AgenticToolCall,
    PolicyDecision,
    ToolRisk,
    ToolSpec,
    V1_ALLOWED_RISKS,
)
from src.agent_platform.tool_registry import ToolRegistry, get_registry

logger = logging.getLogger("agent_platform.policy")


# Fields a tool may declare as "injected" — server fills these from the
# request. If the LLM tried to supply one, we strip + replace.
_SESSION_FIELDS = {
    "patient_id":   "patient_id",
    "phone":        "phone",
    "conditions":   "conditions",
    "medications":  "medications",  # injected from patient profile, not present in request
}


class PolicyGate:
    def __init__(self, registry: Optional[ToolRegistry] = None):
        self._registry = registry or get_registry()
        self._max_calls = int(PLANNER_HARD_LIMITS["max_tool_calls_per_turn"])

    # ────────────────────────────────────────────────────────────
    def evaluate_plan(
        self,
        request: AgenticRequest,
        proposed_calls: List[AgenticToolCall],
    ) -> List[PolicyDecision]:
        """Return a PolicyDecision per proposed call (same length, same order)."""
        decisions: List[PolicyDecision] = []
        approved_count = 0
        for call in (proposed_calls or [])[: self._max_calls + 5]:
            try:
                decision = self._evaluate_one(request, call, approved_count)
            except Exception as e:  # ← fail-closed
                logger.exception("policy gate raised on call=%s; denying", call.tool_name)
                decision = PolicyDecision(
                    allowed=False,
                    reason=f"policy_gate_error:{e.__class__.__name__}",
                    tool_name=call.tool_name,
                )
            if decision.allowed:
                approved_count += 1
            decisions.append(decision)
        # Cap at max_calls — anything beyond is denied even if it would
        # otherwise pass.
        if len(decisions) > self._max_calls:
            for i, d in enumerate(decisions):
                if i >= self._max_calls and d.allowed:
                    decisions[i] = PolicyDecision(
                        allowed=False,
                        reason="exceeds_max_tool_calls_per_turn",
                        tool_name=d.tool_name,
                        risk=d.risk,
                        redacted_arguments=d.redacted_arguments,
                    )
        return decisions

    # ────────────────────────────────────────────────────────────
    def _evaluate_one(
        self,
        request: AgenticRequest,
        call: AgenticToolCall,
        approved_so_far: int,
    ) -> PolicyDecision:
        # 0. The 13 checks (ALL must pass — any failure returns denial)
        # 1. Tool exists in registry
        if not self._registry.has(call.tool_name):
            return self._deny(call, "tool_not_in_registry")

        spec: ToolSpec = self._registry.get(call.tool_name)

        # 2. Risk class is in the v1-allowed set
        if spec.risk not in V1_ALLOWED_RISKS:
            return self._deny(call, f"risk_not_allowed_in_v1:{spec.risk.value}", risk=spec.risk.value)

        # 3. side_effecting must be False
        if spec.side_effecting:
            return self._deny(call, "side_effecting_blocked_in_v1", risk=spec.risk.value)

        # 4. Mode must be allowed
        req_mode = (request.mode or "").lower()
        if spec.allowed_modes and req_mode not in [m.lower() for m in spec.allowed_modes]:
            return self._deny(call, f"mode_not_allowed:{req_mode}", risk=spec.risk.value)

        # 5. Role must be allowed
        req_role = (request.role or "patient").lower()
        if spec.allowed_roles and req_role not in [r.lower() for r in spec.allowed_roles]:
            return self._deny(call, f"role_not_allowed:{req_role}", risk=spec.risk.value)

        # 6. Auth check
        is_authed = bool(
            request.patient_id or request.auth_context or
            (request.session_id and not request.session_id.startswith("guest_"))
        )
        if spec.requires_auth and not is_authed:
            return self._deny(call, "auth_required", risk=spec.risk.value)

        # 7. Emergency rules — if request.is_emergency, allow only emergency_allowed
        if request.is_emergency and not spec.emergency_allowed:
            return self._deny(call, "non_emergency_tool_during_emergency", risk=spec.risk.value)

        # 8/9. Argument validation + injected-field stripping/replacement
        try:
            redacted = self._validate_and_inject(call.arguments, spec, request)
        except _SchemaError as e:
            return self._deny(call, f"schema_error:{e.field}:{e.problem}", risk=spec.risk.value)

        # 10. Patient ownership: caregivers can only act on linked patients.
        # Without an explicit linked-patient store on the request, we
        # accept own-record access for the same patient_id as request.
        # (Caregiver linkage check is the responsibility of upstream auth.)
        # We just enforce that any patient_id on the call equals the
        # session's patient_id (already swapped in by inject).
        if "patient_id" in redacted:
            if redacted["patient_id"] != (request.patient_id or ""):
                return self._deny(call, "patient_id_mismatch", risk=spec.risk.value,
                                  redacted=redacted)

        # 11. Max tool calls per turn
        if approved_so_far >= self._max_calls:
            return self._deny(call, "exceeds_max_tool_calls_per_turn", risk=spec.risk.value,
                              redacted=redacted)

        # 12-13. Already covered by check (2) — admin_only, write, external,
        # forbidden are not in V1_ALLOWED_RISKS so they're already denied.

        return PolicyDecision(
            allowed=True,
            reason="ok",
            risk=spec.risk.value,
            tool_name=call.tool_name,
            redacted_arguments=redacted,
        )

    # ────────────────────────────────────────────────────────────
    def _validate_and_inject(
        self,
        args: Dict[str, Any],
        spec: ToolSpec,
        request: AgenticRequest,
    ) -> Dict[str, Any]:
        """
        Strip server-injected fields the LLM tried to set, replace from
        the request, then validate type/min/max/enum/max_length.

        Raises _SchemaError on failure.
        """
        args = dict(args or {})
        schema = spec.input_schema or {}
        props: Dict[str, dict] = (schema.get("properties") or {})
        required: Set[str] = set(schema.get("required") or [])

        # 1) Strip + inject server-controlled fields
        for field, prop in props.items():
            if not isinstance(prop, dict):
                continue
            if prop.get("injected"):
                # Always overwrite — the LLM's value is untrusted.
                injected_value = self._inject_value(field, request)
                if injected_value is not None:
                    args[field] = injected_value
                else:
                    args.pop(field, None)

        # 2) Validate required
        for r in required:
            if r not in args or args[r] in (None, ""):
                raise _SchemaError(r, "required_missing")

        # 3) Validate per-field
        for field, value in list(args.items()):
            prop = props.get(field)
            if prop is None:
                # Unknown field — drop silently (don't trust LLM)
                args.pop(field, None)
                continue
            self._validate_value(field, value, prop)

        return args

    def _inject_value(self, field: str, request: AgenticRequest) -> Any:
        if field == "patient_id":
            return request.patient_id or ""
        if field == "phone":
            return request.phone or ""
        if field == "conditions":
            return list(request.conditions or [])
        if field == "medications":
            # We don't carry meds on the request directly; pass empty
            # and let the executor's adapter pull from profile if needed.
            return []
        return None

    def _validate_value(self, field: str, value: Any, prop: dict) -> None:
        kind = prop.get("type")
        if kind == "string":
            if not isinstance(value, str):
                raise _SchemaError(field, "expected_string")
            mx = prop.get("max_length")
            if mx is not None and len(value) > int(mx):
                raise _SchemaError(field, "string_too_long")
            enum = prop.get("enum")
            if enum is not None and value not in enum:
                raise _SchemaError(field, "not_in_enum")
        elif kind == "integer":
            if not isinstance(value, int) or isinstance(value, bool):
                raise _SchemaError(field, "expected_integer")
            mn = prop.get("min")
            mx = prop.get("max")
            if mn is not None and value < int(mn):
                raise _SchemaError(field, "below_min")
            if mx is not None and value > int(mx):
                raise _SchemaError(field, "above_max")
        elif kind == "number":
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                raise _SchemaError(field, "expected_number")
            mn = prop.get("min")
            mx = prop.get("max")
            if mn is not None and value < float(mn):
                raise _SchemaError(field, "below_min")
            if mx is not None and value > float(mx):
                raise _SchemaError(field, "above_max")
        elif kind == "boolean":
            if not isinstance(value, bool):
                raise _SchemaError(field, "expected_boolean")
        elif kind == "array":
            if not isinstance(value, list):
                raise _SchemaError(field, "expected_array")
            mx = prop.get("max_length")
            if mx is not None and len(value) > int(mx):
                raise _SchemaError(field, "array_too_long")
        elif kind == "object":
            if not isinstance(value, dict):
                raise _SchemaError(field, "expected_object")

    # ────────────────────────────────────────────────────────────
    def _deny(
        self,
        call: AgenticToolCall,
        reason: str,
        *,
        risk: str = "",
        redacted: Optional[dict] = None,
    ) -> PolicyDecision:
        return PolicyDecision(
            allowed=False,
            reason=reason,
            risk=risk,
            tool_name=call.tool_name,
            redacted_arguments=redacted or {},
        )


class _SchemaError(Exception):
    def __init__(self, field: str, problem: str):
        self.field = field
        self.problem = problem
        super().__init__(f"{field}:{problem}")


# Singleton
_GATE = PolicyGate()


def get_policy_gate() -> PolicyGate:
    return _GATE
