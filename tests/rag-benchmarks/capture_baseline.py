#!/usr/bin/env python3
# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Multi-run RAG-parity baseline capture driver (v1.3 baseline).

Runs the existing eval harness N times and emits a committed baseline artifact
with, per metric, a ``min / median / max`` triple, a variance-derived parity
tolerance, and a resolved-config snapshot.

The driver REUSES the harness (``run_eval.py anchor`` for the deterministic
anchor path, ``run_ragas_eval.py`` for the semantic path) via subprocess — it
does NOT fork the harness. Identity stays content-based (see ``chunk_identity``).

Run ON the swarm node where the v1.3 stack is deployed, with the same env the
eval harness needs (``CHATQNA_CONTAINER``, ``VICTORIATRACES_SVC``,
``CHATQNA_SERVICE_NAME``). Observability must be ON
(``ENABLE_OBSERVABILITY=1``) or every trace is missed and nothing scores.

Artifact schema (committed as ``rag-baseline-v1.3.json``)::

    {
      "artifact": "rag-baseline",
      "version": "1.0.0",
      "baseline_stack": "v1.3",
      "capture_date": "...",
      "git": {...},                       # repo identity of the eval harness
      "stack": {...},                     # container/image/digest per service
      "runs": {"mode": "anchor", "n": N, "seed": S, "temperature": 0, ...},
      "anchor": {
        "per_run": [...],                 # one aggregate per run
        "metrics": { "<metric>": {min, median, max, mad, tol_low, tol_high,
                                  parity_bound}, ... },
        "tolerance_formula": "..."
      },
      "semantic": {...},                  # optional, variance recorded separately
      "config_snapshot": {
        "resolved": {...},                # values read from the LIVE containers
        "reranker_top_n": { "resolved": 3, "code_chatqna": 3, ... , "homes_agree": true },
        "reranking_strategy": {...},
        "graph": {...}
      }
    }

Usage::

    python3 capture_baseline.py --runs 3 --seed 42 --gold gold_dataset.json --out rag-baseline.json
    python3 capture_baseline.py --runs 3 --seed 42 --gold gold_dataset.json --out rag-baseline.json --semantic --stack release-el-salvador
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import statistics
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Metrics where a LOWER value is the parity-relevant regression signal.
LOWER_IS_BETTER = ("recall", "precision", "complete_recall", "retrieval_recall")
# Metrics where a HIGHER value is the parity-relevant regression signal.
UPPER_IS_BETTER = ("noise",)

# Env vars snapshotted from the LIVE service containers (resolved values,
# not placeholders). Grouped by the service whose env carries them.
SERVICE_ENV_VARS = {
    "chatqna": (
        "RERANKER_TOP_N",
        "RERANKING_STRATEGY",
        "RERANKING_THRESHOLD",
        "RETRIEVER_ARANGO_K",
        "RETRIEVER_ARANGO_FETCH_K",
        "RETRIEVER_ARANGO_SEARCH_START",
        "RETRIEVER_ARANGO_TRAVERSAL_ENABLED",
        "RETRIEVER_ARANGO_LAMBDA_MULT",
        "ARANGO_GRAPH_NAME",
    ),
    "embedding": ("EMBEDDING_MODEL_ID", "EMBEDDING_DIM"),
    "reranker": ("RERANKER_MODEL_ID", "RERANKING_STRATEGY", "RERANKER_TOP_N"),
    "dataprep": ("VLLM_LLM_MODEL_ID",),
}

# Image-name substrings used to resolve each service container on the swarm node.
SERVICE_IMAGE_MARKERS = {
    "chatqna": ("chatqna",),
    "reranker": ("reranker",),
    "retriever": ("retriever",),
    "embedding": ("embedding",),
    "dataprep": ("dataprep",),
    "translation": ("translation",),
}

# Code defaults (the "code home" of each param). Paths are repo-relative.
RERANKER_TOP_N_CODE_FILES = (
    "genie-ai-overlay/chatqna/genieai_chatqna.py",
    "genie-ai-overlay/reranker/genieai_tei_reranker.py",
)
RERANKING_STRATEGY_CODE_FILES = (
    "genie-ai-overlay/chatqna/genieai_chatqna.py",
    "genie-ai-overlay/reranker/genieai_reranking_microservice.py",
)

