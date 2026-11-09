# Demo Seeding — Agent Instructions

Populate a running GENIE.AI instance with a knowledge hierarchy, a
document corpus and an aligned quickHelp config, so the quick-help
buttons scope retrieval to real content. Tool: `deploy/demo-seed/`
(`genie-demo-seed.py` + `demo-seed-config.json`); full contracts and
gotchas live in its README — this file is the runbook.

## When

- A fresh demo/evaluation instance has an empty ArangoDB and the
  shipped default config (quick-help buttons pointing at a hierarchy
  that does not exist).
- The operator asks for "seed data", "demo content" or working
  quick-help buttons on a deployment.

Do NOT run it against a production deployment without an explicit
operator GO — it deletes the existing hierarchy (phase 1) and replaces
the frontend's runtime config.

## Run

```bash
# prerequisites: three port-forwards (see deploy/demo-seed/README.md)
cd deploy/demo-seed
KC_ADMIN_USER=admin KC_ADMIN_PASS=<master pwd> DEMO_ADMIN_PASS=<genie-admin pwd> \
  python3 -I genie-demo-seed.py --apply-config
```

The passwords live in the cluster secrets (`keycloak-admin-credentials`,
`keycloak-convergence-credentials`) — never in the repo. The script
mints its own admin token through the documented temp-ROPC dance
(SERVER-TESTING.md) and reverts it on every mint.

## Modes

- `--dry-run` — plan only; run it first, always.
- `--skip-reset` — keep the existing hierarchy (create-if-absent still runs).
- `--ingest-only` — re-ingest already-uploaded files.
- `--labels-mode family` — make the SERVICE hierarchy level retrievable
  (default `category` leaves service scoping inert; costs a re-ingest).
- `--skip-reset --skip-upload --skip-ingest --apply-config` — config swap only.

## Contracts that bite (details in deploy/demo-seed/README.md)

1. Hierarchy MUST exist before ingest — dataprep fetches the taxonomy
   per ingestion; no hierarchy = dead scoping.
2. Chunk labels = `(LLM ∩ taxonomy) ∩ file_labels` — file labels outside
   the hierarchy starve retrieval; the purge marker lives in `author`,
   never in labels.
3. Ingested files refuse DELETE (409) — retract first.
4. dataprep serves ONE ingest lane — per-file ingest with 429 backoff.
5. `GET /api/files` is paginated (10/page).
6. The frontend config is mounted via a subPath ConfigMap — updating the
   CM needs a rollout RESTART; the script does it. Restore baseline:
   `kubectl -n <ns> rollout undo deploy/<frontend> && kubectl -n <ns> delete cm genie-demo-config`.
7. The frontend validates its config against the schema embedded in the
   document — quickHelp buttons REQUIRE `styles` + `action.hiddenPrompt`.

## Verify after a run

- All files `Ingested` (ArangoDB `files`, `author=genie-demo-seed`).
- Scoped retrieval per category returns theme-matching chunks — run it
  from INSIDE the chatqna pod (the retriever NetworkPolicy admits only
  chatqna): embed via `embedding:6000/v1/embeddings`, then
  `retriever:7000/v1/retrieval` with
  `search_start: "chunk::labels:<Category>"`.
- The frontend serves the new config (`/config/genie-ai-config.json`)
  and shows the buttons without the schema-error screen.
