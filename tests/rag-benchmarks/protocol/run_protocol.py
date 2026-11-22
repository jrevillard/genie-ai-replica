#!/usr/bin/env python3
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The evaluation-protocol CLI (story 4.1) — the harness's operator surface.

Subcommands (the eval toolchain's argparse conventions; all live-venue
commands print their refusal reasons and exit nonzero — the gate and the
reuse check REFUSE, they never warn)::

    validate-set <set_path> [--kind assessment|tuning]
        Validate a set file's schema, composition and provenance separation.

    reference --set <set_path> --out-dir <dir> [--corpus-collection NAME]
        [--corpus-graph NAME] [--corpus-fingerprint HEX | --compute-fingerprint]
        [--models-endpoint URL] [--stack-prefix PREFIX] [--resolved-env PATH]
        [--seed N]
        The A-ONLY reference run (never gated): anchor eval over the set,
        then the reference manifest with the full version record.

    assess --config B|C --set <set_path> --out-dir <dir> [gate + run + manifest
        args]
        The gated B/C run: the partial-order gate FIRST (refusing names the
        missing predecessor and no query runs), then the driver, then the
        gated manifest chaining reference + thresholds digests.

    check-reuse --artifact <baseline.json> [--gold PATH] [--stack NAME]
        The suitability report over a capture artifact; nonzero exit on any
        mismatch. There is no override.

Exit codes: 0 success; 1 a typed refusal / validation failure; 2 usage.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__ in (None, ""):  # executed as a script: make the package importable
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from protocol.drivers import (  # noqa: E402
    DriverError,
    discover_model_ids,
    run_config_a,
    run_config_b,
    run_config_c,
)
from protocol.evalset import SetValidationError, load_set  # noqa: E402
from protocol.gate import GateRefusal, check_gated_run  # noqa: E402
from protocol.manifest import (  # noqa: E402
    ManifestError,
    build_manifest,
    fingerprint_corpus,
    sha256_file,
)
from protocol.pairs import CONFIG_PAIR, PairError, check_run_against_pair  # noqa: E402
from protocol.reuse import ReuseRefusal, check_capture_artifact  # noqa: E402

EVALUATOR_INSTRUCTIONS = Path(__file__).resolve().parent / "evaluator-instructions.md"


def cmd_validate_set(args: argparse.Namespace) -> int:
    try:
        _, entries = load_set(args.set_path, args.kind)
    except SetValidationError as failed:
        print(f"INVALID: {args.set_path}", file=sys.stderr)
        for error in failed.errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print(f"OK: {args.set_path} ({len(entries)} case(s))")
    return 0


def _corpus_fingerprint(args: argparse.Namespace) -> str:
    """The corpus fingerprint: --compute-fingerprint collects the source
    collection's content hashes live (the anchor machinery's collector),
    --corpus-fingerprint pins an explicit one."""
    if args.corpus_fingerprint:
        return args.corpus_fingerprint
    if not args.compute_fingerprint:
        raise SystemExit(
            "one of --corpus-fingerprint / --compute-fingerprint is required "
            "(the corpus identity is versioned, never assumed)"
        )
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "eval"))
    import run_eval  # local import: the live-stack collector

    hashes = sorted(set(run_eval.build_key_to_content_hash().values()))
    return fingerprint_corpus(args.corpus_collection, hashes)


def _resolved_configuration(args: argparse.Namespace, config: str, driver_resolved: dict | None = None) -> dict:
    """The per-config resolved snapshot for the manifest, with an EXPLICIT
    precedence: the operator's pinned file (--resolved-env) wins; config B's
    in-container record (the serving container's own env) comes next; the
    config A live container snapshot (--stack-prefix) after. The recorded
    source is declared by the precedence, never by which value happened to be
    non-empty."""
    if args.resolved_env:
        snapshot = json.loads(Path(args.resolved_env).read_text(encoding="utf-8"))
    elif config == "B" and isinstance((driver_resolved or {}).get("env"), dict) and driver_resolved["env"]:
        snapshot = driver_resolved["env"]
    elif config == "A" and args.stack_prefix is not None:
        import capture_baseline  # local import: the live snapshot machinery

        containers = capture_baseline.resolve_containers(args.stack_prefix)
        snapshot = capture_baseline.snapshot_resolved_env(containers)["values"]
    else:
        snapshot = {}
    return {"resolved_env": snapshot, "model_ids": {}, "prompt_digests": {}}