# Default may be a quoted string ("slice") or an unquoted number (int(os.getenv(..., 3))).
_GETENV_DEFAULT_RE = re.compile(
    r'os\.getenv\(\s*["\']([A-Z0-9_]+)["\']\s*,\s*(?:["\']([^"\']*)["\']|([0-9]+(?:\.[0-9]+)?))\s*\)'
)


# ---------------------------------------------------------------------------
# Pure statistics (tested directly — no live stack required)
# ---------------------------------------------------------------------------


def median(values: list[float]) -> float:
    return float(statistics.median(values))


def mad(values: list[float]) -> float:
    """Median absolute deviation (scaled by 1.4826 for a MAD·sigma estimate)."""
    med = statistics.median(values)
    return float(statistics.median(abs(v - med) for v in values))


def compute_triples(values: list[float], k: float = 3.0) -> dict:
    """Per-metric min / median / max + MAD + median ± k·MAD tolerance.

    The tolerance is DERIVED FROM THE BASELINE'S OWN run-to-run variance, not a
    guess (AC:4). ``tol_low``/``tol_high`` bound the parity window; the
    parity-relevant side is reported separately by the caller via
    ``parity_bound`` so Story 3.1 can check the right inequality.
    """
    values = [float(v) for v in values]
    if not values:
        raise ValueError("compute_triples requires at least one value")
    med = median(values)
    m = mad(values)
    return {
        "min": min(values),
        "median": med,
        "max": max(values),
        "mad": m,
        "tol_low": max(0.0, med - k * m),
        "tol_high": min(1.0, med + k * m),
    }


def metric_triples(per_run: list[dict], k: float = 3.0) -> dict:
    """Turn a list of per-run aggregate dicts into per-metric triples.

    The parity-relevant bound is recorded explicitly (``parity_bound``) so the
    downstream parity eval applies the correct one-sided inequality.
    """
    keys = list(per_run[0].keys()) if per_run else []
    result = {}
    for key in keys:
        if key == "n":
            continue
        values = [r[key] for r in per_run]
        t = compute_triples(values, k=k)
        if key in LOWER_IS_BETTER:
            t["parity_bound"] = "low"
        elif key in UPPER_IS_BETTER:
            t["parity_bound"] = "high"
        else:
            t["parity_bound"] = "low"
        result[key] = t
    return result


def tolerance_formula(k: float) -> str:
    return f"median ± {k:g}·MAD (1.4826-scaled median absolute deviation); parity-relevant bound is tol_low for {', '.join(LOWER_IS_BETTER)} (lower is worse) and tol_high for {', '.join(UPPER_IS_BETTER)} (higher is worse)."


# ---------------------------------------------------------------------------
# Config snapshot
# ---------------------------------------------------------------------------


def _run(cmd: list[str], timeout: float = 60) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return result.stdout


def _docker_exec(container: str, cmd: str, timeout: float = 60) -> str:
    result = subprocess.run(
        ["docker", "exec", container, "sh", "-c", cmd],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"docker exec {container} failed: {result.stderr.strip()[:300]}"
        )
    return result.stdout


def resolve_containers() -> dict[str, dict]:
    """Map service → {container, image} for every GENIE.AI OPEA service.

    Resolves the dynamic Swarm replica suffix live via ``docker ps`` and matches
    by image-name substring (never hardcoded container names).
    """
    out = _run(
        ["docker", "ps", "--format", "{{.Names}}\t{{.Image}}"],
        timeout=30,
    )
    rows = [line.split("\t") for line in out.splitlines() if "\t" in line]
    services: dict[str, dict] = {}
    for service, markers in SERVICE_IMAGE_MARKERS.items():
        for name, image in rows:
            if any(m in image for m in markers):
                services.setdefault(service, {"container": name, "image": image})
                break
    return services


def _image_digest(container: str) -> str:
    """Resolve the image ID (sha256) backing a container — the practical digest."""
    return _run(
        ["docker", "inspect", "--format", "{{.Image}}", container], timeout=30
    ).strip()


def snapshot_stack(containers: dict[str, dict]) -> dict:
    stack = {}
    for service, info in containers.items():
        entry = {"container": info["container"], "image": info["image"]}
        try:
            entry["image_id"] = _image_digest(info["container"])
        except (subprocess.SubprocessError, RuntimeError):
            entry["image_id"] = None
        stack[service] = entry
    return stack


def parse_env_lines(output: str) -> dict[str, str]:
    """Parse ``KEY=value`` lines (e.g. from ``env | grep``) into a dict."""
    resolved: dict[str, str] = {}
    for line in output.splitlines():
        if "=" in line:
            key, _, value = line.partition("=")
            resolved[key] = value
    return resolved


