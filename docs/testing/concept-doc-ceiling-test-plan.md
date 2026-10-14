# Test Plan — Concept Document Ceiling & Derived Context Budget

| Field | Value |
|---|---|
| Plan ID | `TPC-2026-10-14` |
| Subject | Oversized concept-document splitting + derived Contextual Retrieval budget |
| Branch | `feat/concept-doc-ceiling` (tip `b2576d9f2`) |
| Environment | Local Docker build, `C:\Dev\builds\main`, compose project `main` |
| Baseline | `verify-local-build.sh` → 77 pass / 0 fail |
| Automated suites | okf-server **1189/1189**, config-validator **58/58**, OPEA **934 passed** (5 pre-existing failures unrelated) |
| Date | 2026-10-14 |
| Status | **Automated + in-container integration cases: all pass.** Operator tiers 0–4 (§9.3) pending execution |

---

## 1. Scope

### In scope
Verification that an oversized concept document is **split losslessly at import** against a ceiling **derived from the serving model's context window**, that the derivation is correct per hardware profile, and that truncation is **visible** to an operator.

### Out of scope
- Map-Reduce hierarchical summarization (named at `genieai_dataprep_arangodb.py:164` as future work; required only for documents exceeding *any* window)
- Retrieval-quality measurement before/after (needs the RAG eval harness, separate plan)
- Migration of the 1,291 pre-existing oversized concepts
- Mobile / Flutter surfaces

---

## 2. Requirements under test

| ID | Requirement | Source |
|---|---|---|
| **R1** | The doc-context budget is **derived** from `VLLM_MAX_MODEL_LEN`, not a fixed literal | `genieai_dataprep_arangodb.py::_resolve_doc_budget` |
| **R2** | An unset `VLLM_MAX_MODEL_LEN` **clamps to the smallest profile** (fail closed) | `_resolve_doc_budget`, `DERIVE_FALLBACK_WINDOW` |
| **R3** | The derived budget **fits the model window** (prompt + batch text + per-chunk output reservation) | `_resolve_doc_budget` |
| **R4** | Truncation is recorded in the **admin Ingestion Log**, not only container stdout | `_doc_context_or_none` → `_write_ingestion_log` |
| **R5** | A concept document over the ceiling is **split** at import | `concept-splitter.js`, `applyDocumentCeiling` |
| **R6** | The split is **lossless** — `parts.join(eol) === body` | `concept-splitter.js` invariant |
| **R7** | **Part 1 retains the original `concept_id`**; parts 2..N get `-part-N` | `applyDocumentCeiling` |
| **R8** | Split runs **before** the concept-cap check, so expansion fails loudly | `ingest-service.js` ordering |
| **R9** | A document that **cannot** be split is rejected `CONCEPT_TOO_LARGE`, never hard-wrapped | `concept-splitter.js` |
| **R10** | A document **under** the ceiling is **not** split | `applyDocumentCeiling` |
| **R11** | Editor save (`patchConcept`) over the ceiling → **409**, not a silent split | `repository-controller.js` |
| **R12** | `okf_repo_id` is cleared when the repo it names is deleted | `backing-file-service.js::clearRepoStamp` |
| **R13** | Compose and `env.j2` agree on every contextual default | config-validator **AC8** |

---

## 3. Test environment

| Component | Value |
|---|---|
| Served model | `ibm-granite/granite-4.1-8b` |
| GPU | NVIDIA RTX 6000 Ada, 48 GB |
| `--max_model_len` | **65536** |
| `--gpu_memory_utilization` | 0.55 (≈26.4 GB usable) |
| `--max_num_seqs` | 16 |
| **Derived ceiling** | `OKF_MAX_CONCEPT_DOC_CHARS = 250000` |
| `DATAPREP_CONTEXTUAL_DOC_BUDGET` | `0` (derive) |
| `VLLM_MAX_MODEL_LEN` in dataprep | `65536` |
| `OKF_IMPORT_CONCURRENCY` / `OKF_INGEST_CONCURRENCY` | 4 / 6 |

**VRAM budget (recorded for future profiling):** 16 GB weights + ~8 GB KV cache @65536 + ~2 GB headroom. `max_model_len 131072` needs ~16 GB KV and would **not** fit.

---