def _model_ids(args: argparse.Namespace) -> dict:
    if not args.models_endpoint:
        return {}
    return discover_model_ids(args.models_endpoint)


def _write_manifest(out_dir: Path, name: str, manifest: dict) -> Path:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "eval"))
    from harness import write_json  # the eval toolchain's atomic JSON IO

    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    write_json(path, manifest, ensure_ascii=False)
    return path


def _validated_entries(args: argparse.Namespace) -> int | None:
    """Validate the set where the RUN happens (not only in validate-set), as
    an ASSESSMENT set: the composition floor AND the provenance separation are
    enforced before hashing/running — a tuning set never produces reference or
    gated evidence. Returns the exit code when the set is invalid, None when
    it passes."""
    try:
        load_set(args.set_path, kind="assessment")
    except SetValidationError as failed:
        print(f"REFUSED: {args.set_path}: {failed}", file=sys.stderr)
        for error in failed.errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    return None


def _corpus_record(args: argparse.Namespace, fingerprint: str) -> dict:
    """The corpus record both commands stamp into their manifests."""
    return {
        "source_collection": args.corpus_collection,
        "arango_graph_name": args.corpus_graph,
        "fingerprint": fingerprint,
    }


def _check_pair_or_fail(manifest: dict) -> int | None:
    """The manifest stamp verification against the shipped pair conditions;
    the exit code on a failure, None when the stamp verifies."""
    errors = check_run_against_pair(manifest)
    if errors:
        for error in errors:
            print(f"pair check failed: {error}", file=sys.stderr)
        return 1
    return None


def cmd_reference(args: argparse.Namespace) -> int:
    """The A-only reference run: anchor eval + reference manifest. NEVER gated."""
    refused = _validated_entries(args)
    if refused is not None:
        return refused
    fingerprint = _corpus_fingerprint(args)
    configuration = _resolved_configuration(args, "A")
    configuration["model_ids"] = _model_ids(args)
    result = run_config_a(args.set_path, args.out_dir, seed=args.seed)
    manifest = build_manifest(
        kind="reference",
        config="A",
        corpus=_corpus_record(args, fingerprint),
        sets={
            "assessment": {
                "path": str(args.set_path),
                "sha256": sha256_file(args.set_path),
            }
        },
        configuration={"A": configuration},
        evaluator_instructions_path=args.evaluator_instructions,
        pair=CONFIG_PAIR["A"],
    )
    pair_failed = _check_pair_or_fail(manifest)
    if pair_failed is not None:
        return pair_failed
    path = _write_manifest(Path(args.out_dir), "reference.manifest.json", manifest)
    print(f"reference run: report {result['report_path']}")
    print(f"reference manifest: {path}")
    return 0


def cmd_assess(args: argparse.Namespace) -> int:
    """The gated B/C run: the set validated, then the gate (a refusal means no
    query ran), then the driver, then the gated manifest chaining the lineage."""
    config = args.config
    refused = _validated_entries(args)
    if refused is not None:
        return refused
    fingerprint = _corpus_fingerprint(args)
    set_sha256 = sha256_file(args.set_path)
    # THE GATE — before any query runs.
    try:
        lineage = check_gated_run(
            run_dir=args.out_dir,
            corpus_fingerprint=fingerprint,
            assessment_set_sha256=set_sha256,
            config=config,
        )
    except GateRefusal as refused:
        print(f"REFUSED: {refused}", file=sys.stderr)
        return 1
    print(
        f"gate passed: reference {lineage['reference_manifest_sha256'][:12]}, "
        f"thresholds {lineage['thresholds_sha256'][:12]}"
    )
    if config == "B":
        result = run_config_b(args.set_path, args.out_dir, container=args.container)
        rows = result["rows"]
    else:
        if not args.base_url:
            print("--base-url is required for a config C assess run", file=sys.stderr)
            return 2
        result = run_config_c(args.set_path, args.out_dir, base_url=args.base_url, deadline_ms=args.deadline_ms)
        rows = result["rows"]
    configuration = _resolved_configuration(args, config, result.get("resolved"))
    model_ids = _model_ids(args)
    resolved = result.get("resolved") or {}
    if not model_ids and isinstance(resolved.get("model_id"), str):
        model_ids = {"llm": resolved["model_id"]}
    configuration["model_ids"] = model_ids
    manifest = build_manifest(
        kind="gated",
        config=config,
        corpus=_corpus_record(args, fingerprint),
        sets={
            "assessment": {"path": str(args.set_path), "sha256": set_sha256},
        },
        configuration={config: configuration},
        evaluator_instructions_path=args.evaluator_instructions,
        lineage=lineage,
        pair=CONFIG_PAIR[config],
    )
    pair_failed = _check_pair_or_fail(manifest)
    if pair_failed is not None:
        return pair_failed
    path = _write_manifest(Path(args.out_dir), f"config-{config.lower()}.manifest.json", manifest)
    # Config C rows carry `outcome`, config B rows carry `status` (ok|failure) —
    # read whichever the row has, so a B failure never prints as 0 non-answered.
    n_failure = sum(1 for row in rows.values() if row.get("outcome", row.get("status")) not in (None, "answered", "ok"))
    print(f"gated run: {len(rows)} case(s) recorded ({n_failure} non-answered outcome(s))")
    print(f"gated manifest: {path}")
    return 0


