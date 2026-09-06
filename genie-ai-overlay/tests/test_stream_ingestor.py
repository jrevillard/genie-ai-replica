# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Story 3-4: json_api polling with content_mapping + parse_error DLQ gate.
Also guards the RSS path staying unchanged through the feed_type dispatch."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import stream_ingestor.genieai_stream_ingestor as si_module
from stream_ingestor.genieai_stream_ingestor import StreamIngestor


def make_ingestor():
    ingestor = StreamIngestor.__new__(StreamIngestor)
    ingestor.db = MagicMock()
    ingestor.feeds_col = MagicMock()
    ingestor.feeds_col.update = MagicMock()
    ingestor.feeds_col.get = MagicMock(return_value=None)
    ingestor.redis = MagicMock()
    ingestor.redis.xadd = AsyncMock(return_value="1-1")
    ingestor.redis.xrange = AsyncMock(return_value=[])
    ingestor.redis.xdel = AsyncMock(return_value=1)
    return ingestor


def make_feed(**overrides):
    feed = {
        "_key": "feed-1",
        "url": "https://api.example.gov/items",
        "type": "json_api",
        "content_mapping": {
            "items_path": "data.items",
            "title_field": "doc.title",
            "body_field": "doc.body",
            "link_field": "doc.url",
            "date_field": "published",
            "id_field": "id",
        },
        "enabled": True,
    }
    feed.update(overrides)
    return feed


def _mock_http(payload, status=200):
    response = MagicMock()
    response.status_code = status
    if status >= 400:
        response.raise_for_status.side_effect = RuntimeError(f"HTTP {status}")
    else:
        response.raise_for_status = MagicMock(return_value=None)
    response.json = MagicMock(return_value=payload)
    return response


def _httpx_client(response):
    """Patch target for the transport: replace the whole AsyncClient class —
    patching the .get method leaves __aenter__ real and the response mock
    ends up double-awaited (AttributeError: coroutine)."""
    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return patch("httpx.AsyncClient", return_value=mock_client)


class TestDispatch:
    @pytest.mark.asyncio
    async def test_rss_still_uses_feedparser(self):
        """Regression guard: the dispatch must not change RSS semantics."""
        ingestor = make_ingestor()
        feed = make_feed(type="rss")
        with patch.object(si_module.feedparser, "parse") as mock_parse:
            mock_parse.return_value = MagicMock(bozo=False, entries=[])
            await ingestor.process_feed(feed)
        mock_parse.assert_called_once()

    @pytest.mark.asyncio
    async def test_json_api_routed_to_json_poller(self):
        ingestor = make_ingestor()
        feed = make_feed()
        with patch.object(ingestor, "process_json_api_feed", new=AsyncMock()) as mock_json:
            await ingestor.process_feed(feed)
        mock_json.assert_awaited_once_with(feed)

    @pytest.mark.asyncio
    async def test_default_type_is_rss(self):
        ingestor = make_ingestor()
        feed = make_feed()
        del feed["type"]
        with patch.object(si_module.feedparser, "parse") as mock_parse:
            mock_parse.return_value = MagicMock(bozo=False, entries=[])
            await ingestor.process_feed(feed)
        mock_parse.assert_called_once()


