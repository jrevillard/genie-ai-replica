---
baseline_commit: pending
---
# Story 2.3: OKF parser — frontmatter (v0.2 families) + body + structural links

Status: ready-for-dev
Story key: `2-3-okf-parser-frontmatter-links` | GitLab: #879 (`prd::okf-server`, `okf-server::epic-2`)
Epic: 2 (OKF Server — Repository Ingestion & Management) | Branch: `feat/okf-server`
FRs: **FR-6** (OKF-aware parsing), **FR-7** (structural link graph) | References: Architecture §4, §6 step 2, §8.1, §9; ADR-okf-010; ADR-okf-013; ADR-okf-017; ADR-okf-018

## Story

As a **platform engineer**,
I want **the OKF Server to parse concept `.md` files into metadata (frontmatter incl. v0.2 families), body, and structural link edges**,
so that **concepts are indexable and traversable by the downstream ingest/index pipeline**.

This is the **pure parsing module** that every ingest path (Story 2.5 bundle ingest, 2.4 conformance, 4.1 concept CRUD) calls. It is **ungated** (Node-only).

## Acceptance Criteria

1. **Pure transform, no persistence** — `services/parser-service.js` exports `parseConcept(markdown, ctx)` that returns a parsed object and performs **NO database I/O** (no `db-connection-service` import) and exposes **no HTTP route**. The *caller* persists to `okf_concepts_meta`; the parser is a reusable, stateless transform. (Architecture §6 separates parse [step 2] from persist [step 3]; ADR-okf-010.)
2. **Frontmatter extraction** — `gray-matter` parses the YAML frontmatter; the **full frontmatter object is preserved** (every key incl. v0.2 families AND unknown producer keys — forward-compat, ADR-okf-017 §6/§7: "never drop unrecognized frontmatter on round-trip"). The markdown **body** is returned with frontmatter stripped (handed to dataprep later; NOT chunked here).
3. **v0.2 families** — extracts + normalizes: `generated` (`{by, at}`), `verified` (array of `{by, at, …}`), `status` (`draft`|`stable`|`deprecated`), `stale_after` (`YYYY-MM-DD`), `sources` (array of credibility objects). All optional; absence yields a plain concept.
4. **Legacy fallback** (ADR-okf-017 §2) — if `generated` is absent, fall back to legacy frontmatter `timestamp` (→ `generated.at`); if frontmatter `sources` is absent, parse a body `# Citations` list → `sources`. Non-breaking; absence of both is fine.
5. **`trust_tier` derived** — computed from `verified` at parse time: `unverified` (no/empty `verified`) / `machine-confirmed` (all `by` actors are non-`human:`) / `human-reviewed` (any `by` starts with `human:`). Actor convention: `agent/tool`, `human:<id>`, `process:<name>`.
6. **Structural links** — `markdown-it` parses the body; each `[anchor](/path/to/concept.md)` link is resolved to a `{ to_concept_id, label }` where `to_concept_id` = the link target path with `.md` removed + normalized (strip leading `/`, `./`; POSIX separators), and `label` = the anchor text. Standard markdown links only (no wiki-link `[[…]]` — not in spec). Returned in a `links` array; the parser does NOT write `OKF_{repo_id}_LINKS_TO` edges (dataprep/Story 2.6 owns the physical edge write).
7. **Broken-link tolerance** (FR-7) — a link whose target concept does not (yet) exist is **tolerated, not fatal**: the link is still emitted (so backlinks work once the target appears) and counted; the parser never throws on a broken link.
8. **`concept_id`** = the concept's own path with `.md` removed (PRD glossary), normalized the same way as link targets.
9. **Attested Computation** — if `type: "Attested Computation"`, preserve `runtime`/`parameters`/`executor`/`attester` opaquely (do not interpret; full support deferred — ADR-okf-017 §6).
10. **Robustness + MELT + standards** — malformed frontmatter → a typed `ParseError` (not a crash); the parser is MELT-instrumented (`withSpan('okf.parse.concept')` + shared logger + `okf_parse_operations_total` counter). CommonJS, flat `services/` layout, shared-lib imports (`tracing`/`logger`/`metrics` only — **not** `db-connection-service`), ITU copyright headers, ESLint/Prettier clean, Jest tests with `.md` fixtures.

