"""
Unit tests for the ProgressReporter class.

Tests fire-and-forget error resilience, throttling behavior,
payload construction, and correct HTTP method/timeout usage.

**Validates: Requirements 6.1, 6.4, 6.5**
"""

import asyncio
import sys
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Mock the comps module before importing progress_reporter
mock_comps = MagicMock()
mock_logger_instance = MagicMock()
mock_comps.CustomLogger.return_value = mock_logger_instance
sys.modules["comps"] = mock_comps

# Add the dataprep source directory to the path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "genie-ai-overlay" / "dataprep"))

from progress_reporter import ProgressReporter, PROGRESS_MIN_INTERVAL, PROGRESS_REQUEST_TIMEOUT


# --- Fixtures ---

@pytest.fixture
def mock_token_getter():
    """Returns an async callable that provides a fake auth token."""
    return AsyncMock(return_value="fake-jwt-token")


@pytest.fixture
def mock_token_getter_none():
    """Returns an async callable that returns None (no token available)."""
    return AsyncMock(return_value=None)


@pytest.fixture
def reporter(mock_token_getter):
    """Creates a ProgressReporter instance with default settings."""
    return ProgressReporter(
        file_id="test-file-123",
        doc_repo_url="http://document-repository:3001",
        auth_token_getter=mock_token_getter,
    )


# --- Test: Initialization ---

class TestProgressReporterInit:
    def test_constructs_correct_url(self, mock_token_getter):
        """Report URL is built from doc_repo_url and file_id."""
        reporter = ProgressReporter(
            file_id="abc-def",
            doc_repo_url="http://my-service:3001",
            auth_token_getter=mock_token_getter,
        )
        assert reporter.base_url == "http://my-service:3001/api/files/abc-def/ingestion-progress"

    def test_initial_last_report_time_is_zero(self, reporter):
        """Initial _last_report_time should be 0 so first report is never throttled."""
        assert reporter._last_report_time == 0

    def test_min_interval_is_30_seconds(self, reporter):
        """Min interval between sub-step updates is 30 seconds."""
        assert reporter._min_interval == 30


# --- Test: report_stage_transition ---

class TestReportStageTransition:
    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_sends_correct_payload(self, mock_session_cls, reporter):
        """Stage transition sends current_stage, stages_completed, and stage_progress_percent=0."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        await reporter.report_stage_transition("Chunking", 1)

        mock_session.patch.assert_called_once()
        call_kwargs = mock_session.patch.call_args
        payload = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
        assert payload == {
            "current_stage": "Chunking",
            "stages_completed": 1,
            "stage_progress_percent": 0,
        }

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_resets_throttle_timer(self, mock_session_cls, reporter):
        """Stage transition resets the throttle timer so next sub-step can report."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        reporter._last_report_time = time.time()  # Simulate recent report
        await reporter.report_stage_transition("Graph", 4)
        assert reporter._last_report_time == 0


# --- Test: report_progress (throttling) ---

class TestReportProgress:
    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_first_call_sends_immediately(self, mock_session_cls, reporter):
        """First report_progress call goes through since _last_report_time is 0."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        await reporter.report_progress(50, "Processing page 5/10")

        mock_session.patch.assert_called_once()
        call_kwargs = mock_session.patch.call_args
        payload = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
        assert payload == {"stage_progress_percent": 50, "message": "Processing page 5/10"}

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_throttled_within_interval(self, mock_session_cls, reporter):
        """Calls within 30 seconds of last report are silently skipped."""
        reporter._last_report_time = time.time()  # Just reported

        await reporter.report_progress(75, "Processing page 15/20")

        # Should not even create a session since it's throttled
        mock_session_cls.assert_not_called()

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_sends_after_interval_elapsed(self, mock_session_cls, reporter):
        """Calls after 30+ seconds from last report go through."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        # Simulate 31 seconds ago
        reporter._last_report_time = time.time() - 31

        await reporter.report_progress(80)

        mock_session.patch.assert_called_once()

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_message_is_optional(self, mock_session_cls, reporter):
        """report_progress without message sends only stage_progress_percent."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        await reporter.report_progress(42)

        call_kwargs = mock_session.patch.call_args
        payload = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
        assert payload == {"stage_progress_percent": 42}
        assert "message" not in payload

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_multiple_rapid_calls_send_only_one_request(self, mock_session_cls, reporter):
        """Multiple rapid calls within 30s only send one HTTP request (the first one)."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        # First call goes through, subsequent rapid calls are throttled
        await reporter.report_progress(10)
        await reporter.report_progress(20)
        await reporter.report_progress(30)
        await reporter.report_progress(50)
        await reporter.report_progress(75)

        # Only one HTTP request should have been made (the first call)
        assert mock_session_cls.call_count == 1
        mock_session.patch.assert_called_once()

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_progress_percent_passthrough(self, mock_session_cls, reporter):
        """
        report_progress faithfully sends the integer percentage it receives.

        **Validates: Requirements 6.4, 6.5**

        The caller (genieai_dataprep_microservice.py) computes
        int((pages_processed / total_pages) * 100) and passes it here.
        The reporter must send that exact value in stage_progress_percent.
        """
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        # Simulate int((5 / 20) * 100) = 25
        percent = int((5 / 20) * 100)
        await reporter.report_progress(percent, "Processed 5/20 pages")

        call_kwargs = mock_session.patch.call_args
        payload = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
        assert payload["stage_progress_percent"] == 25
        assert payload["message"] == "Processed 5/20 pages"

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_progress_percent_boundary_values(self, mock_session_cls, mock_token_getter):
        """report_progress sends boundary percentages (0 and 100) correctly."""
        reporter = ProgressReporter(
            file_id="test-file-123",
            doc_repo_url="http://document-repository:3001",
            auth_token_getter=mock_token_getter,
        )

        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        # Test 0% (start of extraction)
        await reporter.report_progress(0, "Starting extraction")
        call_kwargs = mock_session.patch.call_args
        payload = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
        assert payload["stage_progress_percent"] == 0

        # Reset throttle for next call
        reporter._last_report_time = 0

        # Test 100% (int((20/20)*100) = 100)
        await reporter.report_progress(100, "Processed 20/20 pages")
        call_kwargs = mock_session.patch.call_args
        payload = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
        assert payload["stage_progress_percent"] == 100