## 4. Test data inventory

Measured by unpacking each bundle; `body` = post-frontmatter character count.

| Bundle | Concepts | **Over 250k ceiling** | Largest body | Decompressed | Passes caps? |
|---|---|---|---|---|---|
| `alphabet-company-information-llm-v7.zip` | 18 | **0** | 3,378 | 44 KB | yes |
| `ncd-information-v6.zip` | 46 | **1** | 352,214 | 666 KB | yes |
| `solar-system-v1.zip` | 140 | **1** | 804,896 | 1.3 MB | yes |
| `bali-wikipedia-llm-v20.zip` | 999 | **88** | 849,702 | 96 MB | **no** |
| `indonesia-history-llm-v1.zip` | 999 | **107** | 841,940 | 115 MB | **no** |
| `www-gov-uk-full-crawl-v3.zip` | 997 | 1 | 259,063 | 6.9 MB | **no** (997 > 200) |
| `el-salvador-v3.zip` | 586 | 0 | 68,290 | 824 KB | **no** (586 > 200) |
| `slaugherhouse-heuristics-v7.zip` | 58 | 0 | 14,403 | 82 KB | yes |
| `resilient-ai-hub-v1.zip` | 11 | 0 | 2,711 | 16 KB | yes |

Caps: `OKF_INGEST_MAX_CONCEPTS` default **200/call**; `OKF_INGEST_MAX_ZIP_BYTES` default **26,214,400 decompressed**. Neither is plumbed through compose.

---

## 5. Test cases

### 5.1 Automated cases (executed)

| ID | Req | Case | Expected | Method | Result |
|---|---|---|---|---|---|
| TC-A01 | R6 | Split is lossless across 10 document shapes (headings, no headings, deep levels, frontmatter, consecutive headings, long-line, trailing/leading blanks, tables, CRLF) | `parts.join(eol) === body` every case | `concept-splitter.test.js` | **PASS** |
| TC-A02 | R5 | Splits on heading boundaries when sections fit | exactly 3 parts, each starts `#` | `concept-splitter.test.js` | **PASS** |
| TC-A03 | R5 | An oversized section decomposes further, never truncates | >1 part, lossless | `concept-splitter.test.js` | **PASS** |
| TC-A04 | R9 | A single unbreakable line over the ceiling → unsplittable, not hard-wrapped | `unsplittable:true`, `parts:[]`, reason names the section | `concept-splitter.test.js` | **PASS** |
| TC-A05 | R10 | Body under / exactly at the ceiling is not split | single part, unchanged | `concept-splitter.test.js` | **PASS** |
| TC-A06 | R5 | Determinism — same input, identical output | arrays equal | `concept-splitter.test.js` | **PASS** |
| TC-A07 | R5 | Idempotence — re-splitting a part is a no-op | `parts === [part]` | `concept-splitter.test.js` | **PASS** |
| TC-A08 | R1,R2,R3 | Three-way budget contract: `>0` override, `<0` disable, unset derive | `("override"), (None,"disabled"), derived value` | `test_dataprep.py` | **PASS** |
| TC-A09 | R2 | Unknown window clamps to smallest profile | equals `DERIVE_FALLBACK_WINDOW` result | `test_dataprep.py` | **PASS** |
| TC-A10 | R3 | **Assembled request fits the window** at 4096/8192/16384/65536 | `prompt_tokens + completion <= window` | `test_dataprep.py` | **PASS** |
| TC-A11 | R1 | The historical 6000 budget **would not fit** a 4096 window | assertion holds, derivation refuses | `test_dataprep.py` | **PASS** |
| TC-A12 | R4 | Truncation is written to the Ingestion Log | exactly 1 `WARN`/`Contextualization`/"truncated" call | `test_dataprep.py` | **PASS** |
| TC-A13 | R4 | **Negative control** — fitting document writes no truncation row | zero truncation calls | `test_dataprep.py` | **PASS** |
| TC-A14 | R7 | Skipped backing file has `okf_repo_id` cleared | field `null` | `backing-file-service.test.js` | **PASS** |
| TC-A15 | R12 | A stamp naming a **different** repo is left alone | unchanged | `backing-file-service.test.js` | **PASS** |
| TC-A16 | R13 | Compose ↔ `env.j2` agree on 6 contextual defaults + ceiling | no mismatches | AC8 | **PASS** |
| TC-A17 | R1 | Budget is `0`/derived, not a fixed literal | `'0'` | AC8 | **PASS** |

