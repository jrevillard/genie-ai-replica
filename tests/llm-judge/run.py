#!/usr/bin/env python3
"""
LLM-as-a-judge test runner for the GENIE.AI RAG pipelines.

Loads YAML test cases, dispatches each through the requested adapter (web
chatqna/backend or mobile LocalRAGCLI), feeds the (question, retrieved
context, answer) triple to an OpenAI judge, and writes both a per-case
CSV and a console summary.

Examples
--------
Web (chatqna via SSH tunnel on localhost:8888):
  OPENAI_API_KEY=sk-... python3 run.py \\
    --target web --web-url http://localhost:8888/v1/chatqna

Web (public backend with a Keycloak bearer token):
  OPENAI_API_KEY=sk-... python3 run.py \\
    --target web --web-mode backend \\
    --web-url https://app.youngailinz.org/api/chat/query \\
    --web-token "$GENIE_TOKEN"

Mobile (LocalRAG on macOS using a downloaded Gemma 2 2B GGUF):
  OPENAI_API_KEY=sk-... python3 run.py \\
    --target mobile \\
    --local-cli swift_cli/.build/release/LocalRAGCLI \\
    --local-model ~/models/gemma-2-2b-it-Q4_K_M.gguf

Both:
  OPENAI_API_KEY=sk-... python3 run.py --target both \\
    --web-url http://localhost:8888/v1/chatqna \\
    --local-cli swift_cli/.build/release/LocalRAGCLI \\
    --local-model ~/models/gemma-2-2b-it-Q4_K_M.gguf
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except ImportError:
    print(
        "ERROR: `pyyaml` is required.\n"
        "  pip install -r tests/llm-judge/requirements.txt",
        file=sys.stderr,
    )
    sys.exit(2)

from adapters import SystemResponse, TestCase
from adapters.local_rag import LocalRAGAdapter
from adapters.web_rag import WebRAGAdapter
from judge import Judge, JudgeInput, JudgeResult


HERE = Path(__file__).resolve().parent
DEFAULT_TEST_DIR = HERE / "test_cases"
DEFAULT_CORPUS_DIR = HERE / "corpus"
DEFAULT_REPORT_DIR = HERE / "reports"


def _load_test_cases(test_dir: Path) -> list[TestCase]:
    cases: list[TestCase] = []
    for yaml_path in sorted(test_dir.glob("*.yaml")):
        with yaml_path.open("r", encoding="utf-8") as f:
            doc = yaml.safe_load(f) or {}
        for raw in doc.get("cases", []):
            cases.append(
                TestCase(
                    id=raw["id"],
                    question=raw["question"],
                    labels=list(raw.get("labels") or []),
                    should_abstain=bool(raw.get("should_abstain", False)),
                    must_mention_one_of=list(raw.get("must_mention_one_of") or []),
                    must_not_mention=list(raw.get("must_not_mention") or []),
                    must_cite=bool(raw.get("must_cite", False)),
                    notes=str(raw.get("notes") or "").strip(),
                )
            )
    if not cases:
        raise RuntimeError(f"No test cases found in {test_dir}")
    return cases


def _to_judge_input(case: TestCase, resp: SystemResponse) -> JudgeInput:
    return JudgeInput(
        test_id=case.id,
        question=case.question,
        expected_abstain=case.should_abstain,
        must_mention_one_of=case.must_mention_one_of,
        must_not_mention=case.must_not_mention,
        must_cite=case.must_cite,
        notes=case.notes,
        retrieved_context=resp.retrieved_context,
        answer=resp.answer,
    )


def _checkpoint_write(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    """Overwrite the CSV after each new row so a mid-sweep failure
    (flaky tunnel, OpenAI hiccup, kernel panic) doesn't lose the work
    already done. The runner is idempotent on the test-case dimension —
    a re-run replays from scratch — but the CSV-on-disk lets a human
    see partial results immediately."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _run_adapter(
    name: str,
    adapter,
    cases: list[TestCase],
    judge: Judge,
    report_path: Path,
) -> tuple[int, int]:
    print(f"\n=== {name.upper()} ===")
    print(f"  Dispatching {len(cases)} test case(s) ...")
    sys_responses = adapter.run(cases)

    # Build a quick lookup so we tolerate adapters returning results in a
    # different order than the input cases (the Swift CLI does keep order,
    # but the web adapter is one-call-per-case so it does too — defensive).
    by_id = {r.test_id: r for r in sys_responses}
    rows: list[dict] = []
    passed = 0
    fieldnames = [
        "target",
        "test_id",
        "passed",
        "fail_reasons",
        "faithfulness",
        "answer_relevance",
        "citation_correctness",
        "abstention_correctness",
        "safety",
        "violations",
        "rationale",
        "answer_excerpt",
    ]

    for case in cases:
        resp = by_id.get(case.id)
        if resp is None:
            print(f"  [{case.id}] NO RESPONSE")
            rows.append(
                {
                    "target": name,
                    "test_id": case.id,
                    "passed": False,
                    "fail_reasons": "no_response_from_adapter",
                    "answer_excerpt": "",
                    "violations": "",
                }
            )
            _checkpoint_write(report_path, fieldnames, rows)
            continue

        verdict = judge.evaluate(_to_judge_input(case, resp))
        if verdict.passed:
            passed += 1
            mark = "✓"
        else:
            mark = "✗"
        print(f"  [{mark}] {case.id}: {', '.join(verdict.fail_reasons) or 'pass'}")

        row = verdict.as_row()
        row["target"] = name
        row["answer_excerpt"] = resp.answer.strip().replace("\n", " ")[:160]
        rows.append(row)
        _checkpoint_write(report_path, fieldnames, rows)

    # Final write (already happened per-row, but flush once more for tidiness).
    if rows:
        _checkpoint_write(report_path, fieldnames, rows)
        print(f"  Wrote {report_path}")

    return passed, len(cases)


