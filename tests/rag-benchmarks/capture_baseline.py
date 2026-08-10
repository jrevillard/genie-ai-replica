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
      "runs": {"mode": "anchor", "n": N, "seed": S, "temperature": 0,
               "gold_sha256": "...", ...},
      "anchor": {
        "per_run": [...],                 # one aggregate per run
        "metrics": { "<metric>": {min, median, max, mad, tol_low, tol_high,
                                  parity_bound}, ... },
        "tolerance_formula": "...",
        "tolerance_semantics": "...",     # set when MAD == 0 (exact-equality)
      },
      "semantic": {...},                  # optional, variance recorded separately
      "config_snapshot": {
        "resolved": {...},                # values read from the LIVE containers
        "unresolved": [...],              # declared keys absent from every container
        "homes": {...},                   # code/compose/env-template three homes
        "graph": {...},                   # from gold _meta (driver-produced)
        "model_pins": {...}               # from gold _meta (driver-produced)
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
import shutil
import statistics
import subprocess
import sys
import tempfile
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
    "translation": ("VLLM_TRANSLATION_MODEL_ID",),
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
    return float(statistics.median(abs(v - med) for v in values)) * 1.4826


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
    keys = sorted({k for r in per_run for k in r.keys()}) if per_run else []
    result = {}
    for key in keys:
        if key == "n":
            continue
        # metrics.aggregate drops retrieval_recall unless EVERY row carries it,
        # so a run may legitimately omit a key — skip it rather than KeyError.
        values = [r[key] for r in per_run if key in r]
        if not values:
            continue
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


def _run(cmd: list[str], timeout: float = 60, cwd: str | None = None) -> str:
    """Run a command and return stdout; RAISES on non-zero exit.

    A non-zero exit is a real failure (docker down, inspect failed, git absent)
    — silently returning partial stdout (e.g. ``""``) made ``image_id`` record
    ``""`` and let empty stack resolution look successful.
    """
    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"command failed ({result.returncode}): {' '.join(cmd)}: "
            f"{result.stderr.strip()[:300]}"
        )
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


