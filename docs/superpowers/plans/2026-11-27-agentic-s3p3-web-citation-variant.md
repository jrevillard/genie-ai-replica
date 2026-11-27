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

2. Extend the field-coverage loop (`test_every_projected_entry_carries_what_the_frontend_mapping_reads`, L360-385) with a third leg: a web provenance `{"source": "web", "url": "https://example.gov/policy", "title": "The policy"}` projected through `source_documents_from_citations` yields EXACTLY `WEB_FIELDS` keys, with `document_id == url`, `document_name == "The policy"`, `source == "web"`, and the url preserved verbatim (the frontend renders it clickable).

3. REWRITE AND RENAME `test_a_web_citation_is_delivered_but_not_projected` (L398-422) → `test_a_web_citation_is_delivered_and_projects_the_web_variant` (the old name states the behaviour the rewrite refutes — a pin must not wear a lying name): the delivery assertions stay (delivered text survives, `validity.invalid == ()`); the projection assertion REVERSES — `source_documents_from_citations(validity.delivered, records=SourceRecords())` now returns ONE entry, the web shape above — and the docstring records the landing: "the boundary landed in S3-plan-3: the web entry projects with the url as its identity". Also fix the section header above it ("and NOT projected (yet)") which goes stale.

4. REWRITE the projection assertion of `test_agent_verification.py`'s `test_a_web_only_run_verifies_through_the_judge_and_projects_nothing` (L664-692): rename it `test_a_web_only_run_verifies_through_the_judge_and_projects_the_web_variant`; the judge assertions stay (the judge ran over the web text); `verdict.payload()["source_documents"]` now carries ONE web entry whose `url` is the delivered citation's url and whose `document_id` equals that url.

5. Add one dedup pin, CONSTRUCTED THROUGH THE LEDGER (two hand-built delivered citations with the same url cannot exist — the ledger dedups on record): build an `EvidenceLedger`, `record` a web tool result whose hits carry the SAME url twice with different titles, run `check_reference_validity`, THEN project `validity.delivered` — the delivered list already carries ONE citation, and the projection yields ONE entry (first served wins, url-keyed). Read `EvidenceLedger.record`'s signature in `agent/verification.py` and the existing ledger-building pins for the construction recipe.

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

2. In `source_document_envelope` (L352-393): the branch goes INSIDE the provenance loop, AFTER the dedup lines (`hit_identity`/`seen`, L373-377) and BEFORE the D1 `record_for` check (L379-383). The no-agent builder iterates OBJECTS and appends to `envelope`:

```python
        if _is_web_provenance(hit.provenance):
            envelope.append(_web_entry(hit.provenance, hit.score))
            continue
```

3. In `source_documents_from_citations` (L396-432): the branch goes at the TOP of the loop, BEFORE the D1 `record_for` check (L417-419) — this builder has no builder-level dedup (the ledger dedups upstream). It iterates dict entries and appends to its entries list:

```python
        if _is_web_provenance(entry["provenance"]):
            projected.append(_web_entry(entry["provenance"], entry.get("score")))
            continue
```