### 5.2 Falsification evidence (each guard proven non-vacuous)

| Falsifier | Result |
|---|---|
| Remove the Ingestion Log write | TC-A12 fails `assert 0 == 1` |
| Use a flat `CONTEXTUAL_MAX_TOKENS` instead of `× batch_size` | TC-A10 fails `3572 + 2048 > 4096 — request would be rejected by vLLM` |
| Restore compose default to `6000` | AC8 fails `Expected "0" / Received "6000"` |
| Comment out `clearRepoStamp` | TC-A14, TC-A15 fail |
| New container markers against the stale images | 6 markers FAIL `count=0 expected >= 1` before rebuild |

### 5.3 Integration cases — real content, deployed container

| ID | Req | Case | Data | Expected | Result |
|---|---|---|---|---|---|
| TC-I01 | R5,R6,R7 | **Deployed splitter in-container** | 869,815-char real crawled page | 4 parts, sizes 247096/242657/245080/134979, **lossless**, part 1 keeps id, paths `-part-2..4` | **PASS** |
| TC-I02 | R5,R6 | Indonesia crawl source, 113.7 MB | 1000 pages | 109 over ceiling → 109 split, **0 unsplittable, 0 lossy**, 245 parts (2.25×) | **PASS** |
| TC-I03 | R5,R6 | UK gov crawl source, 95.2 MB | 1002 pages | 88 → 88 split, **0 unsplittable, 0 lossy** | **PASS** |
| TC-I04 | R5,R6 | Bali crawl source, 6.7 MB | 1001 pages | 1 → 1 split, **0 unsplittable, 0 lossy** | **PASS** |
| TC-I05 | R10 | `ncd-information-v6` bundle | 46 concepts | 1 over ceiling (`clinical-detail-set-1`, 352,214) → 2 parts (248255/103958), lossless, 46→47 | **PASS** |
| TC-I06 | R10 | `comprehensive-corpus-supplement` | 186,057 body | **under** ceiling → not split | **PASS** |
| TC-I07 | R10 | Negative control, ncd 2nd largest | 185,318 body | under ceiling | **PASS** |

**Corpus-wide impact at the derived ceiling:** 3,003 pages → 198 over ceiling → **all 198 split, 0 unsplittable, 0 lossy**; 3,003 → 3,254 concepts (**+8.4%**).

### 5.4 Operational cases

| ID | Case | Expected | Result |
|---|---|---|---|
| TC-O01 | `verify-local-build.sh` before rebuild | new markers FAIL against stale images | **PASS** (6 fail) |
| TC-O02 | `verify-local-build.sh` after rebuild | 77 pass / 0 fail | **PASS** |
| TC-O03 | Runtime env reaches the containers | `DATAPREP_CONTEXTUAL_DOC_BUDGET=0`, `VLLM_MAX_MODEL_LEN=65536`, `OKF_MAX_CONCEPT_DOC_CHARS=250000` | **PASS** |
| TC-O04 | Mass repo delete leaves no fragments | 0 orphaned `okf_concepts_meta` rows; 0 dangling stamps | **PASS** |

---

## 6. Execution order & dependencies

Full action sequence per tier is in **§9.3**; preconditions in **§9.1**.

| Order | Tier | Bundle | Precondition |
|---|---|---|---|
| 0 | Negative control | alphabet-v7 | §9.1 green; no other repos exist |
| 1 | Smoke | ncd-v6 | tier 0 clean |
| 2 | Baseline | solar-system-v1 | tier 1 clean |
| 3 | Volume | bali-v20 | tier 2 clean + import-cap override active |
| 4 | Soak | indonesia-llm-v1 | tier 3 clean; overnight window |

**Stop-on-failure:** each tier depends on the previous. TC-I02–I04 already prove the splitter at volume, so tiers 3–4 are a **regression re-run** against the real import pipeline, not the only evidence of scale behaviour.

---

## 7. Entry / exit criteria