def resolve_containers(stack_prefix: str = "") -> dict[str, dict]:
    """Map service → {container, image} for every GENIE.AI OPEA service.

    Resolves the dynamic Swarm replica suffix live via ``docker ps`` and matches
    by image-name substring (never hardcoded container names). ``stack_prefix``
    (e.g. ``genieai-el-salvador_``) disambiguates when a node hosts several
    stacks — docker ps row order is not deterministic, so without it the wrong
    stack's env could be read (AC:5 "the stack under test").
    """
    out = _run(
        ["docker", "ps", "--format", "{{.Names}}\t{{.Image}}"],
        timeout=30,
    )
    rows = [line.split("\t") for line in out.splitlines() if "\t" in line]
    if stack_prefix:
        rows = [r for r in rows if r[0].startswith(stack_prefix)]
    services: dict[str, dict] = {}

    def specificity(name: str, image: str, service: str) -> int:
        # The image marker (e.g. "embedding") matches BOTH the GENIE.AI wrapper
        # (genie-ai-embedding) and the TEI backend (text-embeddings-inference).
        # Prefer the wrapper: genie-ai-<service> image, and penalize TEI images /
        # container names so the resolved env is read from the right container.
        score = 0
        if f"genie-ai-{service}" in image:
            score += 2
        if "text-embeddings" not in image and "tei" not in name.lower():
            score += 1
        return score

    for service, markers in SERVICE_IMAGE_MARKERS.items():
        matched = [
            (name, image) for name, image in rows if any(m in image for m in markers)
        ]
        if not matched:
            continue
        name, image = max(matched, key=lambda r: specificity(r[0], r[1], service))
        services[service] = {"container": name, "image": image}
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
    it. Two distinct non-resolution cases are reported so readers don't conflate
    them:
      - ``missing``: a container was NOT found / its docker exec FAILED
        (infrastructure problem — the stack may be down).
      - ``unresolved``: a declared key was queried but is absent from every
        reachable container's env (e.g. RERANKER_MODEL_ID is baked into the TEI
        entrypoint, not an env var — expected, but recorded for drift checks).
    """
    resolved: dict[str, str] = {}
    missing: list[str] = []
    conflicts: dict[str, list[str]] = {}
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
        # A key declared under several services (e.g. RERANKER_TOP_N under both
        # chatqna and reranker) may differ per container. Record the conflict
        # instead of silently letting the last writer win.
        for key, value in parse_env_lines(body).items():
            if key in resolved and resolved[key] != value:
                conflicts.setdefault(key, []).append(
                    f"{resolved[key]} (earlier service) vs {value}"
                )
            resolved[key] = value
    declared = {k for keys in SERVICE_ENV_VARS.values() for k in keys}
    unresolved = sorted(declared - set(resolved) - set(missing))
    return {
        "values": resolved,
        "missing": sorted(set(missing)),
        "unresolved": unresolved,
        "conflicts": conflicts,
    }


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
            lines = env_tpl.read_text(encoding="utf-8").splitlines()
        except OSError:
            return None
        active = None  # real (non-commented) assignment — wins
        commented = None  # commented hint — fallback only
        for line in lines:
            stripped = line.strip()
            is_comment = stripped.startswith("#")
            candidate = stripped[1:].strip() if is_comment else stripped
            if candidate.startswith(var + "="):
                value = candidate.partition("=")[2].strip().split("#", 1)[0].strip()
                value = value or None
                if is_comment:
                    commented = value
                else:
                    active = value
        return active if active is not None else commented

    def summarize(var, code_files, resolved):
        homes = {
            "code": code_values(code_files, var),
            "compose": _parse_compose_default(compose_path, var)
            if compose_path
            else None,
            "env_template": env_template_value(var),
        }
        # The RESOLVED live value is the single most important datum — include
        # it in the uniqueness set so `homes_agree` is false exactly when the
        # deployed config drifts from the declared homes.
        unique = {
            v
            for v in list(homes["code"].values())
            + [homes["compose"], homes["env_template"], resolved.get(var)]
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


# Committed eval scripts that determine the harness identity (pinned set). A
# stray/uncommitted ``*.py`` on the node must NOT change the recorded sha.
EVAL_IDENTITY_FILES = (
    "arango.py",
    "calibrate.py",
    "chunk_identity.py",
    "dump_chunks.py",
    "metrics.py",
    "run_eval.py",
    "run_ragas_eval.py",
)


def harness_sha() -> str:
    """sha256 over the pinned eval scripts — stable harness identity for the artifact.

    Used instead of git commit because the eval dir is rsynced to the swarm node
    and may not carry a git checkout there. Only the committed, behavior-affecting
    scripts are hashed (test/data files are excluded; the gold is pinned separately).
    """
    h = hashlib.sha256()
    edir = eval_dir()
    for name in sorted(EVAL_IDENTITY_FILES):
        path = edir / name
        h.update(name.encode())
        if path.is_file():
            h.update(path.read_bytes())
        else:
            h.update(b"<missing>")
    return h.hexdigest()


def _run_anchor_eval(
    gold: Path, out: Path, seed: int, env_extra: dict | None = None
) -> dict:
    """Run ``run_eval.py anchor`` once; return the parsed report dict."""
    env = dict(os.environ)
    # FORCE the seed: an ambient PYTHONHASHSEED must not silently override the
    # requested --seed while the artifact records `seed: <requested>`.
    env["PYTHONHASHSEED"] = str(seed)
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


def capture_anchor(
    runs: int,
    gold: Path,
    out_dir: Path,
    seed: int,
    allow_missed_traces: bool = False,
) -> dict:
    """Run the anchor eval ``runs`` times; return per-run aggregates + trace misses.

    Fails FAST: if any run misses a trace (observability off / VT down), raises
    instead of wasting the remaining runs on a doomed zero baseline. Use
    ``allow_missed_traces`` to commit anyway (not recommended).
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    per_run = []
    n_missed_total = 0
    for i in range(1, runs + 1):
        tmp = out_dir / f"anchor_run_{i}.json"
        report = _run_anchor_eval(gold, tmp, seed)
        per_run.append({"run": i, "aggregate": report.get("aggregate", {})})
        n_missed = int(report.get("n_missed_traces", 0))
        n_unmapped = int(report.get("n_unmapped_chunk_keys", 0))
        n_missed_total += n_missed
        if (n_missed > 0 or n_unmapped > 0) and not allow_missed_traces:
            raise RuntimeError(
                f"run {i}: {n_missed} trace(s) missed, {n_unmapped} span chunk "
                "key(s) unmapped (no content-hash map entry — wrong GRAPH_SOURCE? "
                "stale trace?). Refusing to commit a partial/zero baseline. Use "
                "--allow-missed-traces to override."
            )
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

    runs = max(1, runs)
    env = dict(os.environ)
    # FORCE the seed + judge temperature: ambient values must not override the
    # recorded reproducibility contract (seed, temperature 0).
    env["PYTHONHASHSEED"] = str(seed)
    env["EVAL_JUDGE_TEMPERATURE"] = "0"

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

    # Union of metric keys across runs, skipping any key a later run omits
    # (a per-run aggregate may legitimately lack a metric — never float(None)).
    keys = sorted({k for r in per_run for k in r.get("aggregate", {})} - {"n", "model"})
    metrics = {}
    for k in keys:
        values = [r["aggregate"][k] for r in per_run if k in r["aggregate"]]
        if values:
            metrics[k] = compute_triples(values)
    return {
        "mode": "ragas",
        "judge_model": os.getenv("EVAL_JUDGE_MODEL"),
        "temperature": int(env["EVAL_JUDGE_TEMPERATURE"]),
        "per_run": per_run,
        "metrics": metrics,
        "note": "Semantic variance is recorded separately and NOT used for the parity tolerance.",
    }


