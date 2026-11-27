# S3-plan-3: the web citation variant, rendered on web and mobile

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** web results become a rendered citation variant (`source: 'web'`): the agent-service projects them into `source_documents`, the BFF forwards them, and the citation components on web and mobile render them (a WEB badge, a clickable external link).

**Architecture:** the web provenance is SELF-CONTAINED (`{"source": "web", "url", "title"}` — nothing to resolve), so the projection gains a web branch in its two BUILDERS (before the concept/legacy branches) that reads the provenance directly; `record_for` and `resolve_source_records` stay untouched (web resolves nothing) with their docstrings updated to say so. The projected row is `{document_id: url, document_name: title, url, score, source: "web"}` — the url IS the stable identity (`provenance_identity`'s web branch already returns `("web", url)`, pinned). Both clients already open external URLs; each gains only a WEB badge mirrored across the two badge definitions that must not drift.

**Tech Stack:** Python 3.11 / pytest 9.1.1 (agent-service), Node/Jest (BFF, frontend), Dart / flutter_test (mobile), Playwright (E2E — extends an existing spec, no new file).

**Spec:** `docs/superpowers/specs/2026-11-25-agentic-iteration-2-architecture-design.md` §4.7 (L301-302): "web results are a new citation variant (`source: 'web'`), which the citation components on web and mobile must render." The pinned projection boundary of plan-2 (`2026-11-27-agentic-s3p2-web-search-egress.md` L2469: the boundary "is where it lands") is THIS plan's subject.

## Global Constraints

- **The frozen wire gate must not move.** `components/agent-service/tests/test_event_stream_gate.py:124` byte-compares the orchestrated stream against `tests/fixtures/event_stream/orchestrated_run.json`; the delta set is CLOSED. The fixture's run carries NO web provenance, so a web branch that leaves the concept/legacy entry shapes untouched keeps the gate green. A diff on the legacy entry shape is a STOP.
- **Every projected entry must carry what the frontend mapping reads.** `components/agent-service/tests/test_agent_citations.py:360-385` pins per-variant field sets via `LEGACY_FIELDS` (L37) and `OKF_FIELDS` (L38); a web variant adds `WEB_FIELDS` and its own leg in that loop.
- **The two plan-2 boundary pins FLIP here.** `test_agent_citations.py:398-422` (`test_a_web_citation_is_delivered_but_not_projected`) and `test_agent_verification.py:664-692` (`test_a_web_only_run_verifies_through_the_judge_and_projects_nothing`) are this plan's declared boundary: their projection assertions REVERSE (web entries now project), and the docstrings say the boundary landed here.
- **The dedup identity never changes.** `provenance_identity`'s web branch returns `(WEB_SEARCH_SOURCE, url)` (citations.py:275-276, pinned L388-396). A projected row's `document_id` is the url — re-deriving identity from anything else would collide entries.
- **An unreadable score surfaces as `None`, never guessed into a number** (citations.py:404-407, pinned L356).
- **The badge pair must not drift.** Web `components/gov-chat-frontend/src/utils/okfCitation.js` and mobile `mobile/genie_ai_mobile/lib/okf/okf_citation.dart` each state the one-definition rule for the OKF badge; the WEB badge lands in BOTH, same turn.
- **Handle spellings are per-surface.** Web chat: `data-testid` (`answer-source-card-${di}`); mobile: `ValueKey('answer-source-row-${…}')`; admin web: `data-test-id`. A new affordance needs a NEW handle; this plan adds none (the badge is inside the existing card; the click is the existing external-URL branch).
- **No i18n change.** The WEB badge label is a literal (like the OKF badge's `'OKF'`); the sources-panel label (`chatbot.relatedSources` / `chatbot.sourcesBarLabel`) is generic. All 14 web locale files and the mobile locales stay untouched.
- **Lint with the pinned versions**: Python `uvx ruff@0.16.3 check --no-cache …` / `format --no-cache --check …` (never a local ruff 0.16.4); JS per the components' own lint/format scripts.
- **Baseline suites before any task**: agent-service `1078 passed`; BFF jest green; frontend jest green; mobile `flutter test` green. Verify yours before starting.

---

### Task 1: The projection — the web branch in the two builders

**Files:**
- Modify: `components/agent-service/capabilities/citations.py` (`_web_entry`; the web-first branch in `source_document_envelope` and `source_documents_from_citations`; the module docstring's D1 paragraph; `resolve_source_records`' docstring)
- Test: `components/agent-service/tests/test_agent_citations.py` (`WEB_FIELDS`; the field-coverage loop's third leg; the two boundary-pin rewrites; a new web projection pin)
- Test: `components/agent-service/tests/test_agent_verification.py` (the boundary pin's projection assertion reverses)

**Interfaces:**
- Consumes: `_is_web_provenance(provenance) -> bool` (citations.py:118-130, module-private, existing); `WEB_SEARCH_SOURCE = "web"` (contract.py:313); the ledger entries `{"provenance": dict, "text": str, "score": float|None}`; the no-agent hits `{"text", "provenance", "score"}`.
- Produces: `_web_entry(provenance, score=None) -> dict` returning `{"document_id": url, "document_name": title, "url": url, "score": score-or-None, "source": WEB_SEARCH_SOURCE}` — `title` falls back to the url when the provenance's `title` is absent or blank; `document_id` IS the url (the identity rule); the score coerces through the SAME rule as the ledger's (`int`/`float` → carried, anything else → `None`); **the score is NOT score-calibrated** — the calibrator normalises corpus-retrieval scores for the confidence display, and a SearXNG relevance score is a different scale; a web row carries the raw engine score.
- **The branch PLACEMENT (load-bearing — both builders differ):** the web branch goes **BEFORE the D1 `record_for` check** in BOTH builders (`record_for` returns `None` for any web provenance — if the D1 `continue` fires first, NO web entry ever projects and every pin stays red), and **AFTER the dedup lines** in `source_document_envelope` only (a literal first-branch there would bypass `hit_identity` dedup for web). In `source_documents_from_citations` there is no builder-level dedup (the ledger dedups upstream), so the branch sits at the loop top. Dedup therefore inherits: url-keyed via `hit_identity` in the no-agent builder, ledger-first-served in the governed one.

- [ ] **Step 1: Write the failing tests**

In `components/agent-service/tests/test_agent_citations.py`:

1. Add the constant beside the existing two:

```python
WEB_FIELDS = {"document_id", "document_name", "url", "score", "source"}
```

2. Extend the field-coverage loop (`test_every_projected_entry_carries_what_the_frontend_mapping_reads`, L360-381) with a third leg: a web provenance `{"source": "web", "url": "https://example.gov/policy", "title": "The policy"}` projected through `source_documents_from_citations` yields EXACTLY `WEB_FIELDS` keys, with `document_id == url`, `document_name == "The policy"`, `source == "web"`, and the url preserved verbatim (the frontend renders it clickable). **The leg's FIRST assertion is `assert len(entries) == 1`** — today the projection returns `[]`, and a naive single-entry unpack would red on IndexError instead of an assertion.

3. REWRITE AND RENAME `test_a_web_citation_is_delivered_but_not_projected` (L398-422) → `test_a_web_citation_is_delivered_and_projects_the_web_variant` (the old name states the behaviour the rewrite refutes — a pin must not wear a lying name): the delivery assertions stay (delivered text survives, `validity.invalid == ()`); the projection assertion REVERSES — `source_documents_from_citations(validity.delivered, records=SourceRecords())` now returns ONE entry, the web shape above — and the docstring records the landing: "the boundary landed in S3-plan-3: the web entry projects with the url as its identity". Also fix the section header above it ("and NOT projected (yet)") which goes stale.

4. REWRITE the projection assertion of `test_agent_verification.py`'s `test_a_web_only_run_verifies_through_the_judge_and_projects_nothing` (L664-692): rename it `test_a_web_only_run_verifies_through_the_judge_and_projects_the_web_variant`; the judge assertions stay (the judge ran over the web text); `verdict.payload()["source_documents"]` now carries ONE web entry whose `url` is the delivered citation's url and whose `document_id` equals that url.

5. Add one dedup pin, CONSTRUCTED THROUGH THE LEDGER (same-url citations cannot both ride the delivered list in the governed path — the ledger dedups on record; hand-built lists bypass that, so the construction must go through the ledger): build an `EvidenceLedger`, `record` a web tool result whose hits carry the SAME url twice with different titles, run `check_reference_validity`, THEN project `validity.delivered` — the delivered list already carries ONE citation, and the projection yields ONE entry (first served wins, url-keyed). Read `EvidenceLedger.record`'s signature in `agent/verification.py` and the existing ledger-building pins for the construction recipe.

- [ ] **Step 2: Run the pins and watch them fail**

Run: `cd components/agent-service && /tmp/genie-agent-service-venv/bin/python -m pytest tests/test_agent_citations.py tests/test_agent_verification.py -q`

Expected: FAIL on ASSERTIONS — the projections still return `[]` for web (the D1 drop stands until Step 3); `WEB_FIELDS` lives in this test file itself, so there is no import error.

- [ ] **Step 3: The implementation**

In `components/agent-service/capabilities/citations.py`:

1. Add the entry builder beside `_okf_entry` (L312-330):

```python
def _web_entry(provenance, score=None) -> dict:
    """The projected row of a web result. The provenance is SELF-CONTAINED —
    url and title travel with it, nothing resolves — so the row reads the
    provenance directly: the url is both the click target and the stable
    identity (``provenance_identity``'s web branch returns ``(source, url)``),
    the title names the card, and the score follows the ledger's one rule
    (an unreadable score is ``None``, never guessed into a number). The raw
    engine score is carried UNCALIBRATED — the score calibrator normalises
    corpus-retrieval scores, and a web relevance score is a different scale."""
    url = str(provenance.get("url") or "")
    title = str(provenance.get("title") or "").strip() or url
    readable = isinstance(score, (int, float))
    return {
        "document_id": url,
        "document_name": title,
        "url": url,
        "score": score if readable else None,
        "source": WEB_SEARCH_SOURCE,
    }
```

2. In `source_document_envelope` (L352-393): the branch goes INSIDE the provenance loop, AFTER the dedup lines (`hit_identity`/`seen`, L374-377) and BEFORE the `score_calibrator` line (L378) and the D1 `record_for` check (L379-383). The no-agent builder iterates OBJECTS and appends to `envelope`:

```python
        if _is_web_provenance(hit.provenance):
            envelope.append(_web_entry(hit.provenance, hit.score))
            continue
```

3. In `source_documents_from_citations` (L396-432): the branch goes at the TOP of the loop, BEFORE the D1 `record_for` check (L417-419) — this builder has no builder-level dedup and no calibrator (the ledger dedups upstream). It iterates dict entries named `citation` and appends to `envelope` — **both builders' list is named `envelope`; they differ in the ITERATION ACCESS, not the list name**:

```python
        if _is_web_provenance(citation["provenance"]):
            envelope.append(_web_entry(citation["provenance"], citation.get("score")))
            continue
```

(match each loop's REAL variable names — read both builders before pasting; the two snippets above differ on purpose: object access vs dict access.)

3. Update the module docstring's D1 paragraph (L25-30): the paragraph that says "``record_for`` resolves no record for a web provenance and the D1 rule keeps it out of ``source_documents``" becomes the landing statement — the web variant projects through `_web_entry` (self-contained provenance), while `record_for` and `resolve_source_records` still resolve NOTHING for web (there is no metadata source behind a web result; the provenance is the metadata).

4. `resolve_source_records` (L171-200): code UNCHANGED (web provenances keep contributing no ids — nothing to fetch); add one comment line where the loop skips them: "a web provenance resolves nothing — its projection reads the provenance itself".

- [ ] **Step 4: Run the pins and the FULL suite**

Run: `cd components/agent-service && /tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q`

Expected: green at exactly **`1079 passed`** (1078 baseline: the two boundary-pin rewrites keep one test each, the field-coverage leg extends its existing function in place, the dedup pin and the Task-1 web projection pins add — net +1). If `test_event_stream_gate.py` reds: STOP and report — the fixture moved, which the plan forbids.

- [ ] **Step 5: Lint**

```bash
cd components/agent-service
uvx ruff@0.16.3 check --no-cache capabilities/ tests/
uvx ruff@0.16.3 format --no-cache --check capabilities/ tests/
```

- [ ] **Step 6: Commit**

```bash
git add components/agent-service/capabilities/citations.py components/agent-service/tests/test_agent_citations.py components/agent-service/tests/test_agent_verification.py
git commit -m "feat(agent-service): the web citation projects with the url as its identity"
```

---

### Task 2: The BFF — the fallback mapping is REMOVED (amended 2026-11-27, operator decision)

> **Why the amendment:** the original task added a web branch to the
> BFF's `citationToSourceDocument` fallback. The operator ruled the
> fallback out ("les fallbacks cachent les bugs"; "le transitoire
> n'existe pas"). Verified before ruling: the agent service ALWAYS emits
> `source_documents` in its verdict payload (`agent/verification.py:489`,
> built unconditionally by `source_documents_from_citations`), so the
> fallback fires ONLY for a payload from an older agent-service image —
> and no such population exists anywhere: the whole agentic stack is
> pre-release (the `prd` branch); at a release both images ship
> together; the only skew window is seconds on a dev venue. A
> never-firing second implementation of the projection, in another
> language, is dead weight and a bug-hider (a service regression that
> drops `source_documents` would be silently absorbed as degraded
> rows). The service is the ONE owner of the projection; the BFF is a
> FORWARDER, not a mapper.
>
> NOTE: the branch carries an interim commit (`e9e1d61d7`) from the
> abandoned approach — it added a web branch to the fallback. This task
> subsumes it: the whole function goes.

**Files:**
- Modify: `components/gov-chat-backend/services/agent-run-contract.js` (delete `citationToSourceDocument` — JSDoc block + function, ~L98-138; simplify the ternary at ~L249-251; update the comment above it; drop the export at ~L449)
- Modify: `components/gov-chat-backend/__tests__/routes/agent-frame-writer.test.js` (remove every pin that exercises the fallback mapping and the `citationToSourceDocument` import; add the absence pin below)

**Interfaces:**
- Consumes: the metadata assembly at `agent-run-contract.js:249-251` — today `Array.isArray(verdict.source_documents) ? verdict.source_documents : (verdict.citations||[]).map(citationToSourceDocument).filter(Boolean)`.
- Produces: the same line reduced to `Array.isArray(verdict.source_documents) ? verdict.source_documents : []` — a verdict without `source_documents` yields `[]` (the deployed empty shape, the same value the legacy empty-stream base carries at L168). No mapping anywhere in the BFF.

- [ ] **Step 1: Write the failing test**

In `agent-frame-writer.test.js`, beside where the fallback pins lived:

```js
it('a verdict without source_documents carries no BFF-side mapping — the sources are empty', () => {
  // A payload naming only raw citations (an older service) maps to
  // NOTHING: the BFF is a forwarder, the service owns the projection.
  const metadata = /* assemble exactly as the neighbouring pins do,
      with a verdict that carries citations but NO source_documents */;
  expect(metadata.source_documents).toEqual([]);
});
```

Assemble the metadata the way the file's existing pins do (read the neighbouring verdict pins first and mirror their harness). Assert `toEqual([])` — NOT `toBeFalsy`: the empty ARRAY is the contract.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd components/gov-chat-backend && npx jest __tests__/routes/agent-frame-writer.test.js -t "carries no BFF-side mapping"`

Expected: FAIL — today the fallback maps the citations into rows, so `source_documents` is non-empty.

- [ ] **Step 3: The removal**

1. `agent-run-contract.js`: delete the `citationToSourceDocument` JSDoc + function (~L98-138) and its `module.exports` entry (~L449). Reduce the ternary (~L249-251) to `Array.isArray(verdict.source_documents) ? verdict.source_documents : []`. Update the comment above it: the BFF forwards the service's projection verbatim; a payload without it (an older service) carries empty sources — no mapping lives here.
2. `agent-frame-writer.test.js`: delete every fallback-mapping pin (including the interim web-branch pin from `e9e1d61d7`) and the `citationToSourceDocument` import; add the absence pin from Step 1.

- [ ] **Step 4: The BFF suite**

Run: `cd components/gov-chat-backend && npm test`

Expected: green. The suite SHRINKS by the removed pins' count (report before/after).

- [ ] **Step 5: Lint and format**

`rtk proxy npx eslint <changed paths>` and `rtk proxy npx prettier --check <changed paths>` from the component dir (rtk-wrapped npm scripts report phantom errors here).

- [ ] **Step 6: Commit**

```bash
git add components/gov-chat-backend/services/agent-run-contract.js components/gov-chat-backend/__tests__/routes/agent-frame-writer.test.js
git commit -m "refactor(bff): the BFF forwards the service's source_documents — the mapping fallback is removed"
```

---

### Task 3: The web frontend — the WEB badge (the click already works)

**Files:**
- Modify: `components/gov-chat-frontend/src/utils/okfCitation.js` (`isWebSource`; `webSourceBadge`; the no-drift comment)
- Modify: `components/gov-chat-frontend/src/store/modules/conversation.js` (`translateSources` — the mapped shape must CARRY the web marker)
- Modify: `components/gov-chat-frontend/src/components/ChatBotComponent.vue` (`fileBadge`'s web branch)
- Modify: `components/gov-chat-frontend/src/components/RightSideBarComponent.vue` (the same badge branch — its own badge method imports from okfCitation.js, RightSideBarComponent.vue:428-429)
- Test: `components/gov-chat-frontend/src/__tests__/utils/okfCitation.test.js` (EXISTS — append) and `src/__tests__/store/conversation.test.js` (the passthrough pin) and `src/__tests__/components/ChatBotComponent.test.js` (a badge pin)

**Interfaces:**
- Consumes: `fileBadge(d)` (ChatBotComponent.vue:1364-1371: okf → `okfConceptBadge()`, else `fileTypeBadge(...)`); `translateSources` (conversation.js:284-325) — **it does NOT pass a web row through unchanged**: `type` derives from the url's extension (`'GOV/POLICY'` for an extension-less path → garbage) and `source: isOkfConcept ? 'okf-concept' : undefined` DROPS the web marker; the card's external-URL branch (ChatBotComponent.vue:1382 — ALREADY opens `doc.url` in a new tab; NO change there).
- Produces: `isWebSource(row)` → `row?.source === 'web'`; `webSourceBadge()` → `{ label: 'WEB', tone: 'info' }` (match the shape `okfConceptBadge()` returns — read it first); `translateSources` for a non-okf row with `doc.source` truthy carries `source: doc.source` and sets `type: 'WEB'` (an extension-less url must not derive a garbage type); `fileBadge` returns `webSourceBadge()` for a web row BEFORE the file-extension fallback; the sidebar's badge call site gains the same branch through the shared helper.

- [ ] **Step 1: Write the failing tests**

```js
// okfCitation pin
it('badges a web citation as WEB, like the OKF badge, from the one definition', () => {
  expect(isWebSource({ source: 'web', url: 'https://x' })).toBe(true);
  expect(isWebSource({ source: 'okf-concept' })).toBe(false);
  expect(webSourceBadge()).toEqual({ label: 'WEB', tone: 'info' });
});
```

```js
// conversation.test.js pin — beside the translateSources pins (L692-754)
it('a projected web row keeps its source marker and takes the WEB type', () => {
  const [row] = translateSources([{
    document_id: 'https://example.gov/policy', document_name: 'The policy',
    url: 'https://example.gov/policy', score: null, source: 'web',
  }]);
  expect(row.source).toBe('web');
  expect(row.type).toBe('WEB');
  expect(row.url).toBe('https://example.gov/policy');
  expect(row.title).toBe('The policy');
});
```

```js
// ChatBotComponent pin — beside the OKF badge pin (L5241-5259; mirror its recipe:
// the same mount, the metadata frame's source_documents carrying the projected
// web row, delivered through capturedCallbacks.onMetadata)
it('badges a web citation as WEB, not as a file extension', async () => {
  // assert the rendered badge text is 'WEB' and the card's title is 'The policy'.
});
```

Read the OKF badge pin's mounting recipe (L5241-5259) and mirror it exactly.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd components/gov-chat-frontend && npm test -- okfCitation` and `npm test -- conversation` and `npm test -- ChatBotComponent -t "WEB"`

Expected: FAIL — `isWebSource`/`webSourceBadge` do not exist; `translateSources` drops `source` and derives a garbage `type`; the badge renders the file-extension fallback.

- [ ] **Step 3: The implementation**

`okfCitation.js`: add `isWebSource` and `webSourceBadge` beside the OKF pair (same export style), and extend the no-drift comment (L58-60) to name BOTH badge pairs. `conversation.js`'s `translateSources`: for a non-okf row, carry `source: doc.source` through the mapped shape (it is `undefined` today) and set `type: doc.source ? 'WEB' : (the existing derivation)` — the garbage extension type disappears for marked rows only; legacy rows keep the EXACT pre-existing shape (the byte-shape pin at L713-724 must stay green). `ChatBotComponent.vue`'s `fileBadge`: the web check BEFORE the fileTypeBadge fallback (after the OKF branch). `RightSideBarComponent.vue`: the same branch through its own badge method (it imports the helpers from okfCitation.js — RightSideBarComponent.vue:428-429).

- [ ] **Step 4: The frontend suite**

Run: `cd components/gov-chat-frontend && npm test`

Expected: green.

- [ ] **Step 5: Lint and format, then commit**

```bash
cd components/gov-chat-frontend && npm run lint && npm run format:check
git add components/gov-chat-frontend/src/utils/okfCitation.js components/gov-chat-frontend/src/store/modules/conversation.js components/gov-chat-frontend/src/components/ChatBotComponent.vue components/gov-chat-frontend/src/components/RightSideBarComponent.vue components/gov-chat-frontend/src/__tests__/
git commit -m "feat(frontend): the web citation badges as WEB and opens its url"
```

---

### Task 4: The mobile twin — the badge mirrors

**Files:**
- Modify: `mobile/genie_ai_mobile/lib/okf/okf_citation.dart` (`isWebSource`; the badge branch in `sourceBadge`)
- Test: `mobile/genie_ai_mobile/test/okf/answer_sources_bar_test.dart` (a badge pin: a web row shows 'WEB')
- Test: `mobile/genie_ai_mobile/test/okf/okf_citation_test.dart` (the DIRECT pins: the `sourceBadge` group at L103-130 gains the web row; `isWebSource` gains its true/false pair — the file's own convention pins the badge function directly, not only through the widget)

**Interfaces:**
- Consumes: `sourceBadge` (`mobile/genie_ai_mobile/lib/okf/okf_citation.dart:72` — the OKF/'extension' pair the web fileBadge mirrors); the bar's row rendering (`mobile/genie_ai_mobile/lib/components/chat/answer_sources_bar.dart`, badge call L101).
- Produces: `isWebSource(Map row)` → `row['source'] == 'web'`; `sourceBadge` returns the WEB badge for such a row before the extension fallback. The open path needs NO change (`_openCitation`'s external rung already launches a plain https `url`). **Tone note:** the bar renders only `tone == 'accent'` specially (L124, L133); the web badge's `'info'` tone renders neutral on mobile — the mirror is in the LABEL and the predicate, not the tone styling.

- [ ] **Step 1: The failing test** — mirror the OKF badge pin (test/okf/answer_sources_bar_test.dart:73-77): a row `{'document_id': 'https://example.gov/policy', 'document_name': 'The policy', 'url': 'https://example.gov/policy', 'source': 'web'}` renders the badge text `'WEB'`.

- [ ] **Step 2: Watch it fail** — `cd mobile/genie_ai_mobile && flutter test test/okf/answer_sources_bar_test.dart`

- [ ] **Step 3: The implementation** — `okf_citation.dart`: `isWebSource` + the `sourceBadge` branch (the exact mirror of the web fileBadge's branch).

- [ ] **Step 4: The mobile suite** — `flutter test` green.

- [ ] **Step 5: Commit**

```bash
git add mobile/genie_ai_mobile/lib/okf/okf_citation.dart mobile/genie_ai_mobile/test/okf/answer_sources_bar_test.dart mobile/genie_ai_mobile/test/okf/okf_citation_test.dart
git commit -m "feat(mobile): the web citation badges as WEB — the mirror of the web badge"
```

---

### Task 5: The E2E case and the gates

**Files:**
- Modify: `tests/e2e/chatbot/sse-contract.spec.js` (one new case in the existing spec — no new file, no executed-set pin change)
- Files: none for the gates (read-only; a red gate is fixed in the task that owns it)

**Interfaces:**
- Consumes: `mockChatStream` from `tests/e2e/helpers/chatbot.js` (L502 — it wraps `sseBody`, whose metadata spreads VERBATIM to the wire: stream-route.js:78) with the `{verdict}` option emitting the `agent_verdict` frame after the last chunk, before metadata (stream-route.js:68-76 — the BFF's pinned order). `sse-contract.spec.js` imports it from `../helpers/chatbot` (L10) and already carries the `GROUNDED_VERDICT`/`GROUNDED_METADATA` recipes (L25-69) to mirror.
- Produces: one spec case asserting a projected web row renders: `[data-testid="answer-sources"]` visible, one `[data-testid^="answer-source-card-"]`, the badge text `WEB`, and the card's title. The metadata frame carries `source_documents: [{document_id: 'https://example.gov/policy', document_name: 'The policy', url: 'https://example.gov/policy', score: null, source: 'web'}]`. The badge-text assertion mirrors real-rag's accepted locator pattern (handle + `.filter({ hasText })`, real-rag-citation.spec.js:163 — `getByText` is forbidden in scanned files).

- [ ] **Step 1: The spec case** — mirror the existing citation assertions (`real-rag-citation.spec.js:160-163` uses the same handles). Deterministic: exact waits with bounds, no fallback paths.

- [ ] **Step 2: The gates** — run the table:

| gate | command | expected |
|---|---|---|
| G1 the agent-service suite | `cd components/agent-service && /tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q` | the Task-1 count, green |
| G2 the frozen event stream | the same run (`test_event_stream_gate.py`) + `git diff --exit-code 8f08c84c4...HEAD -- components/agent-service/tests/fixtures/event_stream/` | green + SILENT |
| G3 the frozen capability contract | the same run (`test_equivalence_v02.py`) + the file's diff | green + UNTOUCHED |
| G4 lint | `uvx ruff@0.16.3 check --no-cache …` + `format --no-cache --check …` | silent |
| G5 the BFF suite + lint | `cd components/gov-chat-backend && npm test` + the component's lint/format scripts | green |
| G6 the frontend suite + lint/format | `cd components/gov-chat-frontend && npm test` + `npm run lint` + `npm run format:check` | green |
| G7 the mobile suite | `cd mobile/genie_ai_mobile && flutter test` | green |
| G8 the config-validator | `cd tests/config-validator && npm test` | green |
| G9 the e2e suite's eslint | `cd tests/e2e && npm run lint` (the new spec case must pass the scanned-file locator gate) | green |

- [ ] **Step 3: Report the gate table.**

---

## Out of scope

- **The live k8s deployment of the agent service** — the compose/ansible delivery; validated separately (the local three-process validation of 2026-11-27 covers the behaviour; the cluster deployment follows the CI candidate image).
- **`source_documents` entry dedup ACROSS variants** — a legacy file and a web page with the same identity cannot collide (different identity tuples); no cross-variant dedup is added.
- **The `invalid_citations` frame surface** — the verdict frame deletes it (agent-frame-writer.js:486-488); unchanged.
- **A favicon/thumbnail for web rows** — a new affordance needing a new handle; not in this slice.
- **Mobile patrol/E2E on device** — the flutter_test pins cover the widget; the patrol suite gains nothing here.

## What this plan establishes

| Design item | Where | Evidence |
|---|---|---|
| The web variant renders on web and mobile (spec §4.7) | the projection + both badge pairs | the pins above; the E2E case |
| The identity stays url-keyed (ADR agentic-009) | `provenance_identity` unchanged; `document_id` IS the url | the dedup pin (Task 1 Step 1.5) |
| The BFF is a forwarder, not a mapper — no mapping lives there | the fallback mapping is REMOVED (operator decision 2026-11-27); absence = empty sources | Task 2's absence pin |
| The no-drift rule extends to the second badge pair | okfCitation.js + okf_citation.dart, same turn | Tasks 3-4 |
