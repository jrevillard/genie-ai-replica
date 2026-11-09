# GENIE.AI demo seed tooling

Populate a running GENIE.AI instance with a knowledge hierarchy, a
document corpus, and an aligned quickHelp config — so the quick-help
buttons scope retrieval to real content. Adapted for the GENIE.AI
docs-site corpus; the seed data is fully data-driven
(`demo-seed-config.json`), so another install can ship its own
hierarchy/corpus/buttons without touching the script.

## Files

| File | Role |
|---|---|
| `genie-demo-seed.py` | the tool (phases: reset → hierarchy → upload → ingest → config) |
| `demo-seed-config.json` | ALL seed data: hierarchy (categories + FR + services), corpus (path → category), quickHelp buttons, welcome message |
| `genie-ai-config.json` | generated output (phase 5) — the config that gets mounted into the frontend |

## Prerequisites

```bash
# two port-forwards
kubectl -n genieai port-forward svc/backend 13000:80 &
kubectl -n genieai port-forward svc/document-repository 13001:80 &

# one Keycloak admin port-forward (only for token self-minting)
kubectl -n genieai port-forward svc/keycloak-service 18080:80 &
```

Credentials — either:

- `GENIE_TOKEN=<admin JWT>` (fresh — TTL is ~5 min), or
- self-minting: `KC_ADMIN_USER=admin KC_ADMIN_PASS=<master admin pwd> DEMO_ADMIN_PASS=<genie-admin pwd>`
  (the script performs the documented temp-ROPC dance per mint and reverts
  it immediately; `.claude/rules/SERVER-TESTING.md`)

On the forge k3s the passwords live in: `keycloak-admin-credentials`
(master) and `keycloak-convergence-credentials` (`GENIE_ADMIN_PASSWORD`
= the genie-admin realm user).

## Run

```bash
# full seed, first time
KC_ADMIN_USER=admin KC_ADMIN_PASS=... DEMO_ADMIN_PASS=... \
  python3 -I genie-demo-seed.py --apply-config

# plan only (no writes)
python3 -I genie-demo-seed.py --dry-run

# config swap only (hierarchy/files untouched). If --base-config is not
# given (default /tmp/k3s-config.json does not exist), the script fetches
# the live config from the frontend pod itself.
python3 -I genie-demo-seed.py --skip-reset --skip-upload --skip-ingest --apply-config

# re-ingest only (files already uploaded)
python3 -I genie-demo-seed.py --ingest-only --poll-minutes 45

# make the SERVICE hierarchy level retrievable too (costs a full re-ingest)
python3 -I genie-demo-seed.py --labels-mode family
```

`python3 -I` is required if any stray module could shadow the stdlib
(e.g. running from a directory that contains a `bisect.py`).

## Contracts the script encodes (learned the hard way)

1. **Hierarchy before ingest.** Dataprep fetches the taxonomy from
   `GET /api/service-categories/categories` at the start of EVERY
   ingestion (`genieai_dataprep_arangodb.py:4356`). No hierarchy →
   "No labels found in Taxonomy" fallback → dead scoping. The script
   always runs the create-if-absent hierarchy phase before ingest.
2. **Chunk labels = (LLM ∩ taxonomy) ∩ file_labels.**
   (`genieai_dataprep_arangodb.py:4065`.) File labels outside the
   hierarchy produce chunks nothing can ever scope to. NEVER put a
   purge marker in labels — the `author` field is the marker.
3. **Retract before delete.** An INGESTED file refuses DELETE with 409
   (`fileService.js:822`). Purge order: retract → delete; kill-ingest
   first only when an ingest is in flight.
4. **One ingest lane.** dataprep accepts ONE concurrent ingest; a bulk
   `POST /api/files/ingest` 429s everything after the first file. The
   script ingests per-file with 429 backoff.
5. **GET /api/files is paginated** (10/page default) — page until
   exhausted or you silently miss files.
6. **subPath ConfigMap mounts never refresh.** Updating the CM content
   does not reach a running pod; the script applies + RESTARTS the
   frontend deployment every time. Restore baseline: the patch and the
   restart EACH create a rollout revision, so undo TWICE (a single undo
   lands on the patched template and deleting the CM then breaks
   mounting), then delete the CM:
   `kubectl -n genieai rollout undo deploy/<fe>; kubectl -n genieai rollout undo deploy/<fe>; kubectl -n genieai delete cm genie-demo-config`
   (or a single `rollout undo --to-revision=<pre-patch>`).
7. **Config schema is self-validating.** The frontend validates
   `/config/genie-ai-config.json` against the schema embedded in the
   document; quickHelp buttons REQUIRE `styles` +
   `action.hiddenPrompt` — an invalid config shows the error screen.
   The generated config is validated locally against that schema in
   `genie-ai-config.json` itself.
8. **Inline icons are data URIs.** The component feeds `icon.value`
   straight into `<img src>` — an inline SVG must be URL-encoded with
   `%23` for `#`.

## Verification (after a run)

```bash
# statuses
kubectl exec -n genieai deploy/genieai-genieai-umbrella-backend -- node -e "..."
# scoped retrieval, one per button (runs INSIDE the chatqna pod — the
# retriever's NetworkPolicy admits only chatqna):
#   embed text (POST embedding:6000/v1/embeddings)
#   then POST retriever:7000/v1/retrieval
#     {text, embedding, search_start: 'chunk::labels:<Category>', k: 3}
```

Expect: every category returns chunks whose text matches its theme.
Chunks without labels are legitimate — command blocks and boilerplate
get `[]` from the LLM (nothing in the taxonomy applies).

## Known limitations

- `--labels-mode category` (default) leaves the SERVICE level of the
  hierarchy inert for retrieval: chunks carry only their category
  label, so a `serviceLabels`-scoped query returns nothing. Use
  `--labels-mode family` (and re-ingest) to make services scopable.
- Adding a category AFTER a document was ingested does not
  retroactively label its chunks — re-ingest.
- The ingest is serial (one lane): ~1-2 min per doc on a remote GPU.
