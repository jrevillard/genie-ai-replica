#!/usr/bin/env python3
"""Local-only mock of TEI + vLLM endpoints for GPU-free pipeline testing.

Serves (default 127.0.0.1:8080):
  GET  /health, /              -> 200
  POST /embed                  -> TEI native: bare [[1024 dims], ...]
  POST /v1/embeddings          -> OpenAI envelope: {"data":[{"embedding":[...]}]}
  POST /rerank                 -> TEI shape with dummy scores
  POST /v1/chat/completions    -> OpenAI shape, canned text (graph extractor
                                  parses it to an empty graph — acceptable).
                                  With stream:true + MOCK_SLOW=1: real SSE
                                  chunks ~1s apart (see below).

Wiring (containers reach the host via the extra_hosts host-gateway entries):
  EMBEDDING_SERVICE_URL=http://localhost:8080
  RERANKER_SERVICE_URL=http://localhost:8080
  VLLM_ENDPOINT=http://localhost:8080
Then: python3 tests/mock-gpu-server.py
  (MOCK_HOST=0.0.0.0 when containers reach it via host-gateway)

SSE-through-the-stack check (proves nginx AND kong don't buffer):
  MOCK_SLOW=1 MOCK_HOST=0.0.0.0 python3 tests/mock-gpu-server.py
  curl -kN -X POST https://localhost/api/queries/stream \
    -H 'Content-Type: application/json' -H "Authorization: Bearer <token>" \
    -d '{"userId":"u","sessionId":"s","messages":[{"role":"user","content":"hi"}]}'
  -> delta events must arrive ~1s apart, not in one lump at the end.

Never deploy this; it exists so dataprep/retriever run end-to-end without GPUs.
"""
import hashlib
import json
import os
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

DIM = 1024
SLOW = os.getenv("MOCK_SLOW") == "1"


def fake_vector(text):
    h = hashlib.sha512(text.encode()).digest()
    return [(h[i % len(h)] / 255.0) - 0.5 for i in range(DIM)]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._json(200, {"status": "ok"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            req = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            req = {}

        if self.path == "/embed":
            # TEI native: bare array of vectors (consumers index data[0])
            inputs = req.get("inputs") or []
            if isinstance(inputs, str):
                inputs = [inputs]
            self._json(200, [fake_vector(t) for t in inputs])

        elif self.path == "/v1/embeddings":
            # OpenAI envelope (chatqna's align_outputs unwrap)
            inputs = req.get("input") or []
            if isinstance(inputs, str):
                inputs = [inputs]
            self._json(200, {"data": [
                {"index": i, "embedding": fake_vector(t)} for i, t in enumerate(inputs)
            ]})

        elif self.path == "/rerank":
            q = req.get("query", "")
            docs = req.get("texts") or []
            self._json(200, [
                {"index": i, "score": 0.5 + (i and -0.05 * i)} for i, _ in enumerate(docs)
            ] or [{"index": 0, "score": 0.5}])

        elif self.path.startswith("/v1/chat/completions"):
            if SLOW and req.get("stream"):
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for tok in ["Greetings ", "from ", "the ", "slow ", "mock."]:
                    chunk = {
                        "id": "mock", "object": "chat.completion.chunk", "created": 0,
                        "model": req.get("model", "mock"),
                        "choices": [{"index": 0, "delta": {"content": tok}, "finish_reason": None}],
                    }
                    self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode())
                    self.wfile.flush()
                    time.sleep(1)
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
                return
            self._json(200, {
                "id": "mock", "object": "chat.completion", "created": 0,
                "model": req.get("model", "mock"),
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": "(no structured output)"},
                    "finish_reason": "stop"
                }],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
            })

        else:
            # HuggingFaceHubEmbeddings convention: POST {model-endpoint}/ with {"inputs": ...}
            inputs = req.get("inputs")
            if inputs is None:
                self._json(404, {"error": "not found"})
            elif isinstance(inputs, str):
                self._json(200, fake_vector(inputs))
            else:
                self._json(200, [fake_vector(t if isinstance(t, str) else str(t)) for t in inputs])


if __name__ == "__main__":
    # 127.0.0.1 for local runs; MOCK_HOST=0.0.0.0 when containers reach it via host-gateway
    HTTPServer((os.getenv("MOCK_HOST", "127.0.0.1"), 8080), Handler).serve_forever()
