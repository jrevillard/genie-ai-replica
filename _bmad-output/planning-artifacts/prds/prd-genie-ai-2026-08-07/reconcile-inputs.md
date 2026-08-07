# Input Reconciliation — PRD: OPEA 1.3 → 1.5 Upgrade

**Date:** 2026-08-07
**Scope:** Reconcile the user-supplied inputs against `prd.md` + `addendum.md`.
**Verdict at a glance:** No conflicts. Input 1 (verification review) is fully absorbed (no gaps). Input 2 (deferred-work retirement checklist) has **3 material gaps** (whisper re-eval, dataprep Dockerfile `REQ_PATH` rewrite, opencv re-confirm) and **2 low/scope gaps** (Makefile lock targets, retriever/reranker lock pattern).

---

## Input 1 — `research/opear15-upgrade-verification-review-2026-08-07.md`

### 1.1 Corrections C1–C11

| # | Input claim/requirement | Status | PRD / addendum coverage |
|---|---|---|---|
| C1 | OPEA 1.5 is Python 3.11, not 3.10; move 3.10 images to 3.11; sitecustomize paths `python3.10`→`python3.11` (chatqna+dataprep); drop dataprep `update-alternatives`; re-pin C-extension pins | **COVERED** | FR-3 ("Migrate to Python 3.11") names base images, sitecustomize path change in both Dockerfiles, `update-alternatives` removal, rebuilt compiled/C-extension pins; addendum §2 ("Python **3.11** base images…") |
| C2 | `opea_telemetry` NOT renamed — module survives at same path in v1.5; downgrade reranker blast-radius sub-claim | **COVERED** | FR-6 bullet "`comps.cores.telemetry.opea_telemetry` — verified NOT renamed (same path since v1.0)". PRD does not attribute reranker risk to a rename; reranker's real surface (`@register_microservice` params, `ServiceType.RERANK`) is covered by FR-6 + FR-7/FR-8 |
| C3 | vLLM/TEI bumps are moot for GENIE (deployment already runs vLLM v0.10.0, TEI 1.9.3); only unpinned `vllm:latest` chat image needs pinning; de-scope vLLM/TEI from "1.5 brings" narrative | **COVERED** | FR-15 pins chat `vllm` `:latest`→`v0.10.x` and the embedding/textgen wrappers to 1.5-based images; consequence "independent of the OPEA bump and lands as its own commit"; addendum §2 ("the vLLM/TEI 'bump' is not gated on this PRD; only the unpinned `vllm:latest` chat image needs pinning") |
| C4 | No v1.6/v1.7 exists (7.5 months on 1.5); don't assume a fresh 1.6 soon; re-check the release page immediately before the rebase | **COVERED** | §5 Non-Goals ("Not moving to OPEA v1.6+… v1.6 does not exist"); §6.2 ("re-check before starting the rebase (FR-1 gate)"); addendum §1 (rejected "Wait for v1.6") |
| C5 | mcp pin is **1.24.0**, not 1.25.0 | **COVERED** | FR-4 lists "mcp 1.24.0"; addendum §2 ("mcp 1.24.0") |
| C6 | MicroService count is **20**, not "17 nodes"/"21 constructions" | **N/A** | Count is a correction to the *briefing* doc, not reproduced in the PRD (PRD says only "the ~2,560-line chatqna orchestrator", which the review independently confirms ≈ 2,561). No requirement to add; no conflict |
| C7 | `flow_to` "3 byte-identical variants" — actually **4** identical; only `add_remote_service_without_rerank` differs | **COVERED** | §6.1(c) pre-rebase cleanup consolidates "the 5 near-duplicate `add_remote_service*` variants" — total-count 5 is consistent with the review (4 identical + 1 differing); the "4 vs 3" nuance is implementation detail for the architecture doc, not a PRD requirement |
| C8 | dataprep has **1** OPEA base-class subclass, not 3 | **N/A** | Not reproduced in the PRD; briefing-only correction; no conflict |
| C9 | retriever `comps` import is **12** symbols, not 11 | **N/A** | Not reproduced in the PRD; briefing-only correction; no conflict |
| C10 | Assistants API is **react_llama-only** (llama.cpp), not a vLLM surface; viable strategy is `react_langchain`/`react_langgraph` over OpenAI-compatible chat completions; pause/resume-via-threads needs a llama.cpp backend; materially qualifies #603's "adopt, don't build" | **COVERED (by explicit deferral)** | §5 Non-Goals excludes agentic/MCP/`OpeaMCPToolsManager` adoption (belongs to `#603`); addendum §1 rejects "Adopt OPEA 1.5's native agent/MCP as part of this PRD". No contradiction. **Note (low):** the PRD does not carry the C10 qualification forward as downstream context for #603 — see §4 summary |
| C11 | `constants.py` fork is a **hard** rebase item: v1.5 enum has no `TRANSLATOR` (slot 24 = `LANGUAGE_DETECTION`); must be regenerated wholesale from v1.5 with `TRANSLATOR` re-appended (value 29), not patched in place | **COVERED** | FR-7 ("Regenerate the `constants.py` fork from v1.5") — exactly: regen from v1.5 enum, `TRANSLATOR` re-appended at end, all v1.5 members preserved (no `AttributeError`); addendum §2 ("the fork must re-append `TRANSLATOR`") |