(match each loop's REAL variable names — read both builders before pasting; the two snippets above differ on purpose: object vs dict access, `envelope` vs the governed list.)

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

### Task 2: The BFF — the fallback maps the web variant

**Files:**
- Modify: `components/gov-chat-backend/services/agent-run-contract.js` (`citationToSourceDocument`'s web branch; its comment)
- Test: `components/gov-chat-backend/__tests__/routes/agent-frame-writer.test.js` (one new pin)

**Interfaces:**
- Consumes: `citationToSourceDocument(citation)` (agent-run-contract.js:110-132) — the fallback for a payload that names only raw `citations`; `WEB_SEARCH_SOURCE = 'web'`.
- Produces: for a citation whose `provenance.source === 'web'`, the fallback returns `{document_id: provenance.url, document_name: provenance.title || provenance.url, url: provenance.url, categoryLabels: [], serviceLabels: [], score: citation.score ?? null, source: 'web'}` — the SAME FIELDS the frontend mapping reads, with the two label arrays empty as the fallback always carries them (the service's own row has 5 keys and no label arrays; the fallback's shape is its own — they agree on every field the frontend reads, which is the contract). The okf-concept and legacy branches stay first (unchanged); the web branch comes after the okf branch and before the legacy fallback.

- [ ] **Step 1: Write the failing test**

In `components/gov-chat-backend/__tests__/routes/agent-frame-writer.test.js`, beside the fallback pins (L341-412):

```js
it('the fallback maps a web citation to the projection shape the service emits', () => {
  const row = citationToSourceDocument({
    provenance: { source: 'web', url: 'https://example.gov/policy', title: 'The policy' },
    text: 'the policy text',
    score: 0.5,
  });
  expect(row).toEqual({
    document_id: 'https://example.gov/policy',
    document_name: 'The policy',
    url: 'https://example.gov/policy',
    categoryLabels: [],
    serviceLabels: [],
    score: 0.5,
    source: 'web',
  });
});
```

Import `citationToSourceDocument` the way the file's existing tests import it (read the import block first).

- [ ] **Step 2: Run it and watch it fail**

Run: `cd components/gov-chat-backend && npx jest __tests__/routes/agent-frame-writer.test.js -t "fallback maps a web citation"`

Expected: FAIL — today the fallback returns `document_id: undefined, document_name: ''` for a web citation (no `file_id`, no `concept_id`).

- [ ] **Step 3: The implementation**

In `agent-run-contract.js`'s `citationToSourceDocument`, after the okf-concept branch and before the legacy fallback:

```js
  if (citation.provenance?.source === 'web') {
    // The service's projection emits this exact shape for a web result
    // (document_id IS the url — the identity rule); the fallback agrees so
    // an older payload that names only raw citations maps to the same row.
    const url = String(citation.provenance.url || '');
    return {
      document_id: url,
      document_name: String(citation.provenance.title || url),
      url,
      categoryLabels: [],
      serviceLabels: [],
      score: typeof citation.score === 'number' ? citation.score : null,
      source: 'web',
    };
  }
```

- [ ] **Step 4: The BFF suite**

Run: `cd components/gov-chat-backend && npm test`

Expected: green (the new pin + the existing ones — the two fallback-derived rows at L360-382 are untouched: their fixtures are legacy/okf).

- [ ] **Step 5: Lint and format**

`npm run lint` and the component's format check, per its package scripts (from the component dir).

- [ ] **Step 6: Commit**

```bash
git add components/gov-chat-backend/services/agent-run-contract.js components/gov-chat-backend/__tests__/routes/agent-frame-writer.test.js
git commit -m "feat(bff): the citation fallback maps the web variant to the projection shape"
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

**Interfaces:**
- Consumes: `sourceBadge` (`mobile/genie_ai_mobile/lib/okf/okf_citation.dart:72` — the OKF/'extension' pair the web fileBadge mirrors); the bar's row rendering (`mobile/genie_ai_mobile/lib/components/chat/answer_sources_bar.dart`, badge call L101).
- Produces: `isWebSource(Map row)` → `row['source'] == 'web'`; `sourceBadge` returns the WEB badge for such a row before the extension fallback. The open path needs NO change (`_openCitation`'s external rung already launches a plain https `url`). **Tone note:** the bar renders only `tone == 'accent'` specially (L124, L133); the web badge's `'info'` tone renders neutral on mobile — the mirror is in the LABEL and the predicate, not the tone styling.

- [ ] **Step 1: The failing test** — mirror the OKF badge pin (test/okf/answer_sources_bar_test.dart:73-77): a row `{'document_id': 'https://example.gov/policy', 'document_name': 'The policy', 'url': 'https://example.gov/policy', 'source': 'web'}` renders the badge text `'WEB'`.

- [ ] **Step 2: Watch it fail** — `cd mobile/genie_ai_mobile && flutter test test/okf/answer_sources_bar_test.dart`

- [ ] **Step 3: The implementation** — `okf_citation.dart`: `isWebSource` + the `sourceBadge` branch (the exact mirror of the web fileBadge's branch).

- [ ] **Step 4: The mobile suite** — `flutter test` green.

- [ ] **Step 5: Commit**

```bash
git add mobile/genie_ai_mobile/lib/okf/okf_citation.dart mobile/genie_ai_mobile/test/okf/answer_sources_bar_test.dart
git commit -m "feat(mobile): the web citation badges as WEB — the mirror of the web badge"
```

---

### Task 5: The E2E case and the gates

**Files:**
- Modify: `tests/e2e/chatbot/sse-contract.spec.js` (one new case in the existing spec — no new file, no executed-set pin change)
- Files: none for the gates (read-only; a red gate is fixed in the task that owns it)

**Interfaces:**
- Consumes: `tests/e2e/helpers/stream-route.js`'s `mockChatStream(chunks, metadata, {verdict})` dialect (the `agent_verdict` frame after the last chunk, before metadata — the BFF's pinned order).
- Produces: one spec case asserting a projected web row renders: `[data-testid="answer-sources"]` visible, one `[data-testid^="answer-source-card-"]`, the badge text `WEB`, and the card's title. The metadata frame carries `source_documents: [{document_id: 'https://example.gov/policy', document_name: 'The policy', url: 'https://example.gov/policy', score: null, source: 'web'}]`.

- [ ] **Step 1: The spec case** — mirror the existing citation assertions (`real-rag-citation.spec.js:160-163` uses the same handles). Deterministic: exact waits with bounds, no fallback paths.

- [ ] **Step 2: The gates** — run the table:

| gate | command | expected |
|---|---|---|
| G1 the agent-service suite | `cd components/agent-service && /tmp/genie-agent-service-venv/bin/python -m pytest tests/ -q` | the Task-1 count, green |
| G2 the frozen event stream | the same run (`test_event_stream_gate.py`) + `git diff --exit-code 8f08c84c4...HEAD -- components/agent-service/tests/fixtures/event_stream/` | green + SILENT |
| G3 the frozen capability contract | the same run (`test_equivalence_v02.py`) + the file's diff | green + UNTOUCHED |
| G4 lint | `uvx ruff@0.16.3 check --no-cache …` + `format --no-cache --check …` | silent |
| G5 the BFF suite | `cd components/gov-chat-backend && npm test` | green |
| G6 the frontend suite | `cd components/gov-chat-frontend && npm test` | green |
| G7 the mobile suite | `cd mobile/genie_ai_mobile && flutter test` | green |
| G8 the config-validator | `cd tests/config-validator && npm test` | green |

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
| The BFF is a forwarder, not a mapper, for current payloads | the primary path unchanged; the fallback agrees with the service | Task 2's pin |
| The no-drift rule extends to the second badge pair | okfCitation.js + okf_citation.dart, same turn | Tasks 3-4 |
