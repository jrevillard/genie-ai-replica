# Configuration & UI — storage, API, and the self-explaining screen

Companion to SPEC.md. Patterns from the 2026-10-18 settings-UI research.

## Storage: `okf_system_config` keyed doc

Clone the retrieval-governance precedent (Story 1.7 / ADR-okf-039 D3,
`retrieval-config-service.js`): collection `okf_system_config`, doc `_key:
'frontier_model'`, repo-independent (no indexes beyond `_key`), env defaults merged
field-by-field with the stored doc (the doc never has to exist).

```jsonc
{
  "_key": "frontier_model",
  "enabled": true,                    // master switch — off = pure local (cardinal rule)
  "provider": "openai-compatible",    // | "anthropic"
  "base_url": "https://api.openai.com/v1",
  "api_token": "<write-only>",        // never returned by GET; masked in audit
  "model": "gpt-4.1",
  "context_tokens": 1047576,          // drives per-leg prompt budgets (CAP-6)
  "operations": {                     // per-op delegation; false = local
    "import_curation": true,
    "ingest_labeling": true,
    "ingest_contextual": true,
    "head_tags": true,
    "suite_generation": true,
    "ragas_generation": true,
    "ragas_judging": false,           // open question — default off
    "inference": false                // default off: frontier in the chat path is a deliberate choice
  },
  "updated_at": "...", "updated_by": "...", "_rev": "..."
}
```

Write path: joi validation at the controller boundary → optimistic concurrency (`_rev`
precondition, one retry) → revision bump → audit BEFORE/AFTER with **token masked**
(hazard: `retrieval-config` writes `details.before/after` verbatim into
`okf_audit_logs`, rendered by the Logs UI — the frontier service must strip the token
from audit details). Read path: GET returns everything EXCEPT `api_token`, plus
`token_configured: true/false` (the `updated_by`-nulling precedent).

API surface (okf-routes.js):

- `GET /api/okf/frontier-config` — servingReads sub-router (read for the status badge).
- `PUT /api/okf/frontier-config` — `requireRole('tools-admin')` (true enforcement; the
  frontend gates visibility only).
- `POST /api/okf/frontier-config/test` — tools-admin; server-side adapter
  `testConnection()` (never a browser-direct provider call with the token).
- `GET /api/okf/frontier-config/models` — tools-admin; server-side `listModels()`
  (pagination normalized; Anthropic `limit=1000`).
- `GET /internal/llm-routing` — X-Internal-Secret (RAGAS_INTERNAL_SECRET convention);
  returns the RESOLVED per-operation routing for OPEA consumers; NOT publicly routed.

## The screen (first OKF admin-config UI)

Placement: a new **AdminDashboard tab** ("Model Routing") — system-level config is
repo-independent; NOT inside RepoEditor/HeadTestDialog (repo-scoped). Visibility follows
the `isAdmin` NavBar pattern; enforcement is the server-side `requireRole`.

Layout (DS components only):

- **Provider card** (`DsCard`): provider `DsSelect` (OpenAI-compatible / Anthropic),
  base URL `DsInput` (`DsFormGroup` labels), access token `DsInput type="password"`
  (first credential field in this frontend — placeholder "leave blank to keep the saved
  token"), model `DsCombobox` in `remote` mode (AccessPanel group-picker precedent:
  debounced `@search`, or a Fetch button filling options; `displayText` falls back to
  the stored id before any fetch), context window `DsInput` (number, prefilled from the
  models list when the provider exposes it), Test connection `DsButton` (spinner +
  result `DsPill` ok/fail + the provider's own error text), master enabled toggle.
- **Operations card**: one row per routing-table entry — checkbox (native input in
  label, the RagasPanel metrics house style; no DsCheckbox exists) + name + a one-line
  "what this moves" description (CAP-8). **Future-extension rows** (inference;
  ingestion labeling; contextual generation) render DISABLED with their checkbox
  greyed and a "future extension" `DsPill` — visible so administrators know they
  exist, honest that they don't work yet.
- **Every control carries its explanation inline** (David 2026-10-18: "make it very
  clear in the configuration screen what each option does"):
  - provider: "Which API family the endpoint speaks. OpenAI-compatible also covers
    vLLM, LiteLLM and OpenRouter."
  - base URL: "Where requests go. Include `/v1` for OpenAI-compatible endpoints;
    Anthropic takes the bare host."
  - token: "Stored write-only; never displayed again, never written to logs."
  - model: "Pulled from the provider's model list, or typed by hand."
  - context window: "Prompts for delegated work are sized to fit this. Wrong value =
    overflow errors or wasted capacity."
  - each operation checkbox: what work moves, e.g. ingestion labeling — "Chunk
    labeling during ingest runs on the frontier model; falls back to the local GPU if
    it fails, and the Ingestion Log says which served each batch." Inference — "Chat
    answers use the frontier model; retrieval, embeddings and reranking always stay
    local; if the frontier fails mid-chat the next answer resumes locally."
  - the master switch: "Off = everything uses the locally configured GPU model,
    exactly as before this feature existed."
- i18n: all strings via `translate('okf.frontierConfig.*', fallback)` mirrored across
  the 14 locales (localeConsistency gate); man.js English per convention.
- Store: `frontierConfig` service + okf-module actions returning the canonical
  `{ok, code, message, result}` envelope; add the service to `ensureServices()`.

## Env seeding (optional, deployment-level)

`FRONTIER_LLM_PROVIDER/BASE_URL/API_KEY/MODEL/CONTEXT_TOKENS` seed the doc's defaults
at boot (the retrieval-config env-default merge); the UI remains the primary surface.
Unset ⇒ no profile ⇒ cardinal default rule.