# ---------------------------------------------------------------------------
# Artifact assembly
# ---------------------------------------------------------------------------


def git_identity(repo_root: Path) -> dict:
    try:
        # Always inspect the REPO's git, not the driver's process cwd (the
        # driver may be rsynced onto a swarm node and run from /tmp).
        branch = _run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            timeout=10,
            cwd=str(repo_root),
        ).strip()
        commit = _run(
            ["git", "rev-parse", "HEAD"], timeout=10, cwd=str(repo_root)
        ).strip()
        status = _run(
            ["git", "status", "--porcelain"], timeout=10, cwd=str(repo_root)
        ).strip()
    except (OSError, subprocess.SubprocessError, RuntimeError):
        # git binary absent, or not a git checkout — record null rather than crash
        # AFTER all N anchor runs (the rsynced eval dir on a swarm node case).
        return {"branch": None, "commit": None, "tree_clean": None}
    if not branch or not commit:
        # Not a git checkout (e.g. the rsynced eval dir on a swarm node).
        return {"branch": None, "commit": None, "tree_clean": None}
    return {
        "branch": branch,
        "commit": commit,
        "tree_clean": not bool(status),
    }


def file_sha256(path: Path) -> str:
    """sha256 of a file — pins the gold dataset (the anchor is code + queries)."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _repo_relative(repo_root: Path, path: Path) -> str:
    """Fallback for ``runs.gold_dataset`` when ``--gold-repo-path`` is not given.

    The node's transient ``--gold`` path is NOT the committed location, so record
    the bare filename (readers locate the exact gold via ``gold_sha256``);
    ``--gold-repo-path`` should be passed to record the committed path."""
    return path.name


def build_artifact(
    *,
    stack_name: str,
    seed: int,
    runs: int,
    gold_path: str,
    gold_sha256: str,
    anchor: dict,
    semantic: dict,
    config_snapshot: dict,
    graph: dict,
    model_pins: dict,
    stack: dict,
    repo_root: Path,
    k: float,
    semantic_enabled: bool,
) -> dict:
    per_run = anchor["per_run"]
    aggregates = [r["aggregate"] for r in per_run]
    metrics = metric_triples(aggregates, k=k) if aggregates else {}
    tolerance_semantics = None
    if metrics and all(t["mad"] == 0 for t in metrics.values()):
        # Document the exact-equality decision explicitly: a deterministic anchor
        # collapses tolerance to the median (MAD=0). Any post-upgrade deviation
        # then FAILS — that is the intended lock, not an accident. Story 3.1 must
        # first re-verify the upgraded stack is itself deterministic (N runs)
        # before trusting a point comparison.
        tolerance_semantics = (
            "MAD == 0 across all metrics: the anchor is fully deterministic "
            "(temperature 0, fixed seed), so the variance-derived tolerance "
            "collapses to exact equality with the median. Parity therefore "
            "means byte-identical metric values. Story 3.1 MUST re-verify the "
            "upgraded stack is itself deterministic (N runs) and MUST NOT use "
            "a one-run-vs-one-run comparison as the parity method — parity is "
            "established by comparing N-run distributions (median +/- tolerance) "
            "captured on each stack."
        )
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
            "gold_sha256": gold_sha256,
            "semantic_enabled": semantic_enabled,
        },
        "anchor": {
            "per_run": per_run,
            "metrics": metrics,
            "tolerance_formula": tolerance_formula(k),
            "tolerance_semantics": tolerance_semantics,
            "n_missed_traces_total": anchor.get("n_missed_traces_total", 0),
        },
        "semantic": semantic,
        "config_snapshot": {
            **config_snapshot,
            "graph": graph,
            "model_pins": model_pins,
        },
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
        "--gold-repo-path",
        default=None,
        help="Repo-relative path of the gold dataset (e.g. "
        "tests/rag-benchmarks/eval/gold_dataset.json). Recorded in the artifact's "
        "runs.gold_dataset so readers can find the COMMITTED gold — the transient "
        "--gold path on the swarm node is not the committed location.",
    )
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
        "--repo-root",
        default=None,
        help="Path to the GENIE.AI repo checkout holding genie-ai-overlay/, env, "
        "docker-compose.yaml (for the code/compose/env homes). Defaults to "
        "auto-detection from this file's location.",
    )
    p.add_argument(
        "--stack-prefix",
        default="",
        help="Container-name prefix to disambiguate the target stack on a "
        "multi-stack node (e.g. genieai-el-salvador_)",
    )
    p.add_argument(
        "--allow-missed-traces",
        action="store_true",
        help="Commit a baseline even when some traces are missed (not recommended "
        "— a zero baseline is the worst failure mode for the reference artifact)",
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
    if args.runs < 3:
        print("--runs must be >= 3 (AC:3 run-triple)", file=sys.stderr)
        return 2

    repo_root = (
        Path(args.repo_root).resolve()
        if args.repo_root
        else Path(__file__).resolve().parent.parent.parent
    )
    gold = Path(args.gold).resolve()
    if not gold.is_file():
        print(f"gold dataset not found: {gold}", file=sys.stderr)
        return 2
    out = Path(args.out).resolve()
    if out == gold:
        print(
            "--out and --gold must differ (writing the artifact would clobber "
            "the pinned gold dataset)",
            file=sys.stderr,
        )
        return 2
    out.parent.mkdir(parents=True, exist_ok=True)

    try:
        containers = resolve_containers(args.stack_prefix)
    except (subprocess.SubprocessError, RuntimeError, OSError) as exc:
        print(f"container resolution failed: {exc}", file=sys.stderr)
        return 2
    if not containers:
        print(
            "no GENIE.AI containers resolved (wrong --stack-prefix? stack down? "
            "docker ps not reachable?) — refusing to write an artifact with an "
            "empty stack identity",
            file=sys.stderr,
        )
        return 2
    stack = snapshot_stack(containers)
    resolved_env = snapshot_resolved_env(containers)
    homes = snapshot_homes(
        repo_root,
        Path(args.compose).resolve()
        if args.compose
        else repo_root / "docker-compose.yaml",
        resolved_env["values"],
    )

    # Per-run reports go to a temp dir — never into the committed artifact dir.
    tmp_capture = Path(tempfile.mkdtemp(prefix="rag-baseline-capture-"))
    try:
        try:
            anchor = capture_anchor(
                args.runs,
                gold,
                tmp_capture,
                args.seed,
                allow_missed_traces=args.allow_missed_traces,
            )
        except RuntimeError as exc:
            print(f"ABORT: {exc}", file=sys.stderr)
            return 2

        semantic_runs = args.semantic_runs or args.runs
        semantic = (
            capture_semantic(gold, tmp_capture, args.seed, semantic_runs)
            if args.semantic
            else {"skipped": True, "reason": "--semantic not requested"}
        )
    finally:
        shutil.rmtree(tmp_capture, ignore_errors=True)

    # Graph + model pins come from the gold dataset's _meta (driver-produced,
    # so the artifact is regenerable from the committed code + gold alone).
    with open(gold) as fh:
        gold_data = json.load(fh)
    meta = gold_data.get("_meta", {})
    graph = {
        "arango_graph_name": meta.get("corpus_snapshot", {}).get("graph", "GRAPH"),
        "source_collection": meta.get("corpus_snapshot", {}).get(
            "source_collection", ""
        ),
    }

    artifact = build_artifact(
        stack_name=args.stack,
        seed=args.seed,
        runs=args.runs,
        gold_path=args.gold_repo_path or _repo_relative(repo_root, gold),
        gold_sha256=file_sha256(gold),
        anchor=anchor,
        semantic=semantic,
        config_snapshot={"resolved": resolved_env, "homes": homes},
        graph=graph,
        model_pins=meta.get("model_pins", {}),
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
