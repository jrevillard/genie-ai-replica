"""
Web RAG adapter — talks to the server-side ChatQnA pipeline.

Two endpoint shapes are supported:

  --web-endpoint chatqna   (default)
      Direct POST to the chatqna service. The same payload shape that
      tests/rag-benchmarks/benchmark_query.py uses. No bearer token
      needed because chatqna is internal to the Docker network — point
      the URL at an SSH tunnel (e.g. `ssh -L 8888:localhost:8888 ...`)
      or run this script on the host itself. The chatqna response
      includes metadata.source_documents which we feed to the judge as
      the retrieved context.

  --web-endpoint backend
      POST to the public API gateway (gov-chat-backend). Requires a
      Keycloak bearer token via --web-token. The backend wraps chatqna
      and applies auth, conversation persistence, and source URL
      rewriting. Use this when you want to test what an end-user
      actually hits.
"""

from __future__ import annotations

import time

import requests

from . import SystemResponse, TestCase


def _format_context(source_documents: list[dict]) -> str:
    """Render server `source_documents` into the same `From "<title>":`
    layout the judge expects (and that the mobile pipeline produces),
    so groundedness scoring is consistent across adapters."""
    if not source_documents:
        return ""
    parts = []
    for i, doc in enumerate(source_documents, 1):
        title = (
            doc.get("title")
            or doc.get("file_name")
            or doc.get("document_name")
            or "unknown.pdf"
        )
        score = doc.get("score") or doc.get("confidence")
        snippet = (doc.get("snippet") or "").strip()
        score_str = f" (relevance: {int(round(float(score) * 100))}%)" if score else ""
        parts.append(f'[{i}] From "{title}"{score_str}:\n{snippet}')
    return "\n\n".join(parts)


class WebRAGAdapter:
    """HTTP adapter for both chatqna-direct and backend-with-auth modes."""

    def __init__(
        self,
        url: str,
        mode: str = "chatqna",
        token: str | None = None,
        timeout_seconds: int = 210,
    ) -> None:
        if mode not in ("chatqna", "backend"):
            raise ValueError(f"web mode must be 'chatqna' or 'backend' (got {mode!r})")
        if mode == "backend" and not token:
            raise ValueError(
                "backend mode requires --web-token (Keycloak bearer token)."
            )
        self._url = url.rstrip("/")
        self._mode = mode
        self._token = token
        self._timeout = timeout_seconds

    def run(self, cases: list[TestCase]) -> list[SystemResponse]:
        results: list[SystemResponse] = []
        for case in cases:
            results.append(self._run_one(case))
        return results

    def _run_one(self, case: TestCase) -> SystemResponse:
        if self._mode == "chatqna":
            return self._call_chatqna(case)
        return self._call_backend(case)

    def _call_chatqna(self, case: TestCase) -> SystemResponse:
        # Match the chatqna payload shape used by
        # tests/rag-benchmarks/benchmark_query.py:65.
        payload = {
            "messages": [{"role": "user", "content": case.question}],
            "context": {
                "categoryLabel": "Healthcare",
                "serviceLabels": case.labels,
            },
            "stream": False,
            "user_id": "llm-judge-bench",
        }
        t0 = time.time()
        resp = requests.post(self._url, json=payload, timeout=self._timeout)
        duration = time.time() - t0
        return self._parse_response(case, resp, duration)

    def _call_backend(self, case: TestCase) -> SystemResponse:
        # gov-chat-backend's /api/chat/query: bearer-auth, similar payload
        # shape, but the response is unwrapped to {response, metadata: {...}}.
        payload = {
            "messages": [{"role": "user", "content": case.question}],
            "context": {
                "categoryLabel": "Healthcare",
                "serviceLabels": case.labels,
            },
            "language": "en",
        }
        headers = {"Authorization": f"Bearer {self._token}"}
        t0 = time.time()
        resp = requests.post(
            self._url,
            json=payload,
            headers=headers,
            timeout=self._timeout,
        )
        duration = time.time() - t0
        return self._parse_response(case, resp, duration)

    def _parse_response(
        self,
        case: TestCase,
        resp: requests.Response,
        duration: float,
    ) -> SystemResponse:
        if resp.status_code != 200:
            return SystemResponse(
                test_id=case.id,
                answer=f"[HTTP {resp.status_code}] {resp.text[:300]}",
                retrieved_context="",
                extra={
                    "http_status": resp.status_code,
                    "duration_sec": round(duration, 3),
                    "error": True,
                },
            )

        body = resp.json()
        answer = (
            body.get("response")
            or body.get("content")
            or body.get("choices", [{}])[0].get("message", {}).get("content", "")
        )
        metadata = body.get("metadata") or {}
        sources = metadata.get("source_documents") or body.get("sources") or []

        return SystemResponse(
            test_id=case.id,
            answer=answer,
            retrieved_context=_format_context(sources),
            extra={
                "http_status": 200,
                "duration_sec": round(duration, 3),
                "source_count": len(sources),
                "confidence_score": metadata.get("confidence_score")
                or body.get("confidence"),
            },
        )