**Entry — all must hold before tier 0**
- [x] `verify-local-build.sh` → 77 pass / 0 fail
- [x] okf-server 1189/1189, config-validator 58/58
- [x] Runtime env confirmed (§9.1 S1–S3)
- [x] No tier-name clash — no live repo named after a tier bundle (§9.1 S5)
- [x] No orphaned fragments — every `okf_concepts_meta` row maps to a live repo (§9.1 S5)

**Exit — all of**
- [x] R1–R13 each covered by ≥1 executed case
- [x] Losslessness proven on synthetic shapes **and** 215 MB of real crawled content
- [x] Negative controls present (TC-A13, TC-I06, TC-I07)
- [x] Every guard falsified at least once (non-vacuous)
- [x] No regression: full suites green, build verified 77/0
- [ ] Operator tiers 0–4 executed against the live UI (§9.3)

---

## 8. Findings raised (not defects in this change)

| ID | Finding | Status |
|---|---|---|
| F-01 | T4 profile (`max_model_len 2048`) cannot run contextualization at all — the per-chunk output reservation alone consumes the window. It has been **silently** falling back to raw chunks | Correct behaviour now surfaced; needs a release note |
| F-02 | Six documentation surfaces named three different values for the same setting | Fixed |
| F-03 | `env.j2` nested guard: setting only `DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL` rendered nothing | Fixed |
| F-04 | AC7 parity regex excluded `DATAPREP_CONTEXTUAL_*`, so the drift was undetectable by CI | Fixed (AC8) |
| F-05 | `probe.md` (6 bytes) stamped to sentinel `00000000-…-0001` | Pre-existing test artifact, not from a repo delete |
| F-06 | `GRAPH_*` — 1,178 docs in 4 unversioned collections predating born-right naming | Pre-existing; separate cleanup decision |
| F-07 | Hugo site build unverified — no Hugo binary, no Go, Docker Hub pull denied | Mitigated by new CI `docs:build` job; needs one CI run to confirm |
| F-08 | `repos-routes.test.js › R9` failed twice in parallel mode, passed 7 consecutive runs after and under `--runInBand` | Transient flake under concurrent Docker build load; recorded, not dismissed |

---

## 9. Operator execution — local build

### 10.1 Environment (already configured; confirm before starting)

| # | Action | Where | Expected |
|---|---|---|---|
| S1 | `docker exec main-okf-server-1 printenv \| grep OKF_INGEST_MAX` | terminal | `OKF_INGEST_MAX_CONCEPTS=1200`, `OKF_INGEST_MAX_ZIP_BYTES=134217728` |
| S2 | `docker exec main-okf-server-1 printenv \| grep OKF_MAX_CONCEPT` | terminal | `OKF_MAX_CONCEPT_DOC_CHARS=250000` |
| S3 | `docker exec main-dataprep-arango-service-1 printenv \| grep -E "DOC_BUDGET\|MAX_MODEL_LEN"` | terminal | `DATAPREP_CONTEXTUAL_DOC_BUDGET=0` (derive), `VLLM_MAX_MODEL_LEN=65536` |
| S4 | `cd C:\Dev\builds\tooling && sh ./verify-local-build.sh` | terminal | `77 pass, 0 fail` |
| S5 | `node .scratch-pii/clean-state.js` from the repo root | terminal | `TIER-NAME CLASHES … 0`, and `0` orphaned `okf_concepts_meta` rows |

S1–S5 were confirmed green on 2026-10-14. The two caps are **not** in `env` or
`docker-compose.yaml` — they are set in `C:\Dev\builds\main\docker-compose.override.yml`
(local-only). Reverting that file to the defaults restores 200 / 26,214,400.

**Baseline DB state at S5 (2026-10-14).** Five repos are live; none is named after
a tier bundle, so all five tiers import into fresh names. 1 657 concept rows exist
and **every one maps to a live repo** — 0 orphans. The 25 564 graph docs are fully
accounted for: 20 000 belong to `www-gov-uk-full-crawl` and 4 386 to
`slaugherhouse-heuristics` (both live and ingested), and 1 178 are the legacy
unversioned `GRAPH_*` collections (F-06, pre-date born-right naming). One file
stamp points at the `00000000-…-0001` sentinel — `probe.md`, F-05, pre-existing.

### 10.2 Expected results per tier (measured with the shipped splitter, not estimated)