class TestJsonApiPolling:
    @pytest.mark.asyncio
    async def test_happy_path_maps_fields_and_ingests(self):
        ingestor = make_ingestor()
        feed = make_feed()
        body = {
            "data": {
                "items": [
                    {
                        "id": "i1",
                        "doc": {
                            "title": "Notice 42",
                            "body": "The ministry published new guidelines. " * 8,
                            "url": "https://example.gov/42",
                        },
                        "published": "2026-09-01T10:00:00",
                    }
                ]
            }
        }
        with (
            patch.object(ingestor, "ingest_entries", new=AsyncMock()) as mock_ingest,
            _httpx_client(_mock_http(body)),
        ):
            await ingestor.process_json_api_feed(feed)

        mock_ingest.assert_awaited_once()
        entry = mock_ingest.call_args.args[1][0]
        assert entry["title"] == "Notice 42"
        assert "guidelines" in entry["summary"]
        assert entry["link"] == "https://example.gov/42"
        # success bookkeeping matches the RSS path
        assert feed["failures"] == 0
        assert "i1" in feed["last_entry_ids"]

    @pytest.mark.asyncio
    async def test_malformed_items_path_routes_to_dlq_never_dataprep(self):
        """THE AC: a malformed response lands in the DLQ, never in the corpus."""
        ingestor = make_ingestor()
        feed = make_feed()
        with (
            patch.object(ingestor, "ingest_entries", new=AsyncMock()) as mock_ingest,
            _httpx_client(_mock_http({"unexpected": "shape"})),
            pytest.raises(RuntimeError, match="did not resolve to a list"),
        ):
            await ingestor.process_json_api_feed(feed)

        mock_ingest.assert_not_called()
        dlq_call = ingestor.redis.xadd.call_args
        assert dlq_call.args[0] == "feed-ingestion-events-dlq"
        assert dlq_call.args[1]["reason"] == "parse_error"
        assert dlq_call.args[1]["feed_id"] == "feed-1"

    @pytest.mark.asyncio
    async def test_missing_items_path_is_config_error(self):
        ingestor = make_ingestor()
        feed = make_feed(content_mapping={})
        with (
            patch.object(ingestor, "ingest_entries", new=AsyncMock()),
            pytest.raises(RuntimeError, match="missing content_mapping.items_path"),
        ):
            await ingestor.process_json_api_feed(feed)
        dlq_call = ingestor.redis.xadd.call_args
        assert dlq_call.args[1]["reason"] == "config_error"

    @pytest.mark.asyncio
    async def test_item_missing_required_fields_goes_to_dlq(self):
        ingestor = make_ingestor()
        feed = make_feed()
        body = {"data": {"items": [{"id": "i2", "doc": {"title": "Only title"}}]}}
        with (
            patch.object(ingestor, "ingest_entries", new=AsyncMock()) as mock_ingest,
            _httpx_client(_mock_http(body)),
        ):
            await ingestor.process_json_api_feed(feed)
        mock_ingest.assert_not_called()
        dlq_call = ingestor.redis.xadd.call_args
        assert dlq_call.args[1]["reason"] == "parse_error"

    @pytest.mark.asyncio
    async def test_dedup_by_id_field(self):
        ingestor = make_ingestor()
        feed = make_feed()
        body = {"data": {"items": [{"id": "i1", "doc": {"title": "T", "body": "B" * 100}}]}}
        with (
            patch.object(ingestor, "ingest_entries", new=AsyncMock()) as mock_ingest,
            _httpx_client(_mock_http(body)),
        ):
            feed["last_entry_ids"] = ["i1"]  # already seen
            await ingestor.process_json_api_feed(feed)
        mock_ingest.assert_not_called()

    @pytest.mark.asyncio
    async def test_fetch_failure_routes_to_dlq_then_raises_for_backoff(self):
        ingestor = make_ingestor()
        feed = make_feed()
        with (
            patch("httpx.AsyncClient.get", new=AsyncMock(side_effect=RuntimeError("refused"))),
            pytest.raises(RuntimeError, match="refused"),
        ):
            await ingestor.process_json_api_feed(feed)
        dlq_call = ingestor.redis.xadd.call_args
        assert dlq_call.args[1]["reason"] == "parse_error"

    @pytest.mark.asyncio
    async def test_process_feed_json_failure_books_backoff(self):
        """Review parity contract: a json_api failure through process_feed (the
        real caller) increments failures + sets backoff, exactly like RSS."""
        ingestor = make_ingestor()
        feed = make_feed(polling_interval=60)
        with patch.object(ingestor, "process_json_api_feed", new=AsyncMock(side_effect=RuntimeError("down"))):
            await ingestor.process_feed(feed)
        assert feed["failures"] == 1
        assert feed["next_poll_at"] > 0

    def test_resolve_path_dotted_and_list(self):
        assert StreamIngestor._resolve_path({"a": {"b": [10, 20]}}, "a.b.1") == 20
        assert StreamIngestor._resolve_path({"a": {}}, "a.b") is None


# ===========================================================================
# Story 3-5 — webhook push ingestion (FR27/D8/NFR9)
# ===========================================================================
# conftest poisons sys.modules["aiohttp"] with a MagicMock (for dataprep
# tests) BEFORE this module imports the ingestor — so the ingestor's `web`
# name is bound to the mock. Recover the REAL aiohttp.web and rebind it here;
# the webhook tests assert on real response objects (.status/.headers).
import importlib as _importlib
import sys as _sys

from stream_ingestor.genieai_stream_ingestor import _make_webhook_handler, build_web_app

_aiohttp_saved = _sys.modules.get("aiohttp")
_sys.modules.pop("aiohttp", None)
try:
    _real_web = _importlib.import_module("aiohttp.web")
finally:
    if _aiohttp_saved is not None:
        _sys.modules["aiohttp"] = _aiohttp_saved
si_module.web = _real_web