### 1.2 Gaps G1–G5

| # | Input claim/requirement | Status | PRD / addendum coverage |
|---|---|---|---|
| G1 | `langchain-arangodb` (0.0.4) is a coupling surface missing from the "six surfaces"; add with pin-bump check (vector path import/instantiation break, known label-filter defect) | **COVERED** | FR-5 (dedicated FR: 0.0.4 → latest compatible with v1.5 `langchain-core`, `ArangoVector` path re-validated, label-filter defect re-tested); reinforced by FR-2 + FR-11 consequences. Note: it is not enumerated inside FR-6's surface list, but FR-5 gives it a stronger, dedicated requirement |
| G2 | langgraph 1.0.1 will be **installed** (dependency of the 1.5 tree), not just "available to adopt"; sweep each image for modules reaching langgraph at import time | **COVERED** | FR-8 ("Sweep for import-time breaks (langgraph, comps modules)"); FR-4 consequence ("langgraph 1.0.1 is installed… verified not to break any overlay import path (§4.3)") |
| G3 | Python 3.10→3.11 path touches (= C1) | **COVERED** | FR-3 (see C1) |
| G4 | `schedule()` kwargs-forwarding is the make-or-break of the #1 coupling; GENIE's 6 custom kwargs survive only if v1.5 `execute()` forwards arbitrary kwargs into `align_*`; pre-rebase diff v1.3→v1.5 `execute()` kwargs forwarding as the **first** check | **COVERED** | FR-6 first bullet (blocking pre-rebase spike on a bare v1.5 clone; names all 6 kwargs); §6.1(b) milestone; SM-4 ("`schedule()` delivers all custom kwargs (proven by the spike + wire test)"); addendum §2 |
| G5 | dataprep lock-machinery removal list is accurate but the `--require-hashes` (determinism) retention must be explicit in the rebase task, not a cleanup aside | **COVERED** | FR-4 (retires `--no-deps --require-hashes` block "keeping `--require-hashes` semantics"); FR-4 consequence records the hashes `[ASSUMPTION…]` |

### 1.3 Soundness assessment + work-list additions (§4, §5)

