# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The evaluation protocol package.

The versioned harness machinery the protocol's experiments run on: the evaluation-set
schema and composition validator (:mod:`evalset`), the run-manifest builder
(:mod:`manifest`), the E01/E02 pair-conditions manifest (:mod:`pairs`), the
A-only-first partial-order gate (:mod:`gate`), the capture-artifact suitability
checks (:mod:`reuse`), the three configuration drivers (:mod:`drivers`), the
E01 comparison report (:mod:`e01`), the threshold registry and its
promotion decision (:mod:`thresholds`), the counter-metrics report
(:mod:`counter_metrics`), and the CLI (:mod:`run_protocol`).

STDLIB-ONLY on the driver process: every module here imports the standard
library plus the sibling ``eval``/``tests/rag-benchmarks`` modules it reuses
(also stdlib). The one third-party dependency — PyYAML, read by the threshold
registry loader (:mod:`thresholds`) — is imported LAZILY, inside the loader, so
the package stays importable without it and every other command keeps working
on a venue node that has no PyYAML. The harness never runs inside the agent
stack — it talks to it through the docker-exec and HTTP transports of
:mod:`drivers`, and the tests fake those transports, so the suite is
CI-runnable with no live venue.

Protocol invariants this package owns:

* every run carries a version manifest (corpus fingerprint, set digests,
  resolved configuration snapshot, model ids read from the serving endpoints,
  prompt digests, evaluator-instructions digest) with no credentials anywhere;
* the assessment set's composition is validated, never assumed, and its cases
  are separated from tuning cases by SET PROVENANCE, not by directory;
* the partial order (A-only reference measured → thresholds signed → first
  gated B/C run) is enforced by :mod:`gate`, refusing with the named missing
  predecessor — never by convention;
* the threshold decision lives in ONE place (the registry, :mod:`thresholds`):
  a measured dimension carries an agreed value or an EXPLICIT absence, an
  absence (or an unsigned sign-off) blocks promotion and is never defaulted,
  and the gate-compatible artifact is derived from the registry — never
  authored beside it;
* the counter-metrics (:mod:`counter_metrics`) are first-class results:
  CM-1/CM-2/CM-3 sit at the top level of the report, and every absent input
  is recorded as absent WITH its reason — never as a zero;
* a capture artifact is consumed only after its ``harness_sha``, ``gold_sha256``
  and stack identity verify against the current code and set (:mod:`reuse`);
  there is no override.
"""

PROTOCOL_VERSION = "1.0.0"
