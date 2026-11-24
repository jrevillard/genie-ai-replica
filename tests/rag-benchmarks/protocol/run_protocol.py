#!/usr/bin/env python3
# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The evaluation-protocol CLI — the harness's operator surface.

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

    verdicts --rows <rows.json> --set <set_path> --out <report.json> [--config A|B|C]
        Re-judge stored rows into the findings report without
        re-running: the security verdict layer over the rows a previous run
        wrote.

    capture-a --set <set_path> --out-dir <dir> --corpus-collection NAME
        [--corpus-fingerprint HEX | --compute-fingerprint]
        The per-case config-A answer capture: the E01 judgment
        inputs (answers, http_status, wall_ms, source/citation/abstention
        fields) the anchor path cannot carry. Reuses run_eval's query driver
        verbatim (with the anchor's own bearer refresh). The rows file is
        stamped with the assessment-set digest and the corpus fingerprint it
        ran under; a capture over one set or corpus never resumes into
        another.

    e01 --reference-manifest PATH --gated-manifest PATH --anchor-report PATH
        --captured-rows PATH --b-rows PATH --out PATH [--defects PATH]
        [--created-utc STAMP] [--seed N]
        The E01 comparison report: the digest-pinned A-vs-B join
        into per-dimension M-1..M-5 records. Refuses before building on a
        lineage mismatch, a config-C manifest on the B leg, a missing leg
        artifact or a lineage-mismatched defects ledger.

    thresholds --registry PATH [--reference-manifest PATH] [--out PATH]
        [--report PATH] [--created-utc STAMP]
        The threshold registry's promotion decision: every
        measured dimension with its agreed value or its EXPLICIT absence, and
        the sign-off owner. An absent dimension and an unsigned sign-off block
        promotion exactly like a missing predecessor — a blocked registry
        produces NO signed artifact. Only an allowed promotion derives the
        gate-compatible thresholds artifact FROM the registry.

    counters --reference-rows PATH --candidate-rows PATH --out PATH
        [--reference-manifest PATH] [--correctness-ledger PATH]
        [--created-utc STAMP]
        The counter-metrics report: CM-1 (the per-request
        cost/latency delta against the reference), CM-2 (the excessive-
        abstention rate on the questions the reference answers correctly) and
        CM-3 (the limit/cancellation rate) as first-class, top-level results.
        An absent input is recorded as absent with its reason — a rate is
        never reported as zero where nothing was measured.

Exit codes: 0 success; 1 a typed refusal / validation failure; 2 usage.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if __package__ in (None, ""):  # executed as a script: make the package importable
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from protocol import thresholds as thresholds_mod  # noqa: E402
from protocol import verdicts as verdicts_mod  # noqa: E402
from protocol.counter_metrics import (  # noqa: E402
    CounterMetricsRefusal,
    build_counter_metrics_report,
)
from protocol.drivers import (  # noqa: E402
    DriverError,
    discover_model_ids,
    run_config_a,
    run_config_a_capture,
    run_config_b,
    run_config_c,
)
from protocol.coexistence import CoexistenceRefusal, build_coexistence_report  # noqa: E402
from protocol.e01 import E01Refusal, build_e01_report  # noqa: E402
from protocol.e02 import E02Refusal, build_e02_report  # noqa: E402
from protocol.evalset import SetValidationError, coverage_census, load_set  # noqa: E402
from protocol.findings import build_findings_report, report_digest  # noqa: E402
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
        if not isinstance(snapshot, dict):
            # A JSON array or scalar parses fine and would flow silently into
            # the manifest as resolved_env — provenance garbage the protocol
            # exists to keep honest.
            raise ValueError("the resolved-env snapshot must be a JSON object")
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


def _validated_entries(args: argparse.Namespace) -> list | None:
    """Validate the set where the RUN happens (not only in validate-set), as
    an ASSESSMENT set: the composition floor AND the provenance separation are
    enforced before hashing/running — a tuning set never produces reference or
    gated evidence. Returns the entries when the set is valid, None otherwise
    (the refusal is printed; the caller exits 1)."""
    try:
        _, entries = load_set(args.set_path, kind="assessment")
    except SetValidationError as failed:
        print(f"REFUSED: {args.set_path}: {failed}", file=sys.stderr)
        for error in failed.errors:
            print(f"  - {error}", file=sys.stderr)
        return None
    return entries


def _write_findings_report(
    out_dir: Path, config: str, entries: list, rows: dict, absent_rows: str = "error"
) -> tuple[Path, dict]:
    """The findings report: rows → verdicts → report, written into
    the run out-dir beside the rows and the manifest. No silent pass. The
    reference path passes ``absent_rows="skipped"`` — config A evaluates
    through the anchor report, so a case without a row is the expected shape
    (see :func:`verdicts.build_verdicts`)."""
    report = build_findings_report(
        config=config, verdicts_result=verdicts_mod.build_verdicts(entries, rows, absent_rows=absent_rows)
    )
    path = _write_manifest(Path(out_dir), "findings.report.json", report)
    return path, report


def _print_findings_summary(report: dict) -> None:
    counts = report.get("counts") or {}
    verdict_counts = counts.get("verdicts") or {}
    total_findings = sum((counts.get("findings") or {}).values())
    digest = report_digest(report)[:12]
    n_pass = verdict_counts.get("pass", 0)
    print(
        f"findings report: {n_pass} pass / {verdict_counts.get('fail', 0)} fail / "
        f"{verdict_counts.get('skipped', 0)} skipped / {verdict_counts.get('error', 0)} error verdict(s), "
        f"{total_findings} finding(s); digest {digest}"
    )


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
    entries = _validated_entries(args)
    if entries is None:
        return 1
    fingerprint = _corpus_fingerprint(args)
    try:
        configuration = _resolved_configuration(args, "A")
    except (RuntimeError, OSError, ValueError) as failed:
        # capture_baseline's docker-only guard raises RuntimeError; a pinned
        # --resolved-env file that is missing or unreadable raises OSError,
        # and one that is not valid UTF-8 JSON raises ValueError (both
        # JSONDecodeError and UnicodeDecodeError subclass it). Any of them
        # prints a refusal (the gate's shape), never a traceback.
        print(f"REFUSED: {failed}", file=sys.stderr)
        return 1
    configuration["model_ids"] = _model_ids(args)
    result = run_config_a(args.set_path, args.out_dir, seed=args.seed, entries=entries)
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
    report_path, report = _write_findings_report(
        Path(args.out_dir), "A", entries, result.get("rows") or {}, absent_rows="skipped"
    )
    _print_findings_summary(report)
    census = coverage_census(entries)
    print(
        f"reference run: coverage {census['n_cases_with_a_resolved_surface']}/"
        f"{census['n_set_cases']} case(s) with a resolved surface — "
        + ", ".join(f"{surface} {count}" for surface, count in census["by_surface"].items())
    )
    print(f"reference run: report {result['report_path']}")
    print(f"reference manifest: {path}")
    print(f"findings report: {report_path}")
    return 0


def cmd_assess(args: argparse.Namespace) -> int:
    """The gated B/C run: the set validated, then the gate (a refusal means no
    query ran), then the driver, then the gated manifest chaining the lineage,
    then the findings report over the rows."""
    config = args.config
    entries = _validated_entries(args)
    if entries is None:
        return 1
    # A pinned --resolved-env that cannot be read, parsed or shaped is
    # refused FIRST — before even the corpus fingerprint (no Arango needed)
    # and before the gate: the gated run's queries are the expensive part,
    # and a traceback after the run burns them for nothing.
    if args.resolved_env:
        try:
            snapshot = json.loads(Path(args.resolved_env).read_text(encoding="utf-8"))
            if not isinstance(snapshot, dict):
                raise ValueError("the resolved-env snapshot must be a JSON object")
        except (OSError, ValueError) as failed:
            print(f"REFUSED: {args.resolved_env}: {failed}", file=sys.stderr)
            return 1
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
    report_path, report = _write_findings_report(Path(args.out_dir), config, entries, rows)
    _print_findings_summary(report)
    print(f"findings report: {report_path}")
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


def cmd_verdicts(args: argparse.Namespace) -> int:
    """Re-judge stored rows without re-running: the rows file a previous run
    wrote + the set it ran → the findings report, written to --out."""
    entries = _validated_entries(args)
    if entries is None:
        return 1
    try:
        rows_data = json.loads(Path(args.rows_path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as failed:
        print(f"REFUSED: {args.rows_path}: {failed}", file=sys.stderr)
        return 1
    rows = rows_data.get("cases") if isinstance(rows_data, dict) else None
    if not isinstance(rows, dict):
        print(f"REFUSED: {args.rows_path} carries no cases mapping", file=sys.stderr)
        return 1
    report = build_findings_report(
        config=args.config,
        verdicts_result=verdicts_mod.build_verdicts(entries, rows),
        created_utc=args.created_utc,
    )
    path = _write_manifest(Path(args.out).parent, Path(args.out).name, report)
    _print_findings_summary(report)
    print(f"findings report: {path}")
    return 0


def _load_json_refusing(path: str, what: str):
    """One JSON file for the e01 join; None (already refused, printed) on an
    unreadable or malformed file."""
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as failed:
        print(f"REFUSED: {what} ({path}): {failed}", file=sys.stderr)
        return None


def _load_rows_refusing(path: str, what: str):
    """One rows file's ``cases`` mapping; None (already refused, printed)
    when the file carries no cases mapping."""
    data = _load_json_refusing(path, what)
    if data is None:
        return None
    cases = data.get("cases") if isinstance(data, dict) else None
    if not isinstance(cases, dict):
        print(f"REFUSED: {what} ({path}) carries no cases mapping", file=sys.stderr)
        return None
    return cases


def cmd_capture_a(args: argparse.Namespace) -> int:
    """The per-case config-A answer capture: the E01 judgment
    inputs the anchor path cannot carry. The reference command is untouched."""
    entries = _validated_entries(args)
    if entries is None:
        return 1
    result = run_config_a_capture(
        args.set_path,
        args.out_dir,
        entries=entries,
        corpus_fingerprint=_corpus_fingerprint(args),
        corpus_fingerprint_source="computed" if args.compute_fingerprint else "pinned",
    )
    rows = result["rows"]
    n_ok = sum(1 for row in rows.values() if row.get("status") == "ok")
    n_skipped = sum(1 for row in rows.values() if row.get("status") == "skipped")
    n_non_ok = len(rows) - n_ok - n_skipped
    print(f"config A capture: {len(rows)} row(s) recorded ({n_ok} ok / {n_skipped} skipped / {n_non_ok} failed)")
    print(f"captured rows: {result['rows_path']}")
    stamp = result["capture"]
    print(f"capture stamp: set {stamp['assessment_set_sha256'][:12]}, corpus {stamp['corpus_fingerprint'][:12]}")
    census = stamp.get("coverage") or {}
    if census:
        print(
            f"capture coverage: {census['n_cases_with_a_resolved_surface']}/"
            f"{census['n_set_cases']} case(s) with a resolved surface — "
            + ", ".join(f"{surface} {count}" for surface, count in census["by_surface"].items())
        )
    return 0


def _load_capture_refusing(path: str):
    """The A capture file: its cases mapping AND its stamp (the assessment-set
    digest and the corpus fingerprint it ran under) — ONE object, so the rows
    and their provenance cannot come from two different captures. The E01
    join verifies the stamp against the manifests. None (already refused) on
    an unreadable/malformed file."""
    data = _load_json_refusing(path, "the A captured rows")
    if data is None:
        return None
    cases = data.get("cases") if isinstance(data, dict) else None
    if not isinstance(cases, dict):
        print(f"REFUSED: the A captured rows ({path}) carries no cases mapping", file=sys.stderr)
        return None
    return data


def cmd_e01(args: argparse.Namespace) -> int:
    """The E01 comparison report: the typed refusals run first
    (a refusal means nothing was built), then the pure build, then the
    report written to --out with its digest printed."""
    reference_manifest = _load_json_refusing(args.reference_manifest, "the A-leg reference manifest")
    if reference_manifest is None:
        return 1
    gated_manifest = _load_json_refusing(args.gated_manifest, "the B-leg gated manifest")
    if gated_manifest is None:
        return 1
    anchor_report = _load_json_refusing(args.anchor_report, "the A anchor report")
    if anchor_report is None:
        return 1
    capture = _load_capture_refusing(args.captured_rows)
    if capture is None:
        return 1
    b_rows = _load_rows_refusing(args.b_rows, "the B rows")
    if b_rows is None:
        return 1
    defects = None
    if args.defects:
        defects = _load_json_refusing(args.defects, "the reference-defects ledger")
        if defects is None:
            return 1
    report = build_e01_report(
        reference_manifest=reference_manifest,
        gated_manifest=gated_manifest,
        anchor_report=anchor_report,
        capture=capture,
        b_rows=b_rows,
        defects=defects,
        created_utc=args.created_utc,
        seed=args.seed,
    )
    counts = report["counts"]
    path = _write_manifest(Path(args.out).parent, Path(args.out).name, report)
    print(
        f"e01 report: {counts['n_cases']} case(s) ({counts['a_recorded']} A / {counts['b_recorded']} B recorded,"
        f" {counts['reference_defect_cases']} reference-defect case(s))"
    )
    print(f"e01 digest: {report['digest'][:12]} (reproducible under the same inputs + pinned created_utc)")
    print(f"e01 report: {path}")
    return 0


def cmd_thresholds(args: argparse.Namespace) -> int:
    """The threshold registry's promotion decision.

    The registry is the single home of the threshold decision; this command
    reports it and — only when every measured dimension carries an agreed
    value AND the sign-off is signed — derives the gate-compatible thresholds
    artifact from it. A blocked registry produces NO signed artifact: the
    report records the blocking reasons and the command exits 1.
    """
    try:
        registry = thresholds_mod.load_registry(args.registry)
    except thresholds_mod.ThresholdsRefusal as refused:
        print(f"REFUSED: {refused}", file=sys.stderr)
        return 1
    decision = thresholds_mod.promotion_decision(registry)
    derived = None
    if decision["promotion"] == "allowed":
        if not args.reference_manifest:
            print(
                "usage: thresholds --reference-manifest PATH is required to bind the"
                " thresholds to the measured reference they were agreed against",
                file=sys.stderr,
            )
            return 2
        reference_manifest = _load_json_refusing(args.reference_manifest, "the reference manifest")
        if reference_manifest is None:
            return 1
        try:
            derived = thresholds_mod.derive_thresholds_artifact(registry, reference_manifest=reference_manifest)
        except thresholds_mod.ThresholdsRefusal as refused:
            print(f"REFUSED: {refused}", file=sys.stderr)
            return 1
        if not args.out:
            print(
                "usage: thresholds --out PATH is required to write the signed thresholds"
                " artifact (the promotion decision is allowed)",
                file=sys.stderr,
            )
            return 2
    report = thresholds_mod.build_thresholds_report(registry, created_utc=args.created_utc, derived=derived)
    if args.report:
        report_path = _write_manifest(Path(args.report).parent, Path(args.report).name, report)
        print(f"thresholds report: {report_path}")
    sign_off = decision["sign_off"]
    print(f"threshold registry: {args.registry}")
    print(
        f"sign-off owner: {sign_off.get('owner')} — signed: {str(sign_off.get('signed')).lower()}"
    )
    print(f"promotion: {decision['promotion'].upper()}")
    for code in sorted(decision["dimensions"]):
        record = decision["dimensions"][code]
        if record["status"] == thresholds_mod.STATUS_AGREED:
            print(f"  - {code} ({record['dimension']}): agreed {record['value']!r}")
        else:
            print(f"  - {code} ({record['dimension']}): ABSENT — {record['absent_reason']}")
    for reason in decision["blocking_reasons"]:
        print(f"  ! {reason['message']}")
    if derived is None:
        print(
            "REFUSED: the promotion decision is blocked — no signed thresholds artifact is"
            " produced; an absent dimension and an unsigned sign-off block promotion exactly"
            " like a missing predecessor",
            file=sys.stderr,
        )
        return 1
    path = _write_manifest(Path(args.out).parent, Path(args.out).name, derived)
    print(f"signed thresholds: {path}")
    return 0


def cmd_counters(args: argparse.Namespace) -> int:
    """The counter-metrics report: CM-1, CM-2 and CM-3 as
    first-class, top-level results. An absent input is recorded as absent with
    its reason — the rate is never reported as zero where nothing was measured.
    """
    reference_rows = _load_rows_refusing(args.reference_rows, "the reference rows")
    if reference_rows is None:
        return 1
    candidate_rows = _load_rows_refusing(args.candidate_rows, "the candidate rows")
    if candidate_rows is None:
        return 1
    reference_manifest = None
    if args.reference_manifest:
        reference_manifest = _load_json_refusing(args.reference_manifest, "the reference manifest")
        if reference_manifest is None:
            return 1
    correctness_ledger = None
    if args.correctness_ledger:
        correctness_ledger = _load_json_refusing(
            args.correctness_ledger, "the reference-correctness ledger"
        )
        if correctness_ledger is None:
            return 1
    try:
        report = build_counter_metrics_report(
            reference_rows=reference_rows,
            candidate_rows=candidate_rows,
            reference_manifest=reference_manifest,
            correctness_ledger=correctness_ledger,
            created_utc=args.created_utc,
        )
    except CounterMetricsRefusal as refused:
        print(f"REFUSED: {refused}", file=sys.stderr)
        return 1
    path = _write_manifest(Path(args.out).parent, Path(args.out).name, report)
    metrics = report["counter_metrics"]
    for name in sorted(metrics):
        record = metrics[name]
        if record.get("available"):
            print(f"{name} ({record['name']}): available")
        else:
            print(f"{name} ({record['name']}): NOT AVAILABLE — {record.get('not_available_reason')}")
    print(f"counter-metrics digest: {report['digest'][:12]}")
    print(f"counter-metrics report: {path}")
    return 0


def cmd_e02(args: argparse.Namespace) -> int:
    """The E02 comparison report (B vs C): the typed refusals run first (a
    refusal means nothing was built), then the pure build, then the report
    written to --out with its digest printed."""
    b_manifest = _load_json_refusing(args.b_manifest, "the B-leg gated manifest")
    if b_manifest is None:
        return 1
    c_manifest = _load_json_refusing(args.c_manifest, "the C-leg gated manifest")
    if c_manifest is None:
        return 1
    b_rows = _load_rows_refusing(args.b_rows, "the B rows")
    if b_rows is None:
        return 1
    c_rows = _load_rows_refusing(args.c_rows, "the C rows")
    if c_rows is None:
        return 1
    reference_manifest = None
    if args.reference_manifest:
        reference_manifest = _load_json_refusing(args.reference_manifest, "the reference manifest")
        if reference_manifest is None:
            return 1
    thresholds = None
    if args.thresholds:
        thresholds = _load_json_refusing(args.thresholds, "the signed thresholds artifact")
        if thresholds is None:
            return 1
    correctness_ledger = None
    if args.correctness_ledger:
        correctness_ledger = _load_json_refusing(
            args.correctness_ledger, "the reference-correctness ledger"
        )
        if correctness_ledger is None:
            return 1
    entries = []
    try:
        _, entries = load_set(args.set_path, kind="assessment")
    except (SetValidationError, OSError) as failed:
        print(f"REFUSED: {args.set_path}: {failed}", file=sys.stderr)
        return 1
    set_sha256 = sha256_file(args.set_path)
    try:
        report = build_e02_report(
            b_manifest=b_manifest,
            c_manifest=c_manifest,
            b_rows=b_rows,
            c_rows=c_rows,
            entries=entries,
            set_sha256=set_sha256,
            reference_manifest=reference_manifest,
            thresholds=thresholds,
            correctness_ledger=correctness_ledger,
            created_utc=args.created_utc,
            seed=args.seed,
        )
    except E02Refusal as refused:
        print(f"REFUSED: {refused}", file=sys.stderr)
        return 1
    counts = report["counts"]
    path = _write_manifest(Path(args.out).parent, Path(args.out).name, report)
    print(
        f"e02 report: {counts['n_cases']} case(s) ({counts['b_recorded']} B / {counts['c_recorded']} C recorded),"
        f" {counts['n_query_classes']} query class(es),"
        f" {counts['n_query_classes_not_covered']} class(es) not covered"
    )
    print(f"e02 verdict: {report['verdict']['state']}")
    print(f"e02 digest: {report['digest'][:12]} (reproducible under the same inputs + pinned created_utc)")
    print(f"e02 report: {path}")
    return 0


def cmd_coexistence(args: argparse.Namespace) -> int:
    """The coexistence criterion (NFR-3): the controlled legacy-only vs
    legacy-under-agent-load comparison, the agreed limits applied, and the
    verdict computed — never narrated."""
    control = _load_json_refusing(args.control, "the control phase's legacy measurements")
    if control is None:
        return 1
    loaded = _load_json_refusing(args.loaded, "the loaded phase's legacy measurements")
    if loaded is None:
        return 1
    agent_load = _load_json_refusing(args.agent_load, "the agentic load's record")
    if agent_load is None:
        return 1
    limits = None
    if args.limits:
        limits = _load_json_refusing(args.limits, "the agreed legacy limits")
        if limits is None:
            return 1
    lineage = None
    if args.lineage:
        lineage = _load_json_refusing(args.lineage, "the measurement lineage")
        if lineage is None:
            return 1
    try:
        report = build_coexistence_report(
            control_measurements=control,
            loaded_measurements=loaded,
            agent_load=agent_load,
            limits=limits,
            lineage=lineage,
            created_utc=args.created_utc,
        )
    except CoexistenceRefusal as refused:
        print(f"REFUSED: {refused}", file=sys.stderr)
        return 1
    path = _write_manifest(Path(args.out).parent, Path(args.out).name, report)
    phases = report["phases"]
    print(
        f"coexistence: control {phases['control']['n_ok']}/{phases['control']['n_requests']} ok,"
        f" loaded {phases['loaded']['n_ok']}/{phases['loaded']['n_requests']} ok"
    )
    print(f"coexistence verdict: {report['verdict']['verdict']}")
    for reason in report["verdict"]["reasons"]:
        print(f"  - {reason}")
    print(f"coexistence digest: {report['digest'][:12]}")
    print(f"coexistence report: {path}")
    return 0


def _add_corpus_args(p: argparse.ArgumentParser) -> None:
    """The corpus identity arguments — the shared derivation
    (:func:`_corpus_fingerprint`) behind every artifact that names a corpus."""
    p.add_argument("--corpus-collection", required=True, help="the corpus source collection name")
    p.add_argument("--corpus-graph", default="", help="the ArangoDB graph name (recorded)")
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--corpus-fingerprint", help="the pinned corpus fingerprint")
    group.add_argument(
        "--compute-fingerprint",
        action="store_true",
        help="collect the source collection's content hashes live (needs the eval env)",
    )


def _add_created_utc_arg(p: argparse.ArgumentParser) -> None:
    """The report timestamp pin — the digest covers it, so pinning makes two
    rebuilds of the same inputs digest-comparable."""
    p.add_argument(
        "--created-utc",
        default=None,
        help="pin the report timestamp (the digest covers it — the reproducibility pin)",
    )


def _add_common_manifest_args(p: argparse.ArgumentParser) -> None:
    _add_corpus_args(p)
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

    v = sub.add_parser("verdicts", help="re-judge stored rows into a findings report (no re-run)")
    v.add_argument("--rows", dest="rows_path", required=True, help="a config-{a,b,c}.rows.json rows file")
    v.add_argument("--set", dest="set_path", required=True)
    v.add_argument("--out", required=True, help="the findings-report JSON path to write")
    v.add_argument(
        "--created-utc",
        default=None,
        help="pin the report timestamp (the digest covers it — pinning makes two re-judges of"
        " the same rows digest-comparable)",
    )
    v.add_argument("--config", choices=("A", "B", "C"), default="B", help="the run's configuration letter")
    v.set_defaults(func=cmd_verdicts)

    cap = sub.add_parser("capture-a", help="the per-case config-A answer capture (story 4.3)")
    cap.add_argument("--set", dest="set_path", required=True)
    cap.add_argument("--out-dir", required=True)
    _add_corpus_args(cap)
    cap.set_defaults(func=cmd_capture_a)

    e = sub.add_parser("e01", help="the E01 A-vs-B comparison report (story 4.3)")
    e.add_argument("--reference-manifest", required=True, help="the A leg's reference.manifest.json")
    e.add_argument("--gated-manifest", required=True, help="the B leg's config-b.manifest.json")
    e.add_argument("--anchor-report", required=True, help="the A leg's config-a.report.json")
    e.add_argument("--captured-rows", required=True, help="capture-a's config-a.captured.json")
    e.add_argument("--b-rows", required=True, help="the gated run's config-b.rows.json")
    e.add_argument(
        "--defects",
        default=None,
        help="the reference-defects ledger (lineage-verified before application; absent = recorded absent)",
    )
    e.add_argument("--out", required=True, help="the e01.report.json path to write")
    _add_created_utc_arg(e)
    e.add_argument("--seed", type=int, default=None, help="the runs' seed (recorded as an execution condition)")
    e.set_defaults(func=cmd_e01)

    t = sub.add_parser("thresholds", help="the threshold registry's promotion decision (story 4.4)")
    t.add_argument("--registry", required=True, help="the threshold registry (protocol/thresholds.yaml)")
    t.add_argument(
        "--reference-manifest",
        default=None,
        help="the measured reference the thresholds bind to (required to sign them)",
    )
    t.add_argument("--out", default=None, help="the signed thresholds artifact path (when the promotion is allowed)")
    t.add_argument("--report", default=None, help="the threshold report path to write")
    _add_created_utc_arg(t)
    t.set_defaults(func=cmd_thresholds)

    c = sub.add_parser("counters", help="the counter-metrics report (story 4.4)")
    c.add_argument("--reference-rows", dest="reference_rows", required=True, help="the reference rows file")
    c.add_argument("--candidate-rows", dest="candidate_rows", required=True, help="the candidate rows file")
    c.add_argument(
        "--reference-manifest",
        default=None,
        help="the measured reference manifest (lineage-verifies the correctness ledger)",
    )
    c.add_argument(
        "--correctness-ledger",
        default=None,
        help="the reference-correctness ledger (CM-2's denominator; absent = recorded absent)",
    )
    c.add_argument("--out", required=True, help="the counter-metrics report path to write")
    _add_created_utc_arg(c)
    c.set_defaults(func=cmd_counters)

    e2 = sub.add_parser("e02", help="the E02 B-vs-C comparison report (story 4.5)")
    e2.add_argument("--b-manifest", required=True, help="the B leg's config-b.manifest.json")
    e2.add_argument("--c-manifest", required=True, help="the C leg's config-c.manifest.json")
    e2.add_argument("--b-rows", required=True, help="the B leg's config-b.rows.json")
    e2.add_argument("--c-rows", required=True, help="the C leg's config-c.rows.json")
    e2.add_argument(
        "--set",
        dest="set_path",
        required=True,
        help="the assessment set the legs ran against (the query-class source; its digest is verified against the legs' lineage)",
    )
    e2.add_argument(
        "--reference-manifest",
        default=None,
        help="the predecessor the legs were gated against (verified against the legs' lineage)",
    )
    e2.add_argument(
        "--thresholds",
        default=None,
        help="the signed thresholds artifact (absent = every threshold recorded absent)",
    )
    e2.add_argument(
        "--correctness-ledger",
        default=None,
        help="the reference-correctness ledger (CM-2's denominator; absent = recorded absent)",
    )
    e2.add_argument("--out", required=True, help="the e02.report.json path to write")
    _add_created_utc_arg(e2)
    e2.add_argument("--seed", type=int, default=None, help="the runs' seed (recorded as an execution condition)")
    e2.set_defaults(func=cmd_e02)

    cx = sub.add_parser(
        "coexistence",
        help="the coexistence criterion — legacy non-regression under concurrent agentic load (story 4.5)",
    )
    cx.add_argument("--control", required=True, help="the control phase's legacy measurements (JSON)")
    cx.add_argument("--loaded", required=True, help="the loaded phase's legacy measurements (JSON)")
    cx.add_argument("--agent-load", required=True, help="the concurrent agentic load's record (JSON)")
    cx.add_argument(
        "--limits",
        default=None,
        help="the operator's agreed legacy limits (absent = the verdict is BLOCKED, never a pass)",
    )
    cx.add_argument(
        "--lineage",
        default=None,
        help="the measurement lineage the limits bind to (the corpus fingerprint + set digest)",
    )
    cx.add_argument("--out", required=True, help="the coexistence report path to write")
    _add_created_utc_arg(cx)
    cx.set_defaults(func=cmd_coexistence)
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except (
        GateRefusal,
        ReuseRefusal,
        SetValidationError,
        DriverError,
        ManifestError,
        PairError,
        E01Refusal,
        E02Refusal,
        CoexistenceRefusal,
        thresholds_mod.ThresholdsRefusal,
        CounterMetricsRefusal,
    ) as refused:
        print(f"REFUSED: {refused}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