| Input claim | Status | Coverage |
|---|---|---|
| Overlay-rebase (not rewrite) strategy is right | **COVERED** | §1 Vision, FR-1, FR-2 |
| Sequencing pre-rebase cleanup → bump → 6-surface verify → smoke tests is sound | **COVERED** | §6.1 In-Scope order (a)→(d); §6.1 Rebase order (retriever → reranker → dataprep → chatqna) |
| "Tests won't catch 1.5 breaks" (conftest stubs `comps` at `sys.modules`) is the most important observation; smoke tests before the bump | **COVERED** | §4.3 description; FR-10 (real `comps@v1.5`, HTTP-mocked endpoints, isolated from mocked conftest, red-green validated); §6.1(d) |
| Work-list: Python 3.11 sub-task | **COVERED** | FR-3 |
| Work-list: pin chat `vllm` (`:latest`) | **COVERED** | FR-15 |
| Work-list: `langchain-arangodb` compatibility check | **COVERED** | FR-5 |
| Work-list: langgraph import-time sweep | **COVERED** | FR-8 |
| Work-list: `execute()` kwargs-forwarding diff as #1 pre-rebase check | **COVERED** | FR-6, §6.1(b) |
| Work-list: regenerate `constants.py` + re-append `TRANSLATOR` | **COVERED** | FR-7 |
| Work-list: re-check release page before starting (no v1.6) | **COVERED** | §6.2, §5 |
| Work-list: decide native-agent strategy on vLLM before #603 scope | **COVERED (by deferral)** | §5 Non-Goals de-scopes agentic; decision belongs to `#603` (see C10 note) |

### 1.4 Pending verification (§6)

`enable_mcp` adoption scope, OPEAStore DB-agnostic decoupling, vLLM/TEI exact pins in the v1.5 ChatQnA compose — all "refine the OKF/SST pillar mapping, not the upgrade mechanics"; **N/A** for this PRD (de-scoped by §5 Non-Goals: MCP / OKF / SST are separate initiatives).

### 1.5 Input 1 summary

- **Gaps:** none material. One informational carry-forward: C10's react_llama-only qualification of #603's "adopt, don't build" is de-scoped and not echoed as downstream context in §5 (PRD §5 merely notes agent capabilities "only as downstream context"). If the finalizer wants the handoff preserved for `#603`, one line in §5 would carry it; not a functional gap in this PRD.
- **Conflicts:** none.

---

## Input 2 — `implementation-artifacts/deferred-work.md` ("OPEA bump v1.3 → v1.4+", L395-411)

### 2.1 Retirement checklist (redundant on bump)

| Item | Status | PRD / addendum coverage |
|---|---|---|
| `dataprep/requirements.in` + `requirements.lock` → replace with OPEA compiled `requirements-cpu.txt` (GPU: `-gpu.txt`) | **COVERED** | FR-4 (names `requirements.in`, `requirements.lock`; adopts v1.4+ `-cpu/-gpu` layout) |
| `dataprep/scripts/generate-requirements-in.sh` (OPEA now provides the `.in`) | **COVERED** | FR-4 (named) |
| `docling-core==2.82.0` pin (upstream pins correctly) | **COVERED** | FR-4 (named) |
| **`openai-whisper` drop — re-evaluate** (v1.4 keeps whisper; build may be fixed / path exercised) | **GAP** | No FR covers the whisper restore-vs-keep-drop decision. FR-4 is lock-machinery-only; SM-6 ("dead divergence removed…") lists `.in/.lock/generator/docling pin` but not whisper. This is a dataprep dependency decision the bump forces |
| `Makefile` targets `lock-dataprep` / `requirements-in-dataprep` (retire or repoint to OPEA `.in`) | **GAP (low)** | FR-4's "the dataprep local lock machinery (…)" is a superset that plausibly includes the Makefile targets, but they are not named; SM-6 does not mention them. Recommend naming them in FR-4 or SM-6 |
| `verify:dataprep-lock` CI job (repoint or remove) | **COVERED** | FR-4 consequence — resolved: "**re-pointed** to OPEA's lock, with the re-pointing decision recorded in `.decision-log.md` — closing the earlier 're-pointed or removed' ambiguity" |
| `pip install --upgrade pip setuptools wheel` + `--no-deps --require-hashes` Dockerfile block (keep `--require-hashes`) | **COVERED** | FR-4 (retired "keeping `--require-hashes` semantics") |
| KEEP `smoke:dataprep-arango` (runtime import check) | **COVERED** | FR-10 references dataprep's existing `smoke:dataprep-arango` as the retained import-smoke; §9 (CI smoke jobs) |
| KEEP `opencv-python` → `opencv-python-headless` decision — **re-confirm against v1.4/v1.5 reqs** | **GAP** | No FR covers the opencv-headless re-confirmation. Adjacent to FR-4 but not named |