class TestWebhookIngestion:
    """Direct handler invocation — conftest poisons sys.modules["aiohttp"]
    with a MagicMock, so a real TestClient is unavailable under pytest; the
    handler is pure enough to test with fake request objects."""

    @staticmethod
    def make_client(monkeypatch, feeds=None, enabled=True, api_key="secret-key", jwt_mode=False, feed_overrides=None):
        monkeypatch.setenv("WEBHOOK_INGESTION_ENABLED", "true" if enabled else "false")
        if api_key is not None:
            monkeypatch.setenv("WEBHOOK_API_KEY", api_key)
        else:
            monkeypatch.delenv("WEBHOOK_API_KEY", raising=False)
        if jwt_mode:
            monkeypatch.setenv("WEBHOOK_JWT_ENABLED", "true")
        else:
            monkeypatch.delenv("WEBHOOK_JWT_ENABLED", raising=False)

        ingestor = make_ingestor()
        feed = make_feed(type="webhook")
        feed["enabled"] = True
        if feed_overrides:
            feed.update(feed_overrides)
        ingestor.feeds_col.get = MagicMock(return_value=feed)
        ingestor.ingest_entries = AsyncMock()
        ingestor.redis.zremrangebyscore = AsyncMock()
        ingestor.redis.zcard = AsyncMock(return_value=0)
        ingestor.redis.zadd = AsyncMock()
        ingestor.redis.expire = AsyncMock()
        # sliding-window limiter uses a pipeline (zremrangebyscore + zcard batched)
        pipe_mock = MagicMock()
        pipe_mock.execute = AsyncMock(return_value=[0, 0])
        ingestor.redis.pipeline = MagicMock(return_value=pipe_mock)

        build_web_app(ingestor)
        handler = _make_webhook_handler(ingestor)

        def make_request(headers=None, json_body=None, feed_name="feed-1"):
            request = MagicMock()
            request.match_info = {"feed_name": feed_name}
            request.headers = headers or {}
            request.json = AsyncMock(return_value=json_body)
            return request

        default_headers = {"X-API-Key": api_key} if api_key else {}
        return ingestor, handler, make_request, default_headers

    @pytest.mark.asyncio
    async def test_kill_switch_off_route_not_registered(self, monkeypatch):
        monkeypatch.setenv("WEBHOOK_INGESTION_ENABLED", "false")
        app = build_web_app(make_ingestor())
        paths = [r.resource.canonical for r in app.router.routes()]
        assert not any("webhook" in path for path in paths)

    @pytest.mark.asyncio
    async def test_unknown_feed_404(self, monkeypatch):
        ingestor, handler, make_request, headers = self.make_client(monkeypatch)
        ingestor.feeds_col.get = MagicMock(return_value=None)
        response = await handler(make_request(headers=headers, feed_name="nope"))
        assert response.status == 404

    @pytest.mark.asyncio
    async def test_feed_lookup_outage_503_not_404(self, monkeypatch):
        """DB outage must not read as 'unknown feed' (senders would deconfigure)."""
        ingestor, handler, make_request, headers = self.make_client(monkeypatch)
        ingestor.feeds_col.get = MagicMock(side_effect=Exception("arango down"))
        response = await handler(make_request(headers=headers, feed_name="nope"))
        assert response.status == 503

    @pytest.mark.asyncio
    async def test_missing_api_key_401(self, monkeypatch):
        ingestor, handler, make_request, _ = self.make_client(monkeypatch)
        response = await handler(make_request())
        assert response.status == 401

    @pytest.mark.asyncio
    async def test_wrong_api_key_401(self, monkeypatch):
        ingestor, handler, make_request, _ = self.make_client(monkeypatch)
        response = await handler(make_request(headers={"X-API-Key": "wrong"}))
        assert response.status == 401

    @pytest.mark.asyncio
    async def test_no_auth_configured_401_fail_closed(self, monkeypatch):
        ingestor, handler, make_request, _ = self.make_client(monkeypatch, api_key=None)
        response = await handler(make_request())
        assert response.status == 401

    @pytest.mark.asyncio
    async def test_jwt_mode_401_without_bearer(self, monkeypatch):
        ingestor, handler, make_request, _ = self.make_client(monkeypatch, api_key=None, jwt_mode=True)
        response = await handler(make_request())
        assert response.status == 401

    @pytest.mark.asyncio
    async def test_missing_content_400(self, monkeypatch):
        ingestor, handler, make_request, headers = self.make_client(monkeypatch)
        response = await handler(make_request(headers=headers, json_body={"title": "only"}))
        assert response.status == 400

    @pytest.mark.asyncio
    async def test_happy_path_202_ingests_and_publishes_event(self, monkeypatch):
        ingestor, handler, make_request, headers = self.make_client(monkeypatch)
        response = await handler(
            make_request(
                headers=headers,
                json_body={"title": "Push Notice", "content": "Official content " * 5},
            )
        )
        assert response.status == 202

        ingestor.ingest_entries.assert_awaited_once()
        entry = ingestor.ingest_entries.call_args.args[1][0]
        assert entry["title"] == "Push Notice"
        assert "Official content" in entry["summary"]

        xadd_calls = ingestor.redis.xadd.call_args_list
        event_call = next((c for c in xadd_calls if c.args[0] == "feed-ingestion-events"), None)
        assert event_call is not None
        assert event_call.args[1]["event_type"] == "webhook_received"

    @pytest.mark.asyncio
    async def test_rate_limit_429_with_retry_after(self, monkeypatch):
        ingestor, handler, make_request, headers = self.make_client(monkeypatch)
        # Exhaust the window: the limiter's pipeline reports 10 entries already
        # in the window (>= WEBHOOK_RATE_LIMIT_MAX default 10) -> denied
        pipe_mock = MagicMock()
        pipe_mock.execute = AsyncMock(return_value=[10, 10])
        ingestor.redis.pipeline = MagicMock(return_value=pipe_mock)
        ingestor.redis.zrange = AsyncMock(return_value=[str(1690000000.0)])
        response = await handler(make_request(headers=headers, json_body={"title": "t", "content": "c"}))
        assert response.status == 429
        assert "Retry-After" in response.headers
        assert int(response.headers["Retry-After"]) >= 1

    @pytest.mark.asyncio
    async def test_disabled_feed_404(self, monkeypatch):
        ingestor, handler, make_request, headers = self.make_client(monkeypatch, feed_overrides={"enabled": False})
        response = await handler(make_request(headers=headers, json_body={"title": "t", "content": "c"}))
        assert response.status == 404


