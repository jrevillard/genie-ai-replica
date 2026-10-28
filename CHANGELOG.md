# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Living Intelligence theme layer on the base theme.** A decorative layer — hero banner, dot mesh, bottom waves and corner network — is applied to the welcome screen and switched per deployment from the runtime config (`theme.visual`). The base theme ships it on; the derived flavours (`huduma`, `naat`, `original`) ship it off. Every artwork path is configurable, so an operator can swap an illustration without rebuilding an image — **the change goes in the repository, in the flavour's configuration file**: the deployment seeds the host's configuration directory as a mirror of the deployed branch (`rsync --archive --checksum --delete`), so a file changed on the host is reverted by the next deployment, and a file the branch no longer ships is removed. The deployment then verifies that the host matches the branch it just seeded, and refuses to sync a branch that does not ship the Keycloak theme the deployment is configured to use, or that carries a different brand than the host serves. A host that kept a stale configuration served a brand the branch no longer declared, and the app refused to start on it — a blank landing page behind a deploy that reported success. **The role's Ansible task was renamed** to `Rsync branch defaults to host runtime config dir (mirror the branch)`: a runbook that resumes the play with `--start-at-task` must use the new name.
- **Per-category tints on the welcome-screen cards.** The nine quick-help cards now carry the background, hover and border colours that were already declared in each button's `styles` block and were never read by the frontend.
- **`app.splash` in the runtime config.** The splash image is now a declared, per-deployment setting rather than an implicit fallback. The base theme ships the Living Intelligence globe splash; the derived flavours keep the bundled default.
- **RAG pipeline tracing:** LLM spans now record the model, the sampling
  parameters actually sent, token usage and the finish reason; retrieval spans
  record the search type, candidate fetch depth, whether a taxonomy label filter
  was active, the per-candidate dense and lexical scores aligned to the fused
  ranking, the RRF configuration in force, and whether graph traversal ran; chat
  turns record the multi-turn blend settings, the prompt token budget, and an
  event when the context-window guard truncates history. Streaming turns record
  their answer-level outcome (confidence, groundedness) on a span joined to the
  same trace — including turns that abstain, so an abstention rate computed over
  that span no longer reads as zero because abstentions went unrecorded.
  **Note on streamed token usage:** `llm.usage.*` on a streamed turn depends on
  `stream_options: {include_usage: true}` surviving the chatqna → textgen → vLLM
  chain. Verified against the shared vLLM 0.29 endpoint on 2026-10-24 (the flag
  survives; see the Fixed entry below). On a streamed turn the usage attributes
  are omitted rather than guessed if the flag does not arrive. The non-streamed
  path records usage unconditionally.

- **Trace-to-query correlation:** the spans on a chat turn carry
  `genie.query_id`, so a trace can be joined to the stored query document. The
  value is an opaque internal id. It is present when the request came through
  the web/mobile chat backend, which is what injects it; a client that talks to
  chatqna directly (a hand-crafted `curl`, an evaluation harness) sends no
  baggage, and those turns simply carry no correlation id. Document-ingestion
  traces are a separate span family: no span there carries a `query_id`
  attribute, because nothing in the ingestion path opens a query turn. The
  `baggage` header itself is propagated by document-repository too, so a
  correlation id present on an inbound call is carried on its outbound ones. No
  prompt, document or user text is added to any trace attribute.

