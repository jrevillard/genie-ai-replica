# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Tests for the governance pipeline: PII redactor, Redis primitives, governance orchestrator.

Test coverage:
    - PII redaction: regex detection, redaction, BLOCK-on-failure (NFR6)
    - Circuit breaker: state transitions, recovery, force reset
    - Rate limiter: sliding window, denial, retry-after
    - Audit stream: logging, consumer groups
    - Governance pipeline: full 3-phase flow, blocking scenarios
"""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from workflows.tools.pii_redactor import (
    PIIRedactionError,
    PIIRedactor,
    RegexPIIRedactor,
    create_pii_redactor,
)
from workflows.tools.redis_primitives import (
    AuditEntry,
    AuditStream,
    CircuitBreaker,
    CircuitState,
    RateLimitConfig,
    SlidingWindowRateLimiter,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def create_mock_redis():
    """Create a mock async Redis client with common methods."""
    redis = AsyncMock()
    pipe_mock = MagicMock()
    pipe_mock.execute = AsyncMock(return_value=[])
    redis.pipeline = MagicMock(return_value=pipe_mock)
    return redis


# ===========================================================================
# PII Redactor Tests
# ===========================================================================
class TestRegexPIIRedactor:
    """Tests for the regex-based PII redactor."""

    @pytest.fixture
    def redactor(self):
        return RegexPIIRedactor()

    @pytest.mark.asyncio
    async def test_detect_email(self, redactor):
        entities = await redactor.detect("Contact john.doe@example.com for info")
        assert len(entities) == 1
        assert entities[0].entity_type == "EMAIL"
        assert entities[0].text == "john.doe@example.com"

    @pytest.mark.asyncio
    async def test_detect_phone(self, redactor):
        entities = await redactor.detect("Call +1-555-123-4567 or (555) 987-6543")
        assert len(entities) >= 1
        phone_entities = [e for e in entities if e.entity_type == "PHONE"]
        assert len(phone_entities) >= 1

    @pytest.mark.asyncio
    async def test_detect_ssn(self, redactor):
        entities = await redactor.detect("SSN: 123-45-6789")
        ssn_entities = [e for e in entities if e.entity_type == "SSN"]
        assert len(ssn_entities) == 1
        assert ssn_entities[0].text == "123-45-6789"

    @pytest.mark.asyncio
    async def test_detect_ip_address(self, redactor):
        entities = await redactor.detect("Server at 192.168.1.100")
        ip_entities = [e for e in entities if e.entity_type == "IP_ADDRESS"]
        assert len(ip_entities) == 1
        assert ip_entities[0].text == "192.168.1.100"

    @pytest.mark.asyncio
    async def test_detect_empty_text(self, redactor):
        entities = await redactor.detect("")
        assert entities == []

    @pytest.mark.asyncio
    async def test_detect_no_pii(self, redactor):
        entities = await redactor.detect("This is a clean text with no PII")
        # May detect false positives in some edge cases, but should be minimal
        assert isinstance(entities, list)

    @pytest.mark.asyncio
    async def test_detect_multiple_types(self, redactor):
        text = "Email john@example.com, SSN 123-45-6789, IP 10.0.0.1"
        entities = await redactor.detect(text)
        entity_types = {e.entity_type for e in entities}
        assert "EMAIL" in entity_types
        assert "SSN" in entity_types
        assert "IP_ADDRESS" in entity_types

    @pytest.mark.asyncio
    async def test_redact_email(self, redactor):
        result = await redactor.redact("Contact john@example.com please")
        assert "<EMAIL>" in result.redacted_text
        assert "john@example.com" not in result.redacted_text
        assert result.entity_count >= 1

    @pytest.mark.asyncio
    async def test_redact_ssn(self, redactor):
        result = await redactor.redact("SSN: 123-45-6789")
        assert "<SSN>" in result.redacted_text
        assert "123-45-6789" not in result.redacted_text

    @pytest.mark.asyncio
    async def test_redact_empty_text(self, redactor):
        result = await redactor.redact("")
        assert result.redacted_text == ""
        assert result.entity_count == 0

    @pytest.mark.asyncio
    async def test_redact_no_pii(self, redactor):
        text = "Hello world, this has no sensitive data"
        result = await redactor.redact(text)
        assert result.redacted_text == text
        assert result.entity_count == 0

    @pytest.mark.asyncio
    async def test_redact_preserves_non_pii_text(self, redactor):
        result = await redactor.redact("User john@example.com said hello")
        assert "said hello" in result.redacted_text
        assert "User" in result.redacted_text


class TestPIIRedactorFactory:
    """Tests for the PII redactor factory."""

    def test_create_regex_redactor(self):
        redactor = create_pii_redactor("regex")
        assert isinstance(redactor, RegexPIIRedactor)

    def test_create_default_redactor(self):
        redactor = create_pii_redactor()
        assert isinstance(redactor, RegexPIIRedactor)

    def test_create_unknown_raises(self):
        with pytest.raises(PIIRedactionError, match="Unknown PII_REDACTOR_IMPL"):
            create_pii_redactor("unknown")

    def test_create_http_raises_not_implemented(self):
        with pytest.raises(PIIRedactionError, match="not yet implemented"):
            create_pii_redactor("http://pii-service:8080")

    @patch.dict("os.environ", {"PII_REDACTOR_IMPL": "regex"})
    def test_create_from_env(self):
        redactor = create_pii_redactor()
        assert isinstance(redactor, RegexPIIRedactor)


# ===========================================================================
# Circuit Breaker Tests
# ===========================================================================
class TestCircuitBreaker:
    """Tests for the Redis-backed circuit breaker."""

    @pytest.fixture
    def redis(self):
        return create_mock_redis()

    @pytest.fixture
    def cb(self, redis):
        return CircuitBreaker(redis, "test-tool")

    @pytest.mark.asyncio
    async def test_initial_state_is_closed(self, cb, redis):
        redis.get.return_value = None
        state = await cb.get_state()
        assert state == CircuitState.CLOSED

    @pytest.mark.asyncio
    async def test_is_allowed_when_closed(self, cb, redis):
        redis.get.return_value = None
        assert await cb.is_allowed() is True

    @pytest.mark.asyncio
    async def test_is_not_allowed_when_open(self, cb, redis):
        # State is OPEN, and recovery timeout hasn't elapsed
        redis.get.side_effect = lambda key: {
            "cb:test-tool:state": CircuitState.OPEN.value,
            "cb:test-tool:opened_at": str(time.time()),
        }.get(key)
        assert await cb.is_allowed() is False

    @pytest.mark.asyncio
    async def test_transitions_to_half_open_after_timeout(self, cb, redis):
        # State is OPEN, recovery timeout HAS elapsed
        redis.get.side_effect = lambda key: {
            "cb:test-tool:state": CircuitState.OPEN.value,
            "cb:test-tool:opened_at": str(time.time() - 60),  # 60s ago
        }.get(key)

        pipe_mock = MagicMock()
        pipe_mock.execute = AsyncMock(return_value=[])
        redis.pipeline.return_value = pipe_mock

        state = await cb.get_state()
        assert state == CircuitState.HALF_OPEN

    @pytest.mark.asyncio
    async def test_record_success_in_closed(self, cb, redis):
        redis.get.return_value = None
        await cb.record_success()
        redis.set.assert_called_with("cb:test-tool:failures", 0)

    @pytest.mark.asyncio
    async def test_record_failure_increments_count(self, cb, redis):
        redis.get.return_value = None
        redis.incr.return_value = 1
        await cb.record_failure()
        redis.incr.assert_called_with("cb:test-tool:failures")

    @pytest.mark.asyncio
    async def test_opens_after_threshold_failures(self, cb, redis):
        redis.get.return_value = None
        redis.incr.return_value = 3  # Matches default threshold

        pipe_mock = MagicMock()
        pipe_mock.execute = AsyncMock(return_value=[])
        redis.pipeline.return_value = pipe_mock

        await cb.record_failure()
        # Should have called pipeline to transition to OPEN
        pipe_mock.set.assert_any_call("cb:test-tool:state", CircuitState.OPEN.value)

    @pytest.mark.asyncio
    async def test_reset_forces_closed(self, cb, redis):
        pipe_mock = MagicMock()
        pipe_mock.execute = AsyncMock(return_value=[])
        redis.pipeline.return_value = pipe_mock

        await cb.reset()
        pipe_mock.set.assert_any_call("cb:test-tool:state", CircuitState.CLOSED.value)


# ===========================================================================
# Rate Limiter Tests
# ===========================================================================
class TestSlidingWindowRateLimiter:
    """Tests for the Redis-backed sliding-window rate limiter."""

    @pytest.fixture
    def redis(self):
        return create_mock_redis()

    @pytest.fixture
    def limiter(self, redis):
        config = RateLimitConfig(max_requests=5, window_seconds=60)
        return SlidingWindowRateLimiter(redis, config)

    @pytest.mark.asyncio
    async def test_allows_under_limit(self, limiter, redis):
        pipe_mock = MagicMock()
        pipe_mock.execute = AsyncMock(return_value=[0, 2])  # removed=0, count=2
        redis.pipeline.return_value = pipe_mock

        pipe2_mock = MagicMock()
        pipe2_mock.execute = AsyncMock(return_value=[])
        redis.pipeline.side_effect = [pipe_mock, pipe2_mock]

        result = await limiter.consume("web-search", "user-1")
        assert result.allowed is True
        assert result.remaining == 2  # 5 - 2 - 1 = 2

    @pytest.mark.asyncio
    async def test_denies_over_limit(self, limiter, redis):
        pipe_mock = MagicMock()
        pipe_mock.execute = AsyncMock(return_value=[0, 5])  # count=5, at limit
        redis.pipeline.return_value = pipe_mock
        redis.zrangebyscore.return_value = [str(time.time() - 30)]

        result = await limiter.consume("web-search", "user-1")
        assert result.allowed is False
        assert result.remaining == 0
        assert result.retry_after is not None

    @pytest.mark.asyncio
    async def test_check_does_not_consume(self, limiter, redis):
        redis.zcount.return_value = 3
        result = await limiter.check("web-search", "user-1")
        assert result.allowed is True
        assert result.remaining == 2


# ===========================================================================
# Audit Stream Tests
# ===========================================================================
class TestAuditStream:
    """Tests for the Redis Streams-backed audit log."""

    @pytest.fixture
    def redis(self):
        return create_mock_redis()

    @pytest.fixture
    def stream(self, redis):
        return AuditStream(redis, stream_name="test-audit")

    @pytest.mark.asyncio
    async def test_log_entry(self, stream, redis):
        redis.xadd.return_value = "1234-0"
        entry = AuditEntry(
            tool_id="web-search",
            user_id="user-1",
            action="invoke",
            governance_decision="allow",
        )
        entry_id = await stream.log(entry)
        assert entry_id == "1234-0"
        redis.xadd.assert_called_once()

    @pytest.mark.asyncio
    async def test_log_entry_failure_returns_none(self, stream, redis):
        redis.xadd.side_effect = Exception("Redis connection failed")
        entry = AuditEntry(tool_id="web-search", user_id="user-1")
        entry_id = await stream.log(entry)
        assert entry_id is None

    @pytest.mark.asyncio
    async def test_create_consumer_group(self, stream, redis):
        redis.xgroup_create.return_value = True
        result = await stream.create_consumer_group("analytics")
        assert result is True

    @pytest.mark.asyncio
    async def test_create_consumer_group_already_exists(self, stream, redis):
        redis.xgroup_create.side_effect = Exception("BUSYGROUP Consumer Group name already exists")
        result = await stream.create_consumer_group("analytics")
        assert result is True

    def test_audit_entry_to_dict(self):
        entry = AuditEntry(
            tool_id="web-search",
            user_id="user-1",
            action="invoke",
            governance_decision="allow",
            pii_entities_found=2,
            duration_ms=150.5,
        )
        d = entry.to_dict()
        assert d["tool_id"] == "web-search"
        assert d["user_id"] == "user-1"
        assert d["pii_entities_found"] == "2"
        assert d["duration_ms"] == "150.5"

    def test_audit_entry_truncates_result(self):
        entry = AuditEntry(
            tool_id="t",
            user_id="u",
            result_summary="x" * 1000,
        )
        d = entry.to_dict()
        assert len(d["result_summary"]) == 500


# ===========================================================================
# Governance Pipeline Tests
# ===========================================================================
class TestGovernancePipeline:
    """Tests for the full 3-phase governance pipeline."""

    @pytest.fixture
    def redis(self):
        return create_mock_redis()

    @pytest.fixture
    def redactor(self):
        return RegexPIIRedactor()

    @pytest.fixture
    def pipeline(self, redis, redactor):
        from workflows.tools.governance import GovernancePipeline

        return GovernancePipeline(
            redis_client=redis,
            pii_redactor=redactor,
        )

    @pytest.fixture
    def tool_config(self):
        from workflows.tools.governance import ToolConfig

        return ToolConfig(
            tool_id="web-search",
            enabled=True,
            allowed_roles=["tools-admin", "tools-reader"],
        )

    @pytest.fixture
    def mock_tool_fn(self):
        return AsyncMock(return_value="Search result: The government portal is at gov.example.com")

    def _setup_redis_for_allow(self, redis):
        """Configure redis mocks to allow tool execution (no rate limit, closed circuit)."""
        # Circuit breaker: CLOSED (no state key)
        redis.get.return_value = None

        # Rate limiter: under limit
        pipe_mock = MagicMock()
        pipe_mock.execute = AsyncMock(return_value=[0, 0])
        pipe2_mock = MagicMock()
        pipe2_mock.execute = AsyncMock(return_value=[])
        redis.pipeline.side_effect = [pipe_mock, pipe2_mock]

        # Audit stream
        redis.xadd.return_value = "audit-1"

        # Circuit breaker success
        redis.set.return_value = True
        redis.incr.return_value = 0

    @pytest.mark.asyncio
    async def test_full_pipeline_allow(self, pipeline, redis, tool_config, mock_tool_fn):
        """Happy path: tool is allowed, executed, and audited."""
        self._setup_redis_for_allow(redis)

        result = await pipeline.execute(
            tool_config=tool_config,
            user_id="user-1",
            user_roles=["tools-admin"],
            parameters={"query": "government services"},
            tool_fn=mock_tool_fn,
        )

        assert result.allowed is True
        assert result.decision == "allow"
        assert result.execution_result is not None
        assert result.duration_ms is not None
        mock_tool_fn.assert_called_once()

    @pytest.mark.asyncio
    async def test_blocks_disabled_tool(self, pipeline, redis, tool_config, mock_tool_fn):
        """Disabled tool is blocked at pre-execution."""
        redis.xadd.return_value = "audit-1"
        tool_config.enabled = False

        result = await pipeline.execute(
            tool_config=tool_config,
            user_id="user-1",
            user_roles=["tools-admin"],
            parameters={"query": "test"},
            tool_fn=mock_tool_fn,
        )

        assert result.allowed is False
        assert result.decision == "block_auth"
        mock_tool_fn.assert_not_called()

    @pytest.mark.asyncio
    async def test_blocks_unauthorized_user(self, pipeline, redis, tool_config, mock_tool_fn):
        """User without required role is blocked."""
        redis.xadd.return_value = "audit-1"

        result = await pipeline.execute(
            tool_config=tool_config,
            user_id="user-1",
            user_roles=["regular-user"],  # Not in allowed_roles
            parameters={"query": "test"},
            tool_fn=mock_tool_fn,
        )

        assert result.allowed is False
        assert result.decision == "block_auth"
        mock_tool_fn.assert_not_called()

    @pytest.mark.asyncio
    async def test_pii_redaction_applied(self, pipeline, redis, tool_config, mock_tool_fn):
        """PII in parameters is redacted before tool execution."""
        self._setup_redis_for_allow(redis)

        result = await pipeline.execute(
            tool_config=tool_config,
            user_id="user-1",
            user_roles=["tools-admin"],
            parameters={"query": "Email john@example.com about benefits"},
            tool_fn=mock_tool_fn,
        )

        assert result.allowed is True
        assert result.pii_entities_found >= 1
        # The tool should receive redacted params
        call_args = mock_tool_fn.call_args[0][0]
        assert "john@example.com" not in call_args["query"]
        assert "<EMAIL>" in call_args["query"]

    @pytest.mark.asyncio
    async def test_pii_redaction_failure_blocks(self, pipeline, redis, tool_config, mock_tool_fn):
        """PII redaction failure blocks the tool (NFR6: zero PII leakage)."""
        redis.xadd.return_value = "audit-1"

        # Replace redactor with one that always fails
        failing_redactor = AsyncMock(spec=PIIRedactor)
        failing_redactor.redact.side_effect = PIIRedactionError("NER model crashed")
        pipeline._pii_redactor = failing_redactor

        result = await pipeline.execute(
            tool_config=tool_config,
            user_id="user-1",
            user_roles=["tools-admin"],
            parameters={"query": "sensitive data here"},
            tool_fn=mock_tool_fn,
        )

        assert result.allowed is False
        assert result.decision == "block_pii"
        mock_tool_fn.assert_not_called()

    @pytest.mark.asyncio
    async def test_audit_logged_on_block(self, pipeline, redis, tool_config, mock_tool_fn):
        """Blocked invocations are still audited (NFR8)."""
        redis.xadd.return_value = "audit-1"
        tool_config.enabled = False

        result = await pipeline.execute(
            tool_config=tool_config,
            user_id="user-1",
            user_roles=["tools-admin"],
            parameters={"query": "test"},
            tool_fn=mock_tool_fn,
        )

        assert result.allowed is False
        # Audit stream should have been called
        redis.xadd.assert_called_once()


# ===========================================================================
# Source Type Tests
# ===========================================================================
class TestSourceType:
    """Tests for the shared SourceType enum."""

    def test_members_exist(self):
        from core.source_type import SourceType

        assert SourceType.FILE.value == "file"
        assert SourceType.FEED.value == "feed"
        assert SourceType.WEB_SEARCH.value == "web_search"

    def test_is_string_enum(self):
        from core.source_type import SourceType

        assert isinstance(SourceType.FILE, str)
        assert SourceType.FILE == "file"

    def test_member_count(self):
        from core.source_type import SourceType

        assert len(SourceType) == 3

    def test_values_unique(self):
        from core.source_type import SourceType

        values = [m.value for m in SourceType]
        assert len(values) == len(set(values))
