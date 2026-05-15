"""
Local RAG adapter — invokes the Swift CLI that wraps the LocalRAG package.

The CLI is built once (`swift build`) and then called per evaluation run.
It accepts a single JSON document on stdin describing the model path,
corpus directory, and a list of queries. It emits a JSON array on stdout
with one entry per query: `{id, answer, retrieved_context}`.

Keeping the CLI as the boundary means the on-device pipeline (llama.cpp +
Apple NLEmbedding + LocalRAG's vector store) is the actual code under
test — not a Python re-implementation. The only difference between this
test run and a real iOS device run is the host OS (macOS vs. iOS), which
share the same LocalRAG sources and the same llama.cpp XCFramework via
mattt/llama.swift.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

from . import SystemResponse, TestCase


class LocalRAGAdapter:
    def __init__(
        self,
        cli_binary: Path,
        model_path: Path,
        corpus_dir: Path,
        timeout_seconds: int = 600,
    ) -> None:
        if not cli_binary.exists():
            raise FileNotFoundError(
                f"Swift CLI binary not found at {cli_binary}. "
                "Build it first: cd tests/llm-judge/swift_cli && swift build -c release"
            )
        if not model_path.exists():
            raise FileNotFoundError(
                f"GGUF model not found at {model_path}. "
                "Provide --local-model pointing at a Gemma 2 2B GGUF file."
            )
        if not corpus_dir.exists() or not any(corpus_dir.iterdir()):
            raise FileNotFoundError(
                f"Corpus directory {corpus_dir} is empty or missing. "
                "Drop one or more .txt/.md files there (each treated as one "
                "indexed document)."
            )
        self._cli = cli_binary
        self._model = model_path
        self._corpus = corpus_dir
        self._timeout = timeout_seconds

    def run(self, cases: list[TestCase]) -> list[SystemResponse]:
        cli_input = {
            "model_path": str(self._model),
            "corpus_dir": str(self._corpus),
            "queries": [
                {
                    "id": c.id,
                    "question": c.question,
                    "labels": c.labels,
                }
                for c in cases
            ],
        }

        t0 = time.time()
        try:
            proc = subprocess.run(
                [str(self._cli)],
                input=json.dumps(cli_input),
                capture_output=True,
                text=True,
                timeout=self._timeout,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise RuntimeError(
                f"LocalRAGCLI did not finish in {self._timeout}s. "
                "The first run includes model load + corpus indexing, "
                "consider --local-timeout 1200 on slower machines."
            )
        duration = time.time() - t0

        if proc.returncode != 0:
            # Surface both stderr (Swift loader logs) and the LAST 800
            # chars of stdout (which would normally hold the JSON
            # results), so we can tell whether the crash was before or
            # after the queries actually completed.
            sys.stderr.write(proc.stderr)
            tail = proc.stdout[-800:] if proc.stdout else "(empty)"
            sys.stderr.write(
                f"\n--- LocalRAGCLI stdout tail ({len(proc.stdout)} bytes) ---\n"
                f"{tail}\n"
                f"--- end stdout tail ---\n"
            )

            # Fail-soft: if the CLI emitted valid JSON for at least some
            # queries before crashing during exit cleanup, parse what we
            # have and return those responses rather than aborting the
            # whole sweep. The Metal cleanup-on-exit assertion in
            # ggml-metal-device.m is a known issue when llama.cpp is used
            # from a short-lived CLI process; treat it as non-fatal as
            # long as we got the results.
            if proc.stdout:
                try:
                    partial = json.loads(proc.stdout)
                    if partial.get("results"):
                        sys.stderr.write(
                            f"--- Recovered {len(partial['results'])} results "
                            f"despite exit code {proc.returncode}; continuing ---\n"
                        )
                        return [
                            SystemResponse(
                                test_id=e["id"],
                                answer=e.get("answer", ""),
                                retrieved_context=e.get("retrieved_context", ""),
                                extra={
                                    "source_count": e.get("source_count", 0),
                                    "duration_sec": e.get("duration_sec"),
                                    "batch_duration_sec": round(duration, 3),
                                    "cli_exit_code": proc.returncode,
                                },
                            )
                            for e in partial["results"]
                        ]
                except json.JSONDecodeError:
                    pass

            raise RuntimeError(
                f"LocalRAGCLI exited with status {proc.returncode} and stdout "
                "did not contain a recoverable JSON results array. See stderr above."
            )

        # The CLI is noisy on stderr (llama.cpp loader logs) but stdout is
        # strictly the JSON response array — read just the last JSON object
        # to be safe in case anything else slipped in.
        out = proc.stdout.strip()
        try:
            data = json.loads(out)
        except json.JSONDecodeError as e:
            # Show the first 500 chars of stdout for debugging.
            raise RuntimeError(
                f"LocalRAGCLI returned non-JSON on stdout: {e}\n"
                f"First 500 chars: {out[:500]!r}"
            )

        responses: list[SystemResponse] = []
        for entry in data.get("results", []):
            responses.append(
                SystemResponse(
                    test_id=entry["id"],
                    answer=entry.get("answer", ""),
                    retrieved_context=entry.get("retrieved_context", ""),
                    extra={
                        "source_count": entry.get("source_count", 0),
                        "duration_sec": entry.get("duration_sec"),
                        "batch_duration_sec": round(duration, 3),
                    },
                )
            )

        return responses