def env_grep_cmd(keys) -> str:
    """Build ``env | grep '^(KEY1|KEY2|...)= '`` — emits only ``KEY=value`` lines.

    ``printenv KEY`` would print the bare VALUE (no ``=``), which the parser
    can't attribute to a key — ``env | grep`` keeps the KEY= prefix. ``|| true``
    swallows grep's exit-1-on-no-match so a container holding none of the
    requested keys is NOT misreported as an exec failure.
    """
    return "env | grep -E '^(" + "|".join(keys) + ")=' || true"


def snapshot_resolved_env(containers: dict[str, dict]) -> dict:
    """Read the RESOLVED values out of the live containers (docker exec).

    This is the "exact env under test, resolved values, not placeholders"
    requirement (AC:5). A var is recorded only when the container actually holds
    it; missing vars are reported so the operator can investigate drift.
    """
    resolved: dict[str, str] = {}
    missing: list[str] = []
    for service, keys in SERVICE_ENV_VARS.items():
        info = containers.get(service)
        if not info:
            missing.extend(keys)
            continue
        try:
            body = _docker_exec(
                info["container"],
                env_grep_cmd(keys),
                timeout=30,
            )
        except (subprocess.SubprocessError, RuntimeError):
            missing.extend(keys)
            continue
        resolved.update(parse_env_lines(body))
    return {"values": resolved, "missing": sorted(set(missing))}


