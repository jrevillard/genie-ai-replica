# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0

"""Story 3-4: json_api polling with content_mapping + parse_error DLQ gate.
Also guards the RSS path staying unchanged through the feed_type dispatch."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import stream_ingestor.genieai_stream_ingestor as si_module
from stream_ingestor.genieai_stream_ingestor import StreamIngestor


def make_ingestor():
    ingestor = StreamIngestor.__new__(StreamIngestor)
    ingestor.db = MagicMock()
    ingestor.feeds_col = MagicMock()
    ingestor.feeds_col.update = MagicMock()
    ingestor.redis = MagicMock()
    ingestor.redis.xadd = AsyncMock(return_value="1-1")
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
