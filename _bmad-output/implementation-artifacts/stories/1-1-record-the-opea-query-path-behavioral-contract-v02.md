---
title: 'Record the OPEA query-path behavioral contract (V02)'
type: 'feature'
created: '2026-11-18'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
context:
  - 'docs/baselines/v02-opea-query-path-contract.md'
  - 'docs/baselines/v02-opea-query-path-contract.fixtures.json'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The OPEA-free capability layer (story 1.6) must preserve the current
query-path behavior deliberately, and the E01 equivalence suite (story 1.9) must
prove equivalence against something. Nothing records what that behavior actually
is, and the values that drive it are env-tunable — they differ between the
repository defaults, the chart and the running deployment.

**Approach:** Record the deployed behavior of the whole query path — preparation,
embedding, dense + BM25 retrieval, RRF fusion, label filtering, enrichment, the
CAP-1 identity join and the reranking/evidence-selection stage — as one ADR-linked
record with machine-readable fixtures, and ship a read-only probe that re-measures
the running stack so the record can be verified and kept honest.

## Boundaries & Constraints

**Always:**
- every value in the record is read from the running pods; the repository default
  is recorded as a difference, never as the value;
- each behavior states its inputs, its deployed parameter values, its expected
  output and the code that implements it;
- the preparation pipeline's failure classes are recorded separately, each with its
  own outcome;
- the record is linked to the decision records that establish it, with their
  status checked before reliance;
- the probe is read-only: it writes nothing, restarts nothing, mutates no data.

**Never:**
- no comparison engine, no identity gate, no disposition machinery — those belong
  to story 1.2;
- no derived value: a number the deployment does not serve is not recorded as
  deployed;
- no corpus snapshot as a fixture — the record captures behavior, not a result set;
- no behavior change to the OPEA services: this story records, it does not modify.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| record the deployed configuration | the running retriever / chatqna / reranker / embedding / backend pods | one JSON document with the knob values (scoped per container), their absence, the resolved query instruction, the measured translation budget and the three locale samples | a missing pod makes the probe exit 2 with the missing services named |
| verify the record against the venue | `--verify <fixtures file>` | exit 0 when the live deployment still matches the recorded measurement | exit 1 with one line per drifted knob; a difference in the SAMPLED locale strings is a warning, not a drift |
| a translator that is unavailable | the translation endpoint is unreachable or times out | the turn still answers, the source-language history is embedded, the status is `fallback_timeout` or `fallback_error` | never an untranslated silent success — the status makes the degradation visible |
| an oversized query | the query does not fit the translation window | chatqna answers HTTP 422 `translation_input_too_long` with `abstained: true` | no untranslated fallback |
| a translation that comes back blank | the model answers 200 with an empty completion | the turn still answers, the status is `fallback_error` | never reported as a success |

</frozen-after-approval>

## Code Map

- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py` — the retrieval path:
  the search branches (§4.1), the BM25 view and its AQL (§4.2), `rrf_fuse` (§4.3),
  the label clause builder and the Python post-filter (§4.4, §4.5), the batched
  file_id enrichment (§4.6), the CAP-1 join (§4.7), `_attach_provenance` (§4.8),
  the graph traversal (§4.9), the fan-out (§4.10), the routing gate (§4.11), the query-instruction wrapper.
- `genie-ai-overlay/retriever/config.py` — the knob names and the code defaults.
- `genie-ai-overlay/core/embedding_query_prefix.py` — the model-specific
  query-instruction contract.
- `genie-ai-overlay/reranker/genieai_tei_reranker.py` — the TEI call, the five
  reranking strategies, the failure modes.
- `genie-ai-overlay/chatqna/genieai_chatqna.py` — the preparation pipeline
  (detection, translation, bounds, status), the embedding of the prefixed query,
  the reranking call and the abstention paths.
- `genie-ai-overlay/chatqna/language-registry.json` — the supported locale
  registry (a symlink to the backend's shared registry).
- `components/gov-chat-backend/services/query-service.js`,
  `components/gov-chat-backend/routes/query-routes.js` — the BFF boundary: what
  the client actually receives for the status field and for the 422.
- `charts/genieai-umbrella/values.yaml`, `charts/genieai-umbrella/templates/opea/*.yaml`
  — the declared source of the deployed knob values.
- `docs/adr/okf-0*.md` — the decision records the record links.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/baselines/probe-v02-query-path.py` -- a read-only probe that
  measures the deployed knobs from the running pods and exercises the deployed
  preparation code for the three locales -- the record must be re-measurable.
- [x] `docs/baselines/v02-opea-query-path-contract.fixtures.json` -- the
  machine-readable form: the measured block and the expectation block, with the
  inputs, the deployed values, the expected outputs, the code references and the
  ADR links of every behavior -- the fixtures must be consumable by tests.
- [x] `docs/baselines/v02-opea-query-path-contract.md` -- the human-readable
  record: the venue, the deployed configuration, the behavior catalog, the
  preparation pipeline with its three failure classes, the locale coverage, the
  deployed-vs-default differences, the live observations and the decision records.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- the story
  entry moves to `review` -- the story must reach review state.

**Acceptance Criteria:**
- Given the deployed configuration, when the query path is exercised across the
  behavior catalog, then each behavior is documented with inputs, deployed
  parameter values and expected outputs, as fixtures consumable by tests.
- Given the preparation pipeline, when it fails, then the failure classes are
  recorded as deployed and separately: translator unavailable, oversized input
  (the deployed `TranslationInputTooLongError` → explicit 422
  `translation_input_too_long` with `abstained: true`, not an untranslated
  fallback), and translation-returning-blank, each with its distinct outcome.
- Given a conversation in any supported locale, when it is prepared, then at least
  three locales are covered including one non-Latin script, recording the detected
  language, the exact English string sent to the embedder and the status field.
- Given the record, when it is read, then it is linked as an ADR-evidenced
  artifact, with the ADR statuses checked before reliance.

## Implementation Notes

- The venue is the shared k3s (`namespace genieai`, chart `genieai-umbrella`, OPEA
  GPU mode `external`). The probe reads the deployed knobs from the pods, not from
  the overlay ConfigMap alone, so a value that the chart does not template (for
  example `TEI_EMBED_MODEL`) is recorded as absent-and-defaulted rather than as a
  declared value.
- The preparation probe runs **inside** the chatqna container and calls the
  deployed functions (`_get_translated_history_string`, `USER_MSG_PATTERN`,
  `language_codes_map`, `get_query_instruction`), so the English string it records
  is the string the embedder receives, not a re-implementation of it.
- The locale samples live in the probe, so re-running it reproduces the same three
  cases. `langdetect` is unseeded, so the detection step is not deterministic for a
  short sample — recorded as a known gap, not smoothed over.
- The CAP-1 join was observed live on a venue **without** the `okf_concepts_meta`
  collection: the join fails as a whole and the chunks are served unattributed.
  That is the collection-level tolerated absence; the "identity document present"
  branch is recorded from the code and flagged as such in the known gaps.
- The BFF does not forward chatqna's 422 verbatim (the streaming path answers
  HTTP 200 with an SSE error frame, the JSON path answers HTTP 500). The record
  states both layers, because the contract the port must preserve is the one the
  client sees.
- The workflow checkpoint was not used as a hard stop: the operator's standing
  instruction for this dispatch is autonomous execution to a draft merge request,
  with the merge itself gated by the orchestrator's GO. The decisions a checkpoint
  would have collected are recorded above and in the record's §6 and §8.
- No service was modified, restarted or scaled; the only writes are this story,
  the record, the fixtures and the probe.

### Corrections after the global review

The global review of MR !948 raised fifteen findings; all were verified against
the code before being acted on, and all are now applied:

- the translation **char budget** was wrong by an order of magnitude: the 2000
  constant is only the fallback used when the window discovery fails. The
  deployed budget is **11520 characters** (8192-token window), now measured by
  the probe and recorded in §5.3;
- the **graph traversal** stage was missing from the catalog. It runs on the
  deployed chat path and **rewrites every surviving chunk's text** before the
  reranker and the LLM see it — now recorded in §4.9;
- the **history language** rule was mis-stated: the detected code is kept for the
  history even when unsupported, and only the answer language falls back to `EN`
  (§5.1);
- `passthrough_unknown_language` covers a **refused** named code, not only an
  absent one (§5.2);
- an invalid filter strategy in the **environment** crashes the retriever at
  import (503), it is not an HTTP 400 — only a per-request override is (§4.4);
- the empty-**retrieval** abstention (`no_documents_retrieved`) was missing next
  to the empty-**selection** one (§4.13);
- the BM25 leg was credited to `okf-024`, whose BM25 is a different mechanism; it
  is specified by a SPEC (§4.2, §9);
- the probe measured the **backend** container too, so the BFF values in §5.5 are
  measured instead of asserted;
- the probe now exercises the **message-list** history shape the BFF actually
  sends, not the single-message branch;
- `--verify` is container-scoped, covers the query instruction, the model id, the
  language count and the translation budget, and treats the sampled locale
  strings as warnings rather than drift;
- the probe is executable and its failures exit 2 with a message instead of a
  traceback;
- four citation ranges were corrected to the lines that carry the code.

### Corrections after the fix review

The scoped fix review of the correction diff raised three Important findings, all
in the sections the correction rewrote; each was verified against the code and all
are now applied:

- the **traversal size gate** is a fan-out per-leg contract. The legacy
  single-graph path runs with `legacy_unbounded=True` and has neither the gate
  nor the leg sub-budget — and the deployed venue runs that legacy path, so the
  deployed traversal is neither size-gated nor time-boxed (§4.9);
- the **SPEC that specifies the BM25 leg** is archived: the record and the
  fixtures now cite the archived path (§4.2, §9);
- §5.3 contradicted §5.4 on the deployed list shape: the char budget truncates
  and never refuses, but the translation window can still overflow and that does
  refuse with a 422 (§5.3, §5.4).

The minor findings were applied too: the mislabelled token reserve was renamed
(`prompt_overhead_tokens` / `completion_safety_tokens`), `--verify` now compares
the translation window and warns on the two unchecked locale fields, the probe's
exit-2 contract covers every failure mode it can classify (a non-zero exec, a
missing binary, a timeout, a malformed payload), the probe picks the newest
**Ready** pod of a service, and the record states that the probe **mirrors** the
deployed language rule rather than invoking it.

### Corrections after the second fix review

The second scoped fix review confirmed the three Important findings as fixed and
raised one more, plus minors:

- the **deployed-path claim of §4.9** was true but carried no recorded
  evidence: the load-bearing fact is the venue's **OKF posture**
  (`OKF_ENABLED=0`, no okf-server → the BFF's engagement lookup yields no
  engagement → the carrier names no graph → the retriever runs the legacy
  single-graph path). The probe now **measures** `OKF_ENABLED` and
  `OKF_SERVER_URL` on the backend container, §3.3 and §7 carry the measured
  values, and the record's reconsideration triggers name the posture change;
- "the carrier carries labels only" was reworded to "the carrier names **no
  graph**" — the labels are request-dependent, the empty carrier is the
  posture;
- the record now states that the **fan-out path still carries** the size gate and
  the leg budget (§4.10), so the legacy path's lack of them is not read as a
  general absence;
- the record names the two constants the budget derivation uses, and the
  fixtures' `code` arrays keep their `path:line` shape (the prose moved to a
  sibling `probe_note`).

### Corrections after the third fix review

The third scoped fix review confirmed the previous round's fixes and raised two
Important findings (both text-level) plus six minors:

- the reword "the carrier names **no graph**" had reached the record but **not**
  its machine-readable mirror: the fixtures' `graph_traversal.size_gate` still
  carried the old wording and contradicted the fixtures' own new
  `live_observations.okf_posture` — both now agree;
- the record's **reconsideration trigger** overstated what the posture change
  proves: `OKF_ENABLED=1` alone does not engage the fan-out (the client
  short-circuits to the legacy default unless the okf-server is actually
  consulted *and* reports an engaged posture with serving graphs). The trigger
  row now says exactly that, and the evidence chain now cites
  `components/gov-chat-backend/services/retrieval-config-client.js:113`, `:450`.

The minors were applied too: §4.10 now states that each fan-out leg's traversal
is size-gated and bounded by the leg sub-budget (the two bounds the legacy path
does not have); the fixtures name the three token constants and keep the
completion reserve separate from the char-budget derivation; the posture knob was
**added** to the `graph_traversal` expectation (it stays in `preparation`),
where a per-behavior test reads it; the probe's verify path widens the exit-2
contract too; and the story's Code Map section numbers were corrected.

### Corrections after the fourth (scoped) fix review

The fourth scoped fix review — over the correction diff `cf89d7fb2..2fd9c4153` —
returned a **clean** verdict: both Important findings of that round were
verified fixed line by line. Its four wording-level minors were applied to the
record, the fixtures and this story:

- the record no longer claims the `engaged` flag the BFF reads is **absent**: the
  legacy default **carries** `engaged: false`
  (`retrieval-config-client.js:134`), and the operative reason the carrier names
  no graph is the posture's `mode` being `legacy`
  (`query-service.js:803-808`);
- the record restores the dropped clause "**the server's `engaged` flag, read and
  never re-derived**" (`query-service.js:691-694`);
- the story's "the posture knob **moved**" is now "**was added** to the
  `graph_traversal` expectation (it stays in `preparation`)";
- the traversal citation is extended to the lines that carry the fan-out branch
  (`retriever:1996-2011`) and to the size gate itself (`retriever:1452-1476`).

## Spec Change Log

## Review Triage Log

## Design Notes

The record lives under `docs/baselines/` — the same home as the V03 baseline
(story 1.2) — and the fixtures sit beside it as the machine-readable form, so a
test can load one file and get both the measurement and the expectation. The
probe is the third piece: it is what makes the record falsifiable, because
`--verify` compares the live deployment against the committed measurement and
exits non-zero on drift.

The record separates three things that are easy to conflate:

1. the **deployed value** (what the running pod serves) — always measured;
2. the **code default** (what the service falls back to) — recorded only as a
   difference, in §6;
3. the **chart value** (what the chart declares) — the source of (1) whenever the
   chart templates the knob.

## Verification

**Commands:**
- `scripts/baselines/probe-v02-query-path.py --verify docs/baselines/v02-opea-query-path-contract.fixtures.json`
  -- expected: `V02 contract verified: the live deployment matches the recorded
  measurement.` and exit 0.
- `python3 -c "import json; json.load(open('docs/baselines/v02-opea-query-path-contract.fixtures.json'))"`
  -- expected: no output (the fixtures file is valid JSON).
- `python3 -m py_compile scripts/baselines/probe-v02-query-path.py` -- expected:
  no output.

**The guard is falsifiable (mutation check, 2026-11-18).** The probe's drift
detection is what keeps this record honest, so each of its branches was
exercised against a mutated copy of the fixtures:

| Mutation | Expected | Result |
|---|---|---|
| none | exit 0, "contract verified" | exit 0 |
| a deployed knob changed in the recorded measurement | exit 1, one line per difference | exit 1 |
| an expectation claims a value the deployment no longer serves | exit 1 | exit 1 |
| a knob the record claims is absent is now served | exit 1 | exit 1 |
| the query instruction changes | exit 1 | exit 1 |
| a **sampled** locale string differs (`measured.preparation.locales`) | a warning, exit 0 | warning, exit 0 |
| the recorded capture carries no locale sample | exit 1 — the comparison cannot go vacuous | exit 1 |
| the locale pointer names a path that does not exist | exit 1 | exit 1 |
| the locale pointer is absent | exit 1 | exit 1 |
| the locale pointer is repointed at an equal-valued copy | exit 1 — the declaration must name the capture's own list | exit 1 |

The sampled-locale row is the contract that separates the two kinds of
difference: the deployed configuration is a contract, the sampled locale
strings are a sample. The emptiness row and the last three rows are the
non-vacuity guard — the emptiness row keeps the comparison from silently
reading nothing, and the last three keep the declaration from being
repointed away from the recorded capture.

The drift detection has **no automated CI-runner** — the probe needs a live
venue, and the repository has no test harness for `scripts/` (the sibling
`scripts/ci/*.py` checks follow the same convention: the script *is* the
check). That gap is recorded in the record's §8.

### Quality phase (simplify, test-audit, scoped fix review)

The simplify phase ran four cleanup angles; the changes that keep the same
measurement landed in `b54348388`: one container table (marker + knobs), the
locale samples handed to the in-pod script as an argv value (the shell quoting
layer and `shlex` are gone), one `compare_knobs` helper instead of two drift
loops, an explicit ordering key in the pod selection, one failure path with one
error tuple, and ruff format under the repository's Python convention. Two
angles were skipped deliberately: deriving the knob list from the service
config module (it would lose the per-container scoping the fixtures rely on)
and parallelizing the probe's calls (the locale samples exercise the shared GPU
translation service — concurrency would take capacity from the shared stack).

The scoped fix review of the quality diff returned **clean** — no findings. It
was first completed **inline**, as a documented deviation: the dispatched
reviewer agent had produced no report after 12 minutes, the fourth occurrence
of the known reviewer-hang pattern on this host. The agent's report arrived
later and independently confirmed the same verdict (**no findings**), having
verified the knob lists and the locale samples byte-identical by AST
comparison, the argv hand-off, the three drift conditions of `compare_knobs`,
the exception coverage, the pod tie-break, the prose against
`genieai_chatqna.py:4672` and the scope of the diff. The inline checks were:

- the merged knob lists are **byte-identical** to the pre-refactor dicts
  (compared programmatically — same containers, same knobs, same order);
- the argv hand-off was **live-tested** against the running chatqna pod: the
  JSON reaches `sys.argv[1]`, the non-Latin sample survives, and the resulting
  measurement is identical to the committed fixtures (all five contract fields
  and every locale field);
- `compare_knobs`' unification changes one drift-line wording ("is not served
  by the deployment" becomes "expected 'x' -> live None") — both cases still
  exit 1, proven by the mutation table above;
- `PROBE_ERRORS` is the exact union of the two former `except` tuples plus
  `ProbeError`, so no failure mode escapes as a traceback;
- the pod-selection tie-break is unchanged (Ready wins, then newest);
- the unmirrored-branch sentence was verified against
  `genieai_chatqna.py:4655-4672` and tightened twice (the requested-language
  fallback, the refusal case), then mirrored in the fixtures;
- the branch diff touches no service or app source — the story records, it
  does not modify.

**Late cleanup findings, applied.** The three cleanup agents that had looked
hung did deliver their reports afterwards; three of their findings were worth
acting on and are applied:

- **the locale sample now lives once.** The expectation block carried a copy
  of the recorded capture's locale sample — the six compared fields with
  identical values, minus the raw `english_history` the verification never
  compares — and the verification compared the live measurement against that
  COPY, so deleting the copy alone would have turned the locale comparison
  into a silent no-op. The expectation block now points at the recorded
  capture (`locales_source`) and the verification compares the live
  measurement against the recorded capture itself — never against a pointer's
  target — while checking that the declaration still names it. That closes
  the vacuous case the relocation alone would have left open: a recorded
  capture that carries no locale sample, a pointer that names nothing and a
  pointer repointed elsewhere are all **drifts**, not silent greens;
- **the identity fields live once.** The root keeps `artifact`,
  `contract_version`, `story`, `scope` and `method`; the expectations block no
  longer repeats them — its `method` copy described the *measured* block while
  sitting in the expectations block, where it described nothing. `recorded_at`
  and `pods` live only under `measured`, which is the probe's own document;
- **the loop-invariant registry read is hoisted**: the per-sample call goes
  from three to one, so the probe reads the registry twice in total — once
  for the samples, once for the language count.

**Three findings were skipped, with reasons:**

- *translating the three locale samples concurrently* — the probe **measures**
  the deployed translation path, and the deployed chat path translates one
  history per request; the probe must exercise it the way the chat path
  exercises it. Three concurrent calls would also take capacity from the
  shared GPU translation endpoint that serves the live stack. The probe is a
  rarely-run verification tool: 36 s is acceptable.
- *running the five `kubectl exec` reads in parallel* — 5.6 s in total on a
  rarely-run tool, and the concurrency is not worth the added machinery.
- *reading only the probed variables instead of the whole environment* — the
  probe already persists only the ≤42 probed knobs (the rest is read and
  discarded, never written), the values are the pod's own environment —
  reachable by anyone who can run the probe — and narrowing it would
  re-introduce the shell layer the quality phase had just removed.

**Manual checks:**
- the record's §5.6 table lists three locales, one non-Latin, each with the
  detected language, the status and the exact embedded string, and states that
  they are a sample;
- the record's §9 table lists every linked ADR with its status.
