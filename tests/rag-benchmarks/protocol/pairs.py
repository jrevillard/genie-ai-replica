# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The E01/E02 pair-conditions manifest (story 4.1 — recorded, checkable).

The epic's pairs are recorded artifacts, not folklore:

* **E01 (A vs B)** — corpus, evaluation set, execution conditions and model
  services are HELD FIXED; the retrieval backend is the recorded INTENTIONAL
  DIFFERENCE (A is the legacy OPEA retrieval path, B is the OPEA-free port —
  the backend is the variable under test, AD-10).
* **E02 (B vs C)** — retrieval backend, preparation and admission policy are
  HELD FIXED (B and C go through the same orchestrator admission lane, the
  same budgets and the same query preparation); orchestration is the recorded
  INTENTIONAL DIFFERENCE — the delta attributes to the agent, not the
  retrieval migration.

The pair manifest ships with the harness (this module IS the shipped copy)
and rides every gated run's manifest. :func:`check_run_against_pair` verifies
a run manifest against the shipped conditions: the stamped pair must exist,
its stamped conditions must be byte-identical to the shipped copy (a run that
silently re-defined "held fixed" would break the pair's comparability), and
the run's config must belong to the pair.
"""

from __future__ import annotations

import copy

PAIR_IDS = ("E01", "E02")

PAIR_CONDITIONS: dict[str, dict] = {
    "E01": {
        "pair": "E01",
        "compares": ["A", "B"],
        "held_fixed": ["corpus", "evaluation_set", "execution_conditions", "model_services"],
        "intentional_difference": "retrieval_backend",
        "notes": (
            "A is the legacy fixed RAG path (chatqna + OPEA retriever, unchanged); B is the "
            "story-1.9 no-agent pipeline over the OPEA-free port. The retrieval backend is the "
            "variable under test — every other condition is held fixed."
        ),
    },
    "E02": {
        "pair": "E02",
        "compares": ["B", "C"],
        "held_fixed": ["retrieval_backend", "preparation", "admission_policy"],
        "intentional_difference": "orchestration",
        "notes": (
            "B and C share the retrieval backend (the same port adapters), identical query "
            "preparation and the same orchestrator admission lane and budgets, so the E02 delta "
            "attributes to the agent loop — nothing else."
        ),
    },
}

# Which pair a configuration's run belongs to. A is E01's reference leg; the
# gated B run completes E01; C runs under E02.
CONFIG_PAIR = {"A": "E01", "B": "E01", "C": "E02"}


class PairError(ValueError):
    """The run manifest's pair stamping violates the shipped pair conditions."""


def pair_conditions(pair: str) -> dict:
    """The shipped conditions of one pair (a DEEP copy — callers cannot mutate
    the module-level manifest through it, nested lists included)."""
    if pair not in PAIR_CONDITIONS:
        raise PairError(f"unknown pair {pair!r} (known: {', '.join(PAIR_IDS)})")
    return copy.deepcopy(PAIR_CONDITIONS[pair])


def check_run_against_pair(run_manifest: dict) -> list[str]:
    """Check a run manifest's pair stamping against the shipped conditions.

    Returns the error list (empty = consistent). A manifest with no pair
    stamp is only an error when its config belongs to a pair — every config
    does, so a missing stamp on a run manifest is reported.
    """
    errors: list[str] = []
    config = run_manifest.get("config")
    stamped = run_manifest.get("pair")
    expected_pair = CONFIG_PAIR.get(config)
    if expected_pair is None:
        errors.append(f"run manifest names unknown config {config!r}")
        return errors
    if stamped is None:
        errors.append(f"run manifest for config {config} carries no pair stamp (expected {expected_pair})")
        return errors
    if stamped.get("pair") != expected_pair:
        errors.append(f"run manifest for config {config} stamps pair {stamped.get('pair')!r}, expected {expected_pair}")
        return errors
    shipped = pair_conditions(expected_pair)
    if stamped != shipped:
        differing = sorted(key for key in set(stamped) | set(shipped) if stamped.get(key) != shipped.get(key))
        errors.append(
            f"stamped pair conditions for {expected_pair} differ from the shipped manifest"
            f" (differing keys: {', '.join(differing)})"
        )
    return errors