def _parse_code_default(path: Path, env_var: str) -> str | None:
    """Extract the ``os.getenv(ENV_VAR, "<default>")`` default from a repo file."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    for m in _GETENV_DEFAULT_RE.finditer(text):
        if m.group(1) == env_var:
            return m.group(2) if m.group(2) is not None else m.group(3)
    return None


def _parse_compose_default(compose_path: Path, env_var: str) -> str | None:
    """Extract ``${ENV_VAR:-default}`` from a docker-compose file (first hit)."""
    try:
        text = compose_path.read_text(encoding="utf-8")
    except OSError:
        return None
    m = re.search(rf"\${{{env_var}:-([^}}]+)}}", text)
    return m.group(1).strip() if m else None


def snapshot_homes(repo_root: Path, compose_path: Path | None, resolved: dict) -> dict:
    """Record the three homes of RERANKER_TOP_N / RERANKING_STRATEGY.

    Homes: code (per service file), docker-compose, env template (the committed
    ``env`` at repo root). The env template value is a commented hint; the
    RESOLVED value comes from the live container (see snapshot_resolved_env)
    and is passed in by the caller so this function stays pure/testable.
    """

    def code_values(files, var):
        out = {}
        for rel in files:
            v = _parse_code_default(repo_root / rel, var)
            if v is not None:
                out[rel] = v
        return out

    env_tpl = repo_root / "env"

    def env_template_value(var):
        try:
            for line in env_tpl.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if stripped.startswith("#"):
                    stripped = stripped[1:].strip()
                if stripped.startswith(var + "="):
                    value = stripped.partition("=")[2].strip()
                    # Drop any trailing inline comment ("3  # chunks kept ...").
                    value = value.split("#", 1)[0].strip()
                    return value or None
        except OSError:
            return None
        return None

    def summarize(var, code_files, resolved):
        homes = {
            "code": code_values(code_files, var),
            "compose": _parse_compose_default(compose_path, var)
            if compose_path
            else None,
            "env_template": env_template_value(var),
        }
        unique = {
            v
            for v in list(homes["code"].values())
            + [homes["compose"], homes["env_template"]]
            if v is not None
        }
        return {
            "homes": homes,
            "resolved": resolved.get(var),
            "homes_agree": len(unique) <= 1,
        }

    return {
        "reranker_top_n": summarize(
            "RERANKER_TOP_N", RERANKER_TOP_N_CODE_FILES, resolved
        ),
        "reranking_strategy": summarize(
            "RERANKING_STRATEGY", RERANKING_STRATEGY_CODE_FILES, resolved
        ),
    }


# ---------------------------------------------------------------------------
# Harness reuse (subprocess — do NOT fork)
# ---------------------------------------------------------------------------


def eval_dir() -> Path:
    return Path(__file__).resolve().parent / "eval"


def harness_sha() -> str:
    """sha256 over the eval scripts — stable harness identity for the artifact.

    Used instead of git commit because the eval dir is rsynced to the swarm node
    and may not carry a git checkout there.
    """
    h = hashlib.sha256()
    for path in sorted(eval_dir().glob("*.py")):
        h.update(path.name.encode())
        h.update(path.read_bytes())
    return h.hexdigest()


def _run_anchor_eval(
    gold: Path, out: Path, seed: int, env_extra: dict | None = None
) -> dict:
    """Run ``run_eval.py anchor`` once; return the parsed report dict."""
    env = dict(os.environ)
    env.setdefault("PYTHONHASHSEED", str(seed))
    env.update(env_extra or {})
    result = subprocess.run(
        [sys.executable, "run_eval.py", "anchor", str(gold), str(out)],
        cwd=str(eval_dir()),
        capture_output=True,
        text=True,
        timeout=3600,
        env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"run_eval.py anchor failed: {result.stderr.strip()[:500]}")
    with open(out) as fh:
        return json.load(fh)


def capture_anchor(runs: int, gold: Path, out_dir: Path, seed: int) -> dict:
    """Run the anchor eval ``runs`` times; return per-run aggregates + trace misses."""
    out_dir.mkdir(parents=True, exist_ok=True)
    per_run = []
    n_missed_total = 0
    for i in range(1, runs + 1):
        tmp = out_dir / f"anchor_run_{i}.json"
        report = _run_anchor_eval(gold, tmp, seed)
        per_run.append({"run": i, "aggregate": report.get("aggregate", {})})
        n_missed_total += int(report.get("n_missed_traces", 0))
    return {"per_run": per_run, "n_missed_traces_total": n_missed_total}


def capture_semantic(gold: Path, out_dir: Path, seed: int, runs: int) -> dict:
    """Optional semantic path: dump-tuples → run_ragas_eval.py (external LLM judge).

    Variance is RECORDED SEPARATELY and excluded from the anchor tolerance (the
    LLM judge is not perfectly reproducible even seeded — Dev Notes AC:2).
    Returns ``{"skipped": true, "reason": ...}`` when the judge is unconfigured.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    if not (os.getenv("EVAL_JUDGE_BASE_URL") and os.getenv("EVAL_JUDGE_MODEL")):
        return {
            "skipped": True,
            "reason": "EVAL_JUDGE_BASE_URL / EVAL_JUDGE_MODEL not set",
        }

    env = dict(os.environ)
    env.setdefault("PYTHONHASHSEED", str(seed))
    env.setdefault("EVAL_JUDGE_TEMPERATURE", "0")

    # dump-tuples on the node, then judge locally (run_ragas_eval.py runs anywhere).
    tuples_path = out_dir / "eval_tuples.json"
    subprocess.run(
        [sys.executable, "run_eval.py", "dump-tuples", str(gold), str(tuples_path)],
        cwd=str(eval_dir()),
        capture_output=True,
        text=True,
        timeout=3600,
        env=env,
        check=True,
    )
    per_run = []
    for i in range(1, runs + 1):
        tmp = out_dir / f"ragas_run_{i}.json"
        subprocess.run(
            [sys.executable, "run_ragas_eval.py", str(tuples_path), str(tmp)],
            cwd=str(eval_dir()),
            capture_output=True,
            text=True,
            timeout=3600,
            env=env,
            check=True,
        )
        with open(tmp) as fh:
            report = json.load(fh)
        per_run.append({"run": i, "aggregate": report.get("aggregate", {})})

    agg = per_run[0]["aggregate"] if per_run else {}
    keys = [k for k in agg.keys() if k not in ("n", "model")]
    return {
        "mode": "ragas",
        "judge_model": os.getenv("EVAL_JUDGE_MODEL"),
        "temperature": 0,
        "per_run": per_run,
        "metrics": {
            k: compute_triples([r["aggregate"].get(k) for r in per_run]) for k in keys
        },
        "note": "Semantic variance is recorded separately and NOT used for the parity tolerance.",
    }


# ---------------------------------------------------------------------------
# Artifact assembly
# ---------------------------------------------------------------------------


def git_identity(repo_root: Path) -> dict:
    branch = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], timeout=10).strip()
    commit = _run(["git", "rev-parse", "HEAD"], timeout=10).strip()
    status = _run(["git", "status", "--porcelain"], timeout=10).strip()
    return {
        "branch": branch or "unknown",
        "commit": commit or "unknown",
        "tree_clean": not bool(status),
    }