## Tasks / Subtasks

- [ ] **T1 — Dependencies** (AC: 2,6)
  - [ ] Add `gray-matter` (`^4.0.3`, CommonJS) + `markdown-it` (`^15.0.0`, CommonJS) to `components/okf-server/package.json` dependencies. **Do NOT use remark/unified** (the backend's `remark-parse` is ESM-only + untestable via jest.mock — explicitly avoided).
  - [ ] Regenerate + commit `components/okf-server/package-lock.json` (the Dockerfile's `npm ci --omit=dev` depends on it).
- [ ] **T2 — Parser service (pure transform)** (AC: 1,2,3,4,5,8,9)
  - [ ] `components/okf-server/services/parser-service.js` — export `parseConcept(markdown, ctx)` where `ctx = { repo_id, path, bundle_version }`. Returns `{ concept_id, repo_id, path, bundle_version, frontmatter, body, generated, verified, trust_tier, status, stale_after, sources, links }`.
  - [ ] Private helpers: `normalizeFrontmatter` (extract v0.2 families; preserve unknowns), `applyLegacyFallback` (`timestamp`→`generated.at`; body `# Citations`→`sources`), `deriveTrustTier(verified)`, `conceptIdFromPath(path)` (strip `.md`, normalize).
  - [ ] `class ParseError extends Error { code; status }` for malformed input (mirror `repository-service.js` `RepoError`).
- [ ] **T3 — Link extraction** (AC: 6,7)
  - [ ] Use `markdown-it` to walk inline links; for each `[text](target)` where target ends in `.md`, emit `{ to_concept_id, label: text }`. Normalize `to_concept_id` (strip leading `/`/`./`, forward slashes). Broken targets are still emitted (no existence check — the parser has no DB).
- [ ] **T4 — MELT** (AC: 10)
  - [ ] `withSpan('okf.parse.concept', span => { span.setAttribute('okf.repo_id', ctx.repo_id); span.setAttribute('okf.concept_id', concept_id); ... })` via `require('../shared-lib/tracing')`; `logger` via `'../shared-lib/logger'`; `okf_parse_operations_total` counter via `getMeter()` from `'../shared-lib/metrics'`. `recordOp('parse','success'|'error')` wrapped in try/catch (no-op when observability off).
- [ ] **T5 — Tests** (AC: 1–10)
  - [ ] `components/okf-server/__tests__/fixtures/` — `.md` fixtures: `concept-v02.md` (full families), `concept-legacy.md` (`timestamp` + body `# Citations`), `concept-broken-links.md`, `concept-attested.md` (`type: Attested Computation`), `concept-malformed.md` (bad YAML).
  - [ ] `components/okf-server/__tests__/parser-service.test.js` — **pure unit tests** (NO `db-connection-service` mock, NO `keycloak-auth-service` mock — the parser doesn't import either). Cover: frontmatter preserved (incl. unknowns); v0.2 families extracted; legacy fallback (both forms); `trust_tier` derivation (all 3 tiers); body stripped; links extracted with `label`; broken links tolerated; `concept_id` normalization; Attested-Computation opaque; malformed frontmatter → `ParseError`.
- [ ] **T6 — Lint/format/verify + deploy** (AC: 10)
  - [ ] `cd components/okf-server && npm run lint && npm run format:check && npm test` — all clean.
  - [ ] Deploy: rebuild the okf-server image (deps install via `npm ci`) + redeploy to the local build; smoke-verify by exec'ing `node -e "console.log(require('/app/services/parser-service').parseConcept('---\ntype: x\n---\nbody', {repo_id:'r',path:'p.md'}).trust_tier)"` in the container.

## Dev Notes

### The parser is a PURE TRANSFORM — no DB, no route (IMPORTANT)
Do **NOT** import `db-connection-service` into `parser-service.js`, and do **NOT** write to `okf_concepts_meta` from the parser. Architecture §6 separates **parse (step 2)** from **persist (step 3)**; Story 4.1's AC ("re-parse → … → **update** okf_concepts_meta") puts the write on the *caller*. The parser is consumed by 2.4 (conformance), 2.5 (ingest), 4.1 (CRUD) — keeping it I/O-free maximizes reuse + testability (parser tests need no db/jose mock). The physical `_LINKS_TO` edge write is the *caller's* job (Story 4.1 concept-CRUD writes the edges, ungated; arch §6-step6/§9 also reference dataprep-index-time writes — reconcile the exact owner in 4.1/2.6). The epic AC phrase "parsed concepts are handed to dataprep" is fulfilled by the **Story 2.5 bundle-ingest orchestrator**, not this parser.

### Primary pattern to mirror: `services/repository-service.js` (but pure)
- **File**: `services/parser-service.js` (flat layout, kebab-case — per project-context + Story 2.2's override of arch §8.1's `okf-parser/` dir).
- **MELT idiom**: `withSpan('okf.parse.concept', async (span) => { span.setAttribute(...); ... })` — exactly as `repository-service.js` does for repo ops. Non-PII attributes only (`okf.repo_id`, `okf.concept_id`).
- **Error idiom**: `class ParseError extends Error { constructor(code, message, status) {...} }` — mirror `RepoError`; the existing `middleware/error-handler.js` renders `{error, message}` (+ details for client errors).
- **Shared-lib imports** (these only — NOT db): `require('../shared-lib/tracing')` (withSpan), `'../shared-lib/logger'`, `'../shared-lib/metrics'` (getMeter). No `db-connection-service`.
- **Counter**: `const opsCounter = getMeter().createCounter('okf_parse_operations_total', {...})` + `recordOp` wrapped in try/catch (no-op when observability off) — copy the `recordOp` pattern verbatim.
- **luxon** for any timestamp handling; **never** native `Date`.

### Frontmatter schema (ADR-okf-017 + PRD glossary) — exact fields
Only `type` is conformance-required (§11) — and even a missing `type` is *ingested + flagged* (conformance is Story 2.4), never rejected by the parser. Every other field is optional.

| Family | Field | Shape |
|---|---|---|
| baseline | `type` | string (req for conformance; `"Attested Computation"` = opaque pass-through) |
| baseline | `title`, `description`, `resource`, `tags` | preserved |
| Trust | `generated` | `{ by, at }` — `by` = `agent/tool`\|`human:<id>`\|`process:<name>`; `at` = ISO-8601. **Legacy fallback**: `timestamp` → `generated.at`. |
| Trust | `verified` | array of `{ by, at, … }`. Derives `trust_tier`. |
| Lifecycle | `status` | enum `draft`\|`stable`\|`deprecated` (invalid → non-blocking, preserve) |
| Lifecycle | `stale_after` | `YYYY-MM-DD` (absolute; stale when today ≥ stale_after) |
| Provenance | `sources` | array of `{ author, resource, usage_count, last_modified, usage_window }`. **Legacy fallback**: body `# Citations` list → `sources`. |
| forward-compat | unknown keys | **PRESERVE verbatim** (never drop). |

### `trust_tier` derivation (ADR-okf-017 §3 — verbatim logic)
```
if (!verified || verified.length === 0) → 'unverified'
else if every entry's `by` does NOT start with 'human:' → 'machine-confirmed'
else (any entry's `by` starts with 'human:') → 'human-reviewed'
```
Defensive: `verified` may be authored as a bare object (not array) — normalize first: `verified = Array.isArray(verified) ? verified : (verified ? [verified] : [])`. Treat a malformed entry (no `by`) as non-`human:` so it can't falsely promote to `human-reviewed`.

### Link extraction (FR-7) — exact
- Syntax: standard markdown inline links `[<anchor>](<path/to/concept.md>)` (the authoring editor in Story 4.2 inserts `[…](/path/to/concept.md)`). No wiki-links. Walk `markdown-it` tokens of `type === 'link_open'` ONLY — exclude `image` tokens (`![alt](x.md)`); image embeds are not structural cross-links even when the target ends in `.md`. Emit one `{to_concept_id, label}` **per occurrence** — do NOT dedup (conformance counts per-occurrence; dedup is the edge-writer's concern); self-links emitted as-is.
- For each link whose target ends in `.md`: emit `{ to_concept_id, label }` where `to_concept_id` = target with `.md` stripped + normalized (strip leading `/` and `./`; force forward slashes), `label` = anchor text.
- **Broken links tolerated**: emit the link regardless of whether the target exists (the parser has no DB to check). Count is not the parser's job (that's conformance 2.4); just emit + log at debug.
- `concept_id` of the concept itself = its own `path` with `.md` stripped + normalized (same helper).

### Dependencies to ADD (not present repo-wide)
`gray-matter` (^4.0.3) + `markdown-it` (^15.0.0) — both CommonJS, `require()`-able, matches the story AC. **Avoid remark/unified** (backend's `remark-parse` ^11 is ESM-only, loaded via `await import()`, and untestable with `jest.mock` — the backend has a TODO lamenting this). Add to `package.json`, regenerate `package-lock.json`, commit it.

### Test patterns (pure — simplest in the codebase)
- Parser tests **do not** mock `db-connection-service` or `keycloak-auth-service` (the parser imports neither). They also **do not** load `index.js` → no jose/ESM issue.
- Use `__tests__/fixtures/*.md` (mirror doc-repo's fixtures dir). Read each fixture, call `parseConcept`, assert the parsed object.
- Jest config stays inline in `package.json` (no standalone `jest.config.js`).

### Inherited code-review fixes (DO NOT regress)
MELT on every method (withSpan + logger + counter) · shared libs IMPORTED not copied · no `_key`/`_id`/`_rev` in output (the parsed object has no Arango internals anyway) · snake_case + luxon ISO-8601 · all exceptions handled (malformed → ParseError; broken links tolerated) · ITU copyright header · `package-lock.json` committed. (The resilient `getDb` / DB-uniqueness fixes from 2.2 don't apply here — the parser has no DB.)

### Out of scope (later stories)
- **Persisting** the parsed object to `okf_concepts_meta` — caller's job (2.4 conformance, 2.5 ingest, 4.1 CRUD).
- **Physical `_LINKS_TO` edge write** — the *caller's* job (Story 4.1 concept-CRUD writes `OKF_{repo_id}_LINKS_TO` edges, ungated; arch §6-step6/§9 also reference dataprep — reconcile in 4.1/2.6). The parser only emits `links[]`.
- **Chunking/embedding** the body — dataprep (2.6).
- **Conformance validation** (§11) writing `conformance_issues` — Story 2.4.
- **PII redaction** (`pii_state`) — Story 2.8.
- **Bundle ingest route** (the orchestrator that calls this parser) — Story 2.5.
- **Staleness signal at serve / trust surfacing** — Stories 5.4.

### References
- [Source: epics.md#Story-2.3] (AC verbatim) · [Source: prd.md#FR-6,FR-7] · [Source: architecture.md#§4,§6-step2,§8.1,§9]
- [Source: docs/adr/okf-017-okf-v02-trust-lifecycle-provenance.md] (families + fallbacks + trust_tier)
- [Source: docs/adr/okf-010-okf-markdown-loader-location.md] (parser in Node; MVP scope; handoff to dataprep)
- [Source: docs/adr/okf-013-graph-name-wiring.md] (link/edge ↔ graph_name)
- [Source: components/okf-server/services/repository-service.js] (MELT/error/ParseError patterns to mirror)
- [Source: _bmad-output/project-context.md] (flat layout, CommonJS, shared-lib import standard)

## Dev Agent Record

### Agent Model Used
_(filled during dev-story)_

### Debug Log References

### Completion Notes List

### File List