| Tier | Bundle | Concepts in | **Over ceiling** | **Concepts out** | Decompressed | Fits caps? |
|---|---|---|---|---|---|---|
| 0 | `alphabet-company-information-llm-v7.zip` | 18 | **0** | **18** | 0.0 MB | yes |
| 1 | `ncd-information-v6.zip` | 46 | **1** | **47** | 0.6 MB | yes |
| 2 | `solar-system-v1.zip` | 140 | **1** | **143** | 1.3 MB | yes |
| 3 | `bali-wikipedia-llm-v20.zip` | 999 | **88** | **1111** | 91.3 MB | with override |
| 4 | `indonesia-history-llm-v1.zip` | 999 | **107** | **1132** | 109.4 MB | with override |

Every one of the 197 splits across all five bundles is **lossless** and **0
unsplittable** — verified with the shipped `splitConceptBody` against the real
bundle bodies, not inferred.

Headroom check on the override: the cap is enforced **after** the split, on the
post-split count. Worst case is indonesia at **1132 < 1200** (68 spare);
largest decompressed is **109.4 MB < 128 MiB** (24 MiB spare).

### 10.3 Action sequence — repeat per tier, in this order

| # | Action | Where | What to check |
|---|---|---|---|
| 1 | Admin → **OKF** tab → Studio dashboard → click the **"+ New repository"** button | Studio dashboard | the **"New OKF repository"** dialog opens |
| 2 | Type the **Repository name** | dialog, field 1 | a duplicate name shows an inline warning — not fatal |
| 3 | Pick the **Subject area** from the dropdown | dialog, field 2 | **mandatory** — immutable after creation; the Create button stays disabled without it |
| 4 | Below the divider, under *"Or import an existing zip bundle as a new repository"*, choose the file in the **Bundle (.zip)** picker | dialog, field 3 | *"Staged: &lt;filename&gt;"* appears — **this only stages; nothing has imported yet** |
| 5 | Leave **Concept classification** at **Heuristics (default)** | dialog, field 4 | LLM-assisted / Hybrid exist but are slower — no reason to change it for this test |
| 6 | Click **Create repository** | dialog, footer | **this click starts the import**; lands on the dashboard with an in-progress card |
| 7 | **Wait** for the import card to finish | dashboard card | summary shows `created` / `split_documents` |
| 8 | Open the repo from the dashboard card | dashboard | the wizard opens — **on whatever step the saved `studio_step` points at, empirically step 9 "Review" for a bundle import, NOT Curate** |
| 8a | Click **"6. Curate"** in the **left rail** to go back | wizard left rail | unlocked (`locked = i > studio_step`, so every step up to and including the saved one is open); back-nav is non-destructive |
| 9 | Count the `-part-N` siblings in the concept list | wizard step 6 · Curate | matches the "Concepts out" column in §9.2 |
| 10 | **Set frontmatter: ≥3 `topic` AND ≥1 `forbidden`** | index.md YAML pane (Curate/Review) | saved **before** you publish — see §9.4 |
| 11 | Advance **Validate → Auto-correct → Review → Finish** | wizard steps 7–10 | no gate blocks |
| 12 | *Submit for review* | Review | `draft → review` |
| 13 | *Approve* | Review | `review → approve` |
| 14 | *Publish* | Finish | `approve → publish`; a bundle zip is written to doc-repo |
| 15 | *Ingest* | Finish / repo card | `publish → publish` (drain begins) |
| 16 | **Wait** for the drain to finish | Activity log | ingest summary appears |
| 17 | Open the bundle `.zip` → ingestion log | Files → FileDetailsDialog | **zero rows containing "truncated"** |
| 18 | Record the outcome against this plan | §11 | pass / fail + observed counts |

### 9.3a Where the zip picker is — and where it is NOT

The bundle `.zip` picker lives **only** in the *New OKF repository* dialog
(`components/okf/frontend/src/components/okf/StudioTab.vue`, dialog opens at
`:39`, file input at `:114`). It is **not** in the wizard.

Wizard step 1 (**Entry**, `steps/Entry.vue`) has no source picker of any kind — it
only takes the name and domain. Step 3 (**Input**) accepts individual `.md` files
(`onFsFiles` → `importConcepts`) and doc-repo sources via the source dialog, but
**no `.zip`**. So there is no way to reach bundle import from inside the wizard:
creating from a bundle and creating an empty repo both start on the dashboard.

