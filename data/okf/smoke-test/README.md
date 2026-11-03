# OKF smoke harness

The `run-smoke*.js` family is the story smoke harness — every OKF story
extends and re-runs it live before its work is called done (the standing
review rule). They run INSIDE the okf-server container against a live
deployment; `kenya-bundle*` are the fixture corpora and `mint-tokens.mjs`
mints the scoped smoke tokens.

| Script | What it proves |
|---|---|
| `run-smoke.js` | The whole write-side control plane end-to-end: import, publish, ingest, labels, ACL, PII, cleanup (and both scoped and scopeless token paths). |
| `run-smoke-happy.js` | Happy path only — ingest `kenya-bundle-clean` (5 conforming concepts), publish, approve. |
| `run-smoke-building-gate.js` | The building gate: mutations refused while a conversion/indexing run is active. |
| `run-smoke-import-documents.js` | The document→OKF import pipeline (mode B). |
| `run-smoke-lifecycle.js` | The lifecycle state machine: submit → review → approve, per-transition refusals. |

Run pattern (from the repo root):

```bash
docker cp data/okf/smoke-test/run-smoke.js <okf-server-container>:/app/
docker cp data/okf/smoke-test/kenya-bundle-clean <okf-server-container>:/app/
docker exec -e OKF_SMOKE_TOKEN_ADMIN=<...> <okf-server-container> node /app/run-smoke.js
```

Tokens: `node mint-tokens.mjs` prints the `OKF_SMOKE_TOKEN_*` values
(scoped `okf:smoke:{repo}:read` on the smoke repo, plus the admin token).
Bundles live on the container at `/app/<name>` — the script headers show
the exact `docker cp` set per script.

## Removed one-shots (2026-11-02 review round)

`fix-escape.js`, `list-escape.js`, `probe-escape.js`,
`legacy-golden-capture.cjs`, `legacy-golden-{pre,post}-rebase.json`,
`legacy-ingest-smoke.js`, `file-crawler-issues.sh`, `file-stage1-issues.sh`,
`run-lifecycle.sh`, `editor-smoke-tokens.json` and the superseded
`kenya-bundle-2.0` corpus were deleted as one-shot session artifacts (the
same sweep that removed the frontend codemods). Their output, where it
mattered, is baked into the surviving fixtures and this family.