# ===========================================================================
# Story 3-9 — per-feed resilience: breaker, DLQ replay, poll floor
# ==========================================================================
class TestBreakerStateMachine:
    @pytest.fixture
    def ingestor(self):
        ing = make_ingestor()
        ing._replay_dlq = AsyncMock()
        return ing

    @pytest.mark.asyncio
    async def test_three_failures_open_breaker(self, ingestor):
        feed = make_feed(type="rss")
        # drive the bookkeeping directly — process_feed backs off after failure
        # #1 (next_poll_at), so a 3-iteration poll loop never reaches 3 failures
        for i in range(3):
            ingestor._mark_feed_failure(feed, 60, f"down #{i}")
        assert feed["failures"] == 3
        assert feed["breaker_state"] == "open"

    @pytest.mark.asyncio
    async def test_open_breaker_suppressed_poll_writes_dlq(self, ingestor):
        feed = make_feed(type="rss", breaker_state="open", next_poll_at=time.time() + 9999)
        await ingestor.process_feed(feed)
        dlq_call = [c for c in ingestor.redis.xadd.call_args_list if c.args[0] == "feed-ingestion-events-dlq"]
        assert len(dlq_call) == 1
        assert dlq_call[0].args[1]["reason"] == "breaker_open"

    @pytest.mark.asyncio
    async def test_half_open_probe_success_closes_and_replays(self, ingestor):
        feed = make_feed(type="rss", breaker_state="open", next_poll_at=0)  # backoff elapsed
        with patch.object(si_module.feedparser, "parse") as mock_parse:
            mock_parse.return_value = MagicMock(bozo=False, entries=[])
            await ingestor.process_feed(feed)
        assert feed["breaker_state"] == "closed"
        ingestor._replay_dlq.assert_awaited_once_with("feed-1")

    @pytest.mark.asyncio
    async def test_half_open_probe_failure_reopens(self, ingestor):
        feed = make_feed(type="rss", breaker_state="half_open", next_poll_at=0)
        with patch.object(si_module.feedparser, "parse", side_effect=RuntimeError("still down")):
            await ingestor.process_feed(feed)
        assert feed["breaker_state"] == "open"
        assert feed["failures"] >= 1

    @pytest.mark.asyncio
    async def test_success_resets_breaker_field(self, ingestor):
        feed = make_feed(type="rss", breaker_state="half_open", next_poll_at=0)
        with patch.object(si_module.feedparser, "parse") as mock_parse:
            mock_parse.return_value = MagicMock(bozo=False, entries=[])
            await ingestor.process_feed(feed)
        assert feed["breaker_state"] == "closed"


class TestPollRateFloor:
    @pytest.mark.asyncio
    async def test_poll_interval_zero_throttled_to_floor(self, monkeypatch):
        monkeypatch.setenv("FEED_POLL_MIN_INTERVAL_SEC", "60")
        ingestor = make_ingestor()
        feed = make_feed(type="rss", poll_interval_sec=0, last_polled=time.time() - 10)
        # 10s ago < 60s floor -> suppressed
        with patch.object(si_module.feedparser, "parse") as mock_parse:
            await ingestor.process_feed(feed)
        mock_parse.assert_not_called()