**Consequence:** clicking *Create repository* with only a name and subject area
creates an **empty draft** containing just the seeded `index.md` skeleton
(`concept_count: 1`). Nothing is damaged and the import is simply not started —
delete that draft (`DELETE /api/okf/repos/:repo_id`, admin-scoped,
`routes/repos-routes.js:46`) and repeat the dialog with the zip staged.

**Step 15 fallback** if the bundle panel shows nothing: query ArangoDB directly
(`DEBUGGING-TRACING.md` §3) —
`FOR d IN ingestion_log FILTER d.message LIKE "%truncated%" RETURN d.message`.
A hit means a document reached ingest **over** 250 000 chars, i.e. a defect.

### 9.4 Set the tags in Curate — and why nothing tells you to go there

**This is a product defect, not a documentation gap.** Measured 2026-10-14:

- The bundle-import path creates the repo with only `{name, domain}`
  (`StudioTab.vue:467`) and never sets `studio_step`, so the wizard's landing step
  is wherever the default puts it — empirically **step 9 "Review"**, past the work.
- **Step 9 `Review.vue` carries no frontmatter cue at all.** It shows a concept
  count and one passing mention of labels ("set per topic in Curate") — nothing
  about tags.
- The **only** signal lives on `steps/Publish.vue:97-104`, which is **step 10, the
  last step**: *"Frontmatter tags not approved — the LLM can draft them in Curate,
  then approve before publishing."* The user clicks through nine steps, hits a
  dead end, and is told to navigate backwards four.

The frontmatter panel is mounted at the **top of the Curate step**
(`steps/Curate.vue:39` → `FrontmatterPanel.vue`). Click **Refresh suggestions** to
have the LLM draft topic + forbidden chips from the corpus, or type your own, then
**Save tags**. The panel's own hint states the rule: *"Publish requires ≥3 topic +
≥1 forbidden."*

**Fix (not yet applied):** seed `studio_step: 5` (Curate) when creating from a
bundle, exactly as the crawler path already does at `StudioTab.vue:674` and
`:686`. That lands the user where the mandatory work lives instead of past it, and
removes the need for a user manual to explain a navigation puzzle the product
created.

The Finish/Publish step re-checks the rule client-side
(`steps/Publish.vue:209` → `isFrontmatterPublishReady`, counting frontmatter
**rows**: `topic >= 3 && forbidden >= 1`) and shows *"Frontmatter tags approved"*
only once satisfied — so following the wizard stops you **before** the publish
request is ever sent.

That client gate matters because the **server-side** gate runs late: at
`lifecycle-service.js:748-760`, *after* `mintVersion` (`:669`) and after the bundle
export. A publish reaching the server without frontmatter returns
`409 FRONTMATTER_REQUIRED` but has **already burned a version number** and written
a bundle. The wizard prevents this; a direct API call does not.

### 9.5 Stop conditions

Stop and do not proceed to the next tier if any of these occur:

| Symptom | Meaning |
|---|---|
| Import card reports `CONCEPT_TOO_LARGE` | a body could not be split at the ceiling — inspect the named section before continuing |
| Import card split count ≠ the table in 10.2 | the running image is not the one under test — re-run `verify-local-build.sh` |
| `TOO_MANY_CONCEPTS` / zip-bytes rejection on tier 3 or 4 | the local override did not take — re-run S1 |
| Any "truncated" row at step 15 | a document survived the split oversized — defect, capture the file_id |
| Publish 409s | frontmatter missing (§9.4), or a concept exceeds the ceiling |

Tiers 0–2 need no override and pass on stock defaults — **run tier 0 first**. If
tier 0 does not produce exactly 18 concepts and 0 splits, stop; nothing downstream
is meaningful.

---

## 10. Defect log

| Defect ID | TC | Severity | Description | Status |
|---|---|---|---|---|
| — | — | — | None open | — |

---

## 11. Sign-off

| Role | Name | Date | Verdict |
|---|---|---|---|
| Test author | Claude | 2026-10-14 | All executed cases pass |
| Reviewer | *pending* | | |