def cmd_check_reuse(args: argparse.Namespace) -> int:
    """The suitability report over a capture artifact; nonzero on any mismatch."""
    artifact = json.loads(Path(args.artifact).read_text(encoding="utf-8"))
    checks = {}
    if args.gold:
        from protocol.reuse import current_gold_sha256

        checks["gold_sha256"] = current_gold_sha256(args.gold)
    if args.harness_sha:
        checks["harness_sha"] = args.harness_sha
    if args.stack:
        checks["expected_stack"] = args.stack
    if not checks:
        from protocol.reuse import current_harness_sha

        checks["harness_sha"] = current_harness_sha()
    report = check_capture_artifact(artifact, **checks)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if not report["suitable"]:
        print(f"REFUSED: {args.artifact} is not current evidence (no override; re-capture)", file=sys.stderr)
        return 1
    print(f"SUITABLE: {args.artifact} matches the current harness/gold/stack identity")
    return 0


def _add_common_manifest_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--corpus-collection", required=True, help="the corpus source collection name")
    p.add_argument("--corpus-graph", default="", help="the ArangoDB graph name (recorded)")
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--corpus-fingerprint", help="the pinned corpus fingerprint")
    group.add_argument(
        "--compute-fingerprint",
        action="store_true",
        help="collect the source collection's content hashes live (needs the eval env)",
    )
    p.add_argument("--models-endpoint", default=None, help="the serving endpoint to read model ids from")
    p.add_argument("--resolved-env", default=None, help="a pinned resolved-env snapshot JSON (per config)")
    p.add_argument(
        "--evaluator-instructions",
        default=str(EVALUATOR_INSTRUCTIONS),
        help="the versioned evaluator-instructions file (digested by the manifest)",
    )


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="run_protocol.py", description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="command", required=True)

    v = sub.add_parser("validate-set", help="validate a set file")
    v.add_argument("set_path")
    v.add_argument("--kind", choices=("assessment", "tuning"), default=None)
    v.set_defaults(func=cmd_validate_set)

    r = sub.add_parser("reference", help="the A-only reference run (never gated)")
    r.add_argument("--set", dest="set_path", required=True)
    r.add_argument("--out-dir", required=True)
    r.add_argument("--seed", type=int, default=0)
    r.add_argument("--stack-prefix", default=None, help="live resolved-env snapshot prefix (config A)")
    _add_common_manifest_args(r)
    r.set_defaults(func=cmd_reference)

    a = sub.add_parser("assess", help="the gated B/C run")
    a.add_argument("--config", required=True, choices=("B", "C"))
    a.add_argument("--set", dest="set_path", required=True)
    a.add_argument("--out-dir", required=True)
    a.add_argument("--container", default="agent-service", help="the agent-service container (config B)")
    a.add_argument("--base-url", default=None, help="the agent-service base URL (config C)")
    a.add_argument("--deadline-ms", type=int, default=600_000, help="the run's agent-phase deadline (config C)")
    _add_common_manifest_args(a)
    a.set_defaults(func=cmd_assess)

    c = sub.add_parser("check-reuse", help="the suitability report over a capture artifact")
    c.add_argument("--artifact", required=True)
    c.add_argument("--gold", default=None, help="the current gold dataset (hashed live)")
    c.add_argument("--harness-sha", default=None, help="an explicit harness identity (else computed live)")
    c.add_argument("--stack", default=None, help="the expected stack identity")
    c.set_defaults(func=cmd_check_reuse)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (GateRefusal, ReuseRefusal, SetValidationError, DriverError, ManifestError, PairError) as refused:
        print(f"REFUSED: {refused}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
