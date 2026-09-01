# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Story 1-1: the declared-contract tests — the one shape Vue and Flutter
render against (D10 citation, D7 degradation) plus the ToolResult projection
and the review-hardened validation rules."""

import ast
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

import workflows.tools.schemas as schemas_module
from workflows.tools.schemas import (
    Citation,
    CitationSourceType,
    Degradation,
    DegradationReason,
    ToolResult,
)


class TestEnumContracts:
    def test_citation_source_type_values_match_emitted_strings(self):
        # The strings story 2-8 already puts on the wire — a drift here breaks rendering
        assert {e.value for e in CitationSourceType} == {"document", "web_search", "feed"}

    def test_degradation_reason_is_the_recorded_contract(self):
        # plan.md entry 10: LOW_QUALITY + SEARCH_UNAVAILABLE live;
        # CIRCUIT_OPEN + EXECUTION_ERROR reserved for governance wiring
        assert {e.value for e in DegradationReason} == {
            "LOW_QUALITY",
            "SEARCH_UNAVAILABLE",
            "CIRCUIT_OPEN",
            "EXECUTION_ERROR",
        }


class TestCitation:
    def test_d10_json_shape(self):
        citation = Citation(
            url="https://example.com/doc",
            title="Official Portal",
            source_type=CitationSourceType.WEB_SEARCH,
            confidence=0.85,
        )
        payload = citation.to_client_dict()
        assert set(payload) == {"url", "title", "source_type", "retrieved_at", "confidence"}
        assert payload["source_type"] == "web_search"  # enum flattened
        assert payload["confidence"] == 0.85

    def test_retrieved_at_serializes_with_utc_offset(self):
        # JS new Date()/Dart DateTime.parse read an offset-less ISO string as
        # LOCAL time — the offset suffix is part of the contract
        payload = Citation(url="u", title="t", source_type="document", confidence=0.5).to_client_dict()
        parsed = datetime.fromisoformat(payload["retrieved_at"])
        assert parsed.tzinfo is not None
        assert payload["retrieved_at"].endswith(("+00:00", "Z"))

    def test_naive_retrieved_at_coerced_to_utc(self):
        citation = Citation(
            url="u", title="t", source_type="document", confidence=0.5, retrieved_at=datetime(2026, 1, 1, 12)
        )
        assert citation.retrieved_at.tzinfo == timezone.utc
        assert citation.to_client_dict()["retrieved_at"].endswith(("+00:00", "Z"))

    @pytest.mark.parametrize("bad", [-0.01, 1.01, 2.0])
    def test_confidence_range_enforced(self, bad):
        with pytest.raises(ValidationError):
            Citation(url="u", title="t", source_type="document", confidence=bad)

    @pytest.mark.parametrize("ok", [0.0, 1.0])
    def test_confidence_boundaries_are_inclusive(self, ok):
        assert Citation(url="u", title="t", source_type="document", confidence=ok).confidence == ok

    def test_unknown_fields_rejected(self):
        # A contract module must fail loudly on typos — extra="ignore" would
        # silently drop a field two clients render
        with pytest.raises(ValidationError, match="confdence"):
            Citation(url="u", title="t", source_type="document", confidence=0.5, confdence=0.9)

    def test_models_are_frozen(self):
        citation = Citation(url="u", title="t", source_type="document", confidence=0.5)
        with pytest.raises(ValidationError):
            citation.confidence = 5.0  # type: ignore[misc]

    def test_empty_url_rejected(self):
        with pytest.raises(ValidationError):
            Citation(url="", title="t", source_type="document", confidence=0.5)


class TestDegradation:
    def test_d7_json_shape(self):
        degradation = Degradation(
            tool_id="web_search",
            reason="LOW_QUALITY",
            fallback_applied="none",
            message="Web results were found but did not meet quality standards.",
        )
        payload = degradation.to_client_dict()
        assert set(payload) == {"tool_id", "reason", "fallback_applied", "message"}
        assert payload["reason"] == "LOW_QUALITY"  # enum flattened

    def test_optional_guidance_omitted_when_unset(self):
        degradation = Degradation(
            tool_id="web_search", reason="SEARCH_UNAVAILABLE", fallback_applied="none", message="m"
        )
        assert "guidance" not in degradation.to_client_dict()

    def test_optional_guidance_included_when_set(self):
        degradation = Degradation(
            tool_id="web_search",
            reason="SEARCH_UNAVAILABLE",
            fallback_applied="none",
            message="m",
            guidance="Contact the office directly.",
        )
        assert degradation.to_client_dict()["guidance"] == "Contact the office directly."

    def test_reason_must_be_a_known_value(self):
        with pytest.raises(ValidationError):
            Degradation(tool_id="t", reason="BACKEND_ERROR", fallback_applied="none", message="m")

    def test_fallback_applied_is_the_declared_two_value_contract(self):
        # "rag-only" (hyphen typo) must fail — free-form strings drift onto the wire
        with pytest.raises(ValidationError):
            Degradation(tool_id="t", reason="LOW_QUALITY", fallback_applied="rag-only", message="m")
        Degradation(tool_id="t", reason="LOW_QUALITY", fallback_applied="rag_only", message="m")
        Degradation(tool_id="t", reason="LOW_QUALITY", fallback_applied="none", message="m")


class TestToolResultProjection:
    def test_to_citation_maps_fields(self):
        result = ToolResult(content="snippet", url="https://x.test/a", score=0.7, title="A")
        citation = result.to_citation()
        assert citation.url == "https://x.test/a"
        assert citation.title == "A"
        assert citation.source_type is CitationSourceType.WEB_SEARCH
        assert citation.confidence == 0.7
        assert citation.retrieved_at == result.retrieved_at  # propagated, not regenerated

    def test_empty_title_falls_back_to_url(self):
        result = ToolResult(content="snippet", url="https://x.test/a", title="", score=0.5)
        assert result.to_citation().title == "https://x.test/a"

    def test_whitespace_title_falls_back_to_url(self):
        result = ToolResult(content="snippet", url="https://x.test/a", title="   ", score=0.5)
        assert result.to_citation().title == "https://x.test/a"

    @pytest.mark.parametrize("score,expected", [(1.7, 1.0), (-0.3, 0.0)])
    def test_score_clamped_to_unit_range(self, score, expected):
        result = ToolResult(content="c", url="u", score=score)
        assert result.to_citation().confidence == expected

    @pytest.mark.parametrize("bad", [float("nan"), float("inf")])
    def test_nan_and_inf_scores_rejected_at_construction(self, bad):
        # The clamp alone maps NaN to confidence 1.0 — worst score, highest trust
        with pytest.raises(ValidationError):
            ToolResult(content="c", url="u", score=bad)


class TestModuleSelfContainment:
    def test_no_core_imports(self):
        """Image safety: the chatqna Dockerfile ships only selected core/ files —
        a core import here breaks the deployed service. AST-based so prose in
        docstrings/comments cannot false-positive or mask a real import."""
        tree = ast.parse(Path(schemas_module.__file__).read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("core"):
                pytest.fail(f"core import found: from {node.module} import ...")
            if isinstance(node, ast.Import):
                for alias in node.names:
                    assert not alias.name.startswith("core"), f"core import found: import {alias.name}"

    def test_module_imports_standalone(self):
        # cwd pinned to the overlay root — this measures standalone-ness, not
        # wherever pytest happened to be invoked from
        code = "from workflows.tools.schemas import Citation, Degradation, ToolResult; print('ok')"
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            cwd=Path(__file__).resolve().parents[1],
        )
        assert result.returncode == 0, result.stderr
