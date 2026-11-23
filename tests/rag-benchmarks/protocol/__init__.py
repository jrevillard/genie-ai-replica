# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The evaluation protocol package (story 4.1 — one runway).

The versioned harness machinery Epic 4's experiments run on: the evaluation-set
schema and composition validator (:mod:`evalset`), the run-manifest builder
(:mod:`manifest`), the E01/E02 pair-conditions manifest (:mod:`pairs`), the
A-only-first partial-order gate (:mod:`gate`), the capture-artifact suitability
checks (:mod:`reuse`), the three configuration drivers (:mod:`drivers`), the
E01 comparison report (:mod:`e01`, story 4.3), and the CLI
(:mod:`run_protocol`).

STDLIB-ONLY on the driver process: every module here imports the standard
library plus the sibling ``eval``/``tests/rag-benchmarks`` modules it reuses
(also stdlib). The harness never runs inside the agent stack — it talks to it
through the docker-exec and HTTP transports of :mod:`drivers`, and the tests
fake those transports, so the suite is CI-runnable with no live venue.

Protocol invariants this package owns:

* every run carries a version manifest (corpus fingerprint, set digests,
  resolved configuration snapshot, model ids read from the serving endpoints,
  prompt digests, evaluator-instructions digest) with no credentials anywhere;
* the assessment set's composition is validated, never assumed, and its cases
  are separated from tuning cases by SET PROVENANCE, not by directory;
* the partial order (A-only reference measured → thresholds signed → first
  gated B/C run) is enforced by :mod:`gate`, refusing with the named missing
  predecessor — never by convention;
* a capture artifact is consumed only after its ``harness_sha``, ``gold_sha256``
  and stack identity verify against the current code and set (:mod:`reuse`);
  there is no override.
"""

PROTOCOL_VERSION = "1.0.0"