def build_artifact(
    *,
    stack_name: str,
    seed: int,
    runs: int,
    gold_path: str,
    anchor: dict,
    semantic: dict,
    config_snapshot: dict,
    stack: dict,
    repo_root: Path,
    k: float,
    semantic_enabled: bool,
) -> dict:
    per_run = anchor["per_run"]
    aggregates = [r["aggregate"] for r in per_run]
    metrics = metric_triples(aggregates, k=k) if aggregates else {}
    return {
        "artifact": "rag-baseline",
        "version": "1.0.0",
        "baseline_stack": "v1.3",
        "capture_date": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "git": git_identity(repo_root),
        "harness_sha": harness_sha(),
        "stack": {"name": stack_name, "services": stack},
        "runs": {
            "mode": "anchor",
            "n": runs,
            "seed": seed,
            "temperature": 0,
            "gold_dataset": gold_path,
            "semantic_enabled": semantic_enabled,
        },
        "anchor": {
            "per_run": per_run,
            "metrics": metrics,
            "tolerance_formula": tolerance_formula(k),
            "n_missed_traces_total": anchor.get("n_missed_traces_total", 0),
        },
        "semantic": semantic,
        "config_snapshot": config_snapshot,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Multi-run RAG-parity baseline capture (v1.3). Reuses the eval harness.",
    )
    p.add_argument(
        "--runs",
        type=int,
        required=True,
        help="Number of anchor runs (>=3 recommended)",
    )
    p.add_argument(
        "--seed", type=int, required=True, help="Fixed seed for deterministic runs"
    )
    p.add_argument("--gold", required=True, help="Path to gold_dataset.json")
    p.add_argument(
        "--out",
        required=True,
        help="Output baseline artifact path (rag-baseline-v1.3.json)",
    )
    p.add_argument(
        "--semantic", action="store_true", help="Also run the LLM-judged semantic path"
    )
    p.add_argument(
        "--stack", default="", help="Stack identity label, e.g. release-el-salvador"
    )
    p.add_argument(
        "--compose",
        default=None,
        help="Path to docker-compose.yaml (for compose-default homes)",
    )
    p.add_argument(
        "--tolerance-k",
        type=float,
        default=3.0,
        help="MAD multiplier for the parity tolerance (default 3)",
    )
    p.add_argument(
        "--semantic-runs",
        type=int,
        default=0,
        help="Semantic runs (default: same as --runs)",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.runs < 1:
        print("--runs must be >= 1", file=sys.stderr)
        return 2

    repo_root = Path(__file__).resolve().parent.parent.parent
    gold = Path(args.gold).resolve()
    if not gold.is_file():
        print(f"gold dataset not found: {gold}", file=sys.stderr)
        return 2
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    containers = resolve_containers()
    stack = snapshot_stack(containers)
    resolved_env = snapshot_resolved_env(containers)
    homes = snapshot_homes(
        repo_root,
        Path(args.compose).resolve() if args.compose else None,
        resolved_env["values"],
    )

    anchor = capture_anchor(args.runs, gold, out.parent, args.seed)
    semantic_runs = args.semantic_runs or args.runs
    semantic = (
        capture_semantic(gold, out.parent, args.seed, semantic_runs)
        if args.semantic
        else {"skipped": True, "reason": "--semantic not requested"}
    )

    artifact = build_artifact(
        stack_name=args.stack,
        seed=args.seed,
        runs=args.runs,
        gold_path=args.gold,
        anchor=anchor,
        semantic=semantic,
        config_snapshot={"resolved": resolved_env, "homes": homes},
        stack=stack,
        repo_root=repo_root,
        k=args.tolerance_k,
        semantic_enabled=args.semantic,
    )
    with open(out, "w") as fh:
        json.dump(artifact, fh, indent=2)
        fh.write("\n")

    print(f"Baseline artifact → {out}", file=sys.stderr)
    print(f"  anchor runs: {args.runs}, seed: {args.seed}", file=sys.stderr)
    for key, tri in artifact["anchor"]["metrics"].items():
        print(
            f"  {key:20s} min={tri['min']:.3f} median={tri['median']:.3f} max={tri['max']:.3f} "
            f"tol=[{tri['tol_low']:.3f},{tri['tol_high']:.3f}] ({tri['parity_bound']})",
            file=sys.stderr,
        )
    if semantic.get("skipped"):
        print(f"  semantic: skipped ({semantic.get('reason')})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
