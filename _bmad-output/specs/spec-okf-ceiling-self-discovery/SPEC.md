---
id: SPEC-okf-ceiling-self-discovery
companions:
  - ../../../components/okf-server/services/concept-ceiling.js
  - ../../../genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py
sources: []
---

> **Canonical contract.** This SPEC is derived from `.memlog.md` (the decision-of-record) plus the code facts it cites. The two `companions:` are the load-bearing sources any implementer must read alongside it — the ceiling authority and dataprep's discovery implementation. Do not hand-edit this file; it is re-derived on update.

# OKF concept-document ceiling: self-discovery (#1205, closes #1588)

## Why

okf-server enforces a STATIC ceiling on one concept document (`OKF_MAX_CONCEPT_DOC_CHARS`, default 250 000 — `concept-ceiling.js`, the single authority the import path, editor save and publish gate all read), while dataprep's Contextual Retrieval budget is DISCOVERED at runtime from the serving model's window and derived per document (`_serving_model_window` + `_resolve_doc_budget`). The static literal is sized for one window: on the default 65 536-token window the derived budget measures ~219 700 chars (measured 2026-11-06), so a concept AT the ceiling already truncates its context; on a 2048-token T4 profile the ceiling is ~19× too large, so documents pass the gate and truncate anyway. "Over the ceiling" and "will be truncated" stop being the same condition, and no config-validator check can keep a static literal in step with a runtime discovery — #1588's exact gap. Ruling (David, 2026-11-15): **self-discovery** — okf-server derives the ceiling from the SAME `/v1/models` window dataprep reads, TTL-cached.

## Capabilities

- **CAP-1 — Window discovery client**
  - **intent:** okf-server discovers the serving-model context window from the deployment LLM endpoint (`VLLM_ENDPOINT` + `/v1/models` — the endpoint dataprep reads, not okf-server's own judge base), honoring the SAME operator lever dataprep honors (`DATAPREP_MAX_MODEL_LEN`: 0 = discover, >0 = stated window), behind a stale-while-revalidate TTL cache so the enforcement paths never do blocking network I/O.
  - **success:** A deployment whose endpoint serves `max_model_len = X` gets ceilings derived from X within one TTL of boot; an unreachable endpoint serves last-known-good or the static default with a WARN naming the failure; a stated `DATAPREP_MAX_MODEL_LEN` overrides discovery without any request.

- **CAP-2 — Derived ceiling with fallback ladder**
  - **intent:** `concept-ceiling.js` derives the ceiling from the discovered window using dataprep's own formula (prompt, batch, output and scaffold terms; `CHARS_PER_TOKEN = 4`) so "over the ceiling" and "context truncates" remain the same condition on ANY window; the fallback ladder is deliberately NOT dataprep's fail-closed guess.
  - **success:** A 2048-token deployment gets a proportionally small ceiling and a 65 536-token deployment gets ~219 700 (matching the 2026-11-06 measurement within tolerance); an explicit `OKF_MAX_CONCEPT_DOC_CHARS` pin wins uncapped; on discovery failure the ladder is last-known-good → static default 250 000 with a loud WARN (a guess-derived WRITE ceiling would refuse nearly every import during an endpoint blip — the write ceiling fails conservative-but-usable, not fail-closed); every `CONCEPT_TOO_LARGE` refusal names the ceiling's source (discovered-from-window / operator pin / static default).

- **CAP-3 — Drift guard and deployment truth**
  - **intent:** The one thing a runtime derivation cannot do is let a validator compare numbers, so the drift surface moves to the CONSTANTS: okf-server mirrors the formula constants, and a config-validator pins its mirrors against dataprep's python source; the deployment docs state "unset = derived; set = pin".
  - **success:** Editing a dataprep constant without its okf-server mirror fails the validator in CI; no validator check needs to contradict a runtime-discovered number; `env` and `env.j2` comments drop the #1588 by-hand burden ("keep the literal in step") for the derived contract.

- **CAP-4 — Live proof**
  - **intent:** The smoke harness proves the derivation against the live deployment — the derived ceiling matches dataprep's derived budget for the same window within the formula's tolerance, and the ladder's precedence is visible.
  - **success:** The smoke leg runs green on the local build against the deployed endpoint; the smoke output names both ceiling sources it proved (derived vs pinned).

## Constraints

- The ceiling keeps "over the ceiling" ⇔ "document context will be truncated" as ONE condition — the shared number exists for that equivalence (plan §4); any derivation that breaks it on a supported window is wrong.
- No new REQUIRED env vars: `OKF_MAX_CONCEPT_DOC_CHARS` stays the operator override; `DATAPREP_MAX_MODEL_LEN` stays the window override; both must keep working for BOTH local Docker and cloud Ansible deploys.
- Refusals name the ceiling SOURCE — a curator hitting `CONCEPT_TOO_LARGE` must know which lever moves it.
- The discovery client must not add a blocking network call to any write path (stale-while-revalidate; probe in the background).
- Per the docs-merge-with-code rule: the SPEC and story artifacts ride the #1205 code MR, never a document-only MR.

## Non-goals

- dataprep's derivation itself does not change — this work reads its discovery contract, it does not refactor it.
- The doc_level budget (`DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL`) keeps its own semantics.
- Map-Reduce hierarchical summarization for over-budget documents remains dataprep's future; truncation semantics are unchanged here.
- No UI change: `CONCEPT_TOO_LARGE` surfaces keep their current shape; only the message text gains the ceiling source.

## Success signal

On the local build with the deployed endpoint, the smoke leg shows okf-server's ceiling and dataprep's derived budget agreeing within tolerance for the same window; a curator importing an oversized document on a 2048-token deployment is refused at a proportionally small ceiling (not 250 000) with a refusal that names the discovery as the source; and a dataprep constant edited without its mirror turns the CI validator red.

## Open questions

- TTL for the discovery cache — proposal 300 s (matches the smoke serviceToken cadence and okf-server's existing 5-minute posture TTL); confirm at story time.
- Remote-GPU network path: okf-server must reach `VLLM_ENDPOINT` (the GPU node `/llm`); expected open (okf-server already calls the judge base there; `VLLM_ENDPOINT` is emitted in env.j2 §18) — verify at implementation time.