# --- Test: report_completion ---

class TestReportCompletion:
    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_sends_completed_status(self, mock_session_cls, reporter):
        """report_completion sends {status: 'completed'}."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        await reporter.report_completion()

        call_kwargs = mock_session.patch.call_args
        payload = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
        assert payload == {"status": "completed"}


# --- Test: report_error ---

class TestReportError:
    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_sends_error_status(self, mock_session_cls, reporter):
        """report_error sends {status: 'error'}."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        await reporter.report_error()

        call_kwargs = mock_session.patch.call_args
        payload = call_kwargs.kwargs.get("json") or call_kwargs[1].get("json")
        assert payload == {"status": "error"}


# --- Test: Fire-and-forget error resilience ---

class TestFireAndForget:
    """
    **Validates: Requirements 6.5**

    All methods must never raise exceptions. Failures are logged as warnings.
    """

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_no_exception_on_network_error(self, mock_session_cls, reporter):
        """Network errors are caught and logged, never raised."""
        import aiohttp
        mock_session = AsyncMock()
        mock_session.patch = MagicMock(side_effect=aiohttp.ClientError("Connection refused"))
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        # Should not raise
        await reporter.report_stage_transition("Extraction", 0)

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_no_exception_on_timeout(self, mock_session_cls, reporter):
        """Timeout errors are caught and logged, never raised."""
        mock_session = AsyncMock()
        mock_session.patch = MagicMock(side_effect=TimeoutError("Request timed out"))
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        # Should not raise
        await reporter.report_completion()

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_no_exception_on_non_2xx(self, mock_session_cls, reporter):
        """Non-2xx responses are logged as warnings, never raised."""
        mock_response = AsyncMock()
        mock_response.status = 500
        mock_response.text = AsyncMock(return_value="Internal Server Error")
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        # Should not raise
        await reporter.report_error()

    @pytest.mark.asyncio
    async def test_no_exception_when_no_token(self, mock_token_getter_none):
        """Missing auth token is handled gracefully."""
        reporter = ProgressReporter(
            file_id="test-file",
            doc_repo_url="http://document-repository:3001",
            auth_token_getter=mock_token_getter_none,
        )
        # Should not raise
        await reporter.report_stage_transition("Extraction", 0)
        await reporter.report_progress(50)
        await reporter.report_completion()
        await reporter.report_error()

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_no_exception_on_unexpected_error(self, mock_session_cls, reporter):
        """Unexpected exceptions are caught and logged, never raised."""
        mock_session = AsyncMock()
        mock_session.patch = MagicMock(side_effect=RuntimeError("Something went very wrong"))
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        # Should not raise
        await reporter.report_stage_transition("Labeling", 3)


# --- Test: HTTP configuration ---

class TestHTTPConfiguration:
    """
    **Validates: Requirements 6.4**

    Uses HTTP PATCH with 5-second timeout.
    """

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_uses_patch_method(self, mock_session_cls, reporter):
        """All progress updates use HTTP PATCH."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        await reporter.report_stage_transition("Extraction", 0)

        # Verify .patch was called (not .post or .put)
        mock_session.patch.assert_called_once()

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_uses_correct_url(self, mock_session_cls, reporter):
        """Requests are sent to /api/files/{fileId}/ingestion-progress."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        await reporter.report_completion()

        call_args = mock_session.patch.call_args
        url = call_args[0][0] if call_args[0] else call_args.kwargs.get("url")
        assert url == "http://document-repository:3001/api/files/test-file-123/ingestion-progress"

    @pytest.mark.asyncio
    @patch("progress_reporter.aiohttp.ClientSession")
    async def test_sends_auth_header(self, mock_session_cls, reporter):
        """Requests include Bearer token in Authorization header."""
        mock_response = AsyncMock()
        mock_response.status = 200
        mock_response.__aenter__ = AsyncMock(return_value=mock_response)
        mock_response.__aexit__ = AsyncMock(return_value=False)

        mock_patch = AsyncMock(return_value=mock_response)
        mock_patch.__aenter__ = AsyncMock(return_value=mock_response)
        mock_patch.__aexit__ = AsyncMock(return_value=False)

        mock_session = AsyncMock()
        mock_session.patch = MagicMock(return_value=mock_patch)
        mock_session.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session.__aexit__ = AsyncMock(return_value=False)

        mock_session_cls.return_value = mock_session

        await reporter.report_stage_transition("Extraction", 0)

        call_kwargs = mock_session.patch.call_args
        headers = call_kwargs.kwargs.get("headers") or call_kwargs[1].get("headers")
        assert headers["Authorization"] == "Bearer fake-jwt-token"
        assert headers["Content-Type"] == "application/json"

    def test_timeout_constant_is_5_seconds(self):
        """PROGRESS_REQUEST_TIMEOUT is 5 seconds as per spec."""
        assert PROGRESS_REQUEST_TIMEOUT == 5

    def test_min_interval_constant_is_30_seconds(self):
        """PROGRESS_MIN_INTERVAL is 30 seconds as per spec."""
        assert PROGRESS_MIN_INTERVAL == 30
