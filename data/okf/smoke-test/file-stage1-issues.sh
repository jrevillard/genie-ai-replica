#!/bin/bash
# Stage 1 defect batch — GitLab issue creation (David directive 2026-09-07)
# One issue per registry defect; MRs must reference their issue IID.
REG="_bmad-output/implementation-artifacts/stage1-defect-registry-2026-09-07.md"

mk() {
  local iid
  iid=$(glab api "projects/:id/issues" -f title="$1" -f description="$2" -f labels="bug,okf" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.iid+' '+j.web_url)}")
  echo "ISSUE $iid :: $1"
}

mk "okf(stage1) D-A: is_index lost on bundle roots typed other than index — flat import, broken TOC" "Symptom: zip imports render flat; index/TOC/tree broken.
Root cause: concept-meta-service.js:124 derives is_index ONLY from fm.type==='index'. Authorial root types (e.g. BundleRoot) lose the flag.
Evidence: Alphabet repo index row has path=index.md, concept_id=index, 16 links, is_index=false.
Fix: is_index = fm.type==='index' || path==='index.md' || concept_id==='index'; backfill existing rows.
Owner: session 65. Full evidence: $REG"

mk "okf(stage1) D-B: LLM-assisted classification is a silent no-op — no labels, no LLM calls" "Symptom: LLM-assisted import identical to heuristics (byte-identical stats); zero GPU utilization; no labels assigned anywhere.
Root cause: type-inference-service.js:27-29 coerces every non-heuristics mode to heuristics (heuristics-fallback). No vLLM client exists in okf-server (DP-8 stub, AC-5).
Required (David, acceptance bar): LLM-assisted auto-assigns ONE KH-L2 label per concept bounded to the repo Subject Area, classifies type properly, generates description — far more accurate and complete than heuristics; slower acceptable; progress visible.
Fix: llm-curation-service (batched, lane-bounded, fail-soft) + import wiring + autocorrect propose reuse.
Owner: coordinator. Full evidence: $REG"

mk "okf(stage1) D-C: retract keeps the serving graph — must drop graph + underlying collections" "Symptom: retracted Kenya repo left OKF_kenya-government-services_v4 in ArangoDB (verified present).
Root cause: lifecycle-service.js:386-395 retract only flips lifecycle_state; graph teardown exists only in DELETE cascade.
Ruling (David): retract MUST drop the graph and all underlying collections; re-ingest rebuilds from the version.
Fix: teardown via idempotent drop helpers on retract + one-time orphan cleanup + smoke case retract->gone->reingest->rebuilt.
Owner: session 65. Full evidence: $REG"

mk "okf(stage1) D-D: descriptions never populated on any import path" "Symptom: frontmatter description missing from all imports (summary empty on every meta row).
Root cause: nothing generates descriptions anywhere in the import pipeline.
Fix: part of D-B — LLM writes summary per concept during import curation; heuristic mode leaves it as a visible curation gap.
Owner: coordinator (D-B). Full evidence: $REG"

mk "okf(stage1) D-E: crawl imports type every page as topic placeholder" "Symptom: wikipedia import has type=topic on every page.
Root cause: heuristics-only classification (D-B stub); wiki pages are topic-shaped to deterministic rules. Alphabet bundle proves authorial types are preserved correctly.
Fix: D-B LLM classification; authorial types keep absolute precedence.
Owner: coordinator (D-B). Full evidence: $REG"

mk "okf(stage1) D-F: only 4 frontmatter fields editable — ALL must be editable and auto-correctable" "Symptom: sources/links/license/custom keys are display-only in the editor fm form.
Root cause: ConceptEditor.vue fmDraft (:184) + saveFm (:350) hardcode {type,title,labels,description}; backend PATCH {frontmatter} already merges arbitrary keys.
Fix (15): full frontmatter form — curated fields + typed generic key/value rows, per-field validation, single save path via {frontmatter} PATCH.
Backend support (65): RFC 7386 null-deletes semantics in the {frontmatter} PATCH (value null removes key; additive; verify no caller relies on literal nulls).
Owner: session 15 + session 65. Full evidence: $REG"

mk "okf(stage1) D-G: activity log lacks import method and curation decisions" "Symptom: activity log must show the method used (heuristics/llm/hybrid) and decisions made per concept.
Root cause: import writes no method audit row; per-concept resolved_by is computed (type-inference-service.js:99) then discarded (ingest-service.js:321-325 keeps only type).
Fix: persist curation {method, resolved_by, label_source} per meta row + one import audit row with counts; surface in Logs dialog and repo details (15).
Owner: session 65 (persistence) + 15 (surface). Full evidence: $REG"

mk "okf(stage1) D-H: PII hit on alphabet index row — inspect and report" "Observation: alphabet index meta row has pii_state=hit with pii_hits_summary populated.
Action: inspect what matched; confirm fail-closed gating did not degrade the row; report; code change only if a detector misfires.
Owner: session 65. Full evidence: $REG"

mk "okf(stage1) D-I: first alphabet LLM import failed completely — trace the error" "Symptom: the first LLM-assisted alphabet zip import failed outright (David deleted it); the retry succeeded as a no-op.
Action: sweep okf-server logs ~48h around Sep 6 evening; identify the error; classify one-off vs systemic.
Owner: session 65. Full evidence: $REG"

mk "okf(stage1) D-J: firstExample no-match logged as ERROR with retry storm" "Evidence: docker logs main-okf-server-1 — trace e35456e6 repeats collection.firstExample no-match as WARN+ERROR pairs every ~3s.
Fix: treat expected DB miss as a normal result (not error); demote to debug; stop the retry loop on not-found.
Owner: session 65. Full evidence: $REG"

mk "okf(stage1) D-K: wikipedia cross-link density ~7x too low (74 of 999 concepts linked)" "Symptom: wikipedia UI graph barely conjoined — David suspected poor cross-linking. Confirmed: 999 concepts, 1201 links, only 74 concepts (7.4%) with any link, 0 dangling.
Reading: resolver resolves everything it receives; the loss is upstream. Prime suspect: pageProcessor content-pruning heuristic (drops blocks with >5 links and <15 chars/link) eats See also / Related / infobox link clusters.
Fix: trace loss point with before/after evidence; exempt heading-adjacent link-dense lists; re-measure. Acceptance: majority of crawled concepts carry at least one inter-concept link.
Owner: session 65. Full evidence: $REG"

mk "okf(stage1) D-L: autocorrect is a placeholder-filler — must PROPOSE the correct frontmatter (incl. from blank)" "Symptom (David): autocorrect on frontmatter does nothing useful; if before is blank, after must be the correct frontmatter for the repo.
Root cause: planAutocorrectForConcept (concept-meta-service.js:779-821) has 4 mechanical rules only (type->topic placeholder, title from H1, sources->[], status->draft); authorial types only warn; no labels, no description, no LLM, no repo context.
Fix: one curation engine, two surfaces — import-time curation (D-B) + autocorrect PROPOSE endpoint (per-concept + batch dry-run) returning {before, after, changes[]} with from-empty support; proposals follow the repo classification mode (heuristics or LLM — LLM expected more accurate). Frontend: panel renders blank-before as full proposal, per-field apply.
Owner: coordinator (propose endpoint) + 15 (panel UX). Full evidence: $REG"