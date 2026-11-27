# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The web-search adapter: the outbound PII egress and the meta-search call,
in one leaf.

The Server-Side Tools rule (the design's §4.7, ADR agentic-005 §6): a query
that leaves for the open web passes the pii-service FIRST and the search runs
only on the redacted text. The pass is FAIL-CLOSED: a scan that does not
answer 200 with a usable ``redacted_text`` raises before the search endpoint
is dialled — the raw query NEVER reaches the web. The raised
:class:`TransientError` is the contract's declared carrier: the dispatcher
maps it onto the structured error envelope the loop feeds back as tool data.

Two endpoints, both injected as base URLs by the host:

* ``POST {pii_base_url}/v1/pii/scan`` — the batch scan the okf-server's
  governance client also consumes (``{texts: [{id, text, language}]}`` →
  ``{results: [{redacted_text, ...}]}``). The query is scanned with
  ``language: "en"`` because that is the ONLY language the shipped sidecar
  supports (its model is English; ``SUPPORTED_LANGUAGES = frozenset({"en"})``
  in ``components/pii-service/app.py``) — on a non-English query the scan is
  a best-effort pass, an honest limitation of the sidecar, not a coverage
  guarantee. Widening it means a multilingual model in the sidecar, not a
  flag here.
* ``GET {searxng_base_url}/search?q=...&format=json`` — the meta-search's
  JSON API. It is DISABLED by default upstream (its ``search.formats`` ships
  ``[html]``); the deployment's settings file
  (``configs/agent/searxng-settings.yml``) is what adds ``json``, and an
  instance served without it answers 403 to every ``format=json`` call —
  the deployment's own lie, surfaced as a transient failure here.

No identity is forwarded: the caller's bearer rides nowhere — the scan and
the search receive the query text and nothing else, both calls carry EMPTY
headers (the design's rule: identity is forwarded only where declared; this
adapter declares no one). Each leg is bounded at ``budget.timeout_ms`` (the
contract's per-operation timeout reading — the two calls are the operation's
legs), ``budget.max_results`` slices the hits, and ``budget.max_result_bytes``
truncates one hit's text (the read path's per-result byte cut).
"""

from urllib.parse import quote

from capabilities.adapters.httpx import HttpxTransport, TransportTimeoutError
from capabilities.contract import WEB_SEARCH_SOURCE, OperationBudget, OutcomeCode, TransientError

# The scan request's language: the sidecar's only supported one. A constant,
# so the pin and the payload cannot drift apart.
PII_SCAN_LANGUAGE = "en"


class WebSearchAdapter:
    """The ``WebSearchPort`` over the pii-service and the meta-search.

    One call = one scan + one search, in that order, on the injected
    transport. The adapter builds no client of its own and reads no
    environment: the host hands it the two base URLs and the TLS knob.
    """

    def __init__(
        self,
        pii_base_url: str,
        searxng_base_url: str,
        transport: HttpxTransport | None = None,
        tls_verify: bool = True,
    ) -> None:
        self._pii_url = pii_base_url.rstrip("/") + "/v1/pii/scan"
        self._searxng_base = searxng_base_url.rstrip("/")
        self._transport = transport if transport is not None else HttpxTransport(tls_verify)

    async def search(self, query: str, budget: OperationBudget) -> dict:
        """One PII-bounded web search: the redacted query is the only text
        that leaves, and a scan that fails leaves nothing at all."""
        timeout_s = budget.timeout_ms / 1000
        redacted = await self._redact(query, timeout_s)
        return await self._search(redacted, budget, timeout_s)

    async def _redact(self, query: str, timeout_s: float) -> str:
        """The outbound pass. ANY failure — transport, status, shape, a
        ``redacted_text`` that is absent or blank — is a ``TransientError``
        raised HERE, before the search endpoint is dialled."""
        payload = {"texts": [{"id": "query", "text": query, "language": PII_SCAN_LANGUAGE}]}
        try:
            status, body = await self._transport.post_json(self._pii_url, {}, payload, timeout_s)
        except TransportTimeoutError as failure:
            raise TransientError(f"the pii scan timed out: {failure}") from failure
        except Exception as failure:  # noqa: BLE001 — every scan failure is transient
            raise TransientError(f"the pii scan failed: {type(failure).__name__}: {str(failure)[:200]}") from failure
        if status != 200:
            raise TransientError(f"the pii scan answered {status}: {str(body)[:200]}")
        results = body.get("results") if isinstance(body, dict) else None
        first = results[0] if isinstance(results, list) and results and isinstance(results[0], dict) else None
        redacted = first.get("redacted_text") if first is not None else None
        if not isinstance(redacted, str) or not redacted.strip():
            raise TransientError("the pii scan carried no usable redacted_text")
        return redacted

    async def _search(self, redacted: str, budget: OperationBudget, timeout_s: float) -> dict:
        """The search over the REDACTED text, mapped onto the ledger's
        triple shape. Items the shape refuses (no url, blank content, not
        an object) are skipped, never guessed into hits."""
        url = f"{self._searxng_base}/search?q={quote(redacted, safe='')}&format=json"
        try:
            status, body = await self._transport.get_json(url, {}, timeout_s)
        except TransportTimeoutError as failure:
            raise TransientError(f"the web search timed out: {failure}") from failure
        except Exception as failure:  # noqa: BLE001 — every search failure is transient
            raise TransientError(f"the web search failed: {type(failure).__name__}: {str(failure)[:200]}") from failure
        if status != 200:
            raise TransientError(f"the web search answered {status}: {str(body)[:200]}")
        raw = body.get("results") if isinstance(body, dict) else None
        if not isinstance(raw, list):
            raise TransientError("the web search carried no results list")
        hits: list[dict] = []
        for item in raw[: budget.max_results]:
            if not isinstance(item, dict):
                continue
            item_url = item.get("url")
            text = item.get("content")
            if not isinstance(item_url, str) or not isinstance(text, str) or not text.strip():
                continue
            encoded = text.encode("utf-8")
            if len(encoded) > budget.max_result_bytes:
                text = encoded[: budget.max_result_bytes].decode("utf-8", "ignore")
            hits.append(
                {
                    "text": text,
                    "provenance": {
                        "source": WEB_SEARCH_SOURCE,
                        "url": item_url,
                        "title": str(item.get("title") or ""),
                    },
                    "score": item.get("score"),
                }
            )
        return {"outcome": OutcomeCode.SUCCESS.value, "hits": tuple(hits), "truncated": False}