- **RAG eval toolchain overhaul** (`tests/rag-benchmarks/eval/` + `tests/rag-benchmarks/scripts/`): a single command now drives a full RAG-quality evaluation on a deployed stack — Phase 3 dump-tuples + Phase 5 anchor + Phase 4 RAGAS — with provably-safe ROPC enable/disable (curl-K secrets off argv, container-side expansion via `docker exec -e`, re-auth inside trap, 3 retries, exit 9 on revert failure), in-run realm-token refresh (240s TTL, 401→refresh+retry, `EVAL_KC_URL` / `EVAL_KC_REALM` / `EVAL_KC_CLIENT_ID` / `EVAL_KC_USER` / `EVAL_KC_PASSWORD`), atomic out-writes, resume derived from rows (1-row-per-id invariant), and a per-run sidecar JSON (`.meta.json`) with `n_entries` / `n_tuples` / `n_http_errors` / `n_missed_traces` / `skipped` for post-run assertions. The retired `run_eval_chunked.py` orchestrator is replaced by direct `python3 run_eval.py` calls in `run_anchor_with_cleanup.sh`; `run_eval.py` exits deterministically (0 clean, 2 usage, 3 degraded, 4 zero-scored) so a single shell pipe can drive CI. New exit codes on the wrapper itself: 8 = ROPC enable failed, 9 = ROPC revert failed (the revert is the only one that leaves a real security hole, so the wrapper exits 9 and the operator must verify manually).
- **`tests/rag-benchmarks/eval/RUNBOOK.md`**: the new end-to-end recipe for the RAG eval toolchain. Five phases (0 pre-flight / 1 xlsx → gold / 2 match gold chunks / 3 dump-tuples / 4 RAGAS / 5 calibrate), each with copy-pasteable commands, env-var tables, exit-code maps, and a "When things go wrong" section (resume from `.done.jsonl`, salvage partial outputs, ROPC-left-enabled verification curl, chatqna warm-up, `ps` secrets spot-check, full `n_missed_traces` and `n_http_errors` triage tables). Replaces the old "use the script and hope" pattern. Generic placeholders only — no deployment-specific hostname, IP, stack, or DB name in the commands.
- **RAGAS judge pinned for sovereign deployments:** `tests/rag-benchmarks/eval/requirements.txt` pins `ragas==0.4.3`, `langchain-openai==1.6.7`, `langchain-community==0.4.2`, `langchain-core==1.6.6`, `openai==3.3.0`, `httpx==0.28.1`. The judge endpoint stays env-driven (`EVAL_JUDGE_BASE_URL` / `EVAL_JUDGE_API_KEY` / `EVAL_JUDGE_MODEL`), so any OpenAI-compatible LLM works (vLLM, LiteLLM, ollama, external API). Embeddings path is independent (`EVAL_EMBED_BASE_URL` / `EVAL_EMBED_MODEL`). The `langchain-community.vertexai` import is stubbed so the suite runs in a sovereign stack that does not have GCP credentials installed. Ragas `RunConfig.timeout` is now env-overridable via `EVAL_RAGAS_TIMEOUT` (default 600s — the previous 180s default silently NaN'd slow reasoning-judge rows on large `context_precision` prompts).
- **Adaptive-reranker offline calibrator pin:** `calibrate.py` accepts a custom grid (`--factors F1,F2,...` / `--thresholds T1,T2,...`) and exposes a `_strip_eq_prefix` helper so `--thresholds =-1.0,=-0.5` (the form the shell requires to escape leading `-` as an option flag) parses correctly without flipping the sign of negative thresholds. `--check-baseline` is the validity check — it replays the selection with the live capture params and asserts replay-vs-live recall delta is under 0.05; it must be paired with `--baseline-factor` equal to the live `CONTEXT_DECAY_FACTOR` at capture time.
- **Shared eval modules:** `eval/harness.py` (docker_exec wrapper + atomic JSON IO via tmp + `os.replace`, with `HarnessError`) and `eval/keycloak.py` (the only Keycloak token fetcher for the eval toolchain; the legacy Master Admin token path used by the wrapper is kept as a fallback). `eval/arango.py` exposes `source_chunks(graph_source, text_field, conn=None)` and the paginated `cursor(aql, *, url, db, user, password, batch_size, timeout)`, with one centralized `_api/cursor` implementation — `match_gold_chunks.py` and `run_eval.py` both delegate. The legacy benchmark suite (`benchmark_*.py` + `run_benchmarks.sh`, 2549 lines) is removed; latency and load-testing now happen on the OTel trace waterfall.
- **Capture baseline driver extended for the new harness:** `tests/rag-benchmarks/capture_baseline.py` now imports `docker_exec` + `write_json` from `harness.py` (was a local private copy), and its out-file write is atomic (was a non-atomic `open + json.dump` that could leave a truncated JSON on `SIGKILL`). The `EVAL_IDENTITY_FILES` set (used to compute `harness_sha` for baseline provenance) now includes `harness.py` and `keycloak.py`.

- **GPU OCR on dataprep:** `dataprep-arango-service` now declares `NVIDIA_VISIBLE_DEVICES=all` in the Swarm env (was previously unset, leaving the GPU-in-Docling/EasyOCR path inert despite `DOCLING_DEVICE=cuda` default). The v2.1.0 image already ships `torch==2.13.0+cu130` + `cuda-toolkit==13.0.3.0` + `nvidia-cudnn-cu13==9.20.0.48`, so no image rebuild is required. Requires a Swarm node with the `gpu == true` label and `nvidia-container-toolkit` installed (already in place for the 4 OPEA services).
- **Frontend responsive CSS overrides (Saved Chats card + dialog scroll pattern):** `theme-components.css` gains `:root body` selectors that fix mobile overflow on `ChatFolders.vue` (constrain `.chat-item` to parent width, add `flex-wrap` on `.chat-header` so actions drop to a second row when long titles crowd the sidebar) and pin the DsTabs nav inside fixed-height dialog bodies (`FileDetailsDialog` and any modal using `DsTabs` in a flex column) so the body scrolls while the tabs stay reachable — `.ds-tabs` flex-shrinks and `.ds-tabs__content` scrolls, with `min-width: 0` on the `.tab-content-details` grid items to keep long unbreakable strings (e.g. MIME types) inside their column. Backported from `release/el-salvador`. (!409)
- **Bulk-retract UI parity with bulk-ingest in Document Management** (`!469`): New "Retract Selected" button next to "Ingest Selected", mirroring the existing ingest path. Driven by the same `handleBatchAction(action)` dispatcher — `showRetractButton` computed blocks the button when any selected document is already retracted (case-insensitive, matching the symmetric `showIngestButton` filter). The handler opens a confirm dialog, calls the existing `POST /api/files/retract` batch endpoint, and surfaces per-file outcomes through the same 207 response handling. Translations added to all 14 supported locales (ar, bn, de, en, es, fr, id, man, pt, ru, st, sw, th, zh).
- **Query-instruction prefix for contrastive / instruction-tuned embedding models.** `QueryInstructionEmbeddingsWrapper` prepends the model-specific instruction to `embed_query` only — `embed_documents` (passage encoding during ingestion) passes through verbatim, preserving the query/passage asymmetry. Built-in coverage: `BAAI/bge-{large,base,small}-{en,zh}-v1.5`, `hkunlp/instructor`, `nomic-ai/nomic-embed`. Deployers extend via the `EMBEDDING_QUERY_INSTRUCTIONS` env var (`substring=instruction,substring=instruction`). The shared TEI embedding service stays prefix-free, so dataprep ingestion (passages) and retrieval (queries) coexist on a single microservice. Measured A/B on the live corpus (42 gold queries vs 850 chunks): +1.62% retrieval recall at K=32, +1.85% at K=50. No re-ingest required. **Behavior change for deployments using the local `HuggingFaceBgeEmbeddings` fallback** (no `TEI_EMBEDDING_ENDPOINT` set): langchain's default `query_instruction` (`"Represent this question for searching relevant passages: "`, with **"question"**) is cleared and replaced by the BAAI-canonical English string (`"Represent this sentence for searching relevant passages: "`, with **"sentence"**). The wrapper applies the prefix; langchain no longer does. Deployment paths that bypass the wrapper (direct `HuggingFaceBgeEmbeddings.embed_query()` usage outside the retriever) keep the langchain default. (#1035)
- **Condense-question rewrite (multi-turn retrieval mode):** a new `MULTI_TURN_MODE=condense` handles follow-up questions — one short LLM call rewrites each follow-up into a standalone retrieval query, so corrections ("forget the beans, tell me about maize planting") and pronoun follow-ups ("what is its yield?") retrieve the right documents instead of carrying the rejected or implicit subject in the query embedding. Retrieval and reranking use the rewritten query; the answer prompt keeps the original question and history. Fail-closed: a failed rewrite fails the turn with HTTP 503 rather than answering on a wrong retrieval. Tunables: `MULTI_TURN_CONDENSE_HISTORY_TURNS` (default 8 segments = 4 exchanges), `MULTI_TURN_CONDENSE_MAX_TOKENS` (256), `MULTI_TURN_CONDENSE_TIMEOUT_SECONDS` (5.0), `MULTI_TURN_CONDENSE_SYSTEM_PROMPT` (override the rewrite prompt — a custom prompt must still demand JSON-only output). The default mode is unchanged (`blend`).

### Changed

- **The Keycloak theme now covers every surface, not only the login page.**
  The admin console, the account console and the Keycloak emails carry the
  Living Intelligence look: the masthead is a pale wash of the brand instead of
  a solid brand slab (the console's own label sat on that `#4071cb` slab at
  2.25:1 and now reads at 14.1:1 — `#000d64` on the `#ddecff` wash), the pale
  ground shows behind the content panels, the wave
  band closes the sidebar, the admin welcome page shows the brand artwork, and
  the admin console's data tables carry the accent edge. The email template
  follows the same rules, and its images are fetched from the theme's own
  resources — Keycloak attaches nothing to an email, so the logo reference that
  was there resolved to a broken image in every mail client.

  A deployment that ships its own child theme keeps its own look: a child
  declares `styles` for every surface, so the base theme's stylesheets do not
  reach it, and the new console look — CSS only — does not either. See
  [Branding customization](https://opensource.unicc.org/genie-ai/docs/configure/branding-customization/)
  for how the theme resolution works.

- **The gateway revalidates the Keycloak theme resources.** Keycloak serves
  every theme resource with a 30-day `Cache-Control` and, unless the theme
  names a content hash, no validators, so a browser that fetched a stylesheet
  before a theme change keeps it for a month. The gateway now overrides that
  header (`no-cache, must-revalidate`) for the resources of every installed
  theme. Two families keep their long cache: the bundles under `assets/`, whose
  names carry their content hash (Keycloak answers their revalidation with a
  304), and the bundles under `vendor/`, which change only with the Keycloak
  version — and the version is part of the resource URL.

  The override applies to the copies fetched after it is deployed. A browser
  that fetched a stylesheet before that keeps its 30-day entry: the resources
  version in the URL is a database-stored tag that moves when Keycloak is
  upgraded, not when a theme is edited. See
  [Branding customization](https://opensource.unicc.org/genie-ai/docs/configure/branding-customization/)
  for the two levers that invalidate a browser's stored copy.

- **The login page's brand artwork is served in WebP.** The theme now ships the
  artwork in two formats — a 96 KB WebP and the 115 KB PNG — and the login
  template offers them through a `<picture>` element, so a browser that
  supports WebP fetches the smaller one and the others keep the PNG. Keycloak
  serves the WebP as `application/octet-stream`, which does not affect the
  rendering: the browser selects the source by its type and decodes the bytes
  itself. The console mastheads and the email keep a single PNG file, and mail
  clients do not read `<picture>` at all.

- **The gateway sends the `Permissions-Policy` header on every surface.** The
  header was declared once, at the server level, and nginx does not inherit an
  `add_header` into a location that declares one of its own — so the web app,
  the API and the Grafana route were served without it. The value now lives in
  one place and every location reads it, so a deployment's own policy applies
  everywhere.

- **On iOS and macOS, the trust-all TLS interception of the vendored
  `flutter_appauth` fork is now scoped to the OIDC provider's host.** The
  fork registered its `NSURLProtocol` process-globally for the duration of an
  insecure exchange (`allowInsecureConnections: true` — the `dev` and `e2e`
  flavors), so every request the app made during that window — API calls,
  telemetry, image fetches — was intercepted and its certificate check
  skipped. Registration now arms the provider's host and port (resolved
  from the request's `serviceConfiguration` endpoints, or its issuer or
  discovery URL) and the protocol refuses every other one, so unrelated
  traffic keeps its verification even mid exchange. Production flavors run
  with the flag off and are unaffected. Structured guards pin the scoping on
  both platforms.

### Removed

- **Breaking:** **`POST /api/service-categories/init` removed.** The route
  answered 500 on every call: it seeded a default taxonomy through
  `initializeDefaultCategoriesAndServices()`, a service method that no longer
  exists (removed during the migration of the service-category service to the
  translation collections), so the request failed with
  `TypeError: ...initializeDefaultCategoriesAndServices is not a function`.
  The endpoint is removed rather than restored — it had no caller (the web
  frontend, the mobile app and the deployment scripts never called it) and the
  taxonomy it seeded was a hard-coded English default list that matches no real
  deployment. Seed the taxonomy from the **Knowledge Hierarchy** tab of the
  Admin Dashboard, or with
  `components/gov-chat-backend/scripts/new-schema-scripts/create-knowledge-hierarchy.js`
  (turn the ArangoDB schema validation off for `serviceCategories`, `services`
  and `categoryServices` before running the script, and back on afterwards).
- **Breaking:** **`GET /api/analytics` removed.** Same defect as the endpoint
  above: the route called `analyticsService.getAnalytics()`, a method removed
  during the 2025 singleton refactor of the backend services, so it answered
  500 on every call — a malformed `filters` parameter was the one exception, it
  was rejected with 400 before the service was reached. No first-party client
  calls it: the web app reads `/api/analytics/dashboard` and the `/metric`,
  `/timeseries` and `/satisfaction` endpoints, and the mobile app never called
  it. It is removed rather than restored — read
  `GET /api/analytics/dashboard` for the overview.
- **The npm wrappers that created the database and seeded the taxonomy are
  gone.** `npm run setup-db`, `npm run init-categories` and `npm run setup-all`
  ran `node setup-db.js`, `node init-service-categories.js` and
  `node setup-all.js` from the package root, where those files have never
  existed — they were kept elsewhere in the repository and are now gone
  entirely — so every command failed with `MODULE_NOT_FOUND`, while the
  documentation presented them as the way to create the collections and seed
  the taxonomy. No action is needed on a deployed stack: the one-shot
  `db-migrations` job already creates every collection and index at deploy
  time. For a database managed outside Compose, run
  `node arango-schema-creator.js ./arango-schema.json` (after
  `source set-env.sh`) from
  `components/gov-chat-backend/scripts/new-schema-scripts`, and
  `node create-knowledge-hierarchy.js` to seed the taxonomy (which needs the
  ArangoDB schema validation turned off first — see the scripts' README).

### Fixed

- **The labelling prompt was different on every ingestion run.** The candidate
  labels sent to the labelling LLM were collected in a Python set, whose order
  follows the hash seed of the process that built it — so every container sent
  the same taxonomy in a different order, and the LLM could pick a different
  label set for the same chunk. The list now keeps the shape the backend
  returns — each category followed by the services under it — with a canonical
  order inside each category (case-folded name, exact name as the tie-break),
  independently of the order the taxonomy arrives in; the labels a chunk
  stores are in that same order. Two ingestion runs now send the same prompt,
  so an A/B comparison between labelling runs measures the change under test
  instead of the prompt ordering. A label whose translation is missing no
  longer reaches the prompt as the text "None": the per-fetch log line states
  how many entries carried no usable label and how many the payload held that
  the parser did not recognise. (#1109, !612)
- **The welcome screen's title is wrapped in a local scrim instead of a full-width band.** The scrim used to span the whole artwork, washing the icon tiles along with the text; it now hugs the heading and its subtitle and fades on every side, as the designer's mockup does.
- **The welcome screen's input bar was the wrong size.** It took 96 % of the card row's width and stood 90 px tall — a two-line field. It now takes 81 % of the row (805 px of 989 in the mockup) and rests at 50 px, one line, growing with what is typed into it.
- **The welcome screen's subtitle was unreadable in the dark theme.** Its grey sat at 3.05:1 against the artwork behind it, below the 4.5:1 floor WCAG AA sets for 16 px text. It is now a brand tint — 9.95:1 in the light theme, 8.91:1 in the dark one — and stays a visible step below the heading.
- **The welcome screen broke in the narrow-panel window.** With both sidebars open the panel is at its narrowest just above 1400 px: the title wrapped to two lines in the longer locales, and the wave band stopped short of the panel's edges. The title now holds one line in all 14 locales, and the wave band spans the panel's full width.
- **The welcome screen's input placeholder wrapped to two lines.** "Ask a question, explore knowledge, or start a task…" overflowed the field in 10 of the 14 locales, including the English one. The third clause is gone in every locale, and the placeholder is measured against the field in the regression test, so it cannot come back.
- **The label-filter strategy could not be changed in a deployment.** The
  retriever read the strategy from an environment variable that no deployment
  sets, so a deployment asking for `AND` (every label of the filter must be
  present on a chunk) filtered with `OR` (one matching label is enough). The
  retriever now reads the variable the deployment sets,
  `RETRIEVER_ARANGO_FILTER_STRATEGY`, and refuses to start when the value is
  neither `AND` nor `OR`. A deployment that set the old variable name must
  rename it. A check in the configuration validator now fails the build when
  one of the retriever's variables is read under another name, when the
  deployment configures a variable that a service reads but no container
  receives, or when a service reads a variable that no deployment file sets.
  (#614)

- **More links in the documentation site pointed at a page that did not answer
  the question.** The "Developer" card on the home page promised a local dev
  loop with `npm install` and `npm run dev`, but the page it opens explicitly
  tells you not to install anything on the host: the card now describes the
  loop that page actually delivers. The dashboard-customization page sent the
  reader to the Docker Compose quickstart for a Docker Swarm bring-up and
  promised the order in which to rebuild the frontend image — in Swarm the
  image is built by the pipeline and pinned by tag, so the page now points at
  the Swarm setup and says so. The two deployment guides sent their "next
  step" to the health checks for the creation of the first user and of the
  knowledge hierarchy, which the health-check page does not cover: they now
  point at the Keycloak admin guide and at the admin dashboard. The theme page
  sent the reader to the mobile architecture page for the Flutter design
  system, which is documented in the mobile UI component inventory. Two "report
  a problem" links went to the merge-request guide instead of the section that
  says how to report a problem. The pages that describe the ingestion log now
  point at the canonical reference in the Operations section, the pages that
  need an API token point at the API contracts, and the page that explains how
  to read a trace points at the tracing guide instead of the Operations landing
  page. (#608)

- **Links in the documentation site pointed at the wrong page or at the wrong
  section.** The link to the development guide on the home page pointed at
  `/docs/core/development-guide/`, an address no page ever carried: the reader
  got a 404. The deployment card next to it, and the links to the glossary, to
  the source-tree analysis and to the tracing page, resolved through a
  redirect to the page that has since moved, and the "Section -> Page" link
  texts still named sections that had been renamed, so the reader was sent to
  a section that no longer had that name. The addresses of the three renamed
  sections now stay the same whichever version of Hugo builds the site, and a
  new check in the CI pipeline fails when a link is broken, when it only works
  through a redirect, when the anchor it points at does not exist, or when a
  section address would depend on the Hugo version. The links to the source
  code pointed at gitlab.com, where the project does not exist, and now point
  at the self-hosted instance; the links to the NVIDIA container toolkit, to
  the vLLM documentation and to the JWKS specification pointed at pages that
  no longer exist. (#607)

- **Static-analysis follow-ups on the application code (SAST wave-7).**
  The translation example's two `requests.post` calls ran without a timeout
  and could hang on a stalled upstream — the translate call now times out
  after 30 s and the retriever call after 120 s, and the endpoint returns a
  fixed error message instead of echoing the upstream exception text. The
  chatqna `align_outputs` integrity checks used `assert`, which `python -O`
  strips — they now raise `ValueError` unconditionally. The dataprep
  ingestion lock file in the shared `/tmp` is opened with `O_NOFOLLOW` and
  mode `0600`, so a pre-planted symlink cannot redirect it, and a failed
  ingestion start no longer leaks the lock or leaves the decoded file
  behind. See `docs/security/cve-triage-2026q3.md` (wave-7) for the full
  triage, including the findings verified as non-issues. (#1101)

- **A mobile release build made without the `FLAVOR` dart-define now fails at
  startup instead of silently running the dev configuration.** `getConfig()`
  resolved the flavor from the `FLAVOR` compile-time define and fell back to
  `dev` when it was absent — so a release built without the define shipped
  with every endpoint pointed at `localhost` (the app could not authenticate
  anywhere) and the trust-all TLS client armed. In release or profile mode the
  missing define now throws a clear `StateError`; a debug `flutter run`
  without the define keeps the dev default for convenience. The guard is
  exercised in CI (`flutter test --dart-define=dart.vm.product=true`) and the
  documented build commands already set both selectors
  (`--flavor <name> --dart-define=FLAVOR=<name>`). Deriving the define from
  the build flavor itself remains open on the same issue. (#1099)
- **In the vendored `flutter_appauth` fork (Android), an end-session request
  could reuse the TLS setting of the previous sign-in instead of its own.**
  The end-session processor read `allowInsecureConnections` into a local
  variable while the connection builder and the authorization service read
  the plugin field — a field that only the sign-in and token paths assign.
  An end-session call therefore ran on whatever the previous call had set:
  after an insecure sign-in, a logout that asked for certificate verification
  still used the trust-all client, and on a fresh process the discovery fetch
  could use the wrong builder too. The flag is now read into the field, and a
  missing key defaults to `false` instead of throwing. No shipped code path
  calls the fork's end-session API today — the app's logout talks to Keycloak
  directly — so this hardens the vendored API surface rather than a user flow.
  A structural regression test in
  `test/config/flutter_appauth_insecure_gate_test.dart` fails if a rebased
  fork reintroduces the local. (#1102)
- **Streamed chat answers could end with raw transport JSON.** (!595) ChatQnA
  requests streamed token usage from vLLM (`stream_options.include_usage`,
  for the `llm.invoke` span); the terminal usage-only frame of that stream was
  re-emitted by the orchestrator as if it were answer text, so answers
  displayed in the web UI and mobile app — and scored by the RAGAS judge —
  ended with a `{"id":"chatcmpl-...","usage":{...}}` tail. The orchestrator now
  only re-emits lines it could not parse as JSON; any parsed frame that carries
  no forwardable content (the usage-only frame, a keepalive with
  `"choices": null`) feeds the tracing span and is skipped instead of leaking
  its raw JSON. Any deployment of a chatqna build that streams with the
  `include_usage` opt-in was exposed — the opt-in is sent on every streamed
  turn whether or not observability is enabled. Answers on
  `release/el-salvador` were never exposed (that build does not send the
  opt-in).

- **Virus scanning could not reach a ClamAV service running beside the
  document repository.** `CLAMSCAN_HOST` was read into the configuration and
  then dropped before it reached the scanner, so the scanner always dialled
  `localhost`. Any deployment that runs ClamAV as its own service — the
  Docker Compose topology — never had a working scan: the connection probe at
  initialization failed and every scan errored out. The configured host is now
  passed through.
- **The document repository could not validate tokens issued behind an edge
  proxy.** The expected issuer was derived from `KEYCLOAK_URL`, which is the
  address the service itself reaches. When TLS terminates upstream and the
  tokens carry the public issuer, every request was rejected as an invalid
  token. `KEYCLOAK_EXPECTED_ISSUER` now pins the issuer; leaving it unset
  keeps the derived value.
- **The backend's fallback AI/ML address pointed at a hostname from a test
  run.** With `OPEA_HOST` unset, queries were sent to `e2e-109-198:8888`, a
  host that only ever resolved on one machine. Both deployments that ship this
  service set the variable, so the fallback was dead weight carrying a wrong
  value; it is now the ChatQnA service name the compose file already uses, and
  the two places that built the URL share one helper.
- **Model-endpoint calls no longer carry per-site, drifting budgets — and one of them was silently emptying retrievals.** Each in-repo client to an LLM, embedding, rerank or control-plane endpoint had its own timeout: some inherited a library default, some had a literal nobody could find. A new shared module, `genie-ai-overlay/core/model_http_policy.py`, resolves them all from one place, and every call site now reads its budget from it. Three of those sites were actively harmful rather than merely undeclared:
  - **The retriever's embedding client and its document summarizer were unbounded, and both fail in ways an operator cannot see.** Neither was given a timeout at all: `langchain-openai` forwards `request_timeout` (default `None`) into the openai client, and an explicit `None` overrides the SDK's own 600 s default — a detail worth knowing because the openai default is the first thing anyone assumes is in force. A hung call on the embedding client returns `[]` from its `except` clause, and that short-circuits *ahead of* the hybrid/BM25 leg, so a contended GPU produced no documents at all and the chat answered from nothing without saying so. A hung summarizer re-raises, and the microservice maps it to a 500. Both now carry a budget (600 s each) — a new ceiling, not a restatement, so there is no pre-existing floor to reason from. **Lower the embedding one only knowing this**: the empty result is its failure mode, not an error.
  - **Bounding an `aiohttp` call can remove a ceiling it already had.** aiohttp's default session carries `sock_connect=30`, but constructing `ClientTimeout(total=X)` explicitly leaves `sock_connect=None`, which is no limit rather than "inherit". Two calls that were bounded by giving them a budget would therefore have traded a 30 s give-up on an unreachable endpoint for an unbounded wait — the exact failure this change exists to stop, introduced by the act of stopping it. Those two sites now set the connect ceiling explicitly.
  - **A `timeout=` given as a bare number silently discards the SDK's 5 s connect ceiling.** All four client classes accept it, and it replaces the whole `httpx.Timeout` object rather than shortening it — so a GPU node that stops answering waits the full budget instead of 5 s. Every timeout is now built by the policy's `http_timeout()` helper, which keeps that ceiling regardless of the total.
  - **The model-id probe behind the TTL cache had a hardcoded `timeout=10`.** It degrades to the configured model id on failure, which sounds harmless until the vLLM is still loading weights — that takes minutes — and the fallback then quietly picks the configured id instead of the served one, i.e. the wrong model rather than no model.
- **Half-translated answers when a GPU translation model was in use:** the
  output budget sent to vLLM was derived from the model's context length alone,
  leaving no room for the prompt. On a model with an 8192-token context, any
  prompt longer than roughly 128 tokens was rejected — with
  `TRANSLATION_BACKEND=gpu` the affected part of the answer and everything
  after it fell back to English; with `auto` the request quietly fell back to
  the CPU model instead. Affects every deployment that translates through a
  GPU (`TRANSLATION_BACKEND=gpu`, or `auto` when the GPU probe succeeds), in
  Docker Compose as well as Kubernetes; a short answer was never long enough to
  trip it, which is why it went unnoticed. The budget is now sized by what the
  translation can actually produce, which also stops a miscounted prompt (CJK
  runs near one token per character, where the estimate assumed four) from
  claiming the whole window. A translation that still runs past its budget is
  now detected and handed to the CPU model, rather than being served — and
  cached — half-finished. (!576)

- **The navbar controls in dark mode were below the WCAG AA contrast floor.** The dark theme paired a darkened text ink with a saturated brand band, leaving the icons, the language selector and the logout control between 1.74:1 and 2.17:1. The two themes' inks are now swapped, so the controls sit at 4.46:1 against the band.

- **The backend could not start with observability enabled (!565):** the OpenTelemetry
  setup read the shared propagator factory under a name that module does not
  export, so the process exited at startup with `Cannot read properties of
  undefined`. It affected `ENABLE_OBSERVABILITY=1` only (the default is `0`) and
  was never part of a release tag, so deployments built from a tagged release —
  including `release/el-salvador` — are unaffected. Builds of an unreleased
  `main` carried it, as did builds of the `feat/k8s-migration`, `feat/okf-*`
  and `fix/issue-1093-tracing-debt` branches. A boot-level regression test now
  covers it.
- **document-repository dropped the `baggage` header on its outbound calls
  (!565):** it installed a trace-context-only propagator, where the backend
  installed the composite one, so any correlation id arriving on an inbound call
  was discarded rather than carried onward. No current path was affected — the
  service sets no baggage of its own — so this closes a latent gap rather than
  a user-visible failure. Both services now take the propagator and the PII span
  processor from the same shared code instead of carrying two copies.
- The chunk indexes on a batched labelling span are recorded as a list instead
  of a text string such as `[0, 3, 7]`. **Expect a different population from any
  saved VictoriaTraces query or Grafana panel filtering
  `dataprep.chunk_indices`** — the value is now an array attribute, not a
  string. (#1093)
- **Ingestion spans are now held to the same tracing-vocabulary check as chat
  and retrieval (#1093):** all 13 dataprep spans and the 23 attribute keys they
  write are covered by the automated leak sweep, which previously stopped at the
  query path. Ingestion is the one place a span attribute comes from a
  client-supplied HTTP body rather than internal state, so an attribute carrying
  a filename or free text would reach VictoriaTraces undetected. The sweep reads
  span names and attribute keys out of the sources rather than from a list
  someone has to remember to extend, so a span or key added later is caught
  without a human editing a pin. This is a test-harness change — it does **not**
  filter values in production, so an id written with separators
  (`Contrat_de_Jean_Dupont_Q3.pdf`) still reaches the trace store. Constraining
  it means validating the ingest payload, not changing the vocabulary. (#1093)
  **What the sweep sees, precisely:** 98 of the 106 registered attribute keys are
  read from the source. The eight it cannot read are named in
  `genie-ai-overlay/tests/test_span_attrs.py` — seven
  (`llm.request.{max_tokens,top_p,temperature,frequency_penalty}`,
  `llm.usage.{prompt,completion,total}_tokens`) are stamped through a tuple of
  `(field, register_key)` pairs walked by a loop variable, and one
  (`llm.request.repetition_penalty`) has no writer because chatqna never sends
  that parameter. **Those seven are still checked at execution**, by the
  autouse teardown assertion — an injected free-text value fails the suite —
  but a new key written in that shape is not caught at authoring time. **Forms
  the source read does not follow:** a dict assembled at runtime (`{**attrs}`,
  or a mapping behind two or more wrapping calls) is reported by name instead of
  read, and a helper that takes an unrelated dict as a keyword argument beside
  the mapping is treated the same way.
- **Chat history was silently wiped on large prompts:** chatqna hardcoded a 4096-token assumption for the LLM context window while the served vLLM model exposes 65536 — any prompt over ~3.4k tokens drove the history-budget guard negative and the model received an empty `CHAT HISTORY:` with no log, no metric, no error. The window is now discovered at runtime from the vLLM `/v1/models` payload (`max_model_len` — same probe and cache entry as model-id detection, no extra HTTP call) and the probe targets the remote GPU node when configured, otherwise the compose-internal vLLM (`vllm:8000` / translation `:9031`), so local compose deployments now discover their real windows too. **Tiered semantics (breaking for this knob):** a deployer-set `MAX_MODEL_LEN_TEXTGEN` now *caps* the usable window even when discovery answers — a deliberate consumer-side limit (to cap what the model *serves*, use vLLM's `--max_model_len`); **if you set it in a previous deployment and want the full discovered window, remove it**. Unset, discovery wins; the 65536 constant (the project-standard Granite window) only applies when the probe fails (vLLM unreachable — endpoints that do not resolve fail in milliseconds) or the field is missing. Note the compose translation vLLM defaults to a 2048-token window — local translation history grows slightly (2000 → ~2300 chars), not shrinks. The answer-token cap no longer scales with the discovered window (stays 3896 when the request omits `max_tokens`). A **failed** probe is negative-cached for 60 s — where nothing answers (e.g. a core-only compose without the OPEA profile), chatqna retries once per minute and logs a `model_cache: probe failed` warning per retry: that warning is the signal, not an error. A deployer-set `MAX_TRANSLATION_CHARS` caps the derived budget even when discovery wins (the dense-script mitigation). The fallback knobs (`MAX_MODEL_LEN_TEXTGEN`, `MAX_TRANSLATION_CHARS`) are now forwarded to the chatqna container by docker-compose; window-discovery refresh follows the existing `MODEL_DETECT_TTL` knob (shared cache entry). The translation budget reserves room for the completion (input-sized output), the TranslateGemma output cap is clamped to the discovered window, and a proxy-serialized string `max_model_len` no longer poisons the cache. Every truncation now emits a warning log (with kept/dropped counts) and increments the `genie.ai/chat/history/truncated` counter (attribute: `path` = `generation`|`translation`). (`#1089`)
- **Query metadata no longer drops chatqna's diagnostic fields (!549):** stream captures are now persisted whole, so `abstained` / `abstention_reason` / `retrieval_confidence_score` / `self_confidence` reach ArangoDB instead of being parsed and discarded. An admin or a post-hoc eval can now tell an ingestion-side abstention from an ordinary low-confidence miss, and can see when an LLM self-grade overrode the retrieval score. The chat UI is unchanged — it renders `confidence_score` only. (`#1043`)
- **Reranker traces reported a strategy and a threshold that never ran (!550):** the `reranker.rerank` span read `RERANKING_STRATEGY` alone, but the reranker container does not define that variable — every trace carried the hardcoded `slice` default while `reranker.tei_invoke` in the same trace carried the strategy the request actually asked for. Both spans now resolve through one shared function, and an unknown or empty `reranking_strategy` resolves to the branch that really executes instead of the name that was requested. `reranker.score_threshold` is likewise no longer stamped on strategies that never consult it (`slice`, `knee_threshold`, `adaptive`). **Expect a different population from any saved VictoriaTraces query or Grafana panel filtering `reranker.strategy = "slice"`** — the value is now the real one. (`#1083`)
- **`repetition_penalty` was a dead knob on the chat path (!550):** chatqna set it on `LLMParams` with a `1.03` default, but both OPEA v1.5 textgen paths drop the field, so tuning it had no effect. Removed. If you were tuning it, that tuning was never reaching the model. (`#1085`)
- **RAG eval harness scored a serialised envelope instead of the answer (!551):** `run_eval.py::_extract_answer` resolved the answer with the key tuple `(text, answer, generated_text)`, but chatqna answers with `{"response": <text>, "metadata": {...}}`. The resolver missed, fell through every candidate, and returned a dump of the whole envelope — so every `dump-tuples` row, and every RAGAS metric reading that string, scored a JSON blob. **Reports built before this fix score a JSON blob, not the answer — discard them.** Re-run with `EVAL_FRESH=1`; a plain re-run resumes from the `.done.jsonl` sidecar and would rewrite the same blob-scored output. `response` now resolves on presence. `enrich_xlsx_v2._extract_response` is also fixed (a real answer that is valid JSON such as `{"resultado": 42}` unwrapped to an empty cell and its row then counted as answered rather than abstained), and it no longer mojibakes already-decoded non-ASCII text. Both functions now have unit coverage; the eval CI job runs them. (#1084)
- **Docs claimed `RERANKING_THRESHOLD` gates `knee_threshold` — it does not (!551):** `knee_threshold` cuts on the knee of the score curve and never reads the variable; when no knee is found it keeps every candidate. Six published tables and the troubleshooting recipe told operators to raise the variable to tighten a strategy that ignores it — including the `adaptive` default, which never reads it either. All now name the two strategies that do (`threshold` / `slice_threshold`). (#1086)

- **Ansible `image_tag_overrides` silently ignored:** the env template rendered per-service image vars with a doubled prefix (`GENIE_AI_GENIE_AI_<NAME>_IMAGE_TAG`) that docker-compose never referenced, so every service silently fell back to `GENIE_AI_GLOBAL_TAG` — per-service tag pins were a no-op on any deployment run from a `main` checkout (`release/el-salvador` already carried the correct rendering). The var-name derivation is now an anchored prefix strip declared once per loop, a config-validator test cross-checks every rendered var against docker-compose references (a recurrence fails CI instead of deploying the wrong image), and `image_tag_overrides` keys are validated at deploy time — a typo'd key or empty value fails loud instead of deploying the global tag. (!546)
- **Run-eval exit contract:** `run_eval.py` now exits deterministically (0 / 2 / 3 / 4) instead of the previous always-0 path. The contract: 0 = clean, 2 = usage error OR gold-mismatch (a resume .done.jsonl referenced ids not in the current gold — operator must run `EVAL_FRESH=1` or restore the prior gold), 3 = degraded (anchor: `skipped_entries` non-empty without `EVAL_ALLOW_PARTIAL` / `missed > EVAL_MAX_MISSED_TRACES` / `unmapped > 0` without `EVAL_ALLOW_UNMAPPED`; dump-tuples: `len(tuples) < len(entries)` without `EVAL_ALLOW_PARTIAL` / missed over threshold), 4 = zero scored rows. A crashed mid-run no longer silently returns 0 — the run surfaces its real state in the meta sidecar.
- **Atomic out-writes and per-run sidecar:** every per-query row is written via tmp + `os.replace`, so a `SIGKILL` mid-run leaves no half-written JSON. The meta sidecar `<out_path>.meta.json` (with `n_entries` / `n_tuples` / `n_http_errors` / `n_missed_traces` / `skipped`) is also written atomically — a non-atomic sidecar was a NaN trap on truncated files.
- **CHATQNA_CONTAINER re-resolved on docker-exec failure:** when a `docker service update` rotates the chatqna container mid-run (new replica suffix), the cached container name silently kills every subsequent query. `run_eval.py` now re-resolves on failure and lets the existing 3-attempt retry consume the recovered attempt. `VICTORIATRACES_SVC` is intentionally NOT re-resolved — it is a service DNS name, stable across service updates.
- **RAGAS judge n>1 generation collapse fixed:** `langchain-openai` 1.6.7 returns `ChatResult.generations` FLAT for the single input. The judge fan-out subclass (`_FanoutChatOpenAI` in `run_ragas_eval.py`) was previously written assuming the pre-1.x nested shape and iterated one level too deep, producing a list of pydantic field tuples per merge — the ChatResult validator then raised `ValidationError: generations.0 — input_value=[('text', ...)]` for every job. The merge now normalizes both shapes (pre-1.x nested + 1.x flat) and outputs the 1.x shape; usage totals are summed across the n parallel single-n calls. **No prompt-nonce is added** to distinguish the parallel calls — the ccr router was empirically verified (3 parallel identical prompts at temperature 0.7 returned 3 distinct completions) to NOT cache-dedup, so the n parallel calls are honest samples. The recipe to re-verify against a future gateway change is in the RUNBOOK's Phase 4.
- **Calibrate CLI negative-threshold sign-flip regression fixed:** a previous patch used `lstrip('=-')` which silently turned `-1.0` into `1.0` (sign flip). The new helper `_strip_eq_prefix` strips a single leading `=` only and never `-`, with a RED-first test (`test_strip_eq_prefix_does_not_flip_negative_signs`) pinning the behaviour. (`!509`)

- **Dataprep `DATAPREP_CHUNK_OVERLAP` silently inert at runtime:** `DATAPREP_CHUNK_OVERLAP` was declared in `env.j2` and read in code (`genieai_dataprep_microservice.py`), but `docker-compose.yaml` had no matching entry for the dataprep service, so the env var never reached the container and deployments could not tune overlap from Ansible/vars.yml. The doc-repo `POST /v1/dataprep/ingest_file` payload also omitted `chunk_overlap`, so no per-request override existed. Wired `DATAPREP_CHUNK_OVERLAP` through `docker-compose.yaml` (default `50`), extended `DocRepoIngestPayload` with an optional `chunkOverlap` field, and passed it through `fileController._ingestFileById` for both single and batch ingest routes (the batch Joi schema also gained `chunkOverlap` so it is no longer rejected as an unknown key). Rejects negative overlap at runtime. Override hierarchy: per-request `chunkOverlap` > `DATAPREP_CHUNK_OVERLAP` env > hardcoded 50. (!1033)
- **vllm-llm CUDA illegal-memory-access crash loop (RTX 6000 Ada):** The `vllm` Swarm service and the standalone-GPU `vllm-llm` service restart-looped under dataprep labeling load with `RuntimeError: CUDA error: an illegal memory access was encountered` at `gpu_model_runner.py` `sampled_token_ids.tolist()`. Root cause is a known race in vLLM 0.10 V1 between xgrammar guided JSON decoding, chunked prefill, and long-context concurrent requests (upstream vllm-project/vllm#19483, #24107, #23814, #28028). Default `--max_num_seqs` lowered from 64 to 32 across `docker-compose.yaml`, `docker-compose.gpu.yaml`, and `deploy/ansible/templates/docker-compose.gpu.yaml.j2`. Empirical starting point — the crash log showed 19 running requests at the time of failure; iterate to 16 / 8 if 32 is insufficient. Chunked prefill, prefix caching, and `gpu_memory_utilization` are unchanged to preserve the Contextual Retrieval long-prompt path, chat performance, and the shared-GPU memory split with `vllm-translation-guardrail`.
- **Weather third-party API removal:** Removed the `ipapi.co` (server location) and `nominatim.openstreetmap.org` (reverse geocoding) dependencies. Weather service now uses a bundled GeoNames cities500 dataset for offline reverse geocoding — no third-party calls for user-location resolution.
- **Chat markdown rendering:** Tightened the markdown renderer — strips the stray `<p>` wrap around list items and collapses the phantom `<ol>`/`<ul>` gap. Chat output no longer shows broken spacing around bullet lists.
- **Splash image from runtime config:** `SplashScreen.vue` previously hardcoded `src="/config/splash.png"`, ignoring `config.app.splash.value` which lets each deployment point at a branded splash. Every brand-customized splash image was invisible. `SplashScreen.vue` now accepts a `splashPath` prop (default `/config/splash.png`) and `App.vue` passes it from `config.app.splash.value`. (#394)
- **Mobile auth regression on ChatQnA:** drop `azp` claim check in `genie-ai-overlay/chatqna/keycloak_token_validator.py` to align with the Node.js services (`gov-chat-backend`, `document-repository`) which deliberately skip `azp` per standard OIDC Resource Server behavior. Token validation still enforces signature, issuer, and expiry. Resolves the per-flavor `KC_CLIENT_ID` deployment configuration that broke mobile auth on new country deployments.
- **Dataprep defensively creates the ArangoDB vector index on the embedding field (#1002):** New `ensure_vector_index()` helper in `genieai_dataprep_arangodb.py` runs post-ingest. Idempotent and dim/metric/nLists-aware: skip if the canonical `vector_index` (the langchain-arangodb default `ArangoVector.vector_index_name` — the same index the retriever queries) already matches, drop+recreate on dim/metric/nLists drift (e.g. an embedder model swap from bge-base 768-dim to bge-large 1024-dim). Telemetry via the `dataprep.ensure_vector_index` OTel span; status events routed through `_write_ingestion_log` so they appear in the UI. Defensive only — behaviour under the default `RETRIEVER_ARANGO_USE_APPROX_SEARCH=false` is unchanged.
- **Query Inspector shows the visible user question for Quick Help / dual-prompt queries:** `pickUserText(messages, userQuestion)` helper in `services/query-service.js` now prefers the frontend's explicit `userQuestion` field over the `messages` array tail when computing the value stored in `queries.text`. `ChatBotComponent.vue` now sends `userQuestion: messageForDisplay` alongside `messages` and filters out the streaming placeholder so the tail isn't empty. Previously Quick Help prompts (which use the dual-prompt swap to send a hidden persona prompt to OPEA) saved either an empty string or the hidden persona prompt to `queries.text`, leaving the Query Inspector blank. (!401)
- **Service-categories translation payload field names aligned (`lang`/`text` → `languageCode`/`translation`):** `services/service-category-service.js` now reads `trans.languageCode` / `trans.translation` (was `trans.lang` / `trans.text`) on POST/PUT for categories and services. Swagger spec in `routes/service-category-routes.js` updated to document the new field names (`required: [languageCode, translation]`, ISO 639-1 codes stored uppercased). **Breaking** for clients still sending the old field names — `lang` and `text` are no longer accepted and translations are silently lost on round-trips. (!407)
- **otel-collector-init `CAP_CHOWN` restored:** Regression from the 2.1.0 container least-privilege hardening (#320) — the otel-collector init container needed `CAP_CHOWN` to chown telemetry volume directories. Stacks with `ENABLE_OBSERVABILITY=1` had the init container failing silently. (!426)
- **Missing i18n key `weatherAuthRequired`:** Key referenced in `vue-i18n` translations but missing from several locale files, causing the weather auth-required UI to fall back to English in some locales. Dead key `weatherError` removed. (!430)
- **Markdown chunking now section-aware (.md files):** `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py::_load_and_chunk` routes `.md` through `MarkdownHeaderTextSplitter(headers=[H1-H4], strip_headers=True)` chained with `RecursiveCharacterTextSplitter(chunk_size=doc_path.chunk_size, chunk_overlap=doc_path.chunk_overlap)` — splits on heading hierarchy, caps each section at the configured `chunk_size` with intra-section overlap (never crossing `H1 → H2`), and prepends the joined section path (`## H1 > H2 > ...`) to each chunk so the LLM labeler and downstream retrieval see the heading context. Metadata filter strips `add_start_index`-injected ints before joining (`Document.metadata` from `split_documents` carries both the heading keys and the int offset; naive `.join(values)` crashed with `TypeError: expected str instance, int found`). Plain-prose chunks (no headers) and the existing `.html` / `.pdf` / non-md paths are unchanged. (#467)
- **Document Management batch ingest/retract silently dropped per-file failures** (`!469`): The frontend per-row checkbox and select-all pushed ArangoDB `_key` into `selectedDocuments`, but the backend batch handlers (`POST /api/files/ingest`, `POST /api/files/retract`) look up by semantic `file_id` via `metadataService.getMetadataById` — every batch call returned 404 for every file. The controller wrapped the per-file failures in a `200 {success: true, results: [...]}` envelope, so the UI showed a green "queued for ingestion" toast for a no-op. Now: backend batch endpoints return **207 Multi-Status** with `{success, successCount, failureCount, results[]}`; the frontend reads the payload and shows success / partial / all-failure toasts with per-file error detail, keeping only failed selections selected for retry; batch endpoints reject purely numeric IDs at the Joi validation layer as defense against a future `_key` regression. Swagger docs (`@swagger` annotations in `routes/fileRoutes.js`) updated to reflect the 207 contract and per-file result schema — previously they lied about a `200` response, which would have produced wrong client-generated types. Live-verified on the AgroGenio .102 deployment.
- **Post-batch reload could overwrite the precise batch-result toast:** `handleBatchAction` awaited `loadDocuments()` inside the same try/catch as the batch API call, so a stale-token 401 on reload (access tokens expire after 60s) tripped the outer catch and showed the generic "An error occurred during the batch ingestion process." toast — overwriting the success/partial toast that had already been set. Reload is now isolated in its own try/catch with a `console.warn`; a reload failure logs but never overrides the user-visible batch result. (!469)
- Reranker silently truncated inputs larger than 1024 tokens because TEI 1.9.3 computes the effective per-input cap as `min(model.max_position_embeddings, --max-batch-tokens)` and the deployed `--max-batch-tokens` was 1024. The cap is now aligned with the model (`bge-reranker-v2-m3` has `max_position_embeddings=8194`, `model_max_length=8192`) by raising `--max-batch-tokens` to 8192, and the silent-truncation path (`--auto-truncate=true` by default) is replaced with `--auto-truncate=false` so any input exceeding the 8192-token cap raises an HTTP 422 Validation (typed as `RerankerInputTooLong` in the wrapper, error_type `RerankerInputTooLong` by the reranker microservice) which chatqna translates into an abstention response (`abstained: true`, `abstention_reason: "reranker_input_too_long"`). A new Prometheus counter `rag.rerank.input_too_long` and a span attribute (`reranker.input_too_long`) make the condition operator-visible. New env vars `TEI_RERANKING_MAX_BATCH_TOKENS` (default `8192`), `TEI_RERANKING_AUTO_TRUNCATE` (default `false`), `TEI_RERANKING_MAX_CONCURRENT_REQUESTS` (default `32`) document the new TEI runtime caps; lower `MAX_CONCURRENT_REQUESTS` if VRAM budget tighter (bench-validated safe at 32 with shared vLLM on RTX 6000 Ada).
- Dataprep silently truncated chunks when the labeled/context-generated prompt exceeded the vLLM model context window because all five `client.chat.completions.create()` call sites (`_llm_call_single`, `_llm_call_batch`, `_context_batch_call`, `_context_doc_call`, `_context_single_call` in `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`) wrapped the call in a bare `except Exception` that retried three times on the identical oversized prompt and fell back to ingesting the raw chunk with `HTTP 200`. Topology A (`env.t4` `VLLM_MAX_MODEL_LEN=2048` or `env.rtx6000` `VLLM_MAX_MODEL_LEN=4096`) exposed the bug for every non-trivial document because `DATAPREP_CONTEXTUAL_DOC_BUDGET=100000` chars (~25k tokens) injected into the system prompt is 4-12× over the server cap. Topology B1 (`GPU_NODE_HOST` remote GPU) inherits the same silent path. Each call site now classifies `BadRequestError` (by message markers: `context length`, `maximum context length`, `reduce the length`, etc.) and raises the new typed exception `DataprepInputTooLongError(RuntimeError)`, increments the new Prometheus counter `rag.dataprep.input_too_long` (tagged by `dataprep.call_site`), sets the OTel span attribute `dataprep.input_too_long=true`, writes an ERROR-level entry to `_write_ingestion_log` (visible via `/api/admin/ingestion-log`), and aborts with HTTP 500 / OTel span error — surfacing the failure to operators instead of silently producing a degraded chunk. Non-context errors (guided-JSON parse failure, schema mismatch, transient 5xx) keep their existing silent raw-chunk fallback contract. The TEI embedding container (`docker-compose.yaml` `tei:` service, `bge-large-en-v1.5` with `max_position_embeddings=512`) gains the same fail-loud migration applied to the reranker fix: `--auto-truncate` is replaced with `--auto-truncate ${TEI_EMBEDDING_AUTO_TRUNCATE:-false}` + `--max-batch-tokens ${TEI_EMBEDDING_MAX_BATCH_TOKENS:-8192}` so long chunks now surface a 422 instead of being silently truncated. New env vars `TEI_EMBEDDING_AUTO_TRUNCATE` (default `false`) and `TEI_EMBEDDING_MAX_BATCH_TOKENS` (default `8192`) document the new TEI embedding caps in the project-root `env` template.
- ChatQnA translation silently fell back to the English source text on vLLM context-overflow responses because `_translate_text_chunk` (`genie-ai-overlay/chatqna/genieai_chatqna.py`) wrapped the `httpx` call in `except Exception` that returned the untranslated input — breaking the multilingual UX (issue #829) when the translation service responded with HTTP 400 `BadRequestError(context_length_exceeded)`. Now classifies the response by the same overflow markers (`context length`, `context_length_exceeded`, `maximum context length`, `reduce the length`) and raises the new typed exception `TranslationInputTooLongError(RuntimeError)` so the route layer can map to HTTP 422 instead of silently passing through a half-translated / English-only reply.
- Retriever summarizer silently propagated a 500 to chatqna when the summarization prompt exceeded the vLLM context window (`enable_summarizer=True` path in `genie-ai-overlay/retriever/genieai_retriever_arangodb.py::_initialize_llm`'s caller). Now classifies the same overflow markers and SKIPS summarization for that chunk — keeping the original `page_content` rather than crashing the chat — and emits the OTel span attributes `retriever.summarizer.input_too_long=true`, `retriever.summarizer.overflow_count=<N>`, and `retriever.summarizer.overflow_doc_ids=<json list>` once per ingest (cumulative counter + skipped doc ids, not a per-chunk boolean) so operators triage via VictoriaTraces which docs need a chunk-size override.
- **Abstention path translation overflow no longer returns HTTP 500 for non-EN users** (`genie-ai-overlay/chatqna/genieai_chatqna.py`): when the reranker aborts to the abstention branch with a non-EN `original_language` AND the translation service rejects the abstention text for exceeding the model's context window, the previously-unhandled `TranslationInputTooLongError` escaped the branch and surfaced as HTTP 500 to the user — breaking the documented `HTTP 200 + abstained=True + abstention_reason=reranker_input_too_long` contract. The abstention call to `_finalize_llm_response` now wraps the exception, falls back to the English source text, and stamps `metadata.translation_status="failed"` so the contract holds across the translation failure.
- **TEI `--auto-truncate` value normalized to lowercase across all 4 entrypoints** (root `docker-compose.yaml` `tei` + `tei_reranker`; GPU `docker-compose.gpu.yaml` `tei-embedding` + `tei-reranker`; `deploy/ansible/templates/docker-compose.gpu.yaml.j2`): operators can now set `TEI_EMBEDDING_AUTO_TRUNCATE=True` / `TEI_RERANKING_AUTO_TRUNCATE=Yes` in `.env` (Python-style booleans) without the TEI CLI rejecting the value at boot with `invalid bool value` (TEI's `text-embeddings-router` only accepts lowercase `true`/`false`). The normalization (`$(printf '%s' "$VAR" | tr '[:upper:]' '[:lower:]')` in compose, `| lower` in the Jinja2 template) is applied at runtime, so the rendered command remains a single inline string and no entrypoint script or volume mount is required. Hardening applies to both the embedding (`bge-large-en-v1.5`) and reranker (`bge-reranker-v2-m3`) containers.
- **Every markdown translation left an hour-long timer pending.** `translateMarkdown` raced the translation against a one-hour timeout but never cleared the timer, so every translated answer kept an outstanding handle alive for the rest of the hour. The timer is now cleared once the race settles, whatever the outcome.

### Changed

- **Model-endpoint HTTP budgets are configurable from one place.** `MODEL_LLM_TIMEOUT_SECONDS` (default 180), `MODEL_LLM_MAX_RETRIES` (2), `MODEL_SUMMARIZER_TIMEOUT_SECONDS` (600), `MODEL_EMBEDDING_TIMEOUT_SECONDS` (600), `MODEL_RERANK_TIMEOUT_SECONDS` (300), `MODEL_AUTH_TIMEOUT_SECONDS` (300), `MODEL_CONTROL_PLANE_TIMEOUT_SECONDS` (30) and `MODEL_PROBE_TIMEOUT_SECONDS` (10) are read by every in-repo call site instead of each site keeping its own default. Two are deliberately *not* tightened below a value chosen for a no-fallback call — the summarizer and TEI rerank, whose timeouts become a 500 on the user's chat request or a silently empty retrieval respectively. Their defaults are new ceilings rather than values that were already in force (see Fixed), chosen to match what the library defaults would have been, so that raising the deck's GPU load does not turn a working deployment into a failing one. `MODEL_AUTH_TIMEOUT_SECONDS` is dataprep's Keycloak service-account token fetch, kept separate from the 30 s control-plane budget because every ingestion-log write and document-status update waits on that token, one attempt, no retry, and re-raises on failure — there is no degradation route at all. `MODEL_LLM_MAX_RETRIES` reaches the clients that talk to the shared GPU and deliberately does not reach the retriever's two clients built from an `OPENAI_API_KEY`: those talk to the OpenAI API, where a 429 is the dominant transient failure and the SDK's own retry handling is what absorbs it, so setting the knob to 0 for a wedged vLLM node must not also switch that off. A value that is malformed, out of range or non-finite falls back to the default rather than deferring to any other name, so a typo in `.env` cannot stop a service from starting and cannot resolve to a budget you did not set. `MODEL_LLM_MAX_RETRIES=0` is honoured as a real value (disable SDK retries) — the one knob where zero is meaningful rather than an immediate-failure setting — and values above 10 are rejected, since a retry count multiplies the wait rather than bounding it. Under Ansible the same knobs are group vars (`model_llm_timeout_seconds` and friends in `group_vars/<env>/vars.yml`). **Not bounded here:** the retriever's `HuggingFaceEndpointEmbeddings` client, a pydantic model whose accepted fields depend on the pinned `langchain-huggingface`, where passing a `timeout` it does not declare fails at construction; and the vendored `comps` graph transformer, which reads `VLLM_TIMEOUT` through a bare `os.getenv` and would raise `TypeError` on the string it receives — tracked in `genie-ai-overlay/OVERRIDES.yaml`.
- **Document ingestion now degrades instead of stalling when the GPU is contended.** An ingest against a heavily shared GPU could stop making progress with no error and nothing new in the admin UI: a 260-chunk document issued 65 batched labelling calls, and after 13 minutes none had returned and none had failed. Three changes fix it. (1) The per-request budget for LLM calls drops from the client library's default of 600 s to **180 s**, and the same budget now reaches the dataprep, retriever and reranker clients that previously had none or their own default. (2) The labelling and context-generation phases run under a wall-clock budget and report progress into the document's ingestion log while they run, so a slow phase is distinguishable from a stalled one. (3) A phase that runs out of budget finishes on its fallback (file labels, or the raw chunk) rather than blocking — **and the document is then reported as `Ingested with Warnings`, not `Ingested`**, because some of it really did not land. That state was already in the API schema's status enum, in every locale's i18n catalogue and in the admin dashboard's status badge; nothing produced it until now. A clean ingest is still plain `Ingested`, so the state means something when it appears. **The status names which cause, because the causes have different fixes** — and only the budget one is fixed by raising a budget. The ingestion log carries one line per cause with the knob that fixes that one: *the phase budget ran out* (raise `DATAPREP_LLM_PHASE_TIMEOUT_SECONDS`), *the vLLM client could not be built* (fix `VLLM_ENDPOINT` or the model id), *context generation returned nothing* and *the labelling model returned no labels* (both: the endpoint is unreachable, or the model does not support `response_format=json_object`). Four cases behave identically from the outside and are told apart only by that line. In the labelling phase a budget-exhausted phase and an unbuildable client both leave chunks carrying the document's file labels; in the Contextual Retrieval phase they leave raw text instead. Either way only the log line separates "the GPU is too slow" from "the endpoint is down". A handful of chunks falling back while the rest succeed is normal operation and does **not** set the status — it is reserved for a phase that accomplished nothing, so it keeps meaning something. An unbuildable client no longer fails the whole ingest either: it used to be caught by the context phase and then re-raised by the labelling phase, which retracted a document that had a working file-label fallback, so which of the two phases ran first decided whether the ingest survived a misconfigured endpoint. **Re-ingesting a degraded document now clears its existing chunks first.** Re-ingesting is the remedy, and the document is indexed, but dataprep appends to the graph rather than replacing, so a re-ingest left a second copy of every chunk under the same file id — and the chunk count written back afterwards described only the new copy, so nothing visible reported the duplicate. The document's ingestion log is kept when this happens: it is the record of which cause made the document degraded in the first place. **Deployer impact:** a deployment whose GPU is slow enough that labelling now exceeds 180 s will see documents fall back to file labels instead of waiting. Raise `MODEL_LLM_TIMEOUT_SECONDS` **and** `DATAPREP_LLM_PHASE_TIMEOUT_SECONDS` together if that describes your setup — the phase budget is a flat ceiling for the whole document, it does not scale with the per-request budget, so raising only the first leaves the phase ceiling (900 s) as the binding constraint and the document still degrades. Keep the phase budget above BOTH `(1 + MODEL_LLM_MAX_RETRIES) x MODEL_LLM_TIMEOUT_SECONDS` and `waves x MODEL_LLM_TIMEOUT_SECONDS`, where `waves` is the document's batch count divided by `DATAPREP_MAX_CONCURRENT_BATCHES`. The second is the one that usually binds: a 260-chunk document is 65 batches at concurrency 20, so four waves share the one ceiling and it needs 4 x 180 = 720 s even when every call finishes inside its own budget. Under-sizing it there degrades a document whose calls all succeeded — the symptom reads as a labelling-quality regression. Dataprep warns at startup naming both constraints. The new `DATAPREP_LLM_PHASE_TIMEOUT_SECONDS` and `DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS` control the phase budget and the progress cadence. **Not bounded here: the vendored graph transformer.** It reads `VLLM_TIMEOUT` through a bare `os.getenv`, so an injected value arrives as a string; httpx 0.28 no longer coerces a string timeout and `socket.create_connection` rejects it outright (`TypeError: 'str' object cannot be interpreted as an integer`) — which `_process_batch` swallows, so every batch would fail extraction and the document would still report "Ingested" with an empty graph. Injecting it was worse than leaving it alone. The phase therefore keeps comps' own int 600 s default, which is also the right value for the one phase here with no degradation path. Binding it differently needs a patch to the vendored source, tracked in `genie-ai-overlay/OVERRIDES.yaml`. **Not covered:** the retriever's `HuggingFaceEndpointEmbeddings` client is deliberately left without a budget — it is a pydantic model whose accepted fields depend on the pinned `langchain-huggingface`, and passing a `timeout` it does not declare would fail at construction. A hung embedding call on that path is still unbounded.
- **Killing an ingest twice no longer leaves the document half-deleted.** The rollback the kill switch runs — retract what was written, then set the status to `Killed` — was a chain of `await`s inside the cancellation handler, and an `await` in a cancellation path is itself cancellable. A second `task.cancel()` (a double-clicked Kill; the endpoint accepts repeats) landed on its first await and skipped the rest, so the document kept some of its chunks — still served to the retriever — and its status was never set to `Killed`, leaving the admin UI showing a failure that had no recorded cause. The rollback now runs as a single uninterruptible step, bounded at 60 s; past that it is left running to completion rather than killed, because an overrunning rollback is recoverable and an interrupted one is not.
- **The retriever's document summarizer is no longer tightened to the LLM budget.** It had been given the 180 s LLM budget, a 3.3x cut from the openai default, on a call whose error path degrades only vLLM input overflow and re-raises everything else — so a timeout became a 500 on the user's chat request. That is the same shape of mistake already found and fixed on the reranker, repeated on a second site. It now carries `MODEL_SUMMARIZER_TIMEOUT_SECONDS`, default 600 s, which is exactly what an unconfigured client would have used: bounded and adjustable, but not failing faster than before. **Deployer impact:** none unless you were relying on the shorter budget; set the new knob lower if you were.
- **The dataprep phase ceiling is checked against the document, not the call, at startup.** `DATAPREP_LLM_PHASE_TIMEOUT_SECONDS` must stay above BOTH `waves x MODEL_LLM_TIMEOUT_SECONDS` and `(1 + MODEL_LLM_MAX_RETRIES) x MODEL_LLM_TIMEOUT_SECONDS`. The wave term is the one that usually binds: a 260-chunk document is 65 batches at concurrency 20, so four sequential waves share the one ceiling and it needs 4 x 180 = 720 s even when every call finishes inside its own budget. Sizing the ceiling against a single call's retry ladder alone — the obvious reading, and what this initially did — put the break-even per-call latency at 150 s, inside the 180 s budget, so a shared GPU answering a batched call in 160 s degraded every such document while each individual call was well inside its allowance. The default is now **900 s**, which clears four waves of calls at their full per-request budget; only a call that actually exhausts its ladder triggers degradation, which is the signal the bound exists for. Below either constraint the document lands as `Ingested with Warnings` rather than `Ingested`. Dataprep logs a warning at startup naming the values when the ceiling is too low, and the constraint is stated next to the knobs that carry it in both `env` and the Ansible group vars. Note that raising `MODEL_LLM_MAX_RETRIES` to 3 (720 s) still fits under 900 s — it is raising the *per-call* budget that crosses a limit: 300 s per call needs 1200 s of waves.
- **`dataprep.llm.timed_out` now fires when the phase budget is what expired.** The attribute was only ever written by the per-call timeout handler, so it covered a single call that exceeded its own allowance and not the case this work exists for: a phase wedged under the ceiling, where the tasks are cancelled rather than allowed to raise. A cancelled task never reaches the timeout handler, so the live incident — 65 batched calls, none returned, none failed, nothing logged — produced no such attribute at all. Each bounded phase now opens its own `dataprep.llm.phase` span carrying `dataprep.llm.phase`, `dataprep.llm.timed_out` and `dataprep.llm.timeout_seconds`.
- **The reranker's timeout budget stays at 300 s, not the LLM budget.** The LLM budgets are the ones that degrade — labelling falls back to file labels, context generation to the raw chunk — so tightening them costs quality rather than availability. The retriever's document summarizer is the third: its error path degrades only vLLM input overflow and re-raises everything else, so a timeout becomes a 500 on the chat request.

Shortening any of these converts a slow-but-successful call into a visible failure — or, for the embedding client, into a silently empty answer, because its `return []` short-circuits ahead of the BM25 leg. So they are budgeted as follows, and each is adjustable rather than fixed: the reranker stays at 300 s, exactly what an unconfigured aiohttp session would have applied; the summarizer and the embedding client both stay at 600 s. Neither was on the openai 600 s default, though, and this is the part worth stating plainly: `langchain-openai` forwards `timeout=request_timeout` into the openai client, `request_timeout` defaults to `None`, and an explicit `None` overrides the SDK default — so both calls were **unbounded**. 600 is a new ceiling chosen to match what the library default would have been, not a value that was in force. There is therefore no pre-existing floor to reason from: any value set here, above or below 600, is a new bound. Lower the embedding one only knowing what this call does when it misses — it returns `[]`, which short-circuits ahead of the BM25 leg, so too low a budget yields a silently empty answer rather than a visible failure.

- **GPU translation failures are no longer absorbed by the CPU model:** with
  `TRANSLATION_BACKEND=auto` the backend was chosen once at startup and then
  set aside — a request that failed was silently re-translated by NLLB on CPU,
  producing a different, lower-quality translation of the same answer with
  nothing in the output to show it. `auto` now probes the GPU translation
  endpoint once — a remote API or the in-network service, whichever
  `VLLM_TRANSLATION_ENDPOINT` points at — and stays with whatever answered,
  the way the dataprep device is resolved at load time. The CPU model is
  selected only when that startup probe itself fails **and no GPU API is
  configured** (see below). **A deployment that relied on the fallback will
  now see the affected text served in English:** the unit that failed is left
  untranslated and the rest of the answer follows.
- **A configured GPU API is mandatory: the backend now refuses to start rather
  than falling back to the CPU model.** A deployment that names a GPU API —
  `GPU_NODE_HOST` set, or a `VLLM_TRANSLATION_ENDPOINT` other than the
  in-cluster worker — always uses it, and `TRANSLATION_BACKEND` is not
  consulted: `cpu`, `gpu`, `auto` and unset all resolve to the GPU. If the API
  does not answer, the backend does not start. **Deployer impact:** a GPU node
  that is unreachable at boot now crash-loops the backend instead of silently
  serving English answers from a local model — content you routed to a remote
  GPU API will no longer quietly move onto one running inside the backend
  container. `TRANSLATION_BACKEND` keeps its meaning when no GPU API is
  configured. The startup probe budget is now `TRANSLATION_PROBE_TIMEOUT_SECONDS`
  (default 30, previously a hardcoded 5 s); it has to cover a cold TLS
  handshake to a remote node, and the endpoint's `/health` answers in tens of
  milliseconds once connected, so the previous 5 s was a false-negative waiting
  to happen rather than a bound on anything.
- **A streaming answer now says when its translation failed.** When the
  translation backend could not answer, the untranslated text was emitted and
  the stream carried on with no signal — the client received a fully English
  answer and no indication anything had gone wrong. The `done` event now
  carries `translationFailed`, and the answer it belongs to shows a short
  "translation unavailable" notice. It is deliberately **not** an `error`
  event: the web client treats that as terminal, stops reading the stream, and
  reports the whole system as down, none of which is true when only the
  translator failed and the answer is complete. This also fixes the same
  misreporting on the existing post-stream path, which has been emitting an
  `error` event ahead of `done` — so a translation failure at the end of an
  answer used to mark the deployment offline.
- **Breaking: a runtime config that does not match its own schema now stops the web app from starting,** and the failing paths are reported. The schema embedded in each `genie-ai-config*.json` is enforced at load time, so a hand-edited or truncated config fails loudly instead of booting into a half-themed site. A config file that cannot be fetched at all still falls back to the bundled defaults and starts normally. Operators running a modified config should validate it before deploying: `npm run validate:config` in `components/gov-chat-frontend`.
- **Breaking: the navbar in light mode is now a pale band carrying the brand wordmark,** instead of a solid brand-blue bar. The change is driven by the shared `--navbar-bg` and `--navbar-fg` tokens, so it applies to every deployment, including the derived flavours, on every route. Operators who prefer the previous solid bar override `--navbar-bg` in `theme-variables.css`.
- **The welcome-screen cards now follow their column instead of the viewport,** so the four-column grid survives on a narrow screen instead of being crushed into a single 600 px column. The grid breakpoints are unchanged on a desktop-width screen.

- **Legacy benchmark suite removed** (`tests/rag-benchmarks/{benchmark_*.py, run_benchmarks.sh}`, 2549 lines): the scripts were run-once-and-never-rerun, had no live test, and produced numbers that drifted from the rest of the eval surface. Latency and load-testing now live on the OTel trace waterfall (Grafana RAG Pipeline Trace Waterfall dashboard) — the OTel collector already captures every request with `latency` and `http.status_code` attributes, so the dashboards cover the same question without a separate harness. The site docs (`source-tree-analysis.md`) no longer mention the deleted files.
- **Wrapper ROPC `EVAL_DEPLOY_ENV` is no longer defaulted:** the wrapper used to silently fall back to `/opt/genieai-el-salvador/.env` when the env var was unset — a stack-specific hardcode inside a script that should be generic. The wrapper now fails LOUD with `:?` and a message naming the expected `/opt/<stack>/.env` pattern (per `deploy/ansible/templates/env.j2` layout) when neither the env var nor `GENIE_ADMIN_PASSWORD` is set. The MR replaces the runbook / docs and the wrapper's "wrapper / argparse defaults" table to make the override path explicit.
- **Per-context manual slicing heredocs removed from the root `CLAUDE.md` golden-dataset recipe:** the manual `for i in range(N): chunk = dict(gold); chunk['entries'] = gold['entries'][i::N]; open(f'/tmp/batches/gold_{i:02d}.json', 'w').write(json.dumps(chunk))` loop is gone — `run_eval.py` now slices the gold internally when `EVAL_CHUNK_SIZE` is set, and the sidecar already records per-chunk progress so a manual round-robin shell loop is no longer needed.
- **Eval reports and gold datasets stop tracking new artifacts in `tests/rag-benchmarks/eval/{eval-reports,gold_datasets}/` for code-only changes:** campaign-generated Markdown reports and the campaign gold dataset stay on the integration branch (`feat/eval-toolchain`) for traceability but do not ship to `main` in a code-only MR. The directories themselves are kept (with a README) so future eval runs have a place to land.
- **`run_ragas_eval.py` judge requires `n_samples=3` to actually emit 3 samples:** when a single OpenAI-compatible LLM endpoint rejects `n>1` upstream (the ccr router / MiniMax-M3 case), the previous `langchain-openai` fallback collapsed to a single sample, NaN'ing the `answer_relevancy` metric. The fan-out subclass now fires n independent single-n calls in parallel (`ThreadPoolExecutor` for `_generate`, `asyncio.gather` for `_agenerate`) and merges the results. **Performance note:** the wall-clock cost of the merged result is ~max(single-call latency) instead of the naive ~n× that the previous serialization would have imposed — verified by sibling-overlap tests.
- **`run_eval.py` and `keycloak.py` no longer pin `langchain_community.vertexai` at import time** — the `vertexai` import is now stubbed in `run_ragas_eval.py` so sovereign stacks that do not have GCP credentials installed can still run the suite. Deployers on GCP should override the stub by installing `langchain-community[vertexai]` as before.

- **Default embedding model `bge-base-en-v1.5` → `bge-large-en-v1.5`:** New deployments now use the 1024-dim `BAAI/bge-large-en-v1.5` model by default for better semantic recall on multilingual/agricultural corpora. The smaller `BAAI/bge-base-en-v1.5` (768-dim) remains available as an opt-in override via `embedding_model_id` in `group_vars/<env>/vars.yml` or `EMBEDDING_MODEL_ID` in `.env`. Embedding latency ~3× higher (~10 ms/query vs ~3 ms), VRAM footprint +~0.9 GB (~1.3 GB total), per-chunk storage +1 KB. **Existing deployments that already ingested with bge-base must re-ingest their documents** — querying against mismatched dims silently returns empty results. Re-deploy the GPU node after merging to pick up the new default.
- **vLLM bump v0.10.0 to v0.29.0 (both services):** Mitigates the persistent CUDA illegal-memory-access crash loop in the chat/labeling vLLM under dataprep labeling load (vllm-project/vllm#23814, #24107 family — closed stale, no documented fix). Both `vllm-llm` and `vllm-translation` images are bumped for version consistency. The `--max_num_seqs` default is also lowered from 64 to 16 (iterative tuning showed no measurable effect on the crash, but kept as defense in depth).
- **Contextual Retrieval default strategy `doc_level` → `per_chunk`:** `CONTEXTUAL_STRATEGY` env default now follows the Anthropic recipe (one context-generation call per chunk with section-tailored context) instead of one call per document. Deployers who relied on the previous default should re-evaluate context quality on existing corpora. (!406)
- **Default chatqna abstention prompt updated:** Built-in fallback when `CHATQNA_ABSTENTION_INSTRUCTIONS` is unset now instructs the LLM to surface partial KB content with an up-front disclaimer about ungrounded training-data fill-in (`_DEFAULT_CHATQNA_ABSTENTION_INSTRUCTIONS` in `genieai_chatqna.py`, header `[No Relevant Documents Found]`). Replaces the legacy "State clearly that you cannot answer" wording. Deployers can override the prompt via the `CHATQNA_ABSTENTION_INSTRUCTIONS` env var (now templated in `deploy/ansible/templates/env.j2`). (!456)

- **Breaking: theme and branding files are now read from the host and can be edited without rebuilding images.** The theme stylesheet, the runtime JSON config, the logos, the splash images and the whole Keycloak `genie` theme are served from two directories on the node instead of from inside the images. To change them, edit the file and reload the browser — the web app serves the mounted files live. Only Keycloak needs a container restart (`docker service update --force <stack>_keycloak`), because it caches themes in memory. No image rebuild and no redeploy are needed.
- **Breaking: the deployment now needs two new host directories.** They are `<config_dir>/frontend/` and `<config_dir>/keycloak/themes/` (the directory that contains the Keycloak themes — `genie/` and any additional themes sit inside it). `config_dir` defaults to `/opt/genieai/config` and follows the `deploy_dir` group var if your deployment overrides it. A normal `ansible-playbook deploy.yml --tags deploy` creates and fills them, so an Ansible deployment needs no manual step. If you deploy by hand, create both directories and copy the files in, or the site comes up without any branding.
- **Air-gapped deployments: Keycloak is no longer a GENIE.AI image.** The stack now runs `quay.io/keycloak/keycloak:26.7.0` straight from upstream instead of building its own. That image is not in the internal GitLab registry. One image fewer to build, but you must also mirror the Keycloak image itself. Theme bootstrap additionally downloads the branding archives from the GitLab repository-archive endpoint on every deploy node: an air-gapped node must either reach that endpoint or have both host config directories pre-seeded by hand with `config_bootstrap_sync_enabled: false`.
- **One fewer image in the internal registry:** GENIE.AI no longer builds and publishes `genie-ai-keycloak` (16 images down to 15). Air-gapped operators should copy 15 GENIE.AI images plus the upstream Keycloak image.
- **Breaking: `OPEA_SSL_SKIP_VERIFY` is now required for a self-signed GPU node instead of being implied by `VLLM_API_KEY`.** Turning certificate verification off was previously a side effect of configuring a remote GPU API key. It is now explicit, because a deployment that needs it should say so and a deployment that does not should not have it decided for it. **Action:** if you set `GPU_NODE_HOST` and the GPU node serves a self-signed certificate, set `OPEA_SSL_SKIP_VERIFY=1` (Ansible: `opea_ssl_skip_verify: "1"` in `group_vars/<env>/vars.yml`). Without it the deployment completes and then fails at its first call to a model with `CERTIFICATE_VERIFY_FAILED`. Deployments using Let's Encrypt or a recognized CA, and any deployment without a remote GPU node, need no change.

- **Browser cache headers fixed for theme files.** The theme stylesheet, the runtime config file and the theme fallback stylesheet were previously served with a one-year "immutable" cache, which meant a change could stay invisible in the browser for a year. They are now re-checked on every load. Users who visit the site once after this update should do a hard reload (Ctrl+Shift+R) so the browser drops its old copies.

### Removed

- **`GENIE_AI_KEYCLOAK_IMAGE` and `GENIE_AI_KEYCLOAK_IMAGE_TAG` removed from `env`:** Keycloak is no longer built and published by GENIE.AI, so there is no image ref to override. Delete both lines from any local `.env`; they are ignored if left in place. (`GENIE_AI_KEYCLOAK_CONFIG_IMAGE` is a different image and is unaffected.)

### Security

- **Certificate verification is no longer disabled on unrelated calls.** The startup hook that injects the GPU node's `Authorization` header into `requests` calls also forced `verify=False` on all of them, so every deployment that set a `VLLM_API_KEY` — i.e. every remote-GPU deployment — silently lost certificate verification for those calls, whether or not the endpoint needed it. Verification now follows `OPEA_SSL_SKIP_VERIFY`, matching the rest of the hook. The affected surface is `requests` calls inside the OPEA overlay images: the model endpoints (which is exactly the self-signed GPU node the opt-out exists for) and ArangoDB via python-arango — the latter over plain `http://` by default, so `verify` was moot there unless a deployment fronts ArangoDB with TLS. The backend and the document repository were never on this path: they are Node images with no `.pth` hook, and the overlay reaches them over `aiohttp`, which this hook only ever gave an `Authorization` header to. **Deployer impact:** a deployment pointing at a GPU node with a self-signed certificate that relied on the unconditional bypass must now set `OPEA_SSL_SKIP_VERIFY=1` (already documented in `env`); without it, calls to that node fail with a certificate error. **This bites the stock Ansible combination**: `gpu_node_host` set plus the `gpu_self_signed_certs: true` default, which is the documented remote-GPU setup. That deployment now needs `opea_ssl_skip_verify: "1"` in its `group_vars/<env>/vars.yml` — it will otherwise deploy cleanly and fail at its first model call. The value is deliberately NOT derived from `gpu_self_signed_certs`: switching off certificate verification is not a decision a template should make on the operator's behalf.
- **Known, still open: the GPU node's API key is sent to services that never needed it.** The same startup hook now gates `verify=False`, but it still injects `Authorization: Bearer $VLLM_API_KEY` into *every* `aiohttp` and `requests` call in the process, whatever the destination. The reachable case is dataprep's Keycloak service-account token fetch (`dataprep/keycloak_service_account.py`), which carries its own service-account header and no `Authorization`, so the GPU key goes to Keycloak — landing in its access logs and in anything that logs request headers upstream. Calls that build their own `Authorization` are unaffected (`setdefault` respects them) and py-arango is unaffected (it authenticates after this wrapper runs). This is left as-is here because the fix — scoping the injection to the GPU/TEI/vLLM hosts — changes authentication on the hot path of every model call and needs validation inside the built image, which no local suite can do. Design and routes are written up in `genie-ai-overlay/build-patches/comps_http_budget_debt.py` § "Adjacent finding"; tracked rather than silently shipped.
- **chatqna rejects unauthenticated requests:** `handle_request` now requires a `Bearer` token in the `Authorization` header and validates it against the Keycloak JWKS before reaching any business logic. Missing, malformed, or invalid tokens raise `HTTPException(status_code=401)`. The Bearer scheme is matched case-insensitively per RFC 7235 §2.1. The validated token is threaded as a function argument through `fetch_file_metadata`, `get_user_profile`, `_assemble_source_documents`, and `_stream_with_metadata`; no token state lives on the service instance or `request.state`, so concurrent requests cannot leak each other's tokens on outbound service-to-service calls. The legacy `tests/testing_genieai_chatqna.py` (a manual end-to-end CLI harness with its own copy of the old `set_token`/`_token` API) is removed.
- **The requested target language can no longer reach a translation prompt as free text.** The language travels in the request body (`context.language`), so it is caller-controlled: chatqna interpolated it straight into the translation prompt ("Translate the following text to <language>"), and the backend's translation service reached the same prompts through the model-specific language maps, where an inherited key such as `constructor` was handed out as a language name. A caller could therefore put instructions where a language belongs. The language is now resolved against the shipped language map on both sides, and an unknown code is refused rather than translated: the backend answers `400` and names only the refused side (the caller's value is never echoed back), and chatqna returns the English answer and logs the refusal. The name and the code that go into a prompt are taken from the map only, and the map lookups use own properties only, so an inherited key is not a language. The prompt also asks for the script the target language is written in, taken from a shipped table: a translation into a non-Latin language is no longer asked for in the Latin alphabet, and the source language is no longer named in the prompt by a hard-coded list. A source language is refused the same way: `POST /api/translate` and `POST /api/translate/markdown` take a `source_lang` from the request body, and it is now resolved against the language map before it is used. The chat path (`POST /api/queries`, and its streaming form `POST /api/queries/stream`) takes no source language — it detects the conversation's language itself. The backend resolves both languages once per request, before the cache lookup, and the translation cache key now carries the source language as well as the target one — as the codes the model is asked for, so a translation cached for one source language is not served for another, and two languages the model answers alike share one entry. The map is read once and kept in memory; a map that could not be read is remembered as unreadable for one minute and retried after that, so a transient read failure does not disable translation for the life of the process. **Deployer impact:** the backend and chatqna both read their language map at startup — after changing the language map files, restart both services, otherwise the running ones keep the map they read at startup. A refused language no longer steers the answer: chatqna keeps the answer in English and detects the language the question was actually written in, so the conversation history is normalized instead of being embedded untranslated (when the detection itself fails, there is no source language to translate from and the history is embedded as it is, as it was before). The history is normalized to **English** — the language the embeddings are in — and no longer follows the requested language: that target is now a constant of the service, so no request, and no later edit, can point the history at another language. The requested language steers the answer, not the history. An unknown target leaves the history untranslated instead of putting the caller's string into a prompt. A language the translation models do not cover is refused up front: the chat routes answer `400` with `{error: "UNSUPPORTED_LANGUAGE", message}` before anything is generated, so an answer is never produced in a language the caller did not ask for. A translation that fails for another reason — the translator is down, the call times out — is not the caller's mistake: the request goes through, the answer is delivered in English, and the stream reports the failure on the `done` frame (`translationFailed: true`) so the client can say so instead of presenting the English original as a translation. The non-streaming path reports it the same way, in the answer's metadata (`translation_status`: `ok`, `refused` or `failed`), so a client that reads the metadata can tell a translated answer from an untranslated one. chatqna's language map was missing 24 of the languages the backend supports, so the boundary would have refused them; the two lists are now the same 41 languages — the backend maps gained Hindi, Japanese and Korean, which chatqna already sent to the same models but the backend refused — and a parity test fails the build if they drift apart again. (#1097, !589)

### Added

- **Admin Logs panel powered by VictoriaLogs.** The admin logs UI now reads every container log from VictoriaLogs via the `/api/admin/logs/*` endpoints (search, range, summary, services). The previous file-rotation viewer is gone — operators get one queryable, time-bounded, service/level-filterable view across the whole stack from a single panel, with the same `trace_id` link to VictoriaTraces that already exists for the rest of the observability stack. A service-level inventory powers the panel's service dropdown from a single live VL query.
- **Trace correlation between logs and traces.** Each VictoriaLogs row carries the originating OTel `trace_id` / `span_id`, so clicking a trace id from the logs panel (or the LogQL `trace_id:` filter in Grafana) jumps directly to the matching span in VictoriaTraces. Applies to every service that emits through fluentd (backend, document-repository, all OPEA overlay services). Upstream images we do not fork (vLLM, TEI, ArangoDB, Kong, …) keep their plain-text logs and remain uncorrelated.
- **Per-service per-level error-rate metrics in the admin dashboard.** The admin system-health tile surfaces live error/warning rates per service (backed by OTel collector self-telemetry over VictoriaLogs), so an operator can spot a degraded service without opening Grafana.
- **VictoriaLogs health in the observability dashboards.** New tiles in the Observability Grafana folder expose ingest rate, query latency, storage size, and retention — previously these were implicit in the admin logs UI's response time.
- **Alert rule for silent PII-redaction regression.** `otel-pii-redact-fail` fires critical if the OTel collector's PII redaction transform drops anything or stops accepting records for 15 minutes — a safety net for the new collector-edge redaction pipeline.

### Changed

- **Single log ingestion channel.** Every log line from every service now flows through `stdout → Docker fluentd driver → OTel Collector → VictoriaLogs`. The previous dual-channel architecture (an in-process OTel SDK LoggerProvider exporting directly to VL alongside the fluentd driver) is gone. Deployers no longer need to configure `LOG_TO_VICTORIALOGS` or `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` — the docker logging driver carries every record to the collector regardless of env.
- **Admin logs outage behaviour is now a typed HTTP 503.** When VictoriaLogs is unreachable, `/api/admin/logs/*` returns `503` with `{error: "vl_unreachable", message}` instead of the previous soft-fail empty-state envelope. The frontend renders this as an explicit "VL unreachable" banner with the underlying error message — operators always know whether they are looking at "no data" or "VL is down". The previous `VL_FAIL_OPEN` env-var escape hatch is dropped.
- **Morgan HTTP access logs (Node services) normalised in the admin TYPE column.** The collector rewrites the raw morgan format into `METHOD PATH STATUS TIME` so the admin TYPE column shows a usable request summary instead of the raw `HTTP_REQUEST:` line.
- **Python log-level prefixes stripped at the collector.** The OTel collector strips the `ERROR:` / `WARNING:` / `INFO:` / `DEBUG:` prefix that Python's `logging` module (and uvicorn) prepends to every message, so the admin TYPE column shows the actual error message instead of bare severity words.

### Removed

- **`LOG_TO_VICTORIALOGS` env var.** No longer read by the runtime; safe to leave set in `.env`. Removed from `env`, the Ansible template, and `docker-compose.yaml`.
- **`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` env var.** No longer read; the docker fluentd driver has its own collector address.
- **`ADMIN_LOGS_SOURCE` env var.** No longer read; VictoriaLogs is the only source. Setting it has no effect.
- **`VL_FAIL_OPEN` env var.** Replaced by the typed `503 / vl_unreachable` contract — there is no longer a soft-fail mode.
- **The fallback language of the translation language maps.** Each shipped map named a fallback language: a request for a language the map did not know was answered in the language the map named as its fallback — silently, in a language the caller never asked for. The shipped maps only ever named fallbacks for languages they also supported, so the chain never walked in practice, but the mechanism was one map edit away from answering a French request in Spanish. The fallback is gone from the maps and from the backends: an unknown language is now always refused, never substituted. (#1097)
- **`LOG_TO_FILE` host bind mounts.** The `${DATA_DIR}/logs/{backend,doc-repo}:/app/logs` bind mounts are removed from `docker-compose.yaml`. The runtime `LOG_TO_FILE` boolean env var still works as an audit-retention escape hatch for operators who want to re-enable local file rotation, but they must now manually re-add the `/app/logs` bind mount if they do so (a comment in `env` documents this).

### Fixed

- **`/api/admin/users/search` returns 500 on every call.** `searchUsers()` passed `limit` and `offset` bind vars to the count query, which declares no `LIMIT` clause. ArangoDB rejects undeclared bind parameters (`errorNum 1552`), so every admin user-list request failed with HTTP 500 after the LIMIT-injection hardening landed. The count query now receives only the filter bind vars it declares. (#541)
- **Trace correlation across services we control.** Logs from backend, document-repository, and every OPEA overlay service now carry `trace_id` / `span_id` end-to-end, so clicking a log row opens the originating trace in VictoriaTraces. (#343)
- **Python `uvicorn.access` logs correlated with traces.** uvicorn HTTP access logs from OPEA services now include `trace_id` / `span_id` (previously they were plain text and uncorrelatable). (#343)
- **Log loss under burst ingest.** The docker fluentd driver buffer was saturated at 1 MB during ingest peaks and dropped records before they reached the collector. Bumped to 8 MB / 5 retries / 2 s backoff in the `x-logging` compose anchor. (#343)
- **Bare-severity rows in the admin logs TYPE column.** Python uvicorn / `logging` module messages no longer surface as `ERROR`, `WARNING`, `INFO` in the admin TYPE column — the leading level prefix is stripped at the collector and the column now shows the actual message head. (#343)
- **The mobile app answered in English whatever the interface language was.** The mobile chat client never sent the language it wanted the answer in, so the backend had no way to honour it: every answer came back in English. The mobile app now sends the interface language with the query, and — like the web client — says so when the answer could not be translated instead of presenting the English original as a translation. The FAQ sidebar follows the same rule. (#1097, !589)
- **The web client hid the reason the backend refused a request.** A failed request was reported as `HTTP <status>`, whatever the backend had actually said, so the user never learned why. The backend's message is now shown. (#1097, !589)
- **The mobile app reported a refused language as a generic failure.** When the backend refuses a language the deployment cannot answer in, the mobile chat client showed only "Error processing your request." The refusal code is now read from the response body and shown as its own message, in the interface language, on both the chat and the FAQ paths. (#1097, !589)

### Security

- **PII redaction enforced at the OTel collector edge.** The 19-key PII list (`configs/otel/pii-key-list.md`, CODEOWNER @jrevillard) is now applied at the export boundary into VictoriaLogs, covering every log path: docker fluentd driver (non-Node services, crashed-process edge cases), Winston envelope, and any ingestion route that bypasses the in-process SDK. Previously only services with a working in-process OTel SDK LoggerProvider had redaction; the collector-edge transform closes the gap and protects services that historically bypassed it. The new `otel-pii-redact-fail` alert rule (see Added) detects silent regressions. (#343)
- **The static-analysis scan surface now excludes two more trees, and one of them ships inside the mobile app.** `.gitlab-ci.yml` adds `.agents/**` (the BMAD agent-skill tree — developer tooling, never copied into an image and never executed by a deployed service) and `mobile/genie_ai_mobile/flutter_appauth/**` (the whole vendored checkout of the `flutter_appauth` plugin, a melos monorepo the app depends on through a `path:` dependency). The second exclusion covers more than the package the app compiles: the platform-interface package and the upstream GitHub Actions workflows inside that checkout are no longer scanned either — those workflows alone produced 9 findings that nobody owns. The tree carries code whose purpose is to skip TLS certificate validation (Android `InsecureConnectionBuilder`, iOS `InsecureURLProtocol`), reachable only when `KeycloakConfig.allowInsecureConnections` is true. Two tests now hold that in place: one asserts the flag is off in the `itu`, `staging` and per-institution flavor configurations and on in `dev` and `e2e`; the other asserts the gates inside the vendored fork itself, which no analyzer checks any more now that the tree is out of the scan — on Android and on both Apple platforms, structurally rather than by pattern, so a re-indented guard still passes and an unguarded one does not. The vendored fork **stays** in the repository: the instruction in the mobile `CLAUDE.md` to revert it to the upstream release before merging is removed, because upstream ignores `allowInsecureConnections` on iOS entirely. **Deployer impact — mobile release builds:** the app picks its flavor from the `FLAVOR` dart-define and falls back to `dev` when that define is absent, and `--flavor <name>` alone does not set it — a release build produced that way resolves the *dev* configuration, where the trust-everything HTTP client is enabled (every endpoint points at `localhost`, so the app cannot authenticate against a real deployment; it simply fails to log in). Every documented build command now sets **both** selectors — `--flavor <name> --dart-define=FLAVOR=<name>` — in the mobile README, the mobile `CLAUDE.md`, the mobile deployment guide and `build-release.ps1` (the release script now takes the flavor as a mandatory argument and refuses a release built from `dev` or `e2e`, the two flavors that arm the trust-everything client). The silent fallback itself is still there and is tracked as #1099. The earlier 2.1.0 note claiming the scan exclusions covered "only dev/test-only paths" no longer holds: one of them is code that ships in the APK. (#590)


## [2.1.0] - 2026-08-31

### Changed

- **OPEA upgrade from v1.3 to v1.5:** All four OPEA overlay images (chatqna, dataprep, retriever, reranker) now build from OPEA v1.5. The upgrade absorbs 7.5 months of upstream bug fixes and dependency CVEs while preserving GENIE's RAG behavior (retrieval, reranking, labeling, contextual retrieval). Rollback: redeploy the previous v1.3-based image tags.
- **Python 3.11:** Replaces Python 3.10 in all OPEA overlay images (matching OPEA v1.5's base). The dataprep image base changed from `nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04` to `python:3.11-slim` to align with OPEA v1.5 upstream — GPU support is maintained via pip-installed CUDA libraries (`cuda-toolkit`, `nvidia-cuda-runtime`).
- **Mobile client ID placeholders:** `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` in the `env` template changed from ITU-specific values to generic institutional placeholders (`genie-mobile-<institution>`, `com.<institution>.genieai`). Existing deployments unaffected.

### Fixed

- **Query endpoint ownership validation:** Query-related endpoints now enforce userId ownership. A user can no longer access query data belonging to another user — the endpoint returns 404 for non-existent queries, 403 for queries owned by another user.
- **Backend input validation:** API endpoints now validate `limit` and `offset` query parameters with proper bounds checking (min/max constraints). Invalid values (negative, non-numeric) return the default instead of silently producing unexpected queries.
- **Analytics filters error handling:** The `filters` query parameter on the analytics endpoint now returns a proper 400 error with `INVALID_FILTERS_JSON` code when malformed JSON is provided, instead of crashing with an unhandled exception.
- **Reranker index bounds:** Reranker now handles out-of-range TEI indices defensively — a buggy TEI response that returns fewer scores than documents no longer crashes with `IndexError`; the affected entry is skipped and the partial result is preserved.
- **Docling device auto-detection:** When `DOCLING_DEVICE=cuda` is requested but no GPU is available (CPU-only deployment), the dataprep service now falls back to CPU with a visible warning instead of crashing at docling initialization.
- **Backend CPU translation fallback crash:** When the GPU translation endpoint was unreachable, the CPU fallback crashed the backend at startup (EACCES on the transformers.js model cache and log directories owned by root while the image runs as uid 1000). Image directories are now pre-created writable, and fatal translation-worker errors fail fast with a clear message instead of hanging for the 20-minute init timeout. (#325)

### Security

- **Horizontal privilege escalation prevented:** Query message endpoints now validate that the requesting user owns the queried resource.
- **Dependency CVE remediation (GitLab Ultimate pipeline 6345, 2026-08-22):** Resolved 21 high-severity runtime CVEs across all JS components by bumping affected transitive and direct dependencies. Highlights: `protobufjs` 7.5.5 → 7.5.6 (5 CVEs including RCE via prototype pollution CVE-2026-44291, code injection CVE-2026-44293, DoS recursion CVE-2026-44289); `sharp` 0.32.6 → 0.35.0 (inherited libvips CVEs); `ip-address` 5.9.4 → 10.3.1 (SSRF via Address4 octal/decimal confusion CVE-2026-69192) via `geoip-lite` 1.4.10 → 2.0.3; `@opentelemetry/propagator-jaeger` 2.7.1 → 2.9.0 (DoS via malformed Jaeger header CVE-2026-59892); `js-yaml` → 4.3.1 across all manifests (quadratic CPU `!!omap` GHSA-5p4m-2wfm-xmqj); `dompurify` 3.2.6 → 3.4.14 (IN_PLACE hook XSS); `uuid`, `postcss`, `serialize-javascript`, `fast-uri` overrides; `@opentelemetry/core` 2.7.1 → 2.8.0 (unbounded memory W3C Baggage CVE-2026-54285).
- **Mobile AppAuth MITM vulnerability fixed:** The vendored `flutter_appauth` Android plugin previously wired an `InsecureConnectionBuilder` (which disables TLS certificate validation via a trust-everything `X509TrustManager`) into the `AuthorizationService` unconditionally at engine attach. Production now never instantiates an insecure service: `createAuthorizationServices()` lazy-instantiates the insecure service only when `allowInsecureConnections=true`, which only the dev and E2E configs set. Production flavors (`flavors/itu.dart`, `flavors/template.dart`) inherit `false` from `KeycloakConfig` and reach the secure path. An attacker on a hostile network (Wi-Fi, ISP proxy) can no longer MITM the Keycloak login flow on Android production builds.
- **SAST scan surface restricted:** `.gitlab-ci.yml` adds `SAST_EXCLUDED_PATHS` covering only dev/test-only paths (Windows desktop CMake runner, real-comps contract tests, jest test dirs, dev migration scripts, synthetic-data generators, coverage reports). The production Docker entrypoint `document-repository/scripts/clamav-node.sh` remains scanned. The previously advertised `SEARCH_IGNORED` variable was removed — it is not honored by any official GitLab SAST template.

- **Container least-privilege hardening:** All 37 compose services now run with `cap_drop: [ALL]`, `no-new-privileges`, and only the capabilities their entrypoints require. The GPU-node (`docker-compose.gpu.yaml`) and standalone-Arango compose files are hardened identically. **Breaking** for custom deployments with modified entrypoints: add the required `cap_add` to your overrides (#320, #324, #329)
- **Slimmed runtime images:** Backend, doc-repo, dataprep, retriever and reranker runtime stages moved to Debian slim bases with `apt-get upgrade` security-update layers at build time, removing the kernel-headers CVE surface; entrypoint/healthcheck tool inventory audited per image (#315)
- **keycloak-config image security updates:** The `adorsys/keycloak-config-cli` base (Ubuntu 24.04) now receives `apt-get upgrade` at build time, pulling published perl/p11-kit fixes on every rebuild (#328)
- **Crawler SSRF hardening:** Literal-IP validation (encoded-IPv4 normalization), DNS resolution checked against private ranges, and manual per-hop redirect revalidation (#318)
- **Dynamic `RegExp` hardening:** All interpolated `RegExp` construction sites escape their inputs or were refactored to plain string operations; the DNS safety layer gained dedicated tests (#319, #321)
- **Conversation key generation:** Backend uses `crypto.randomInt` instead of `Math.random` for conversation key suffixes (#318)
- **Frontend dev-server path containment:** The `gov-chat-frontend` static server restricts served paths to the project root (#323)
- **OPEA base images security patch:** `apt-get upgrade` layer added to the embedding/textgen wrappers, fixing openssl CVE-2026-31789 (#314)
- **Brace-expansion DoS overrides:** `brace-expansion` pinned above the affected versions across all four package locks (#323, #330)
- **file-type nested copy eliminated:** The transitive `file-type@16.5.4` under `mime-kind` (CVE-2026-31808, ASF parser infinite loop) is removed via a self-referencing override resolving to the direct 21.3.4 (#330)

## [2.0.1] - 2026-08-03

### Security

- **CVE remediation:** 3,466 critical/high vulnerabilities resolved across Docker base images, npm dependencies, and image tags
- **PostgreSQL 13 → 16 upgrade:** PostgreSQL 13 is end-of-life. The default image is now `postgres:16`.
  - **⚠ Deployers MUST follow `docs/UPGRADE.md`** — this is a **mandatory migration** with planned downtime. Run `pg_dumpall`, reset the `genieai`/`kong`/`keycloak` role passwords, and verify before restarting services.

### Changed

- **Docker base images updated:** Node.js `node:22`, Alpine `3.22`, Keycloak `26.7`, PostgreSQL `16`
- **Image tags pinned:** all `:latest` tags pinned to specific versions (Kong `3.9.3`, ClamAV `stable-debian`, vLLM `v0.10.0`, OPEA services, etc.)
- **Reranker default strategy:** `RERANKING_STRATEGY` now defaults to `slice` (top-N) with `RERANKER_TOP_N=3` — the `adaptive` strategy could return 0 documents with low TEI scores

### Fixed

- **Chat responses interrupted:** `max_tokens=None` rejected by pydantic ≥2.13 caused chat stream failures — fixed in ChatQnA

## [2.0.0] - 2026-07-28

### Added

- **Quick Help:** configurable dual-prompt system with customizable welcome message, knowledge hierarchy categories, and service labels for precise RAG retrieval filtering
- **Non-English document ingestion:** upload and translate Spanish PDFs into the RAG knowledge base
- **Account management:** administrators can deactivate and reactivate user accounts
- **RAG abstention:** the assistant now says "I don't know" instead of hallucinating when no relevant information is found — toggle via `CHATQNA_ENFORCE_ABSTENTION`
- **Contextual Retrieval (Anthropic-style):** LLM-generated document context is prepended to each chunk before embedding, improving retrieval relevance for domain-specific documents — toggle via `CONTEXTUAL_RETRIEVAL_ENABLED`
- **Reranking strategies:** configurable via `RERANKING_STRATEGY` (slice, threshold, knee, adaptive) — each deployment can select the method best suited to its data
- **Streaming translation:** chat output now streams in the target language during generation instead of waiting for the full English response first — enable via `STREAMING_TRANSLATION_ENABLED`
- **Multi-turn vector-space blending:** previous conversation turns influence retrieval, improving relevance in multi-turn chats — enable via `MULTI_TURN_BLEND_ENABLED`
- **Multi-crop query support:** users can query across multiple crop categories simultaneously
- **Faster document ingestion:** batched LLM labeling (4 chunks per call) with increased concurrency — processing time reduced by an order of magnitude
- **Remote GPU node:** deploy model services (vLLM, TEI) on a dedicated machine with TLS and API key authentication
- **Config-driven locale whitelist:** restrict active UI locales per deployment via `VUE_APP_AVAILABLE_LOCALES` — applies to web, mobile, and Keycloak login pages
- **Documentation site:** public Hugo/Docsy site with redesigned landing page, dark mode, and curated reference docs
- **Model selection guide:** comprehensive documentation on choosing and configuring LLM, embedding, and reranker models
- **Docker Swarm deployment:** fully automated via Ansible — one command to deploy the entire stack
- **Kong API gateway:** production-grade API gateway with automatic route configuration
- **SSL certificates:** automatic Let's Encrypt certificate provisioning and renewal
- **GPU support:** configurable NVIDIA GPU utilization and data type for vLLM inference in Swarm mode
- **Configurable RAG pipeline:** new variables (`ARANGO_PORT`, `EMBEDDING_SERVER_ENDPOINT`, `RETRIEVER_ARANGO_GRAPH_NAME`)
- **Keycloak OIDC authentication:** replaced the legacy authentication system with Keycloak as the central identity provider — single sign-on, password reset, and token lifecycle management
- **Mobile app OIDC migration:** Flutter app now uses Keycloak OIDC with build flavors, custom URL schemes, TLS enforcement, and network error recovery — no more legacy auth
- **SSE streaming:** LLM responses now stream in real-time via Server-Sent Events instead of waiting for the full response
- **Query Inspector:** admin tool for inspecting and debugging RAG pipeline results (what was retrieved, reranked, and sent to the LLM)
- **Dynamic favicon:** the browser favicon is set from the deployment configuration
- **Weather API hardening:** 5-second timeout on all external weather service calls to prevent hangs
- **Observability stack:** OpenTelemetry tracing across the entire RAG pipeline, with Grafana dashboards, VictoriaMetrics, and alerting (enable via `ENABLE_OBSERVABILITY=1`)

### Changed

- **UI theme system:** replaced hardcoded colors with CSS custom properties — custom themes can now be applied by overriding variables
- **Document repository file upload limit:** default reduced from 500 MB to 50 MB — adjustable via `MAX_FILE_SIZE`
- **Translation pipeline:** automatically detects model type from `VLLM_TRANSLATION_MODEL_ID` — no manual config needed
- **Translation backend:** default mode changed from `cpu` to `auto` — the system picks the best available translation method
- **Guardrails:** content guardrail service is now disabled by default; enable explicitly if needed
- **Deployment:** consolidated to a single `docker-compose.yaml` supporting both local dev (`docker compose`) and production Swarm (`docker stack deploy`)
- **Deployment:** all persistent data centralized under `./data/` directory
- **Deployment:** configuration files consolidated into single `configs/` directory
- **Nginx security headers:** `Permissions-Policy` now configurable per environment
- **LLM token limit:** removed the arbitrary 1024 max_tokens default — the LLM can now generate full responses
- **Locale parity:** all 14 locales brought to strict key parity — 81 unused keys removed, 9 missing translations added

### Security

- Fixed authentication bypass on `/email` route — no-token access to email operations (#422)
- Added admin authorization checks to database operations routes (#423)
- Prevented AQL injection by converting all database queries to tagged template literals (#425)
- Replaced all shell `exec()` calls with Node.js built-in APIs (#426)
- Prevented path traversal in file upload and log file operations (#431)
- Removed hardcoded `JWT_SECRET` fallback — the server now fails fast at startup if the secret is missing (#430)
- Removed hardcoded database password fallback in connection service (#432)
- Stopped leaking internal error messages in API responses (#434)
- Replaced real credentials with placeholders in environment templates (#424)
- Added admin authorization to file deletion routes (#467)
- Added magic-byte validation for file uploads — rejects files disguised by MIME type (#470)
- Sanitized Content-Disposition headers against CRLF injection attacks (#471)
- Added array size validation on batch file endpoints (#472)
- Added path traversal guard in file storage operations (#477)
- Removed legacy `_key <= 10` admin bypass — all admin access now role-based (#429)

### Fixed

- Mobile app now sends timestamps in UTC instead of device local time
- Translations created without `nameEN` on category and service documents (#531, #532)
- JWT token not forwarded from Authorization header to logout endpoint (#530)
- Duplicate logout call when navigating away from the app (#527)
- Database statistics API returning 404 on `/admin/database/stats` (#528)
- Admin toast notification when Quick Help labels don't match the knowledge hierarchy (#529)
- Admin role checks now use JWT claims instead of stale cached roles — changes take effect immediately
- Admin document search bar no longer collapses; pagination button labels no longer overflow (#830)
- Admin document status filter now case-insensitive (#832)
- Document re-ingestion/retraction status guard now case-insensitive (#831)
- Conversation saved twice on certain actions
- Markdown conversation export producing broken PDFs
- Missing routes causing mobile registration screen to fail
- Spanish responses appearing when English is selected — the UI language is now correctly included in all LLM requests (#579)
- Wrong i18n key causing SatisfactionHeatmap to display incorrectly (#580)
- Streaming SSE `|<-MSG->|` boundary markers no longer visible in chat output
- Label filters now correctly cleared when switching to Just Chat mode (#249)
- Just Chat no longer auto-submits a hidden prompt — enters free-form mode without sending any message
- Cross-document label contamination fixed — chunk labels scoped to their document (#216)

## [R_1_0_0] - 2026-03-16

Initial release for El Salvador agricultural AI assistant deployment.

[R_1_0_0]: https://opensource.unicc.org/un/itu/genie-ai/-/tags/R_1_0_0
[2.0.0]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/R_1_0_0...v2.0.0
[2.0.1]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.0.0...v2.0.1
[Unreleased]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.1.0...main
[2.1.0]: https://opensource.unicc.org/un/itu/genie-ai/-/compare/v2.0.1...v2.1.0