def _summarise(target_results: dict[str, tuple[int, int]]) -> int:
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    overall_passed = 0
    overall_total = 0
    for name, (p, t) in target_results.items():
        pct = (p / t * 100) if t else 0
        print(f"  {name:<8}  {p}/{t} passed  ({pct:.0f}%)")
        overall_passed += p
        overall_total += t
    print("-" * 60)
    pct = (overall_passed / overall_total * 100) if overall_total else 0
    print(f"  overall  {overall_passed}/{overall_total} passed  ({pct:.0f}%)")
    # Return non-zero if any target had a failure — useful for CI.
    return 0 if overall_passed == overall_total else 1


def main() -> int:
    p = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=__doc__,
    )
    p.add_argument(
        "--target",
        choices=("web", "mobile", "both"),
        required=True,
        help="Which pipeline(s) to evaluate.",
    )
    p.add_argument(
        "--test-dir",
        type=Path,
        default=DEFAULT_TEST_DIR,
        help="Directory containing *.yaml test cases (default: test_cases/).",
    )
    p.add_argument(
        "--report-dir",
        type=Path,
        default=DEFAULT_REPORT_DIR,
        help="Directory to write per-target CSV reports (default: reports/).",
    )
    p.add_argument(
        "--judge-model",
        default="gpt-4o-2024-08-06",
        help="OpenAI model used as judge (must support structured outputs).",
    )
    p.add_argument(
        "--openai-key",
        default=None,
        help="Override OPENAI_API_KEY for this run.",
    )

    # Web adapter args.
    p.add_argument(
        "--web-mode",
        choices=("chatqna", "backend"),
        default="chatqna",
        help="chatqna: direct internal endpoint; backend: public auth gateway.",
    )
    p.add_argument(
        "--web-url",
        default="http://localhost:8888/v1/chatqna",
        help="URL for the web RAG endpoint (see --web-mode).",
    )
    p.add_argument(
        "--web-token",
        default=None,
        help="Keycloak bearer token (required for --web-mode backend).",
    )
    p.add_argument(
        "--web-timeout",
        type=int,
        default=210,
        help="HTTP timeout per request, seconds.",
    )

    # Mobile/local adapter args.
    p.add_argument(
        "--local-cli",
        type=Path,
        default=HERE / "swift_cli" / ".build" / "release" / "LocalRAGCLI",
        help="Path to the LocalRAGCLI binary (see swift_cli/README.md).",
    )
    p.add_argument(
        "--local-model",
        type=Path,
        default=None,
        help=(
            "Path to a Gemma 2 2B GGUF (e.g. gemma-2-2b-it-Q4_K_M.gguf). "
            "Required when --target is mobile or both."
        ),
    )
    p.add_argument(
        "--local-corpus",
        type=Path,
        default=DEFAULT_CORPUS_DIR,
        help="Directory of .txt/.md files to index for mobile RAG runs.",
    )
    p.add_argument(
        "--local-timeout",
        type=int,
        default=600,
        help="Subprocess timeout for LocalRAGCLI (covers model load + all queries).",
    )

    args = p.parse_args()

    judge = Judge(model=args.judge_model, api_key=args.openai_key)
    cases = _load_test_cases(args.test_dir)
    print(f"Loaded {len(cases)} test case(s) from {args.test_dir}.")

    # Stamped subdir so successive runs don't clobber.
    run_stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_dir = args.report_dir / run_stamp
    run_dir.mkdir(parents=True, exist_ok=True)

    target_results: dict[str, tuple[int, int]] = {}

    if args.target in ("web", "both"):
        web = WebRAGAdapter(
            url=args.web_url,
            mode=args.web_mode,
            token=args.web_token,
            timeout_seconds=args.web_timeout,
            # The web adapter falls back to corpus text when the server
            # response is missing chunk content (the current chatqna
            # implementation strips chunks and 401s out to "error"
            # placeholders without auth). The local corpus dir is the
            # same one used for the mobile pipeline.
            corpus_fallback_dir=args.local_corpus,
        )
        target_results["web"] = _run_adapter(
            "web",
            web,
            cases,
            judge,
            run_dir / "web.csv",
        )

    if args.target in ("mobile", "both"):
        if args.local_model is None:
            p.error("--local-model is required when --target is mobile or both")
        local = LocalRAGAdapter(
            cli_binary=args.local_cli,
            model_path=args.local_model,
            corpus_dir=args.local_corpus,
            timeout_seconds=args.local_timeout,
        )
        target_results["mobile"] = _run_adapter(
            "mobile",
            local,
            cases,
            judge,
            run_dir / "mobile.csv",
        )

    return _summarise(target_results)


if __name__ == "__main__":
    sys.exit(main())
