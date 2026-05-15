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
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from . import SystemResponse, TestCase


def _make_session() -> requests.Session:
    """Session with automatic retries on network blips. The Swarm host
    is reached over an SSH tunnel which can blink during the run; on a
    failed request we retry up to 3 times with exponential backoff
    rather than aborting the whole sweep."""
    s = requests.Session()
    retry = Retry(
        total=3,
        connect=3,
        read=3,
        backoff_factor=2.0,  # 0s, 2s, 4s
        status_forcelist=(502, 503, 504),
        allowed_methods=frozenset(["POST", "GET"]),
        raise_on_status=False,
    )
    s.mount("http://", HTTPAdapter(max_retries=retry))
    s.mount("https://", HTTPAdapter(max_retries=retry))
    return s


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
        corpus_fallback_dir=None,
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
        # The chatqna service currently strips chunk text from
        # source_documents and, when it can't authenticate to doc-repo,
        # returns "error" placeholders for the metadata too. To give the
        # judge a meaningful retrieved_context anyway, we can fall back to
        # the full corpus text — the judge can then check whether each
        # fact in the answer is supported by the corpus the server was
        # supposed to retrieve from. The fallback is loaded lazily and
        # cached.
        self._corpus_fallback_dir = corpus_fallback_dir
        self._corpus_text_cache: str | None = None
        self._session = _make_session()

    def run(self, cases: list[TestCase]) -> list[SystemResponse]:
        results: list[SystemResponse] = []
        for case in cases:
            try:
                results.append(self._run_one(case))
            except Exception as e:  # noqa: BLE001 — fail-soft per case
                # A single-case network blip shouldn't kill the whole
                # sweep. Record it as a synthetic response so the judge
                # can mark it failed and we keep going.
                results.append(
                    SystemResponse(
                        test_id=case.id,
                        answer=f"[ADAPTER ERROR] {type(e).__name__}: {e}",
                        retrieved_context="",
                        extra={"error": True, "exception": type(e).__name__},
                    )
                )
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
        resp = self._session.post(self._url, json=payload, timeout=self._timeout)
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

    def _load_corpus_fallback(self) -> str:
        if self._corpus_text_cache is not None:
            return self._corpus_text_cache
        if self._corpus_fallback_dir is None:
            self._corpus_text_cache = ""
            return ""
        from pathlib import Path

        dir_path = Path(self._corpus_fallback_dir)
        if not dir_path.exists():
            self._corpus_text_cache = ""
            return ""
        # Per-document truncation. The full WHO PDF is ~62k tokens; if we
        # forward it verbatim to the judge per query, we hit the model's
        # tokens-per-minute limit immediately. 60_000 chars ≈ 15k tokens
        # — enough to cover the recommendations + treatment sections of
        # the WHO guideline (which is what most of our cases probe). For
        # corpora that grow beyond what this truncation can hold, switch
        # the harness to chunk-text retrieval from a real retriever
        # endpoint instead of corpus_fallback.
        per_doc_limit = 60_000
        parts: list[str] = []
        for f in sorted(dir_path.iterdir()):
            if f.suffix.lower() not in (".txt", ".md"):
                continue
            stem = f.stem
            title = stem if stem.lower().endswith(".pdf") else f"{stem}.pdf"
            text = f.read_text(encoding="utf-8", errors="replace")
            if len(text) > per_doc_limit:
                text = text[:per_doc_limit] + f"\n\n[... corpus truncated at {per_doc_limit} chars; original length {len(text)}]"
            parts.append(f'From "{title}" (full corpus fallback):\n{text}')
        self._corpus_text_cache = "\n\n".join(parts)
        return self._corpus_text_cache

    def _sources_are_real(self, sources: list[dict]) -> bool:
        """Return True only if at least one source has plausible metadata.
        Chatqna without auth returns sentinel "error" strings for every
        field — see the runtime log finding documented in the README."""
        if not sources:
            return False
        for s in sources:
            doc = s.get("document_id") or s.get("documentId") or ""
            name = s.get("document_name") or s.get("title") or ""
            if doc and doc != "error" and name and name != "error":
                return True
        return False

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

        sources_real = self._sources_are_real(sources)
        if sources_real:
            retrieved_context = _format_context(sources)
            ctx_source = "server_sources"
        else:
            # Fall back to the full corpus text. This lets the judge
            # verify grounding against the same documents the server
            # indexed, at the cost of losing per-chunk score signal.
            retrieved_context = self._load_corpus_fallback()
            ctx_source = "corpus_fallback"

        return SystemResponse(
            test_id=case.id,
            answer=answer,
            retrieved_context=retrieved_context,
            extra={
                "http_status": 200,
                "duration_sec": round(duration, 3),
                "source_count": len(sources),
                "sources_real": sources_real,
                "context_source": ctx_source,
                "confidence_score": metadata.get("confidence_score")
                or body.get("confidence"),
            },
        )