### 2.2 Dockerfile requirements-patch rewrite (mandatory on bump)

| Item | Status | PRD / addendum coverage |
|---|---|---|
| Dataprep Dockerfile `ARG REQ_PATH=/app/comps/dataprep/src/requirements.txt` + sed/`fix_dependencies.sh` blocks target a file that no longer exists in v1.4+; rewrite to `requirements-cpu.txt`; adjust pins (`pyspark==4.0.0`, `pathway` line dead, `unstructured[all-docs]` sed is a no-op) | **GAP** | FR-9 covers `fix_dependencies.sh` (**shared by retriever + reranker**) and its `…/retrievers/src/requirements.txt` `REQ_PATH` re-point, plus the docarray rename hack — but **not** the dataprep-specific `ARG REQ_PATH`/sed rewrite. FR-4 adopts the compiled-lock *layout* but does not name this Dockerfile patch rewrite. Recommend extending FR-9 (or FR-4) to name the dataprep `REQ_PATH` → `requirements-cpu.txt` rewrite + the three pin adjustments |
| `fix_dependencies.sh` is shared by reranker + retriever — do NOT delete it in the dataprep-only bump; reranker/retriever keep consuming it until they migrate to locks | **COVERED** | FR-9 treats `fix_dependencies.sh` as a shared keep-and-re-point artifact (no deletion) |

### 2.3 Lock pattern for retriever/reranker

| Item | Status | PRD / addendum coverage |
|---|---|---|
| Apply the compiled-lock pattern to retriever/reranker (determinism + SBOM story); deferred-work says "pick up when those images next change" — the bump is precisely when they change | **GAP (scope)** | PRD's FR-4/SM-6 are dataprep-only. The bump re-builds retriever/reranker images (FR-1), so the deferred-work trigger fires within this PRD's execution window, yet no FR adopts the lock pattern for them. At minimum an open question / explicit deferral is warranted; see §10 recommendation below |

### 2.4 Input 2 summary

- **Gaps (material):**
  1. `openai-whisper` drop re-evaluation (deferred-work L403) — no FR.
  2. Dataprep Dockerfile `ARG REQ_PATH`/sed requirements-patch rewrite → `requirements-cpu.txt` + `pyspark==4.0.0` / dead `pathway` / `unstructured[all-docs]` no-op adjustments (L409) — not named in FR-4 or FR-9.
  3. `opencv-python-headless` decision re-confirmation against v1.4/v1.5 reqs (L408) — no FR.
- **Gaps (low / scope):**
  4. Makefile `lock-dataprep` / `requirements-in-dataprep` targets (L404) — implicit in FR-4 but not named.
  5. Retriever/reranker compiled-lock adoption (L411) — the bump triggers deferred-work's "next change", but PRD is dataprep-only; needs an explicit scope decision.
- **Conflicts:** none.

---

## Overall disposition

- **Conflicts: 0.** No input claim is silently contradicted by the PRD or addendum.
- **Gaps to close before finalize (recommended):**
  1. FR-9 (or FR-4): name the dataprep Dockerfile `REQ_PATH` → `requirements-cpu.txt` rewrite + `pyspark==4.0.0` / `pathway` / `unstructured[all-docs]` pin adjustments (Input 2, §2.2).
  2. Add the `openai-whisper` drop re-evaluation to FR-4's dependency-decision scope (Input 2, §2.1).
  3. Add the `opencv-python-headless` re-confirmation alongside FR-4 (Input 2, §2.1).
  4. Decide/nail retriever+reranker lock-pattern scope in §10 or §6.2 (Input 2, §2.3) — either adopt in-bump or record as explicit deferral.
  5. (Optional, one line) Echo C10's react_llama-only qualification in §5 as downstream context for `#603` (Input 1, §1.1).
