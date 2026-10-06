# Retrieval Evaluation

Two complementary eval paths, fed from **one** query drive through chatqna. Use
both — each catches failures the other can't.

| Path | Command | Trait | Catches |
|---|---|---|---|
| **Deterministic anchor** | `run_eval.py anchor gold.json out.json` | Reproducible, no LLM | "chunk X stopped getting retrieved" (regressions) |
| **Semantic** | `run_eval.py dump-tuples gold.json tuples.json` → `run_ragas_eval.py` | LLM-judged | "answer hallucinated / off-topic despite good chunks" |

`run_eval.py` takes **positional** args (`mode gold_path out_path`) — there is no
`--mode` flag.

## Start here

**`eval/CLAUDE.md`** is the operational entry point (auth requirement, score
threshold, diagnostic mode, scripts inventory, live vs offline).

**`eval/RUNBOOK.md`** is the end-to-end phase-by-phase runbook (Phase 0
pre-flight through Phase 5 failure attribution), including the wrapper
`scripts/run_anchor_with_cleanup.sh` for stack-agnostic anchor runs.

The gold dataset is corpus-independent (built from a benchmark xlsx) — the
same `gold_dataset.json` works against any deployment. Re-run Phases 3+4 to
compare stacks; Phase 1+2 are one-time per benchmark.
